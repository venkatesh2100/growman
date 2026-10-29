"""Razorpay and Shiprocket call these. They prove themselves with a signature, not a JWT.

The event id is claimed first. Processing then runs in a savepoint, so a
bug while applying the event does not forget that we already received it.
The provider always gets 200 after the claim and will not retry forever.
"""

import hashlib
import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import shop
from app.db import get_db
from app.models import Order, alive

router = APIRouter(tags=["webhooks"])


@router.post("/webhooks/razorpay")
async def razorpay(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    settings = request.app.state.settings
    given = request.headers.get("x-razorpay-signature", "")
    if not settings.dev and not shop.signature_ok(settings.razorpay_webhook_secret, raw, given):
        from app.http import APIError
        raise APIError(400, "invalid_signature")
    body = json.loads(raw or b"{}")
    event_id = request.headers.get("x-razorpay-event-id") or hashlib.sha256(raw).hexdigest()
    if not shop.claim_event(db, "razorpay", event_id, str(body.get("event") or ""), raw.decode(errors="replace")[:20000]):
        return {"ok": True}
    try:
        with db.begin_nested():
            _apply_razorpay(db, body)
    except Exception:
        db.flush()
    return {"ok": True}


def _apply_razorpay(db: Session, body: dict) -> None:
    event = body.get("event") or ""
    entity = ((body.get("payload") or {}).get("payment") or {}).get("entity") or {}
    razorpay_order = entity.get("order_id") or ""
    payment_id = entity.get("id") or ""
    if not razorpay_order:
        return
    order = db.scalar(select(Order).where(alive(Order), Order.razorpay_order_id == razorpay_order))
    if order is None:
        return
    if event in {"payment.captured", "order.paid"} and payment_id:
        shop.mark_paid(db, order, payment_id)
    elif event == "payment.failed":
        shop.fail_payment(db, order)


@router.post("/webhooks/shiprocket")
async def shiprocket(request: Request, db: Session = Depends(get_db)):
    settings = request.app.state.settings
    token = request.headers.get("x-api-key") or request.query_params.get("token") or ""
    if settings.shiprocket_webhook_token and token != settings.shiprocket_webhook_token and not settings.dev:
        from app.http import APIError
        raise APIError(401, "invalid_signature")
    body = await request.json()
    awb = str(body.get("awb") or body.get("awb_code") or "")
    if not awb:
        return {"ok": True}
    order = db.scalar(select(Order).where(alive(Order), Order.awb_number == awb))
    if order is None:
        return {"ok": True}
    status = str(body.get("current_status") or body.get("shipment_status") or "").lower()
    if "deliver" in status:
        order.status = "delivered"
    elif "transit" in status or "ship" in status:
        order.status = "shipped"
    if body.get("tracking_url"):
        order.tracking_url = str(body["tracking_url"])[:300]
    return {"ok": True}
