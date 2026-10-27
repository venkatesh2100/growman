"""Orders and the client-driven payment check.

``POST /razorpay/verify`` and the Razorpay webhook both call
``mark_order_paid``. The conditional update inside that function is what
makes the confirmation email happen once.

``GET /order`` is never authorised by a sequential id alone. A guest
presents the opaque token minted at checkout. A signed-in customer
presents the id and must own the order (admins may see any).
"""

from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.accounts import add_credit, hash_password
from app.auth import is_admin, optional_claims, require_user
from app.documents import render_invoice_pdf
from app.errors import APIError
from app.inventory import release
from app.metrics import payment_signature_failures
from app.models import Order, User, alive, utcnow
from app.notify import alert_ops, send_email
from app.payments import mark_order_paid, refund_payment, verify_hmac
from app.payments import _assign_invoice
from app.present import order_json
from app.responses import page_meta, parse_page
from app.routers.deps import get_db

log = logging.getLogger("growman.orders")
router = APIRouter()


def _load_for_viewer(db: Session, request: Request, claims, *, order_id: int | None = None, token: str = "") -> Order:
    stmt = select(Order).where(alive(Order)).options(selectinload(Order.items))
    if token:
        if len(token) < 32:
            raise APIError(400, "invalid order token")
        order = db.scalar(stmt.where(Order.public_token == token))
    elif order_id:
        if claims is None:
            raise APIError(401, "missing Authorization header")
        order = db.scalar(stmt.where(Order.id == order_id))
        if order and not is_admin(claims.role) and order.user_id != claims.user_id:
            # Same 404 as a missing order, so ids cannot be enumerated.
            order = None
    else:
        raise APIError(400, "id or token is required")
    if order is None:
        raise APIError(404, "order not found")
    return order


@router.get("/order")
def get_order(request: Request, db: Session = Depends(get_db), claims=Depends(optional_claims)):
    token = (request.query_params.get("token") or "").strip()
    raw_id = (request.query_params.get("id") or "").strip()
    order_id = int(raw_id) if raw_id.isdigit() else None
    order = _load_for_viewer(db, request, claims, order_id=order_id, token=token)
    return order_json(order, request.app.state.settings.image_base_url)


@router.get("/orders/{order_id}/invoice")
def invoice(order_id: int, request: Request, db: Session = Depends(get_db), claims=Depends(optional_claims)):
    token = (request.query_params.get("token") or "").strip()
    order = _load_for_viewer(db, request, claims, order_id=None if token else order_id, token=token)
    if order.payment_status != "paid" and not order.refunded_amount:
        raise APIError(409, "an invoice is only available once the order is paid")
    if not order.invoice_number:
        _assign_invoice(db, order)
        db.flush()
    filename = (order.invoice_number or f"order-{order.id}").replace("/", "-")
    pdf = render_invoice_pdf(order)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="invoice-{filename}.pdf"',
            "Cache-Control": "private, max-age=0, no-store",
        },
    )


class VerifyIn(BaseModel):
    razorpay_order_id: str = ""
    razorpay_payment_id: str = ""
    razorpay_signature: str = ""
    orderId: int | None = None


@router.post("/razorpay/verify")
def verify_payment(body: VerifyIn, request: Request, db: Session = Depends(get_db)):
    if not body.razorpay_payment_id:
        raise APIError(400, "razorpay_payment_id is required")
    if not body.orderId and not body.razorpay_order_id:
        raise APIError(400, "orderId or razorpay_order_id is required")
    stmt = select(Order).options(selectinload(Order.items))
    if body.orderId:
        order = db.scalar(stmt.where(Order.id == body.orderId, alive(Order)))
    else:
        order = db.scalar(stmt.where(Order.razorpay_order_id == body.razorpay_order_id, alive(Order)))
    if order is None:
        raise APIError(404, "order not found")

    settings = request.app.state.settings
    if not settings.skip_signature_checks:
        # Sign the order id we stored, not the one the browser posted.
        if not body.razorpay_signature:
            raise APIError(400, "razorpay_signature is required")
        message = f"{order.razorpay_order_id}|{body.razorpay_payment_id}"
        if not verify_hmac(settings.razorpay_key_secret, message, body.razorpay_signature):
            payment_signature_failures.labels(stage="verify").inc()
            raise APIError(400, "payment verification failed")

    first = mark_order_paid(db, order, body.razorpay_payment_id)
    _after_paid(request, db, order, first)
    return {"success": True, "message": "Payment verified successfully", "orderId": order.id, "publicToken": order.public_token}


def _after_paid(request, db: Session, order: Order, first: bool) -> None:
    if not first:
        return
    settings = request.app.state.settings
    if order.customer_email:
        lines = "\n".join(f"- {i.name} x {i.quantity}" for i in order.items)
        send_email(
            settings,
            order.customer_email,
            f"Growman order {order.id} confirmed",
            f"Hi {order.customer_name},\n\nWe received ₹{order.amount:.0f}.\n\n{lines}\n",
        )
    alert_ops(settings, f"Paid order #{order.id} ₹{order.amount:.0f} via {order.fulfillment_channel}")
    if order.user_id is None and order.customer_email:
        _link_soft_account(db, order)


def _link_soft_account(db: Session, order: Order) -> None:
    """A guest payment still becomes a user, so the order has an owner.

    Failure here must not undo the payment, so the caller runs this after
    ``mark_order_paid`` has already written the paid row. The random
    password is never shown; the customer sets one through forgot-password.
    """
    user = db.scalar(
        select(User).where(or_(User.email == order.customer_email, User.phone == order.customer_phone), alive(User))
    )
    if user is None:
        user = User(
            name=order.customer_name,
            email=order.customer_email,
            phone=order.customer_phone,
            password_hash=hash_password(secrets.token_hex(16)),
            email_verified=True,
            provider="local",
            role="user",
        )
        db.add(user)
        db.flush()
    order.user_id = user.id


@router.get("/orders")
def list_orders(request: Request, db: Session = Depends(get_db), claims=Depends(require_user)):
    page, size, offset = parse_page(request)
    status = (request.query_params.get("status") or "").strip().lower()
    search = (request.query_params.get("search") or "").strip().lower()
    scope = (request.query_params.get("scope") or "").strip().lower()
    admin = is_admin(claims.role) and scope != "self"
    cond = [alive(Order)]
    if not admin:
        cond.append(Order.user_id == claims.user_id)
    if status in {"", "all"}:
        pass
    elif status == "settled":
        # Paid, refunded, and partially refunded stay in history. Unpaid
        # checkouts and abandoned carts do not.
        cond.append(Order.payment_status.notin_(["created", "failed"]))
        cond.append(Order.status != "abandoned")
    else:
        wanted = [part.strip() for part in status.split(",") if part.strip()]
        cond.append(Order.status.in_(wanted))
    if search and admin:
        like = f"%{search}%"
        cond.append(or_(Order.customer_name.ilike(like), Order.customer_email.ilike(like), Order.customer_phone.ilike(like)))
    total = db.scalar(select(func.count()).select_from(Order).where(*cond)) or 0
    rows = db.scalars(
        select(Order).where(*cond).options(selectinload(Order.items)).order_by(Order.created_at.desc()).offset(offset).limit(size)
    ).all()
    base = request.app.state.settings.image_base_url
    return {"data": [order_json(o, base) for o in rows], "pagination": page_meta(page, size, total)}


class StatusIn(BaseModel):
    status: str


@router.patch("/orders/{order_id}/status")
def update_status(order_id: int, body: StatusIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    if not is_admin(claims.role):
        raise APIError(403, "admin access required")
    order = db.get(Order, order_id)
    if order is None or order.deleted_at is not None:
        raise APIError(404, "order not found")
    order.status = body.status.strip().lower()
    if order.status == "delivered" and order.delivered_at is None:
        order.delivered_at = utcnow()
    return {"id": order.id, "status": order.status}


class DeliveryDateIn(BaseModel):
    expectedDeliveryDate: str


@router.patch("/orders/{order_id}/expected-delivery")
def update_delivery_date(order_id: int, body: DeliveryDateIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    if not is_admin(claims.role):
        raise APIError(403, "admin access required")
    order = db.get(Order, order_id)
    if order is None:
        raise APIError(404, "order not found")
    try:
        order.expected_delivery_date = datetime_from(body.expectedDeliveryDate)
    except ValueError as exc:
        raise APIError(400, "expectedDeliveryDate must be YYYY-MM-DD") from exc
    return {"ok": True}


def datetime_from(value: str):
    from datetime import datetime

    return datetime.strptime(value.strip()[:10], "%Y-%m-%d")


class CancelIn(BaseModel):
    reason: str = ""


@router.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int, body: CancelIn, request: Request, db: Session = Depends(get_db), claims=Depends(require_user)):
    order = db.scalar(select(Order).where(Order.id == order_id, alive(Order)).options(selectinload(Order.items)))
    if order is None or (not is_admin(claims.role) and order.user_id != claims.user_id):
        raise APIError(404, "order not found")
    if not order.is_cancellable() and not is_admin(claims.role):
        raise APIError(409, "this order can no longer be cancelled")
    order.cancelled_at = utcnow()
    order.cancel_reason = body.reason[:500]
    order.status = "cancelled"
    release(db, order)
    if order.payment_status == "paid" and order.razorpay_payment_id:
        refund = refund_payment(request.app.state.settings, order.razorpay_payment_id, order.amount - order.refunded_amount)
        from app.models import Refund

        db.add(
            Refund(
                order_id=order.id,
                razorpay_refund_id=str(refund.get("id") or ""),
                razorpay_payment_id=order.razorpay_payment_id,
                amount=order.amount,
                reason="customer_cancelled",
                initiated_by=claims.user_id,
                status=str(refund.get("status") or "pending"),
            )
        )
        order.payment_status = "refunded"
        order.refunded_amount = order.amount
    if order.credit_applied and order.user_id:
        add_credit(db, order.user_id, order.credit_applied, "cancel", order.id)
    if order.customer_email:
        send_email(
            request.app.state.settings,
            order.customer_email,
            f"Growman order {order.id} cancelled",
            f"Hi {order.customer_name},\n\nOrder #{order.id} for Rs. {order.amount:.0f} is cancelled."
            + (" The payment will be refunded.\n" if order.payment_status == "refunded" else "\n"),
        )
    return {"ok": True, "status": order.status}
