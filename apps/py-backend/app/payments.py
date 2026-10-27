"""Payments.

Two callers can confirm the same payment: the browser callback and
Razorpay's webhook. Only the first may send the email and commit stock.
That is a conditional update:

    UPDATE orders SET payment_status = 'paid'
    WHERE id = :id AND payment_status <> 'paid'

``rowcount == 1`` means this call won. The other call still records the
payment row (an upsert on the unique payment id) and then stops.

Signatures use HMAC-SHA256. The checkout callback signs
``order_id|payment_id`` with the API key secret. The webhook signs the
raw body with a different secret. A missing secret does not disable the
check.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from datetime import datetime

import httpx
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.errors import APIError, OutOfStock
from app.inventory import commit as commit_stock
from app.models import Order, OrderItem, OrderSupportRequest, Payment, Product, WebhookEvent, utcnow

log = logging.getLogger("growman.payments")

INVOICE_PREFIX = "GRW"


def verify_hmac(secret: str, message: str, signature: str) -> bool:
    if not secret or not signature:
        return False
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    hex_ok = hmac.compare_digest(signature.lower(), digest.hex())
    b64_ok = hmac.compare_digest(signature, base64.b64encode(digest).decode())
    return hex_ok or b64_ok


def financial_year(when: datetime) -> str:
    """Indian financial year, April–March. January 2026 is FY 2025-26."""
    year = when.year if when.month >= 4 else when.year - 1
    return f"{year}-{(year + 1) % 100:02d}"


def create_razorpay_order(settings: Settings, amount_rupees: float, currency: str = "INR") -> dict:
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        if settings.skip_signature_checks:
            # Lets a learner walk reserve → pay → commit without live keys.
            # Production refuses to boot without the secrets, so this branch
            # cannot run there.
            paise = int(amount_rupees * 100 + 0.5)
            return {"id": "order_dev_" + hashlib.sha1(f"{paise}{utcnow().isoformat()}".encode()).hexdigest()[:14], "amount": paise, "currency": currency, "status": "created"}
        raise APIError(503, "payments_unavailable")
    paise = int(amount_rupees * 100 + 0.5)
    auth = (settings.razorpay_key_id, settings.razorpay_key_secret)
    try:
        response = httpx.post(
            "https://api.razorpay.com/v1/orders",
            json={"amount": paise, "currency": currency},
            auth=auth,
            timeout=15,
        )
    except httpx.HTTPError as exc:
        raise APIError(502, "payments_unavailable") from exc
    if response.status_code >= 300:
        log.warning("razorpay create: %s", response.text[:300])
        raise APIError(502, "payments_unavailable")
    return response.json()


def mark_order_paid(db: Session, order: Order, payment_id: str) -> bool:
    """Return True only when this call made the first transition to paid."""
    won = db.execute(
        text(
            """
            UPDATE orders
            SET razorpay_payment_id = :pid,
                payment_status = 'paid',
                status = 'paid',
                updated_at = NOW()
            WHERE id = :id AND payment_status <> 'paid' AND deleted_at IS NULL
            """
        ),
        {"pid": payment_id, "id": order.id},
    )
    first = won.rowcount == 1
    order.razorpay_payment_id = payment_id
    order.payment_status = "paid"
    order.status = "paid"

    now = utcnow()
    stmt = pg_insert(Payment).values(
        order_id=order.id,
        razorpay_order_id=order.razorpay_order_id,
        razorpay_payment_id=payment_id,
        amount=order.amount,
        currency=order.currency or "INR",
        status="captured",
        method="",
        description="",
        created_at=now,
        updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["razorpay_payment_id"],
        set_={"status": "captured", "amount": order.amount, "updated_at": now},
    )
    db.execute(stmt)

    if first:
        if not order.items:
            order.items = list(db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)))
        try:
            commit_stock(db, order)
        except OutOfStock as sold_out:
            # The money is taken. Refusing here would leave a real payment
            # with no order. The order stands and a person is told.
            log.warning("order %s paid but stock unavailable: %s", order.id, sold_out)
            db.add(
                OrderSupportRequest(
                    order_id=order.id,
                    user_id=order.user_id,
                    customer_name=order.customer_name,
                    customer_email=order.customer_email,
                    customer_phone=order.customer_phone,
                    issue_type="out_of_stock",
                    priority="high",
                    user_message=sold_out.extra.get("reason") or "Paid order could not re-reserve stock",
                    order_status="paid",
                    payment_status="paid",
                    order_amount=order.amount,
                    source="payment",
                )
            )
        _assign_invoice(db, order)
    return first


def _assign_invoice(db: Session, order: Order) -> None:
    if order.invoice_number:
        return
    now = utcnow()
    fy = financial_year(now)
    prefix = f"{INVOICE_PREFIX}/{fy}/"
    # Counting inside the payment transaction serialises allocations: the
    # order row was just updated, so concurrent pay calls for other orders
    # wait on their own rows, and this count sees committed invoice numbers.
    count = db.execute(
        text("SELECT count(*) FROM orders WHERE invoice_number LIKE :prefix"),
        {"prefix": prefix + "%"},
    ).scalar_one()
    number = f"{prefix}{int(count) + 1:06d}"
    taxable, tax = _tax_split(db, order)
    db.execute(
        text(
            """
            UPDATE orders
            SET invoice_number = :number,
                invoice_date = :now,
                taxable_value = :taxable,
                tax_amount = :tax,
                updated_at = NOW()
            WHERE id = :id
            """
        ),
        {"number": number, "now": now, "taxable": taxable, "tax": tax, "id": order.id},
    )
    order.invoice_number = number
    order.invoice_date = now
    order.taxable_value = taxable
    order.tax_amount = tax


def _tax_split(db: Session, order: Order) -> tuple[float, float]:
    """Catalogue prices are GST-inclusive, so tax is extracted, not added."""
    items = order.items or []
    product_ids = [i.product_id for i in items]
    rates = {}
    if product_ids:
        rows = db.execute(select(Product.id, Product.gst_rate).where(Product.id.in_(product_ids))).all()
        rates = {row[0]: row[1] or 0 for row in rows}
    taxable = 0.0
    tax = 0.0
    for item in items:
        gross = item.price * item.quantity
        rate = rates.get(item.product_id, 0) or 0
        if rate <= 0:
            taxable += gross
            continue
        net = gross / (1 + rate / 100)
        taxable += net
        tax += gross - net
    return round(taxable, 2), round(tax, 2)


def claim_webhook(db: Session, provider: str, event_id: str, event_type: str, payload: str) -> bool:
    """Insert the event. False means a duplicate delivery — ack and stop.

    The unique index is what makes this atomic. Two deliveries of the same
    event cannot both insert.
    """
    try:
        # A savepoint so a duplicate event_id rolls back only this insert.
        # Any other database error must propagate: Razorpay retries on 500,
        # and we must not answer 200 for an event we failed to store.
        with db.begin_nested():
            db.add(
                WebhookEvent(
                    provider=provider,
                    event_id=event_id,
                    event_type=event_type,
                    status="received",
                    payload=payload[:20000],
                )
            )
            db.flush()
        return True
    except IntegrityError:
        return False


def finish_webhook(db: Session, event_id: str, status: str, error: str = "") -> None:
    db.execute(
        text(
            """
            UPDATE webhook_events
            SET status = :status, error = :error, attempts = attempts + 1,
                processed_at = NOW(), updated_at = NOW()
            WHERE event_id = :id
            """
        ),
        {"status": status, "error": error[:2000], "id": event_id},
    )


def refund_payment(settings: Settings, payment_id: str, amount_rupees: float) -> dict:
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        if settings.skip_signature_checks:
            return {"id": "rfnd_dev_" + payment_id[-6:], "status": "pending"}
        raise APIError(503, "payments_unavailable")
    try:
        response = httpx.post(
            f"https://api.razorpay.com/v1/payments/{payment_id}/refund",
            json={"amount": int(amount_rupees * 100 + 0.5)},
            auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            timeout=20,
        )
    except httpx.HTTPError as exc:
        raise APIError(502, "refund_failed") from exc
    if response.status_code >= 300:
        log.warning("razorpay refund: %s", response.text[:300])
        raise APIError(502, "refund_failed")
    return response.json()


def parse_notes(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value)[:2000]
