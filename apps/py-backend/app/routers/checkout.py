"""Checkout.

This is the only way to start a payment. The handler refuses to trust the
request:

* The price of each line comes from the product row, never from the client.
* A fulfillment channel is required, and the server re-quotes it. Omitting
  the channel used to skip the price check; that path is gone.
* A guest must present the single-use proof from ``verify-email-otp``.
  A signed-in customer is already verified by their token.
* Any coupon is evaluated again here. The discount the client claims is ignored.
* The order row, the stock reservation, and the coupon redemption commit
  in one transaction. An order without its reservation would oversell.
  A reservation without an order would leak stock.

The amount sent to Razorpay is the server's subtotal + delivery fee + gift
wrap, minus coupon and store credit. The client's ``amount`` only has to
agree within one rupee, which absorbs rounding.
"""

from __future__ import annotations

import logging
import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts import credit_balance, spend_credit
from app.auth import optional_claims
from app.coupons import Discount, evaluate, redeem
from app.errors import APIError, CouponRejected, OutOfStock
from app.fulfillment import Cart, CartItem, option_for, policy_from_settings, quote
from app.inventory import reserve
from app.metrics import inventory_conflicts
from app.models import Order, OrderItem, Product, ProductSize, alive
from app.notify import send_email, smtp_ready
from app.otp import consume_proof, generate_email_otp, issue_proof, verify_email_otp
from app.payments import create_razorpay_order
from app.ratelimit import client_ip, limit
from app.routers.deps import get_db

log = logging.getLogger("growman.checkout")
router = APIRouter(dependencies=[Depends(limit("checkout", 20, 60, fail_closed=True))])

PINCODE = re.compile(r"^[1-9][0-9]{5}$")
PHONE = re.compile(r"^[6-9][0-9]{9}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
GIFT_WRAP_FEE = 49.0
AMOUNT_TOLERANCE = 1.0
PAYABLE = {"store_pickup", "courier", "own_vehicle"}


class LineIn(BaseModel):
    productId: int
    productSizeId: int | None = None
    quantity: int = Field(ge=1)
    # Accepted and ignored. Documented so a reader sees the client still sends it.
    price: float | None = None


class CustomerIn(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    addressLine: str = ""
    city: str = ""
    state: str = ""
    pincode: str = ""


class QuoteIn(BaseModel):
    items: list[LineIn]
    pincode: str = ""
    latitude: float | None = None
    longitude: float | None = None


class OrderIn(BaseModel):
    amount: float
    currency: str = "INR"
    items: list[LineIn]
    customer: CustomerIn
    fulfillmentChannel: str = ""
    latitude: float | None = None
    longitude: float | None = None
    verificationToken: str = ""
    couponCode: str = ""
    giftWrap: bool = False
    giftNote: str = ""
    hidePrice: bool = False
    deliverySlot: str = ""
    preferredDeliveryDate: str = ""
    useCredit: bool = False


class CouponIn(BaseModel):
    code: str
    items: list[LineIn] = []
    email: str = ""


def _cart_from_db(db: Session, lines: list[LineIn]) -> tuple[Cart, list[OrderItem]]:
    """Resolve every line in two queries, then price it from the database."""
    if not lines:
        raise APIError(400, "cart is empty")
    product_ids = [line.productId for line in lines]
    size_ids = [line.productSizeId for line in lines if line.productSizeId]
    products = {
        p.id: p
        for p in db.scalars(select(Product).where(Product.id.in_(product_ids), alive(Product))).all()
    }
    sizes = {}
    if size_ids:
        sizes = {s.id: s for s in db.scalars(select(ProductSize).where(ProductSize.id.in_(size_ids))).all()}

    cart_items: list[CartItem] = []
    order_items: list[OrderItem] = []
    for line in lines:
        product = products.get(line.productId)
        if product is None:
            raise APIError(400, f"product {line.productId} not found")
        size = None
        if line.productSizeId:
            size = sizes.get(line.productSizeId)
            if size is None or size.product_id != product.id:
                raise APIError(400, f"product size {line.productSizeId} not found")
        unit = size.price if size else product.price
        size_class = (size.size_class if size and size.size_class else None) or product.size_class
        bulky = size.bulky if size and size.bulky is not None else product.bulky
        label = f"{product.name} ({size.label})" if size and size.label else product.name
        cart_items.append(CartItem(size_class=size_class or "small", bulky=bool(bulky), quantity=line.quantity, unit_price=unit))
        order_items.append(
            OrderItem(
                product_id=product.id,
                product_size_id=size.id if size else None,
                quantity=line.quantity,
                price=unit,
                name=label,
                image_key=(size.image_keys[0] if size and size.image_keys else product.image_key) or "",
            )
        )
    return Cart(cart_items), order_items


def _quote(request: Request, db: Session, lines: list[LineIn], lat, lng, pincode: str) -> dict:
    cart, _items = _cart_from_db(db, lines)
    settings = request.app.state.settings
    policy = policy_from_settings(settings)
    courier_checked = False
    serviceable = True
    rate = None
    name = ""
    days = 0
    client = request.app.state.shiprocket
    # A live lookup records Growman's cost. Failure leaves the zone fee
    # standing; it does not block the sale.
    if client and client.configured and settings.store_pincode and pincode:
        looked = client.serviceability(settings.store_pincode, pincode, max(cart.units, 1))
        if looked is not None:
            courier_checked = True
            serviceable = bool(looked.get("serviceable"))
            rate = looked.get("rate")
            name = looked.get("name") or ""
            days = int(looked.get("days") or 0)
    return quote(
        policy,
        cart,
        lat,
        lng,
        pincode,
        courier_checked=courier_checked,
        courier_serviceable=serviceable,
        courier_rate=rate,
        courier_name=name,
        courier_days=days,
    )


def _public_quote(quoted: dict) -> dict:
    # Drop the cost-side keys before the quote reaches the browser.
    return {k: v for k, v in quoted.items() if not k.startswith("_")}


@router.post("/checkout/quote")
def quote_fulfillment(body: QuoteIn, request: Request, db: Session = Depends(get_db), _claims=Depends(optional_claims)):
    quoted = _quote(request, db, body.items, body.latitude, body.longitude, body.pincode)
    return {"quote": _public_quote(quoted), "courierProvider": request.app.state.settings.courier_provider}


class EmailOTPIn(BaseModel):
    email: str


@router.post("/checkout/send-email-otp")
def send_email_otp(body: EmailOTPIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not EMAIL.match(email):
        raise APIError(400, "invalid email format")
    # A registered customer should sign in and use their saved address.
    from app.models import User

    if db.scalar(select(User.id).where(User.email == email, alive(User))):
        raise APIError(409, "user_exists")
    settings = request.app.state.settings
    if settings.is_prod and not smtp_ready(settings):
        raise APIError(503, "email_unavailable")
    code, retry = generate_email_otp(request.app.state.redis, f"checkout:{email}")
    if code is None:
        raise APIError(429, "otp_cooldown", retry_after=retry)
    if smtp_ready(settings):
        send_email(settings, email, "Confirm your Growman order", f"Your code is {code}. It expires in 10 minutes.")
    else:
        log.warning("SMTP is not configured. Checkout OTP for %s is %s", email, code)
    return {"message": "OTP sent successfully", "cooldown": 60}


class VerifyOTPIn(BaseModel):
    email: str
    otp: str


@router.post("/checkout/verify-email-otp")
def verify_checkout_otp(body: VerifyOTPIn, request: Request):
    email = body.email.strip().lower()
    if not verify_email_otp(request.app.state.redis, f"checkout:{email}", body.otp):
        raise APIError(400, "invalid or expired OTP")
    # The proof is what create-order consumes. Without it, a client could
    # skip this endpoint and still place an order for any address.
    proof = issue_proof(request.app.state.redis, f"checkout:{email}")
    return {"success": True, "message": "OTP verified successfully", "verificationToken": proof, "expiresIn": 900}


@router.post("/checkout/validate-coupon")
def validate_coupon(
    body: CouponIn,
    request: Request,
    db: Session = Depends(get_db),
    claims=Depends(optional_claims),
):
    _cart, items = _cart_from_db(db, body.items) if body.items else (Cart(), [])
    subtotal = sum(i.price * i.quantity for i in items)
    try:
        discount = evaluate(
            db,
            body.code,
            subtotal,
            items,
            claims.user_id if claims else None,
            body.email,
        )
    except CouponRejected:
        raise
    return {
        "code": discount.code,
        "type": discount.type,
        "amount": discount.amount,
        "freeShipping": discount.free_shipping,
        "description": discount.description,
    }


@router.post("/checkout/create-order")
def create_order(
    body: OrderIn,
    request: Request,
    db: Session = Depends(get_db),
    claims=Depends(optional_claims),
):
    customer = body.customer
    if not PINCODE.match(customer.pincode or ""):
        raise APIError(400, "invalid pincode format")
    if not PHONE.match(customer.phone or ""):
        raise APIError(400, "invalid phone number format")
    if not EMAIL.match((customer.email or "").strip()):
        raise APIError(400, "invalid email format")
    if body.amount <= 0:
        raise APIError(400, "amount must be greater than 0")
    email = customer.email.strip().lower()

    if claims is None:
        if not consume_proof(request.app.state.redis, f"checkout:{email}", body.verificationToken):
            raise APIError(403, "email_not_verified", reason="Please verify your email address before placing the order.")

    cart, items = _cart_from_db(db, body.items)
    _check_stock_preview(db, items)

    channel = body.fulfillmentChannel.strip()
    if not channel:
        raise APIError(400, "fulfillment_channel_required", reason="Choose a delivery option before placing the order.")
    if channel == "bulk_quote":
        raise APIError(400, "bulk orders are quoted by sales, not paid at checkout")
    if channel not in PAYABLE:
        raise APIError(400, "unknown fulfillment channel")

    quoted = _quote(request, db, body.items, body.latitude, body.longitude, customer.pincode)
    chosen = option_for(quoted, channel)
    if not chosen or not chosen["available"]:
        raise APIError(409, "channel_unavailable", reason=(chosen or {}).get("reason") or "unavailable", quote=_public_quote(quoted))

    gift = GIFT_WRAP_FEE if body.giftWrap else 0.0
    expected = quoted["subtotal"] + chosen["fee"] + gift
    if abs(body.amount - expected) > AMOUNT_TOLERANCE:
        raise APIError(409, "amount_mismatch", expectedAmount=round(expected, 2), quote=_public_quote(quoted))
    # Charge the server's figure now that the client agrees within rounding.
    amount = round(expected, 2)

    slot = body.deliverySlot.strip().lower()
    if slot and slot not in {"morning", "evening"}:
        raise APIError(400, "Delivery slot must be morning or evening.")
    preferred = None
    if body.preferredDeliveryDate.strip():
        try:
            preferred = datetime.strptime(body.preferredDeliveryDate.strip(), "%Y-%m-%d")
        except ValueError as exc:
            raise APIError(400, "preferredDeliveryDate must be YYYY-MM-DD") from exc
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        if preferred < today or preferred > today + timedelta(days=21):
            raise APIError(400, "Choose a delivery date within the next 3 weeks.")

    discount: Discount | None = None
    if body.couponCode.strip():
        discount = evaluate(
            db,
            body.couponCode,
            quoted["subtotal"],
            items,
            claims.user_id if claims else None,
            email,
        )
        if discount.free_shipping:
            amount = round(amount - chosen["fee"], 2)
            discount.amount = chosen["fee"]
        else:
            amount = round(amount - discount.amount, 2)
        if amount < 1:
            raise CouponRejected("This code would bring the order below the ₹1 minimum. Please contact us to arrange it.")

    credit_applied = 0.0
    if claims and body.useCredit:
        available = credit_balance(db, claims.user_id)
        if available > 0:
            credit_applied = min(available, amount - 1)
            credit_applied = round(credit_applied, 2)
            if credit_applied > 0:
                amount = round(amount - credit_applied, 2)

    razorpay = create_razorpay_order(request.app.state.settings, amount, body.currency or "INR")
    order = Order(
        user_id=claims.user_id if claims else None,
        razorpay_order_id=razorpay["id"],
        public_token=secrets.token_hex(32),
        payment_status="created",
        status="pending",
        amount=amount,
        currency=body.currency or "INR",
        customer_name=customer.name.strip(),
        customer_email=email,
        customer_phone=customer.phone,
        client_ip=client_ip(request)[:64],
        user_agent=(request.headers.get("user-agent") or "")[:512],
        address_line=customer.addressLine,
        city=customer.city,
        state=customer.state,
        pincode=customer.pincode,
        fulfillment_channel=channel,
        fulfillment_zone=quoted["zone"],
        subtotal=quoted["subtotal"],
        delivery_fee=0 if discount and discount.free_shipping else chosen["fee"],
        delivery_fee_waived=bool(chosen.get("feeWaived")) or bool(discount and discount.free_shipping),
        distance_km=quoted["distanceKm"],
        distance_source=quoted["distanceSource"],
        latitude=body.latitude,
        longitude=body.longitude,
        courier_provider=request.app.state.settings.courier_provider if channel == "courier" else "",
        courier_service=quoted.get("_courierName") or "",
        courier_cost=quoted.get("_courierCost"),
        gift_wrap=body.giftWrap,
        gift_note=body.giftNote[:300],
        hide_price=body.hidePrice,
        gift_fee=gift,
        delivery_slot=slot,
        preferred_delivery_date=preferred,
        credit_applied=credit_applied,
        coupon_code=discount.code if discount else "",
        discount_total=discount.amount if discount else 0,
    )
    if discount:
        order.coupon_id = discount.coupon.id
    order.items = items

    try:
        db.add(order)
        db.flush()
        if credit_applied > 0 and order.user_id:
            spend_credit(db, order.user_id, credit_applied, order.id)
        reserve(db, order.items)
        redeem(db, discount, order)
    except OutOfStock:
        inventory_conflicts.inc()
        raise
    except CouponRejected:
        raise

    response = {
        "id": razorpay["id"],
        "amount": razorpay.get("amount"),
        "currency": razorpay.get("currency", "INR"),
        "status": razorpay.get("status", "created"),
        "orderId": order.id,
        "publicToken": order.public_token,
        "subtotal": order.subtotal,
        "deliveryFee": order.delivery_fee,
        "fulfillmentChannel": order.fulfillment_channel,
    }
    if discount:
        response["discount"] = order.discount_total
        response["couponCode"] = order.coupon_code
    if credit_applied:
        response["creditApplied"] = credit_applied
    return response


def _check_stock_preview(db: Session, items: list[OrderItem]) -> None:
    """Friendly 409 before payment. The reservation inside the transaction is the real check."""
    problems = []
    product_ids = [i.product_id for i in items]
    products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_(product_ids))).all()}
    size_ids = [i.product_size_id for i in items if i.product_size_id]
    sizes = {s.id: s for s in db.scalars(select(ProductSize).where(ProductSize.id.in_(size_ids))).all()} if size_ids else {}
    for item in items:
        product = products[item.product_id]
        if not product.track_inventory:
            continue
        available = sizes[item.product_size_id].stock if item.product_size_id else product.stock
        if available < item.quantity:
            problems.append(
                {
                    "productId": item.product_id,
                    "productSizeId": item.product_size_id,
                    "name": item.name,
                    "requested": item.quantity,
                    "available": max(available, 0),
                }
            )
    if problems:
        raise OutOfStock(items=problems, name=problems[0]["name"])
