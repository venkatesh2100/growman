"""Admin mutations that are not catalog CRUD.

The role check is the same ``require_admin`` dependency the product
routes use. An onboarding token cannot reach it even if the role claim
says admin, because the dependency demands a full scope first.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import is_admin, require_admin, require_user
from app.documents import render_invoice_pdf
from app.errors import APIError
from app.images import store as store_image
from app.inventory import notify_restock, release
from app.models import (
    Coupon,
    DoothaWaitlist,
    Order,
    OrderSupportRequest,
    Product,
    Refund,
    RequestedProduct,
    Review,
    QuoteRequest,
    alive,
    utcnow,
)
from app.payments import refund_payment
from app.present import review_json
from app.routers.deps import get_db

router = APIRouter()


@router.get("/dashboard/map")
def dashboard_map(request: Request, _claims=Depends(require_user)):
    if not is_admin(_claims.role):
        raise APIError(403, "admin access required")
    # Request volume from Cloudflare Analytics Engine, the same SQL the Go
    # service runs. Orders are not a substitute: the map is traffic, not sales.
    time_frame = (request.query_params.get("timeFrame") or "daily").strip().lower()
    map_type = (request.query_params.get("mapType") or "").strip().lower()
    country = (request.query_params.get("country") or "").strip()
    days = {"weekly": "7", "monthly": "30"}.get(time_frame, "1")
    settings = request.app.state.settings
    if map_type == "world":
        if not settings.cloudflare_account_id:
            return {"success": True, "formattedStats": []}
        sql = f"""
SELECT blob1 AS countryCode, SUM(_sample_interval * double1) AS requests
FROM wae_events_v2
WHERE timestamp > NOW() - INTERVAL '{days}' DAY
GROUP BY countryCode
ORDER BY requests DESC
LIMIT 250"""
        rows = _wae(settings, sql)
        stats = []
        for row in rows or []:
            code = str(row.get("countryCode") or "").strip()
            if not code or code.lower() == "null":
                continue
            stats.append({"code": code, "name": code, "value": float(row.get("requests") or 0)})
        return {"success": True, "formattedStats": stats}
    if map_type == "country":
        if country.lower() != "india":
            raise APIError(400, "only India country map is supported")
        if not settings.cloudflare_api_token or not settings.cloudflare_account_id:
            raise APIError(502, "cloudflare account analytics is not configured")
        sql = f"""
SELECT blob3 AS regionCode, blob2 AS region, SUM(_sample_interval * double1) AS requests
FROM wae_events_v2
WHERE timestamp > NOW() - INTERVAL '{days}' DAY AND blob1 = 'IN'
GROUP BY regionCode, region
ORDER BY requests DESC
LIMIT 100"""
        try:
            rows = _wae(settings, sql, strict=True)
        except APIError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise APIError(502, "cloudflare analytics request failed") from exc
        stats = [
            {"code": str(row.get("regionCode") or row.get("region") or ""), "name": str(row.get("region") or ""), "value": float(row.get("requests") or 0)}
            for row in rows
            if row.get("region") or row.get("regionCode")
        ]
        return {"success": True, "formattedStats": stats}
    raise APIError(400, "mapType must be world or country")


def _wae(settings, sql: str, strict: bool = False) -> list[dict]:
    url = f"https://api.cloudflare.com/client/v4/accounts/{settings.cloudflare_account_id}/analytics_engine/sql"
    try:
        response = httpx.post(url, content=sql, headers={"Authorization": f"Bearer {settings.cloudflare_api_token}"}, timeout=20)
    except httpx.HTTPError as exc:
        if strict:
            raise APIError(502, "cloudflare analytics request failed") from exc
        return []
    if response.status_code >= 300:
        if strict:
            raise APIError(502, "cloudflare analytics request failed")
        return []
    data = response.json().get("data") or []
    return data if isinstance(data, list) else []


@router.get("/requested-products")
def list_requested(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    rows = db.scalars(select(RequestedProduct).order_by(RequestedProduct.created_at.desc()).limit(200)).all()
    return [
        {"id": r.id, "productName": r.product_name, "details": r.details, "status": r.status, "source": r.source, "requesterEmail": r.requester_email}
        for r in rows
    ]


@router.get("/dootha-waitlist")
def list_waitlist(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    rows = db.scalars(select(DoothaWaitlist).order_by(DoothaWaitlist.created_at.desc()).limit(200)).all()
    return [{"id": r.id, "name": r.name, "phone": r.phone, "email": r.email, "status": r.status, "signups": r.signups} for r in rows]


@router.get("/order-support-requests")
def list_support(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    rows = db.scalars(select(OrderSupportRequest).order_by(OrderSupportRequest.created_at.desc()).limit(200)).all()
    return [
        {"id": r.id, "orderId": r.order_id, "issueType": r.issue_type, "status": r.status, "priority": r.priority, "userMessage": r.user_message}
        for r in rows
    ]


class SupportStatus(BaseModel):
    status: str
    adminNotes: str = ""


@router.patch("/order-support-requests/{request_id}/status")
def update_support(request_id: int, body: SupportStatus, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    row = db.get(OrderSupportRequest, request_id)
    if row is None:
        raise APIError(404, "support request not found")
    row.status = body.status
    if body.adminNotes:
        row.admin_notes = body.adminNotes
    return {"id": row.id, "status": row.status}


@router.post("/images/upload")
async def upload_image(request: Request, _admin=Depends(require_admin)):
    form = await request.form()
    upload = form.get("image") or form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise APIError(400, "image file is required")
    data = await upload.read()
    if not data:
        raise APIError(400, "image file is required")
    prefix = str(form.get("prefix") or "uploads")
    try:
        key, url = store_image(request.app.state.settings, data, getattr(upload, "filename", "image.jpg"), getattr(upload, "content_type", "") or "", prefix)
    except ValueError as exc:
        raise APIError(400, "unsupported image type") from exc
    return {"imageKey": key, "imageUrl": url}


class StockIn(BaseModel):
    productId: int
    productSizeId: int | None = None
    delta: int


@router.post("/inventory/adjust")
def adjust_stock(body: StockIn, request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    if body.productSizeId:
        from app.models import ProductSize

        size = db.get(ProductSize, body.productSizeId)
        if size is None:
            raise APIError(404, "size not found")
        before = size.stock
        size.stock = max(size.stock + body.delta, 0)
        stock = size.stock
        product_id = size.product_id
        size_id = size.id
    else:
        product = db.get(Product, body.productId)
        if product is None:
            raise APIError(404, "product not found")
        before = product.stock
        product.stock = max(product.stock + body.delta, 0)
        stock = product.stock
        product_id = product.id
        size_id = None
    # A shelf that was empty and now has plants is the only moment the
    # waiting list should hear about it. Adding more to a shelf that was
    # never empty is not news.
    if before <= 0 < stock:
        notify_restock(db, request.app.state.settings, product_id, size_id)
    request.app.state.cache.invalidate_catalog()
    return {"stock": stock}


@router.get("/inventory/low-stock")
def low_stock(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    rows = db.scalars(
        select(Product).where(alive(Product), Product.track_inventory.is_(True), Product.stock <= Product.low_stock_threshold).limit(100)
    ).all()
    return [{"id": p.id, "name": p.name, "slug": p.slug, "stock": p.stock, "threshold": p.low_stock_threshold} for p in rows]


@router.get("/reviews")
def moderate_list(request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    status = request.query_params.get("status") or "pending"
    rows = db.scalars(select(Review).where(Review.status == status, alive(Review)).limit(100)).all()
    base = request.app.state.settings.image_base_url
    return [review_json(r, base) for r in rows]


class ModerateIn(BaseModel):
    status: str
    adminNotes: str = ""


@router.patch("/reviews/{review_id}/status")
def moderate(review_id: int, body: ModerateIn, request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    if body.status not in {"pending", "approved", "rejected"}:
        raise APIError(400, "status must be pending, approved, or rejected")
    review = db.get(Review, review_id)
    if review is None:
        raise APIError(404, "review not found")
    review.status = body.status
    review.admin_notes = body.adminNotes
    _recalculate(db, review.product_id)
    request.app.state.cache.invalidate_catalog()
    return {"id": review.id, "status": review.status}


def _recalculate(db: Session, product_id: int) -> None:
    ratings = db.scalars(select(Review.rating).where(Review.product_id == product_id, Review.status == "approved", alive(Review))).all()
    product = db.get(Product, product_id)
    if product is None:
        return
    product.rating_count = len(ratings)
    product.rating_average = round(sum(ratings) / len(ratings), 2) if ratings else 0


@router.get("/refunds")
def list_refunds(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    rows = db.scalars(select(Refund).order_by(Refund.created_at.desc()).limit(100)).all()
    return [{"id": r.id, "orderId": r.order_id, "amount": r.amount, "status": r.status, "reason": r.reason} for r in rows]


class RefundIn(BaseModel):
    amount: float | None = None
    reason: str = "other"
    notes: str = ""


@router.post("/orders/{order_id}/refund")
def create_refund(order_id: int, body: RefundIn, request: Request, db: Session = Depends(get_db), claims=Depends(require_admin)):
    order = db.scalar(select(Order).where(Order.id == order_id).options(selectinload(Order.items)))
    if order is None:
        raise APIError(404, "order not found")
    if order.payment_status not in {"paid", "partially_refunded"}:
        raise APIError(409, "order is not paid")
    remaining = round(order.amount - order.refunded_amount, 2)
    amount = body.amount if body.amount is not None else remaining
    if amount <= 0 or amount > remaining + 0.01:
        raise APIError(400, "refund amount is outside what is left on the order")
    remote = refund_payment(request.app.state.settings, order.razorpay_payment_id, amount)
    row = Refund(
        order_id=order.id,
        razorpay_refund_id=str(remote.get("id") or ""),
        razorpay_payment_id=order.razorpay_payment_id,
        amount=amount,
        reason=body.reason,
        notes=body.notes,
        initiated_by=claims.user_id,
        status=str(remote.get("status") or "pending"),
    )
    db.add(row)
    order.refunded_amount = round(order.refunded_amount + amount, 2)
    order.payment_status = "refunded" if order.refunded_amount >= order.amount - 0.01 else "partially_refunded"
    if order.payment_status == "refunded":
        release(db, order)
    return {"id": row.razorpay_refund_id, "status": row.status, "refundedAmount": order.refunded_amount}


@router.post("/orders/{order_id}/invoice/email")
def email_invoice(order_id: int, request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    from app.notify import send_email_now
    from app.payments import _assign_invoice

    order = db.scalar(select(Order).where(Order.id == order_id).options(selectinload(Order.items)))
    if order is None:
        raise APIError(404, "order not found")
    if not order.customer_email:
        raise APIError(409, "order has no customer email")
    if not order.invoice_number:
        _assign_invoice(db, order)
    filename = (order.invoice_number or f"order-{order.id}").replace("/", "-") + ".pdf"
    try:
        send_email_now(
            request.app.state.settings,
            order.customer_email,
            f"Invoice {order.invoice_number}",
            f"Hi {order.customer_name},\n\nYour tax invoice {order.invoice_number} for order #{order.id} is attached.\n",
            (filename, render_invoice_pdf(order)),
        )
    except Exception as exc:  # noqa: BLE001
        raise APIError(502, "failed to send invoice email") from exc
    return {"success": True, "invoiceNumber": order.invoice_number}


@router.get("/reports/gst")
def gst_report(request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """One calendar month of invoices, shaped for a GSTR reconciliation.

    ``month`` is ``YYYY-MM``. The default is the current month.
    """
    from datetime import datetime

    raw = (request.query_params.get("month") or "").strip() or utcnow().strftime("%Y-%m")
    try:
        start = datetime.strptime(raw, "%Y-%m")
    except ValueError as exc:
        raise APIError(400, "month must be formatted YYYY-MM") from exc
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    rows = db.scalars(
        select(Order)
        .where(Order.invoice_number != "", Order.invoice_date >= start, Order.invoice_date < end, alive(Order))
        .order_by(Order.invoice_number)
    ).all()
    invoices = [
        {
            "invoiceNumber": order.invoice_number,
            "invoiceDate": order.invoice_date.isoformat() + "Z" if order.invoice_date else None,
            "orderId": order.id,
            "customerName": order.customer_name,
            "state": order.state,
            "pincode": order.pincode,
            "taxableValue": order.taxable_value,
            "taxAmount": order.tax_amount,
            "total": order.amount,
            "refundedAmount": order.refunded_amount,
            "paymentStatus": order.payment_status,
        }
        for order in rows
    ]
    totals = {
        "taxableValue": round(sum(row["taxableValue"] or 0 for row in invoices), 2),
        "taxAmount": round(sum(row["taxAmount"] or 0 for row in invoices), 2),
        "total": round(sum(row["total"] or 0 for row in invoices), 2),
        "refundedAmount": round(sum(row["refundedAmount"] or 0 for row in invoices), 2),
    }
    return {"month": raw, "invoices": invoices, "count": len(invoices), "totals": totals}


@router.post("/orders/{order_id}/shipment")
def create_shipment(order_id: int, request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    order = db.scalar(select(Order).where(Order.id == order_id).options(selectinload(Order.items)))
    if order is None:
        raise APIError(404, "order not found")
    client = request.app.state.shiprocket
    settings = request.app.state.settings
    if client is None or not client.configured or not settings.shiprocket_pickup_location:
        raise APIError(503, "courier_unavailable")
    try:
        booked = client.book(order, settings.shiprocket_pickup_location)
    except Exception as exc:  # noqa: BLE001
        raise APIError(502, "courier_booking_failed", reason=str(exc)) from exc
    order.shipment_id = booked["shipmentId"]
    order.awb_number = booked["awb"]
    order.tracking_url = booked["trackingUrl"]
    order.courier_service = booked["courier"] or order.courier_service
    if booked["awb"]:
        order.status = "shipped"
        order.shipped_at = utcnow()
    return booked


@router.post("/orders/{order_id}/shipment/pickup")
def schedule_pickup(order_id: int, request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    order = db.get(Order, order_id)
    if order is None or not order.shipment_id:
        raise APIError(404, "shipment not found")
    client = request.app.state.shiprocket
    if client is None or not client.configured:
        raise APIError(503, "courier_unavailable")
    try:
        client.pickup(order.shipment_id)
    except Exception as exc:  # noqa: BLE001
        raise APIError(502, "pickup_failed", reason=str(exc)) from exc
    order.pickup_booked_at = utcnow()
    return {"ok": True}


class CouponIn(BaseModel):
    code: str
    description: str = ""
    type: str = "fixed"
    value: float = 0
    maxDiscount: float = 0
    minSubtotal: float = 0
    usageLimit: int = 0
    perUserLimit: int = 1
    firstOrderOnly: bool = False
    active: bool = True


def _apply_coupon(row: Coupon, body: CouponIn) -> None:
    row.code = body.code.strip().upper()
    row.description = body.description
    row.type = body.type
    row.value = body.value
    row.max_discount = body.maxDiscount
    row.min_subtotal = body.minSubtotal
    row.usage_limit = body.usageLimit
    row.per_user_limit = body.perUserLimit
    row.first_order_only = body.firstOrderOnly
    row.active = body.active


@router.get("/coupons")
def list_coupons(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    rows = db.scalars(select(Coupon).where(alive(Coupon)).order_by(Coupon.created_at.desc())).all()
    return [
        {"id": c.id, "code": c.code, "type": c.type, "value": c.value, "usageCount": c.usage_count, "usageLimit": c.usage_limit, "active": c.active}
        for c in rows
    ]


@router.post("/coupons")
def create_coupon(body: CouponIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    row = Coupon(code=body.code.strip().upper())
    _apply_coupon(row, body)
    db.add(row)
    db.flush()
    return {"id": row.id, "code": row.code}


@router.put("/coupons/{coupon_id}")
def update_coupon(coupon_id: int, body: CouponIn, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    row = db.get(Coupon, coupon_id)
    if row is None:
        raise APIError(404, "coupon not found")
    _apply_coupon(row, body)
    return {"id": row.id, "code": row.code}


@router.delete("/coupons/{coupon_id}")
def delete_coupon(coupon_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    row = db.get(Coupon, coupon_id)
    if row is None:
        raise APIError(404, "coupon not found")
    row.deleted_at = utcnow()
    row.active = False
    return {"ok": True}


class QuoteStatus(BaseModel):
    status: str


@router.patch("/quotes/{quote_id}")
def update_quote(quote_id: int, body: QuoteStatus, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    row = db.get(QuoteRequest, quote_id)
    if row is None:
        raise APIError(404, "quote not found")
    row.status = body.status[:16]
    return {"id": row.id, "status": row.status}
