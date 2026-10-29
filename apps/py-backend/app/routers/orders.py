"""Orders the customer can see, and the invoice they can download."""

from datetime import datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import shop
from app.db import get_db
from app.http import APIError
from app.models import Order, alive
from app.security import member, optional_user
from app.serialize import order_out

router = APIRouter(tags=["orders"])


def _own(db: Session, user, order_id: int, *, admin_ok: bool = False) -> Order:
    order = shop.load_order(db, order_id=order_id)
    if order.user_id != user.id and not (admin_ok and user.role in {"admin", "superadmin"}):
        raise APIError(404, "not_found")
    return order


@router.get("/order")
def get_order(request: Request, db: Session = Depends(get_db), user=Depends(optional_user), token: str = "", id: int = 0):
    if token:
        order = shop.load_order(db, token=token)
    elif user is not None and id:
        order = _own(db, user, id, admin_ok=True)
    else:
        raise APIError(400, "token_or_id_required")
    return order_out(order, request.app.state.settings.image_base_url)


@router.get("/orders")
def list_orders(request: Request, db: Session = Depends(get_db), user=Depends(member)):
    rows = db.scalars(
        select(Order).where(alive(Order), Order.user_id == user.id).options(selectinload(Order.items)).order_by(Order.id.desc())
    ).all()
    return [order_out(row, request.app.state.settings.image_base_url) for row in rows]


@router.get("/me/orders/active")
def active_order(request: Request, db: Session = Depends(get_db), user=Depends(member)):
    order = db.scalar(
        select(Order).where(
            alive(Order), Order.user_id == user.id,
            Order.status.notin_(["delivered", "cancelled", "abandoned", "failed"]),
        ).options(selectinload(Order.items)).order_by(Order.id.desc())
    )
    return order_out(order, request.app.state.settings.image_base_url) if order else None


@router.post("/orders/{order_id}/cancel")
def cancel(order_id: int, body: dict, db: Session = Depends(get_db), user=Depends(member)):
    order = _own(db, user, order_id, admin_ok=True)
    shop.cancel(db, order, str(body.get("reason") or "Cancelled by customer"))
    return {"ok": True}


@router.get("/orders/{order_id}/invoice")
def invoice(order_id: int, request: Request, db: Session = Depends(get_db), user=Depends(optional_user), token: str = ""):
    if token:
        order = shop.load_order(db, token=token)
        if order.id != order_id:
            raise APIError(404, "not_found")
    elif user is not None:
        order = _own(db, user, order_id, admin_ok=True)
    else:
        raise APIError(401, "missing_token")
    if order.payment_status != "paid" or not order.invoice_number:
        raise APIError(409, "invoice_not_ready")
    return Response(pdf(order), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{order.invoice_number.replace("/", "-")}.pdf"'})


@router.post("/orders/{order_id}/reorder")
def reorder(order_id: int, request: Request, db: Session = Depends(get_db), user=Depends(member)):
    order = _own(db, user, order_id)
    base = request.app.state.settings.image_base_url
    return {"items": order_out(order, base)["items"]}


@router.post("/orders/{order_id}/rating")
def rate(order_id: int, body: dict, db: Session = Depends(get_db), user=Depends(member)):
    order = _own(db, user, order_id)
    score = int(body.get("rating") or 0)
    if not 1 <= score <= 5:
        raise APIError(400, "invalid_rating")
    order.delivery_rating = score
    order.delivery_feedback = str(body.get("feedback") or "")[:500]
    return {"ok": True}


@router.post("/orders/{order_id}/retry-payment")
def retry_payment(order_id: int, request: Request, db: Session = Depends(get_db), user=Depends(member)):
    order = _own(db, user, order_id)
    if order.payment_status == "paid":
        raise APIError(409, "already_paid")
    remote = shop._razorpay(request.app.state.settings, order.amount, order.currency or "INR")
    order.razorpay_order_id = remote["id"]
    order.payment_status = "created"
    order.status = "pending"
    return {"id": remote["id"], "amount": remote["amount"], "currency": remote["currency"], "orderId": order.id, "publicToken": order.public_token}


@router.patch("/orders/{order_id}/status")
def update_status(order_id: int, body: dict, db: Session = Depends(get_db), user=Depends(member)):
    if user.role not in {"admin", "superadmin"}:
        raise APIError(403, "admin_required")
    order = shop.load_order(db, order_id=order_id)
    status = str(body.get("status") or "")
    if status not in {"pending", "paid", "confirmed", "processing", "shipped", "delivered", "cancelled"}:
        raise APIError(400, "invalid_status")
    order.status = status
    if status == "shipped":
        order.shipped_at = order.shipped_at or datetime.utcnow()
    if status == "delivered":
        order.delivered_at = order.delivered_at or datetime.utcnow()
    return {"ok": True, "status": order.status}


@router.patch("/orders/{order_id}/expected-delivery")
def expected_delivery(order_id: int, body: dict, db: Session = Depends(get_db), user=Depends(member)):
    if user.role not in {"admin", "superadmin"}:
        raise APIError(403, "admin_required")
    order = shop.load_order(db, order_id=order_id)
    raw = str(body.get("date") or body.get("expectedDeliveryDate") or "")
    try:
        order.expected_delivery_date = datetime.strptime(raw, "%Y-%m-%d")
    except ValueError as exc:
        raise APIError(400, "date must be YYYY-MM-DD") from exc
    return {"ok": True}


def pdf(order: Order) -> bytes:
    from fpdf import FPDF
    doc = FPDF()
    doc.add_page()
    doc.set_font("Helvetica", size=16)
    doc.cell(0, 10, "Sri Shirdi Sai Nursery", new_x="LMARGIN", new_y="NEXT")
    doc.set_font("Helvetica", size=11)
    doc.cell(0, 6, "Hyderabad", new_x="LMARGIN", new_y="NEXT")
    doc.cell(0, 8, f"Tax invoice {order.invoice_number}", new_x="LMARGIN", new_y="NEXT")
    doc.cell(0, 6, f"{order.customer_name}  {order.customer_phone}", new_x="LMARGIN", new_y="NEXT")
    doc.cell(0, 6, f"{order.address_line}, {order.city} {order.pincode}", new_x="LMARGIN", new_y="NEXT")
    doc.ln(4)
    for item in order.items:
        if item.deleted_at:
            continue
        doc.cell(0, 6, f"{item.quantity} x {item.name}    Rs {item.price * item.quantity:.2f}", new_x="LMARGIN", new_y="NEXT")
    doc.ln(2)
    doc.cell(0, 6, f"Subtotal Rs {order.subtotal:.2f}", new_x="LMARGIN", new_y="NEXT")
    doc.cell(0, 6, f"Delivery Rs {order.delivery_fee:.2f}", new_x="LMARGIN", new_y="NEXT")
    doc.cell(0, 6, f"Tax Rs {order.tax_amount:.2f}    Total Rs {order.amount:.2f}", new_x="LMARGIN", new_y="NEXT")
    doc.ln(4)
    doc.set_x(doc.l_margin)
    doc.multi_cell(0, 6, shop.rupees(order.amount))
    return bytes(doc.output())
