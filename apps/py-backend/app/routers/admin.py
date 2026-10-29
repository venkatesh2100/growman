"""Staff tools: stock, coupons, refunds, images, and the GST month."""

import io
import secrets
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import mail, shop
from app.db import get_db
from app.http import APIError
from app.models import (
    BackInStockRequest,
    Coupon,
    Order,
    Product,
    ProductSize,
    Refund,
    Review,
    alive,
    utcnow,
)
from app.security import admin
from app.serialize import image_url, review as review_out

router = APIRouter(tags=["admin"], dependencies=[Depends(admin)])


def store_upload(upload, prefix: str, base: str) -> dict:
    raw = upload.file.read()
    if len(raw) > 8_000_000:
        raise APIError(413, "image_too_large")
    ext = "bin"
    try:
        from PIL import Image
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        image.thumbnail((1600, 1600))
        buf = io.BytesIO()
        image.save(buf, format="WEBP", quality=82)
        raw, ext = buf.getvalue(), "webp"
    except Exception:
        ext = (upload.filename or "bin").rsplit(".", 1)[-1][:8] or "bin"
    key = f"{prefix}/{secrets.token_hex(8)}.{ext}"
    path = Path("data/uploads") / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return {"imageKey": key, "imageUrl": image_url(base, key)}


@router.post("/images/upload")
async def upload_image(request: Request):
    form = await request.form()
    upload = form.get("image")
    if upload is None or not hasattr(upload, "read"):
        raise APIError(400, "image_required")
    prefix = str(form.get("prefix") or "products")
    return store_upload(upload, prefix, request.app.state.settings.image_base_url)


@router.post("/inventory/adjust")
def adjust(body: dict, request: Request, db: Session = Depends(get_db)):
    product = db.get(Product, int(body.get("productId") or 0))
    if product is None or product.deleted_at:
        raise APIError(404, "not_found")
    before = product.stock
    if body.get("productSizeId"):
        size = db.get(ProductSize, int(body["productSizeId"]))
        if size is None or size.product_id != product.id:
            raise APIError(404, "not_found")
        before = size.stock
        size.stock = max(0, int(body.get("stock", size.stock)))
        now = size.stock
    else:
        product.stock = max(0, int(body.get("stock", product.stock)))
        now = product.stock
    if before <= 0 < now:
        base = request.app.state.settings
        for ask in db.scalars(select(BackInStockRequest).where(BackInStockRequest.product_id == product.id, BackInStockRequest.notified_at.is_(None))):
            mail.send(base, ask.email, f"{product.name} is back", "It is on the shelf again.")
            ask.notified_at = utcnow()
    return {"stock": now}


@router.get("/inventory/low-stock")
def low_stock(db: Session = Depends(get_db)):
    rows = db.scalars(select(Product).where(alive(Product), Product.track_inventory.is_(True), Product.stock <= Product.low_stock_threshold)).all()
    return [{"id": row.id, "name": row.name, "slug": row.slug, "stock": row.stock, "threshold": row.low_stock_threshold} for row in rows]


@router.get("/reviews")
def moderate_list(db: Session = Depends(get_db), status: str = "pending"):
    rows = db.scalars(select(Review).where(alive(Review), Review.status == status).order_by(Review.id.desc()).limit(100)).all()
    return [review_out(row) for row in rows]


@router.patch("/reviews/{row_id}/status")
def moderate(row_id: int, body: dict, db: Session = Depends(get_db)):
    row = db.get(Review, row_id)
    if row is None:
        raise APIError(404, "not_found")
    status = str(body.get("status") or "")
    if status not in {"pending", "approved", "rejected"}:
        raise APIError(400, "invalid_status")
    row.status = status
    row.admin_notes = str(body.get("notes") or "")
    scores = [item.rating for item in db.scalars(select(Review).where(Review.product_id == row.product_id, Review.status == "approved", alive(Review)))]
    product = db.get(Product, row.product_id)
    if product:
        product.rating_count = len(scores)
        product.rating_average = round(sum(scores) / len(scores), 2) if scores else 0
    return {"ok": True}


@router.get("/refunds")
def list_refunds(db: Session = Depends(get_db)):
    rows = db.scalars(select(Refund).where(alive(Refund)).order_by(Refund.id.desc()).limit(100)).all()
    return [{"id": row.id, "orderId": row.order_id, "amount": row.amount, "status": row.status, "reason": row.reason} for row in rows]


@router.post("/orders/{order_id}/refund")
def refund(order_id: int, body: dict, db: Session = Depends(get_db), user=Depends(admin)):
    order = shop.load_order(db, order_id=order_id)
    amount = shop.money(float(body.get("amount") or order.amount))
    if order.payment_status != "paid" or amount <= 0 or order.refunded_amount + amount > order.amount + 0.01:
        raise APIError(409, "refund_not_allowed")
    order.refunded_amount = shop.money(order.refunded_amount + amount)
    if order.refunded_amount >= order.amount:
        order.status = "refunded"
    row = Refund(order_id=order.id, amount=amount, reason=str(body.get("reason") or "requested")[:64],
                 notes=str(body.get("notes") or ""), initiated_by=user.id, status="pending")
    if body.get("restock"):
        shop._release_lines(db, order)
        row.restocked_inventory = True
    db.add(row)
    db.flush()
    return {"id": row.id, "refundedAmount": order.refunded_amount}


@router.post("/orders/{order_id}/invoice/email")
def email_invoice(order_id: int, request: Request, db: Session = Depends(get_db)):
    order = shop.load_order(db, order_id=order_id)
    settings = request.app.state.settings
    if not settings.smtp_email:
        raise APIError(503, "email_unavailable")
    from app.routers.orders import pdf
    sent = mail.send(settings, order.customer_email, f"Invoice {order.invoice_number}", shop.rupees(order.amount))
    if not sent:
        raise APIError(503, "email_unavailable")
    return {"ok": True}


@router.get("/reports/gst")
def gst(db: Session = Depends(get_db), month: str = ""):
    try:
        start = datetime.strptime(month, "%Y-%m")
    except ValueError as exc:
        raise APIError(400, "month must be YYYY-MM") from exc
    end = datetime(start.year + (start.month == 12), 1 if start.month == 12 else start.month + 1, 1)
    rows = db.scalars(select(Order).where(alive(Order), Order.payment_status == "paid", Order.invoice_date >= start, Order.invoice_date < end)).all()
    return {
        "month": month,
        "orders": [{
            "invoiceNumber": row.invoice_number, "taxableValue": row.taxable_value,
            "taxAmount": row.tax_amount, "amount": row.amount,
        } for row in rows],
        "taxableValue": shop.money(sum(row.taxable_value for row in rows)),
        "taxAmount": shop.money(sum(row.tax_amount for row in rows)),
    }


@router.get("/coupons")
def list_coupons(db: Session = Depends(get_db)):
    rows = db.scalars(select(Coupon).where(alive(Coupon)).order_by(Coupon.id.desc())).all()
    return [{"id": row.id, "code": row.code, "type": row.type, "value": row.value, "active": row.active, "usageCount": row.usage_count, "usageLimit": row.usage_limit} for row in rows]


@router.post("/coupons")
def create_coupon(body: dict, db: Session = Depends(get_db)):
    code = str(body.get("code") or "").strip().upper()
    if not code:
        raise APIError(400, "code_required")
    row = Coupon(code=code, description=str(body.get("description") or ""), type=str(body.get("type") or "fixed"),
                 value=float(body.get("value") or 0), max_discount=float(body.get("maxDiscount") or 0),
                 min_subtotal=float(body.get("minSubtotal") or 0), usage_limit=int(body.get("usageLimit") or 0),
                 per_user_limit=int(body.get("perUserLimit") or 1), active=bool(body.get("active", True)))
    db.add(row)
    db.flush()
    return {"id": row.id, "code": row.code}


@router.put("/coupons/{row_id}")
def update_coupon(row_id: int, body: dict, db: Session = Depends(get_db)):
    row = db.get(Coupon, row_id)
    if row is None or row.deleted_at:
        raise APIError(404, "not_found")
    for src, dest in (("description", "description"), ("value", "value"), ("active", "active"), ("usageLimit", "usage_limit")):
        if src in body:
            setattr(row, dest, body[src])
    return {"id": row.id, "code": row.code, "active": row.active}


@router.delete("/coupons/{row_id}")
def delete_coupon(row_id: int, db: Session = Depends(get_db)):
    row = db.get(Coupon, row_id)
    if row:
        row.deleted_at = utcnow()
        row.active = False
    return {"ok": True}


@router.patch("/quotes/{row_id}")
def quote_status(row_id: int, body: dict, db: Session = Depends(get_db)):
    from app.models import QuoteRequest
    row = db.get(QuoteRequest, row_id)
    if row is None:
        raise APIError(404, "not_found")
    row.status = str(body.get("status") or row.status)[:16]
    return {"id": row.id, "status": row.status}


def courier_token(settings) -> str:
    if settings.shiprocket_token:
        return settings.shiprocket_token
    if not settings.shiprocket_email or not settings.shiprocket_password:
        return ""
    import httpx
    response = httpx.post(
        "https://apiv2.shiprocket.in/v1/external/auth/login",
        json={"email": settings.shiprocket_email, "password": settings.shiprocket_password},
        timeout=15,
    )
    return response.json().get("token", "") if response.status_code < 300 else ""


def book_courier(settings, order) -> dict:
    """Booking happens after payment. A courier failure never un-pays the order."""
    token = courier_token(settings)
    if not token:
        raise APIError(503, "courier_unavailable")
    import httpx
    payload = {
        "order_id": f"GRW{order.id}",
        "order_date": order.created_at.strftime("%Y-%m-%d %H:%M"),
        "pickup_location": settings.shiprocket_pickup_location or "Primary",
        "billing_customer_name": order.customer_name,
        "billing_address": order.address_line or "Hyderabad",
        "billing_city": order.city or "Hyderabad",
        "billing_pincode": order.pincode,
        "billing_state": order.state or "Telangana",
        "billing_country": "India",
        "billing_email": order.customer_email,
        "billing_phone": order.customer_phone,
        "shipping_is_billing": True,
        "order_items": [{"name": item.name, "sku": str(item.product_id), "units": item.quantity, "selling_price": item.price} for item in order.items],
        "payment_method": "Prepaid",
        "sub_total": order.amount,
        "length": 20, "breadth": 20, "height": 20, "weight": 1,
    }
    response = httpx.post(
        "https://apiv2.shiprocket.in/v1/external/orders/create/adhoc",
        json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=20,
    )
    if response.status_code >= 300:
        raise APIError(502, "courier_failed")
    body = response.json()
    order.shipment_id = str(body.get("shipment_id") or "")
    order.awb_number = str(body.get("awb_code") or "")
    order.courier_provider = "Shiprocket"
    return {"shipmentId": order.shipment_id, "awb": order.awb_number}


@router.post("/orders/{order_id}/shipment")
def create_shipment(order_id: int, request: Request, db: Session = Depends(get_db)):
    order = shop.load_order(db, order_id=order_id)
    if order.payment_status != "paid":
        raise APIError(409, "not_paid")
    return book_courier(request.app.state.settings, order)


@router.post("/orders/{order_id}/shipment/pickup")
def schedule_pickup(order_id: int, request: Request, db: Session = Depends(get_db)):
    order = shop.load_order(db, order_id=order_id)
    if not order.shipment_id:
        raise APIError(409, "shipment_missing")
    token = courier_token(request.app.state.settings)
    if not token:
        raise APIError(503, "courier_unavailable")
    import httpx
    response = httpx.post(
        "https://apiv2.shiprocket.in/v1/external/courier/generate/pickup",
        json={"shipment_id": [int(order.shipment_id)]},
        headers={"Authorization": f"Bearer {token}"}, timeout=20,
    )
    if response.status_code >= 300:
        raise APIError(502, "courier_failed")
    order.pickup_booked_at = utcnow()
    return {"ok": True}
