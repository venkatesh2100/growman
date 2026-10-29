"""Checkout. The amount the browser sends is checked, then replaced by ours."""

import secrets

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import codes, mail, shop
from app.db import get_db
from app.http import APIError, client_ip, limit
from app.models import Order
from app.security import optional_user

router = APIRouter(tags=["checkout"], dependencies=[Depends(limit("checkout", 20, 60, True))])


def _email(body: dict) -> str:
    return str((body.get("customer") or {}).get("email") or body.get("email") or "").strip().lower()


@router.post("/checkout/quote")
def quote(body: dict, request: Request, db: Session = Depends(get_db), _user=Depends(optional_user)):
    lines = shop.price_lines(db, body.get("items") or [])
    dest = body.get("destination") or {}
    quoted = shop.quote_for(
        request.app.state.settings, lines,
        pincode=str(dest.get("pincode") or ""),
        lat=dest.get("latitude"), lng=dest.get("longitude"),
    )
    return {"quote": quoted, "courierProvider": "Shiprocket"}


@router.post("/checkout/send-email-otp")
def send_email_otp(body: dict, request: Request):
    email = _email(body)
    if "@" not in email:
        raise APIError(400, "invalid_email")
    box, redis = request.app.state.box, request.app.state.redis
    if box.get(redis, f"otp:cool:checkout:{email}"):
        raise APIError(429, "otp_cooldown")
    box.put(redis, f"otp:cool:checkout:{email}", "1", 30)
    code = f"{secrets.randbelow(900000) + 100000}"
    codes.save(box, redis, f"otp:email:checkout:{email}", code, 600)
    mail.send(request.app.state.settings, email, "Confirm your Growman order", f"Your code is {code}. It expires in 10 minutes.")
    return {"ok": True}


@router.post("/checkout/verify-email-otp")
def verify_email_otp(body: dict, request: Request):
    email = _email(body)
    box, redis = request.app.state.box, request.app.state.redis
    if not codes.take(box, redis, f"otp:email:checkout:{email}", str(body.get("otp") or "")):
        raise APIError(401, "invalid_otp")
    proof = secrets.token_urlsafe(24)
    codes.save(box, redis, f"otp:proof:checkout:{email}", proof, 900)
    return {"message": "OTP verified successfully", "verificationToken": proof, "expiresIn": 900}


@router.post("/checkout/validate-coupon")
def validate_coupon(body: dict, request: Request, db: Session = Depends(get_db), user=Depends(optional_user)):
    lines = shop.price_lines(db, body.get("items") or [])
    subtotal = shop.money(sum(line["price"] * line["quantity"] for line in lines))
    coupon, discount, free_ship = shop._coupon(db, str(body.get("code") or body.get("couponCode") or ""), subtotal, lines, user, _email(body))
    return {"code": coupon.code, "discount": discount, "freeShipping": free_ship, "subtotal": subtotal}


@router.post("/checkout/create-order")
def create_order(body: dict, request: Request, db: Session = Depends(get_db), user=Depends(optional_user)):
    result = shop.place_order(
        db, request.app.state.settings, request.app.state.box, request.app.state.redis,
        body, user, client_ip(request), request.headers.get("user-agent", ""),
    )
    mail.send(request.app.state.settings, (body.get("customer") or {}).get("email", ""),
              "We have your Growman order", "We have your order and will update you once payment is confirmed.")
    return result


@router.post("/razorpay/verify")
def verify_payment(body: dict, request: Request, db: Session = Depends(get_db)):
    payment_id = str(body.get("razorpay_payment_id") or "")
    if not payment_id:
        raise APIError(400, "razorpay_payment_id is required")
    order = shop.load_order(db, order_id=int(body.get("orderId") or 0), razorpay_id=str(body.get("razorpay_order_id") or ""))
    settings = request.app.state.settings
    if not settings.dev:
        signed = shop.signature_ok(
            settings.razorpay_key_secret,
            f"{order.razorpay_order_id}|{payment_id}".encode(),
            str(body.get("razorpay_signature") or ""),
        )
        if not signed:
            raise APIError(400, "payment verification failed")
    first = shop.mark_paid(db, order, payment_id)
    if first:
        mail.send(settings, order.customer_email, "Payment received", f"Order {order.id} is paid. Total ₹{order.amount:g}.")
    return {"ok": True, "orderId": order.id, "paid": True}
