"""Prices, stock, coupons, and the one way an order becomes paid.

The browser sends a total. We recompute it. Stock moves in the same
transaction as the order. Payment verify and the Razorpay webhook both
call mark_paid, and only the first one notifies the customer.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app import delivery
from app.http import APIError
from app.models import (
    Coupon,
    CouponRedemption,
    CreditEntry,
    Order,
    OrderItem,
    OrderSupportRequest,
    Payment,
    Product,
    ProductSize,
    StoreCredit,
    User,
    WebhookEvent,
    alive,
    utcnow,
)
from app.security import find_user, hash_password, ten_digit

log = logging.getLogger("growman")
GIFT = 49.0
PAYABLE = {"store_pickup", "courier", "own_vehicle"}
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split()


def money(value: float) -> float:
    return round(float(value) + 1e-9, 2)


def financial_year(when: datetime) -> str:
    year = when.year if when.month >= 4 else when.year - 1
    return f"{year}-{str(year + 1)[-2:]}"


def rupees(amount: float) -> str:
    whole, paise = divmod(int(round(amount * 100)), 100)

    def under_100(n: int) -> str:
        if n < 20:
            return ONES[n]
        name = TENS[n // 10 - 2]
        return name if n % 10 == 0 else f"{name} {ONES[n % 10]}"

    def indian(n: int) -> str:
        if n == 0:
            return "zero"
        parts = []
        if n >= 10000000:
            parts.append(f"{indian(n // 10000000)} crore")
            n %= 10000000
        if n >= 100000:
            parts.append(f"{under_100(n // 100000)} lakh")
            n %= 100000
        if n >= 1000:
            parts.append(f"{under_100(n // 1000)} thousand")
            n %= 1000
        if n >= 100:
            parts.append(f"{ONES[n // 100]} hundred")
            n %= 100
        if n:
            parts.append(under_100(n))
        return " ".join(parts)

    text = f"{indian(whole)} rupees"
    if paise:
        text += f" and {indian(paise)} paise"
    return text[:1].upper() + text[1:]


def signature_ok(secret: str, payload: bytes, given: str) -> bool:
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
    offered = (given or "").strip()
    return hmac.compare_digest(digest.hex(), offered) or hmac.compare_digest(
        __import__("base64").b64encode(digest).decode(), offered
    )


def _product(db: Session, product_id: int) -> Product:
    row = db.scalar(
        select(Product)
        .where(Product.id == product_id, alive(Product))
        .options(selectinload(Product.sizes))
    )
    if row is None or row.status != "active":
        raise APIError(400, "unknown_product", productId=product_id)
    return row


def price_lines(db: Session, items: list[dict]) -> list[dict]:
    """Client prices are ignored. A missing size on a sized plant is an error."""
    if not items:
        raise APIError(400, "cart_empty")
    priced = []
    for raw in items:
        product = _product(db, int(raw.get("productId") or 0))
        qty = int(raw.get("quantity") or 0)
        if qty < 1:
            raise APIError(400, "invalid_quantity", name=product.name)
        size_id = raw.get("productSizeId") or raw.get("sizeId")
        size = None
        live = [row for row in product.sizes if row.deleted_at is None]
        if size_id:
            size = next((row for row in live if row.id == int(size_id)), None)
            if size is None:
                raise APIError(400, "unknown_size", name=product.name)
        elif live:
            raise APIError(400, "size_required", name=product.name)
        price = size.price if size else product.price
        track = product.track_inventory
        stock = size.stock if size else product.stock
        if track and stock < qty:
            raise APIError(409, "out_of_stock", items=[{"name": product.name, "productId": product.id}])
        kind = (size.size_class if size and size.size_class else product.size_class) or "small"
        bulky = size.bulky if size and size.bulky is not None else product.bulky
        image = (size.image_keys[0] if size and size.image_keys else "") or product.image_key
        priced.append({
            "product": product,
            "size": size,
            "quantity": qty,
            "price": money(price),
            "name": product.name if not size else f"{product.name} ({size.label})",
            "image": image,
            "size_class": kind,
            "bulky": bool(bulky),
            "gst": product.gst_rate or 0,
        })
    return priced


def quote_for(settings, lines: list[dict], *, pincode="", lat=None, lng=None) -> dict:
    return delivery.quote(
        [{"price": row["price"], "quantity": row["quantity"], "size": row["size_class"], "bulky": row["bulky"]} for row in lines],
        pincode=pincode,
        lat=lat,
        lng=lng,
        store=(settings.store_latitude, settings.store_longitude),
        free_min=settings.free_delivery_min_subtotal,
        own_min=settings.own_vehicle_min_subtotal,
        bulk_units=settings.bulk_min_units,
        bulk_subtotal=settings.bulk_min_subtotal,
        retail_max=settings.retail_max_zone or "far",
    )


def _coupon(db: Session, code: str, subtotal: float, lines: list[dict], user: User | None, email: str) -> tuple[Coupon, float, bool]:
    row = db.scalar(select(Coupon).where(Coupon.code == code.strip().upper(), alive(Coupon)))
    now = utcnow()
    if row is None or not row.active:
        raise APIError(422, "coupon_rejected", reason="That code is not active.")
    if row.starts_at and row.starts_at > now or row.expires_at and row.expires_at < now:
        raise APIError(422, "coupon_rejected", reason="That code is not valid today.")
    if row.usage_limit and row.usage_count >= row.usage_limit:
        raise APIError(422, "coupon_rejected", reason="That code has been used up.")
    if subtotal < row.min_subtotal:
        raise APIError(422, "coupon_rejected", reason=f"Add ₹{money(row.min_subtotal - subtotal):g} more to use this code.")
    if row.first_order_only and user is not None:
        prior = db.scalar(select(Order.id).where(Order.user_id == user.id, Order.payment_status == "paid", alive(Order)))
        if prior:
            raise APIError(422, "coupon_rejected", reason="This code is for a first order.")
    if user is not None and row.per_user_limit:
        used = db.query(CouponRedemption).filter(CouponRedemption.coupon_id == row.id, CouponRedemption.user_id == user.id).count()
        if used >= row.per_user_limit:
            raise APIError(422, "coupon_rejected", reason="You have already used this code.")
    eligible = subtotal
    if row.product_ids:
        allowed = {int(item) for item in row.product_ids}
        eligible = money(sum(line["price"] * line["quantity"] for line in lines if line["product"].id in allowed))
    if eligible <= 0:
        raise APIError(422, "coupon_rejected", reason="This code does not apply to these plants.")
    if row.type == "free_shipping":
        return row, 0, True
    if row.type == "percentage":
        off = money(eligible * row.value / 100)
        if row.max_discount:
            off = min(off, row.max_discount)
    else:
        off = money(min(row.value, eligible))
    return row, off, False


def _hold(db: Session, product_id: int, size_id: int | None, qty: int, name: str) -> None:
    if size_id:
        sql = ("UPDATE product_sizes SET stock = stock - :qty, updated_at = NOW() "
               "WHERE id = :id AND stock >= :qty AND deleted_at IS NULL")
        target = size_id
    else:
        sql = ("UPDATE products SET stock = CASE WHEN track_inventory THEN stock - :qty ELSE stock END, "
               "updated_at = NOW() WHERE id = :id AND deleted_at IS NULL "
               "AND (track_inventory = false OR stock >= :qty)")
        target = product_id
    if not db.execute(text(sql), {"qty": qty, "id": target}).rowcount:
        raise APIError(409, "out_of_stock", items=[{"name": name}])


def _reserve(db: Session, lines: list[dict]) -> None:
    for line in lines:
        size = line["size"]
        _hold(db, line["product"].id, size.id if size is not None else None, line["quantity"], line["name"])


def _release_lines(db: Session, order: Order) -> None:
    won = db.execute(
        text("UPDATE orders SET inventory_released = true, updated_at = NOW() "
             "WHERE id = :id AND inventory_released = false"),
        {"id": order.id},
    ).rowcount
    if not won:
        return
    for item in order.items:
        if item.product_size_id:
            db.execute(text("UPDATE product_sizes SET stock = stock + :qty WHERE id = :id"),
                       {"qty": item.quantity, "id": item.product_size_id})
        else:
            db.execute(text("UPDATE products SET stock = stock + :qty WHERE id = :id AND track_inventory = true"),
                       {"qty": item.quantity, "id": item.product_id})
    order.inventory_released = True


def _spend_credit(db: Session, user_id: int, amount: float, order_id: int) -> None:
    changed = db.execute(
        text("UPDATE store_credits SET balance = balance - :amount, updated_at = NOW() "
             "WHERE user_id = :uid AND balance >= :amount"),
        {"amount": amount, "uid": user_id},
    ).rowcount
    if not changed:
        raise APIError(409, "credit_changed", reason="Your store credit changed. Please review the total and try again.")
    db.add(CreditEntry(user_id=user_id, amount=-amount, reason="order", order_id=order_id))


def _razorpay(settings, rupees_amount: float, currency: str) -> dict:
    paise = int(money(rupees_amount) * 100 + 0.5)
    if settings.dev and not settings.razorpay_key_id:
        return {"id": "order_dev_" + secrets.token_hex(8), "amount": paise, "currency": currency, "status": "created"}
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise APIError(503, "payments_unavailable")
    try:
        response = httpx.post(
            "https://api.razorpay.com/v1/orders",
            auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            json={"amount": paise, "currency": currency, "receipt": secrets.token_hex(6)},
            timeout=15,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("razorpay create failed: %s", exc)
        raise APIError(502, "payment_provider_failed") from exc
    body = response.json()
    return {"id": body["id"], "amount": body["amount"], "currency": body.get("currency", currency), "status": body.get("status", "created")}


def place_order(db: Session, settings, box, redis, body: dict, user: User | None, ip: str, ua: str) -> dict:
    customer = body.get("customer") or {}
    email = str(customer.get("email") or "").strip().lower()
    phone = ten_digit(str(customer.get("phone") or ""))
    pin = str(customer.get("pincode") or "").strip()
    if not customer.get("name") or "@" not in email or not phone or len(pin) != 6 or pin[0] == "0":
        raise APIError(400, "invalid_customer")
    channel = str(body.get("fulfillmentChannel") or "")
    if channel not in PAYABLE:
        if channel == "bulk_quote":
            raise APIError(400, "bulk_not_payable", reason="Bulk orders are quoted by sales, not paid at checkout.")
        raise APIError(400, "fulfillment_channel_required", reason="Choose a delivery option before placing the order.")
    slot = str(body.get("deliverySlot") or "").lower()
    if slot and slot not in {"morning", "evening"}:
        raise APIError(400, "invalid_slot")
    if user is None and not take_proof(box, redis, email, str(body.get("verificationToken") or "")):
        raise APIError(403, "email_not_verified", reason="Please verify your email address before placing the order.")

    lines = price_lines(db, body.get("items") or [])
    quoted = quote_for(settings, lines, pincode=pin, lat=body.get("latitude"), lng=body.get("longitude"))
    chosen = delivery.option(quoted, channel)
    if not chosen or not chosen["available"]:
        raise APIError(409, "channel_unavailable", reason=(chosen or {}).get("reason", ""), quote=quoted)
    gift = GIFT if body.get("giftWrap") else 0
    expected = money(quoted["subtotal"] + chosen["fee"] + gift)
    client = float(body.get("amount") or 0)

    discount = 0.0
    free_ship = False
    coupon = None
    code = str(body.get("couponCode") or "").strip()
    if code:
        coupon, discount, free_ship = _coupon(db, code, quoted["subtotal"], lines, user, email)
        if free_ship:
            discount = chosen["fee"]
    charged = money(expected - discount)
    if charged < 1:
        raise APIError(422, "coupon_rejected", reason="This code would bring the order below the ₹1 minimum.")
    credit = 0.0
    if user is not None and body.get("useCredit"):
        balance = db.scalar(select(StoreCredit.balance).where(StoreCredit.user_id == user.id)) or 0
        credit = money(min(balance, charged - 1))
        charged = money(charged - credit)
    # The web sends the discounted total. An older client sends the total before the coupon.
    if min(abs(client - expected), abs(client - charged), abs(client - money(expected - discount))) > 1:
        raise APIError(409, "amount_mismatch", expectedAmount=charged, quote=quoted)

    remote = _razorpay(settings, charged, body.get("currency") or "INR")
    buyer = user or find_user(db, email=email) or _guest(db, customer, email, phone)
    order = Order(
        user_id=buyer.id,
        razorpay_order_id=remote["id"],
        public_token=secrets.token_urlsafe(32),
        payment_status="created",
        status="pending",
        amount=charged,
        currency=remote["currency"],
        customer_name=str(customer.get("name"))[:200],
        customer_email=email,
        customer_phone=phone,
        client_ip=ip[:64],
        user_agent=ua[:512],
        address_line=str(customer.get("addressLine") or ""),
        city=str(customer.get("city") or ""),
        state=str(customer.get("state") or ""),
        pincode=pin,
        fulfillment_channel=channel,
        fulfillment_zone=quoted["zone"],
        subtotal=quoted["subtotal"],
        delivery_fee=0 if free_ship else chosen["fee"],
        delivery_fee_waived=bool(chosen["feeWaived"] or free_ship),
        distance_km=quoted["distanceKm"],
        distance_source=quoted["distanceSource"],
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        courier_provider="Shiprocket" if channel == "courier" else "",
        gift_wrap=bool(body.get("giftWrap")),
        gift_note=str(body.get("giftNote") or "")[:300],
        hide_price=bool(body.get("hidePrice")),
        gift_fee=gift,
        delivery_slot=slot,
        credit_applied=credit,
        coupon_id=coupon.id if coupon else None,
        coupon_code=coupon.code if coupon else "",
        discount_total=discount,
    )
    tax = 0.0
    for line in lines:
        gross = line["price"] * line["quantity"]
        if line["gst"] > 0:
            tax += gross * line["gst"] / (100 + line["gst"])
    order.tax_amount = money(tax)
    order.taxable_value = money(order.subtotal - order.tax_amount)
    db.add(order)
    db.flush()
    for line in lines:
        db.add(OrderItem(
            order_id=order.id,
            product_id=line["product"].id,
            product_size_id=line["size"].id if line["size"] else None,
            quantity=line["quantity"],
            price=line["price"],
            name=line["name"],
            image_key=line["image"],
        ))
    if credit:
        _spend_credit(db, buyer.id, credit, order.id)
    _reserve(db, lines)
    if coupon is not None:
        won = db.execute(
            text("UPDATE coupons SET usage_count = usage_count + 1, updated_at = NOW() "
                 "WHERE id = :id AND (usage_limit = 0 OR usage_count < usage_limit)"),
            {"id": coupon.id},
        ).rowcount
        if not won:
            raise APIError(422, "coupon_rejected", reason="That code has been used up.")
        db.add(CouponRedemption(coupon_id=coupon.id, user_id=buyer.id, email=email, order_id=order.id, amount=discount))
    db.flush()
    body_out = {
        "id": remote["id"],
        "amount": remote["amount"],
        "currency": remote["currency"],
        "status": remote["status"],
        "orderId": order.id,
        "publicToken": order.public_token,
        "subtotal": order.subtotal,
        "deliveryFee": order.delivery_fee,
        "fulfillmentChannel": order.fulfillment_channel,
    }
    if discount:
        body_out["discount"] = discount
        body_out["couponCode"] = coupon.code
    if credit:
        body_out["creditApplied"] = credit
    return body_out


def _guest(db: Session, customer: dict, email: str, phone: str) -> User:
    row = User(
        name=str(customer.get("name"))[:200],
        email=email,
        phone=phone,
        password_hash=hash_password(secrets.token_urlsafe(18)),
        email_verified=True,
        provider="checkout",
        role="user",
        referral_code=secrets.token_hex(4),
    )
    db.add(row)
    db.flush()
    return row


def take_proof(box, redis, email: str, token: str) -> bool:
    from app.codes import take
    return bool(token) and take(box, redis, f"otp:proof:checkout:{email}", token)


def mark_paid(db: Session, order: Order, payment_id: str) -> bool:
    """True only for the caller that wins the paid transition."""
    won = db.execute(
        text("UPDATE orders SET payment_status = 'paid', status = 'paid', razorpay_payment_id = :pid, "
             "updated_at = NOW() WHERE id = :id AND payment_status <> 'paid'"),
        {"pid": payment_id, "id": order.id},
    ).rowcount
    if not won:
        return False
    order.payment_status = "paid"
    order.status = "paid"
    order.razorpay_payment_id = payment_id
    db.add(Payment(
        order_id=order.id,
        razorpay_order_id=order.razorpay_order_id,
        razorpay_payment_id=payment_id,
        amount=order.amount,
        currency=order.currency,
        status="captured",
    ))
    if not order.invoice_number:
        _assign_invoice(db, order)
    if order.inventory_released:
        try:
            with db.begin_nested():
                for item in order.items:
                    _hold(db, item.product_id, item.product_size_id, item.quantity, item.name)
                db.execute(text("UPDATE orders SET inventory_released = false WHERE id = :id"), {"id": order.id})
        except APIError:
            db.add(OrderSupportRequest(
                order_id=order.id, user_id=order.user_id, customer_name=order.customer_name,
                customer_email=order.customer_email, customer_phone=order.customer_phone,
                issue_type="stock_after_payment", user_message="Paid after the reservation expired and stock was gone.",
                order_status="paid", payment_status="paid", order_amount=order.amount, source="payment",
            ))
    return True


def _assign_invoice(db: Session, order: Order) -> None:
    now = utcnow()
    prefix = f"GRW/{financial_year(now)}/"
    total = db.query(Order).filter(Order.invoice_number.like(prefix + "%")).count()
    for n in range(total + 1, total + 4):
        number = f"{prefix}{n:06d}"
        try:
            with db.begin_nested():
                order.invoice_number = number
                order.invoice_date = now
                db.flush()
            return
        except IntegrityError:
            continue


def fail_payment(db: Session, order: Order) -> None:
    if order.payment_status == "paid":
        return
    order.payment_status = "failed"
    order.status = "failed"
    _release_lines(db, order)


def cancel(db: Session, order: Order, reason: str) -> None:
    if not order.is_cancellable():
        raise APIError(409, "not_cancellable")
    order.status = "cancelled"
    order.cancelled_at = utcnow()
    order.cancel_reason = reason[:1000]
    if order.payment_status != "paid":
        order.payment_status = "cancelled"
    _release_lines(db, order)


def sweep(db: Session) -> list[Order]:
    """Unpaid orders hold stock for 30 minutes, then the plants go back on the shelf."""
    cutoff = utcnow() - timedelta(minutes=30)
    rows = db.scalars(
        select(Order).where(
            alive(Order),
            Order.inventory_released.is_(False),
            Order.payment_status.in_(["created", "pending"]),
            Order.status.in_(["pending", "created"]),
            Order.created_at < cutoff,
        ).options(selectinload(Order.items))
    ).all()
    for order in rows:
        order.status = "abandoned"
        _release_lines(db, order)
    return [order for order in rows if order.created_at > utcnow() - timedelta(minutes=45)][:8]


def claim_event(db: Session, provider: str, event_id: str, event_type: str, payload: str) -> bool:
    try:
        with db.begin_nested():
            db.add(WebhookEvent(provider=provider, event_id=event_id, event_type=event_type, payload=payload))
            db.flush()
        return True
    except IntegrityError:
        return False


def load_order(db: Session, *, order_id: int = 0, razorpay_id: str = "", token: str = "") -> Order:
    query = select(Order).where(alive(Order)).options(selectinload(Order.items))
    if order_id:
        query = query.where(Order.id == order_id)
    elif razorpay_id:
        query = query.where(Order.razorpay_order_id == razorpay_id)
    elif token:
        query = query.where(Order.public_token == token)
    else:
        raise APIError(400, "order_required")
    row = db.scalar(query)
    if row is None:
        raise APIError(404, "not_found")
    return row
