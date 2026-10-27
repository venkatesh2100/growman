"""Signed-in customer features: addresses, wishlist, plants, privacy.

These routes all require a full account. An onboarding token cannot
reach them, because the dependency is mounted in ``main``.
"""

from __future__ import annotations

import json
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.accounts import add_credit, credit_balance, ensure_referral_code
from app.auth import require_user
from app.care import advice
from app.errors import APIError
from app.images import store as store_image
from app.models import (
    Address,
    AppNotification,
    CartSnapshot,
    ChatTurn,
    NotificationPreference,
    Order,
    OwnedPlant,
    PlantHealthLog,
    Product,
    QuoteRequest,
    RecentView,
    SavedItem,
    SavedPaymentMethod,
    User,
    Wishlist,
    alive,
    utcnow,
)
from app.payments import create_razorpay_order
from app.present import address_json, order_json, product_card
from app.privacy import export_account, erase_account
from app.routers.deps import get_db

router = APIRouter()


def _me(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise APIError(401, "invalid token")
    return user


@router.get("/wishlist")
def list_wishlist(request: Request, db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(
        select(Wishlist).where(Wishlist.user_id == claims.user_id, alive(Wishlist)).options(selectinload(Wishlist.product))
    ).all()
    base = request.app.state.settings.image_base_url
    return [
        {"id": w.id, "productId": w.product_id, "priceAtAdd": w.price_at_add, "product": product_card(w.product, base)}
        for w in rows
        if w.product and w.product.deleted_at is None
    ]


class WishlistIn(BaseModel):
    productId: int


@router.post("/wishlist")
def add_wishlist(body: WishlistIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    product = db.get(Product, body.productId)
    if product is None or product.deleted_at is not None:
        raise APIError(404, "product not found")
    existing = db.scalar(select(Wishlist).where(Wishlist.user_id == claims.user_id, Wishlist.product_id == product.id))
    if existing:
        return {"id": existing.id}
    row = Wishlist(user_id=claims.user_id, product_id=product.id, price_at_add=product.price)
    db.add(row)
    db.flush()
    return {"id": row.id}


@router.delete("/wishlist/{product_id}")
def remove_wishlist(product_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    db.execute(delete(Wishlist).where(Wishlist.user_id == claims.user_id, Wishlist.product_id == product_id))
    return {"ok": True}


@router.get("/addresses")
def list_addresses(db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(select(Address).where(Address.user_id == claims.user_id, alive(Address)).order_by(Address.is_default.desc())).all()
    return [address_json(r) for r in rows]


class AddressIn(BaseModel):
    label: str = ""
    name: str
    phone: str
    addressLine: str
    city: str
    state: str
    pincode: str
    latitude: float | None = None
    longitude: float | None = None
    isDefault: bool = False


@router.post("/addresses")
def create_address(body: AddressIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    if body.isDefault:
        db.execute(Address.__table__.update().where(Address.user_id == claims.user_id).values(is_default=False))
    row = Address(
        user_id=claims.user_id,
        label=body.label,
        name=body.name,
        phone=body.phone,
        address_line=body.addressLine,
        city=body.city,
        state=body.state,
        pincode=body.pincode,
        latitude=body.latitude,
        longitude=body.longitude,
        is_default=body.isDefault,
    )
    db.add(row)
    db.flush()
    return address_json(row)


@router.put("/addresses/{address_id}")
def update_address(address_id: int, body: AddressIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = db.scalar(select(Address).where(Address.id == address_id, Address.user_id == claims.user_id, alive(Address)))
    if row is None:
        raise APIError(404, "address not found")
    row.label = body.label
    row.name = body.name
    row.phone = body.phone
    row.address_line = body.addressLine
    row.city = body.city
    row.state = body.state
    row.pincode = body.pincode
    row.latitude = body.latitude
    row.longitude = body.longitude
    row.is_default = body.isDefault
    return address_json(row)


@router.delete("/addresses/{address_id}")
def delete_address(address_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = db.scalar(select(Address).where(Address.id == address_id, Address.user_id == claims.user_id))
    if row is None:
        raise APIError(404, "address not found")
    row.deleted_at = utcnow()
    return {"ok": True}


@router.get("/privacy/export")
def export_me(db: Session = Depends(get_db), claims=Depends(require_user)):
    return export_account(db, _me(db, claims.user_id))


@router.post("/privacy/erase")
def erase_me(db: Session = Depends(get_db), claims=Depends(require_user)):
    erase_account(db, _me(db, claims.user_id))
    return {"ok": True, "message": "Account identifiers were removed. Order records stay for one year, without contact details."}


class PlantIn(BaseModel):
    name: str
    location: str = ""
    notes: str = ""
    waterEveryDays: int = 7
    fertilizeEveryDays: int = 30
    room: str = ""
    productId: int | None = None
    productSlug: str = ""


def _plant_json(row: OwnedPlant) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "location": row.location,
        "notes": row.notes,
        "room": row.room,
        "waterEveryDays": row.water_every_days,
        "fertilizeEveryDays": row.fertilize_every_days,
        "waterNextAt": row.water_next_at.isoformat() + "Z" if row.water_next_at else None,
        "fertilizeNextAt": row.fertilize_next_at.isoformat() + "Z" if row.fertilize_next_at else None,
        "waterReminder": row.water_reminder,
        "fertilizeReminder": row.fertilize_reminder,
        "photoUrl": row.photo_url,
        "productId": row.product_id,
        "productSlug": row.product_slug,
        "snoozedUntil": row.snoozed_until.isoformat() + "Z" if row.snoozed_until else None,
    }


def _next_at(days: int):
    return utcnow() + timedelta(days=max(days, 1))


@router.get("/me/plants")
def list_plants(db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(select(OwnedPlant).where(OwnedPlant.user_id == claims.user_id, alive(OwnedPlant)).order_by(OwnedPlant.name)).all()
    return [_plant_json(r) for r in rows]


@router.post("/me/plants")
def create_plant(body: PlantIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = OwnedPlant(
        user_id=claims.user_id,
        name=body.name[:80],
        location=body.location,
        notes=body.notes[:1000],
        water_every_days=body.waterEveryDays,
        fertilize_every_days=body.fertilizeEveryDays,
        water_next_at=_next_at(body.waterEveryDays),
        fertilize_next_at=_next_at(body.fertilizeEveryDays),
        room=body.room,
        product_id=body.productId,
        product_slug=body.productSlug,
    )
    db.add(row)
    db.flush()
    return _plant_json(row)


def _own_plant(db, claims, plant_id: int) -> OwnedPlant:
    row = db.scalar(select(OwnedPlant).where(OwnedPlant.id == plant_id, OwnedPlant.user_id == claims.user_id, alive(OwnedPlant)))
    if row is None:
        raise APIError(404, "plant not found")
    return row


@router.get("/me/plants/calendar")
def plant_calendar(db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(select(OwnedPlant).where(OwnedPlant.user_id == claims.user_id, alive(OwnedPlant))).all()
    events = []
    for row in rows:
        if row.water_next_at:
            events.append({"plantId": row.id, "name": row.name, "kind": "water", "at": row.water_next_at.isoformat() + "Z"})
        if row.fertilize_next_at:
            events.append({"plantId": row.id, "name": row.name, "kind": "fertilize", "at": row.fertilize_next_at.isoformat() + "Z"})
    events.sort(key=lambda e: e["at"])
    return {"season": advice(), "events": events}


@router.post("/me/plants/import-orders")
def import_plants(db: Session = Depends(get_db), claims=Depends(require_user)):
    """Turn paid plant lines into owned plants, once per product."""
    orders = db.scalars(
        select(Order).where(Order.user_id == claims.user_id, Order.payment_status == "paid", alive(Order)).options(selectinload(Order.items))
    ).all()
    created = 0
    for order in orders:
        for item in order.items:
            exists = db.scalar(
                select(OwnedPlant.id).where(OwnedPlant.user_id == claims.user_id, OwnedPlant.product_id == item.product_id, alive(OwnedPlant))
            )
            if exists:
                continue
            db.add(
                OwnedPlant(
                    user_id=claims.user_id,
                    name=item.name[:80],
                    product_id=item.product_id,
                    water_every_days=7,
                    fertilize_every_days=30,
                    water_next_at=_next_at(7),
                    fertilize_next_at=_next_at(30),
                )
            )
            created += 1
    return {"imported": created}


@router.get("/me/plants/{plant_id}")
def get_plant(plant_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    return _plant_json(_own_plant(db, claims, plant_id))


@router.put("/me/plants/{plant_id}")
def update_plant(plant_id: int, body: PlantIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = _own_plant(db, claims, plant_id)
    row.name = body.name[:80]
    row.location = body.location
    row.notes = body.notes[:1000]
    row.water_every_days = body.waterEveryDays
    row.fertilize_every_days = body.fertilizeEveryDays
    row.room = body.room
    return _plant_json(row)


@router.delete("/me/plants/{plant_id}")
def delete_plant(plant_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = _own_plant(db, claims, plant_id)
    row.deleted_at = utcnow()
    return {"ok": True}


def _mark(db, claims, plant_id: int, every_attr: str, next_attr: str) -> dict:
    row = _own_plant(db, claims, plant_id)
    days = getattr(row, every_attr) or 7
    setattr(row, next_attr, _next_at(days))
    return _plant_json(row)


@router.post("/me/plants/{plant_id}/water")
def water(plant_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    return _mark(db, claims, plant_id, "water_every_days", "water_next_at")


@router.post("/me/plants/{plant_id}/fertilize")
def fertilize(plant_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    return _mark(db, claims, plant_id, "fertilize_every_days", "fertilize_next_at")


class TaskIn(BaseModel):
    task: str


@router.post("/me/plants/{plant_id}/care")
def mark_task(plant_id: int, body: TaskIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    mapping = {
        "water": ("water_every_days", "water_next_at"),
        "fertilize": ("fertilize_every_days", "fertilize_next_at"),
        "mist": ("mist_every_days", "mist_next_at"),
        "rotate": ("rotate_every_days", "rotate_next_at"),
        "repot": ("repot_every_days", "repot_next_at"),
        "prune": ("prune_every_days", "prune_next_at"),
    }
    pair = mapping.get(body.task)
    if not pair:
        raise APIError(400, "unknown care task")
    return _mark(db, claims, plant_id, pair[0], pair[1])


class HealthIn(BaseModel):
    status: str = "ok"
    notes: str = ""


@router.post("/me/plants/{plant_id}/health")
def add_health(plant_id: int, body: HealthIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = _own_plant(db, claims, plant_id)
    log = PlantHealthLog(owned_plant_id=row.id, user_id=claims.user_id, status=body.status[:32], notes=body.notes[:1000])
    db.add(log)
    db.flush()
    return {"id": log.id, "status": log.status}


class SnoozeIn(BaseModel):
    days: int = 2


@router.post("/me/plants/{plant_id}/snooze")
def snooze(plant_id: int, body: SnoozeIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = _own_plant(db, claims, plant_id)
    row.snoozed_until = utcnow() + timedelta(days=max(min(body.days, 30), 1))
    return _plant_json(row)


@router.post("/me/plants/{plant_id}/diagnosis")
def diagnose(plant_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = _own_plant(db, claims, plant_id)
    return {
        "plant": row.name,
        "advice": "Check the top of the soil before watering. Yellow leaves usually mean the pot stayed wet. Move it to brighter indirect light if the stems look stretched.",
    }


@router.post("/me/plants/{plant_id}/care-plan")
def care_plan(plant_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = _own_plant(db, claims, plant_id)
    row.water_next_at = row.water_next_at or _next_at(row.water_every_days)
    row.fertilize_next_at = row.fertilize_next_at or _next_at(row.fertilize_every_days)
    return _plant_json(row)


@router.get("/me/plants/{plant_id}/card")
def care_card(plant_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = _own_plant(db, claims, plant_id)
    season = advice()
    return {"plant": _plant_json(row), "season": season}


@router.get("/notification-preferences")
def get_prefs(db: Session = Depends(get_db), claims=Depends(require_user)):
    row = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == claims.user_id))
    if row is None:
        row = NotificationPreference(user_id=claims.user_id)
        db.add(row)
        db.flush()
    return {
        "orderUpdates": row.order_updates,
        "promotions": row.promotions,
        "careReminders": row.care_reminders,
        "weatherAlerts": row.weather_alerts,
        "doothaAlerts": row.dootha_alerts,
        "reminderHour": row.reminder_hour,
        "quietStartHour": row.quiet_start_hour,
        "quietEndHour": row.quiet_end_hour,
    }


class PrefsIn(BaseModel):
    orderUpdates: bool = True
    promotions: bool = False
    careReminders: bool = True
    weatherAlerts: bool = True
    doothaAlerts: bool = True
    reminderHour: int = 8
    quietStartHour: int = 22
    quietEndHour: int = 7


@router.put("/notification-preferences")
def update_prefs(body: PrefsIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == claims.user_id))
    if row is None:
        row = NotificationPreference(user_id=claims.user_id)
        db.add(row)
    row.order_updates = body.orderUpdates
    row.promotions = body.promotions
    row.care_reminders = body.careReminders
    row.weather_alerts = body.weatherAlerts
    row.dootha_alerts = body.doothaAlerts
    row.reminder_hour = body.reminderHour
    row.quiet_start_hour = body.quietStartHour
    row.quiet_end_hour = body.quietEndHour
    return {"ok": True}


@router.get("/notifications")
def list_notes(db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(
        select(AppNotification).where(AppNotification.user_id == claims.user_id).order_by(AppNotification.created_at.desc()).limit(50)
    ).all()
    return [
        {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "href": n.href, "readAt": n.read_at.isoformat() + "Z" if n.read_at else None}
        for n in rows
    ]


@router.post("/notifications/read-all")
def read_all(db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(select(AppNotification).where(AppNotification.user_id == claims.user_id, AppNotification.read_at.is_(None))).all()
    now = utcnow()
    for row in rows:
        row.read_at = now
    return {"ok": True}


@router.patch("/notifications/{note_id}/read")
def read_one(note_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = db.scalar(select(AppNotification).where(AppNotification.id == note_id, AppNotification.user_id == claims.user_id))
    if row is None:
        raise APIError(404, "notification not found")
    row.read_at = utcnow()
    return {"ok": True}


@router.get("/me/saved")
def list_saved(request: Request, db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(select(SavedItem).where(SavedItem.user_id == claims.user_id).options(selectinload(SavedItem.product))).all()
    base = request.app.state.settings.image_base_url
    return [{"id": r.id, "quantity": r.quantity, "pot": r.pot, "product": product_card(r.product, base)} for r in rows if r.product]


class SavedIn(BaseModel):
    productId: int
    quantity: int = 1
    pot: str = ""
    productSizeId: int | None = None


@router.post("/me/saved")
def save_item(body: SavedIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = db.scalar(select(SavedItem).where(SavedItem.user_id == claims.user_id, SavedItem.product_id == body.productId))
    if row is None:
        row = SavedItem(user_id=claims.user_id, product_id=body.productId)
        db.add(row)
    row.quantity = body.quantity
    row.pot = body.pot[:80]
    row.product_size_id = body.productSizeId
    db.flush()
    return {"id": row.id}


@router.delete("/me/saved/{item_id}")
def remove_saved(item_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    db.execute(delete(SavedItem).where(SavedItem.id == item_id, SavedItem.user_id == claims.user_id))
    return {"ok": True}


@router.get("/me/payment-methods")
def list_methods(db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(select(SavedPaymentMethod).where(SavedPaymentMethod.user_id == claims.user_id)).all()
    return [{"id": r.id, "kind": r.kind, "label": r.label, "detail": r.detail, "isDefault": r.is_default} for r in rows]


class MethodIn(BaseModel):
    kind: str = "upi"
    label: str
    detail: str
    isDefault: bool = False


@router.post("/me/payment-methods")
def save_method(body: MethodIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    # Last four or a UPI id only. A full card number does not belong here.
    if body.kind == "card" and any(ch.isdigit() for ch in body.detail) and sum(ch.isdigit() for ch in body.detail) > 4:
        raise APIError(400, "store the last four digits, not the full card number")
    row = SavedPaymentMethod(user_id=claims.user_id, kind=body.kind[:16], label=body.label[:40], detail=body.detail[:80], is_default=body.isDefault)
    db.add(row)
    db.flush()
    return {"id": row.id}


@router.delete("/me/payment-methods/{method_id}")
def delete_method(method_id: int, db: Session = Depends(get_db), claims=Depends(require_user)):
    db.execute(delete(SavedPaymentMethod).where(SavedPaymentMethod.id == method_id, SavedPaymentMethod.user_id == claims.user_id))
    return {"ok": True}


@router.get("/me/referral")
def get_referral(db: Session = Depends(get_db), claims=Depends(require_user)):
    user = _me(db, claims.user_id)
    code = ensure_referral_code(db, user)
    return {"code": code, "balance": credit_balance(db, user.id)}


class ReferralIn(BaseModel):
    code: str


@router.post("/me/referral")
def claim_referral(body: ReferralIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    user = _me(db, claims.user_id)
    if user.referred_by:
        raise APIError(409, "a referral was already applied")
    code = body.code.strip().upper()
    inviter = db.scalar(select(User).where(User.referral_code == code, alive(User)))
    if inviter is None or inviter.id == user.id:
        raise APIError(404, "referral code not found")
    user.referred_by = inviter.id
    # Both sides get a small credit. The inviter's reward for a first paid
    # order is granted in mark-paid's caller when you extend it; this grant
    # is the immediate welcome credit.
    add_credit(db, user.id, 50, "referral_welcome")
    add_credit(db, inviter.id, 50, "referral_invite")
    return {"ok": True, "balance": credit_balance(db, user.id)}


class ViewIn(BaseModel):
    productId: int


@router.post("/me/recently-viewed")
def record_view(body: ViewIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = db.scalar(select(RecentView).where(RecentView.user_id == claims.user_id, RecentView.product_id == body.productId))
    if row is None:
        row = RecentView(user_id=claims.user_id, product_id=body.productId)
        db.add(row)
    row.viewed_at = utcnow()
    return {"ok": True}


@router.get("/me/recently-viewed")
def list_views(request: Request, db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(
        select(RecentView)
        .where(RecentView.user_id == claims.user_id)
        .options(selectinload(RecentView.product))
        .order_by(RecentView.viewed_at.desc())
        .limit(20)
    ).all()
    base = request.app.state.settings.image_base_url
    return [product_card(r.product, base) for r in rows if r.product and r.product.deleted_at is None]


class CartIn(BaseModel):
    items: list[dict] = []


@router.post("/me/cart-signals")
def sync_cart(body: CartIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    row = db.scalar(select(CartSnapshot).where(CartSnapshot.user_id == claims.user_id))
    if row is None:
        row = CartSnapshot(user_id=claims.user_id)
        db.add(row)
    row.items_json = json.dumps(body.items)[:8000]
    row.item_count = len(body.items)
    return {"ok": True}


@router.get("/me/offers")
def offers(db: Session = Depends(get_db), _claims=Depends(require_user)):
    from app.models import Coupon

    rows = db.scalars(select(Coupon).where(Coupon.active.is_(True), alive(Coupon)).limit(20)).all()
    return [{"code": c.code, "description": c.description, "type": c.type, "value": c.value, "minSubtotal": c.min_subtotal} for c in rows]


@router.get("/me/quotes")
def my_quotes(db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(select(QuoteRequest).where(QuoteRequest.user_id == claims.user_id).order_by(QuoteRequest.created_at.desc())).all()
    return [{"id": r.id, "estimateNo": r.estimate_no, "summary": r.summary, "amount": r.amount, "status": r.status} for r in rows]


@router.get("/me/orders/active")
def active_order(request: Request, db: Session = Depends(get_db), claims=Depends(require_user)):
    order = db.scalar(
        select(Order)
        .where(
            Order.user_id == claims.user_id,
            Order.payment_status == "paid",
            Order.delivered_at.is_(None),
            Order.cancelled_at.is_(None),
            alive(Order),
        )
        .options(selectinload(Order.items))
        .order_by(Order.created_at.desc())
    )
    if order is None:
        return {"order": None}
    return {"order": order_json(order, request.app.state.settings.image_base_url)}


@router.post("/me/images")
async def upload_my_image(request: Request, claims=Depends(require_user)):
    form = await request.form()
    upload = form.get("image") or form.get("file") or form.get("photo")
    if upload is None or not hasattr(upload, "read"):
        raise APIError(400, "image file is required")
    data = await upload.read()
    if not data:
        raise APIError(400, "image file is required")
    try:
        key, url = store_image(
            request.app.state.settings,
            data,
            getattr(upload, "filename", "photo.jpg"),
            getattr(upload, "content_type", "") or "",
            f"users-{claims.user_id}",
        )
    except ValueError as exc:
        raise APIError(400, "unsupported image type") from exc
    return {"imageKey": key, "imageUrl": url}


class ScanAlertIn(BaseModel):
    message: str = ""


@router.post("/me/scan-alert")
def scan_alert(body: ScanAlertIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    db.add(
        AppNotification(
            user_id=claims.user_id,
            kind="scan",
            title="Plant scan",
            body=(body.message or "A scan needs a look")[:500],
            dedupe_key=f"scan:{claims.user_id}:{utcnow().timestamp()}",
        )
    )
    return {"ok": True}


@router.post("/me/care-followup")
def care_followup(db: Session = Depends(get_db), claims=Depends(require_user)):
    return {"season": advice(), "userId": claims.user_id}


@router.get("/me/chat")
def chat_history(db: Session = Depends(get_db), claims=Depends(require_user)):
    rows = db.scalars(select(ChatTurn).where(ChatTurn.user_id == claims.user_id).order_by(ChatTurn.created_at.desc()).limit(40)).all()
    rows = list(reversed(rows))
    return [{"role": r.role, "content": r.content, "createdAt": r.created_at.isoformat() + "Z"} for r in rows]


@router.post("/orders/{order_id}/reorder")
def reorder(order_id: int, request: Request, db: Session = Depends(get_db), claims=Depends(require_user)):
    order = db.scalar(select(Order).where(Order.id == order_id, Order.user_id == claims.user_id).options(selectinload(Order.items)))
    if order is None:
        raise APIError(404, "order not found")
    base = request.app.state.settings.image_base_url
    from app.present import order_item_json

    return {"items": [order_item_json(i, base) for i in order.items]}


class RatingIn(BaseModel):
    rating: int
    feedback: str = ""


@router.post("/orders/{order_id}/rating")
def rate_delivery(order_id: int, body: RatingIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    if not 1 <= body.rating <= 5:
        raise APIError(400, "rating must be 1 to 5")
    order = db.scalar(select(Order).where(Order.id == order_id, Order.user_id == claims.user_id))
    if order is None:
        raise APIError(404, "order not found")
    order.delivery_rating = body.rating
    order.delivery_feedback = body.feedback[:500]
    return {"ok": True}


@router.post("/orders/{order_id}/retry-payment")
def retry_payment(order_id: int, request: Request, db: Session = Depends(get_db), claims=Depends(require_user)):
    order = db.scalar(select(Order).where(Order.id == order_id, Order.user_id == claims.user_id))
    if order is None:
        raise APIError(404, "order not found")
    if order.payment_status != "created":
        raise APIError(409, "this order is not awaiting payment")
    created = create_razorpay_order(request.app.state.settings, order.amount, order.currency or "INR")
    order.razorpay_order_id = created["id"]
    return {"id": created["id"], "amount": created.get("amount"), "currency": created.get("currency"), "orderId": order.id}
