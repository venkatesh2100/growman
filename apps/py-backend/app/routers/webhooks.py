"""Provider webhooks.

Razorpay delivers at least once and does not promise order. The handler
claims the event id with an insert against a unique index, answers 200,
and only then changes the order. A duplicate delivery loses the insert
and returns ``{"duplicate": true}`` without doing the work again.

The webhook secret signs the raw body. It is not the API key secret.
An empty expected secret refuses the request. Treating "empty" as
"skip the check" would turn a half-configured deploy into an open
endpoint that can mark orders paid.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.errors import APIError
from app.inventory import release
from app.metrics import payment_signature_failures
from app.models import Order, Refund, utcnow
from app.payments import claim_webhook, finish_webhook, mark_order_paid, verify_hmac
from app.routers.deps import get_db
from app.routers.orders import _after_paid

log = logging.getLogger("growman.webhooks")
router = APIRouter()


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    settings = request.app.state.settings
    if not settings.razorpay_webhook_secret and not settings.skip_signature_checks:
        raise APIError(503, "webhook secret is not configured")
    signature = request.headers.get("x-razorpay-signature") or ""
    if not settings.skip_signature_checks and not verify_hmac(settings.razorpay_webhook_secret, raw.decode(), signature):
        payment_signature_failures.labels(stage="webhook").inc()
        raise APIError(400, "invalid signature")

    payload = json.loads(raw or b"{}")
    event_id = request.headers.get("x-razorpay-event-id") or payload.get("event") or ""
    # Razorpay's event id header is the stable identity. Fall back to a
    # hash of the body only when the header is missing, so retries of the
    # same body still collapse.
    if not request.headers.get("x-razorpay-event-id"):
        import hashlib

        event_id = hashlib.sha256(raw).hexdigest()
    event_type = str(payload.get("event") or "")
    if not claim_webhook(db, "razorpay", event_id, event_type, raw.decode(errors="replace")):
        return {"duplicate": True}

    try:
        # Savepoint: a failure while applying the event undoes the order
        # change but keeps the claim row, so a retry is a duplicate rather
        # than a second payment.
        with db.begin_nested():
            _process_razorpay(db, request, payload, event_type)
        finish_webhook(db, event_id, "processed")
    except Exception as exc:  # noqa: BLE001
        log.exception("razorpay event %s", event_id)
        finish_webhook(db, event_id, "failed", str(exc))
    # Always 200 after the claim. A 500 would make Razorpay retry work we
    # already recorded, and the next delivery will see the duplicate.
    return {"ok": True}


def _process_razorpay(db: Session, request: Request, payload: dict, event_type: str) -> None:
    entity = ((payload.get("payload") or {}).get("payment") or {}).get("entity") or {}
    if event_type in {"payment.captured", "order.paid"}:
        razorpay_order_id = entity.get("order_id") or ""
        payment_id = entity.get("id") or ""
        if not razorpay_order_id or not payment_id:
            return
        order = db.scalar(
            select(Order).where(Order.razorpay_order_id == razorpay_order_id).options(selectinload(Order.items))
        )
        if order is None:
            log.warning("webhook for unknown razorpay order %s", razorpay_order_id)
            return
        first = mark_order_paid(db, order, payment_id)
        _after_paid(request, db, order, first)
        return
    if event_type == "payment.failed":
        razorpay_order_id = entity.get("order_id") or ""
        order = db.scalar(select(Order).where(Order.razorpay_order_id == razorpay_order_id).options(selectinload(Order.items)))
        if order and order.payment_status == "created":
            order.payment_status = "failed"
            order.status = "failed"
            release(db, order)
        return
    if event_type in {"refund.processed", "refund.failed"}:
        refund_entity = ((payload.get("payload") or {}).get("refund") or {}).get("entity") or {}
        refund_id = str(refund_entity.get("id") or "")
        row = db.scalar(select(Refund).where(Refund.razorpay_refund_id == refund_id)) if refund_id else None
        if row:
            row.status = "processed" if event_type == "refund.processed" else "failed"
            row.processed_at = utcnow()


@router.post("/webhooks/shiprocket")
async def shiprocket_webhook(request: Request, db: Session = Depends(get_db)):
    settings = request.app.state.settings
    # No token configured means refuse, not "accept everything".
    if not settings.shiprocket_webhook_token:
        raise APIError(503, "webhook token is not configured")
    provided = request.headers.get("x-api-key") or ""
    if not secrets_equal(provided, settings.shiprocket_webhook_token):
        raise APIError(401, "invalid webhook token")
    raw = await request.body()
    payload = json.loads(raw or b"{}")
    awb = str(payload.get("awb") or payload.get("awb_code") or "")
    event_id = f"shiprocket:{awb}:{payload.get('current_status') or payload.get('shipment_status')}"
    if not claim_webhook(db, "shiprocket", event_id, str(payload.get("current_status") or "tracking"), raw.decode(errors="replace")):
        return {"duplicate": True}
    order = db.scalar(select(Order).where(Order.awb_number == awb)) if awb else None
    if order:
        status = str(payload.get("current_status") or "").lower()
        previous = order.status
        if "deliver" in status and order.delivered_at is None:
            order.delivered_at = utcnow()
            order.status = "delivered"
        elif "transit" in status or "ship" in status:
            order.status = "shipped"
            if order.shipped_at is None:
                order.shipped_at = utcnow()
        if order.status == "shipped" and previous != "shipped" and order.customer_email:
            from app.notify import send_email

            send_email(
                settings,
                order.customer_email,
                f"Growman order {order.id} shipped",
                f"Hi {order.customer_name},\n\nOrder #{order.id} is on the way.\nAWB {order.awb_number}\n{order.tracking_url}\n",
            )
    finish_webhook(db, event_id, "processed")
    return {"ok": True}


def secrets_equal(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left, right)
