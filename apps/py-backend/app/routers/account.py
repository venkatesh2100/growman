"""The signed-in customer: addresses, plants, privacy, and the little lists around them."""

import json
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.http import APIError
from app.models import (
    Address,
    AppNotification,
    CartSnapshot,
    ChatTurn,
    CreditEntry,
    NotificationPreference,
    Order,
    OwnedPlant,
    PlantHealthLog,
    Product,
    QuoteRequest,
    RecentView,
    SavedItem,
    SavedPaymentMethod,
    StoreCredit,
    User,
    Wishlist,
    alive,
    utcnow,
)
from app.security import member
from app.serialize import image_url

router = APIRouter(tags=["account"])


def _mine(db: Session, model, user: User, row_id: int):
    row = db.get(model, row_id)
    if row is None or row.deleted_at is not None or getattr(row, "user_id", None) != user.id:
        raise APIError(404, "not_found")
    return row


@router.get("/wishlist")
def list_wishlist(request: Request, db: Session = Depends(get_db), user: User = Depends(member)):
    rows = db.scalars(select(Wishlist).where(alive(Wishlist), Wishlist.user_id == user.id)).all()
    return [{"id": row.id, "productId": row.product_id, "priceAtAdd": row.price_at_add} for row in rows]


@router.post("/wishlist")
def add_wishlist(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    product = db.get(Product, int(body.get("productId") or 0))
    if product is None or product.deleted_at:
        raise APIError(404, "not_found")
    existing = db.scalar(select(Wishlist).where(Wishlist.user_id == user.id, Wishlist.product_id == product.id, alive(Wishlist)))
    if existing:
        return {"id": existing.id}
    row = Wishlist(user_id=user.id, product_id=product.id, price_at_add=product.price)
    db.add(row)
    db.flush()
    return {"id": row.id}


@router.delete("/wishlist/{product_id}")
def remove_wishlist(product_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    row = db.scalar(select(Wishlist).where(Wishlist.user_id == user.id, Wishlist.product_id == product_id, alive(Wishlist)))
    if row:
        row.deleted_at = utcnow()
    return {"ok": True}


def _address(row: Address) -> dict:
    return {
        "id": row.id, "label": row.label, "name": row.name, "phone": row.phone,
        "addressLine": row.address_line, "city": row.city, "state": row.state, "pincode": row.pincode,
        "latitude": row.latitude, "longitude": row.longitude, "isDefault": row.is_default,
    }


@router.get("/addresses")
def list_addresses(db: Session = Depends(get_db), user: User = Depends(member)):
    rows = db.scalars(select(Address).where(alive(Address), Address.user_id == user.id).order_by(Address.id.desc())).all()
    return [_address(row) for row in rows]


@router.post("/addresses")
def create_address(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    if body.get("isDefault"):
        for row in db.scalars(select(Address).where(Address.user_id == user.id, alive(Address))):
            row.is_default = False
    row = Address(user_id=user.id, label=str(body.get("label") or ""), name=str(body.get("name") or user.name),
                  phone=str(body.get("phone") or ""), address_line=str(body.get("addressLine") or ""),
                  city=str(body.get("city") or ""), state=str(body.get("state") or ""), pincode=str(body.get("pincode") or ""),
                  latitude=body.get("latitude"), longitude=body.get("longitude"), is_default=bool(body.get("isDefault")))
    db.add(row)
    db.flush()
    return _address(row)


@router.put("/addresses/{row_id}")
def update_address(row_id: int, body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    row = _mine(db, Address, user, row_id)
    for src, dest in (("label", "label"), ("name", "name"), ("phone", "phone"), ("addressLine", "address_line"),
                      ("city", "city"), ("state", "state"), ("pincode", "pincode")):
        if src in body:
            setattr(row, dest, str(body[src]))
    if "isDefault" in body:
        row.is_default = bool(body["isDefault"])
    return _address(row)


@router.delete("/addresses/{row_id}")
def delete_address(row_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    _mine(db, Address, user, row_id).deleted_at = utcnow()
    return {"ok": True}


@router.get("/privacy/export")
def export_data(db: Session = Depends(get_db), user: User = Depends(member)):
    return {
        "user": {"id": user.id, "name": user.name, "email": user.email, "phone": user.phone},
        "addresses": list_addresses(db, user),
        "orders": [row.id for row in db.scalars(select(Order).where(Order.user_id == user.id))],
    }


@router.post("/privacy/erase")
def erase(db: Session = Depends(get_db), user: User = Depends(member)):
    """The account goes. Invoices stay, with the name removed, because tax law keeps them."""
    user.deleted_at = utcnow()
    user.name = "Erased"
    user.email = None
    user.phone = None
    user.password_hash = None
    for order in db.scalars(select(Order).where(Order.user_id == user.id)):
        order.customer_name = "Erased"
        order.customer_email = ""
        order.customer_phone = ""
        order.address_line = ""
    return {"ok": True}


def _plant(row: OwnedPlant) -> dict:
    return {
        "id": row.id, "name": row.name, "location": row.location, "notes": row.notes, "room": row.room,
        "photoUrl": row.photo_url, "productId": row.product_id, "productSlug": row.product_slug,
        "waterEveryDays": row.water_every_days, "fertilizeEveryDays": row.fertilize_every_days,
        "waterNextAt": row.water_next_at.isoformat() if row.water_next_at else None,
        "fertilizeNextAt": row.fertilize_next_at.isoformat() if row.fertilize_next_at else None,
        "snoozedUntil": row.snoozed_until.isoformat() if row.snoozed_until else None,
    }


def _schedule(row: OwnedPlant, field: str, days: int) -> None:
    setattr(row, field, utcnow() + timedelta(days=max(days, 1)))


@router.get("/me/plants")
def list_plants(db: Session = Depends(get_db), user: User = Depends(member)):
    rows = db.scalars(select(OwnedPlant).where(alive(OwnedPlant), OwnedPlant.user_id == user.id).order_by(OwnedPlant.id.desc())).all()
    return [_plant(row) for row in rows]


@router.post("/me/plants")
def create_plant(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    name = str(body.get("name") or "").strip()
    if not name:
        raise APIError(400, "name_required")
    row = OwnedPlant(user_id=user.id, name=name[:80], location=str(body.get("location") or "")[:80],
                     notes=str(body.get("notes") or "")[:1000], room=str(body.get("room") or "")[:40],
                     water_every_days=int(body.get("waterEveryDays") or 7),
                     fertilize_every_days=int(body.get("fertilizeEveryDays") or 30),
                     photo_url=str(body.get("photoUrl") or ""), product_id=body.get("productId"),
                     product_slug=str(body.get("productSlug") or ""))
    _schedule(row, "water_next_at", row.water_every_days)
    _schedule(row, "fertilize_next_at", row.fertilize_every_days)
    db.add(row)
    db.flush()
    return _plant(row)


@router.get("/me/plants/calendar")
def plant_calendar(db: Session = Depends(get_db), user: User = Depends(member)):
    soon = utcnow() + timedelta(days=14)
    rows = db.scalars(select(OwnedPlant).where(alive(OwnedPlant), OwnedPlant.user_id == user.id)).all()
    due = []
    for row in rows:
        if row.snoozed_until and row.snoozed_until > utcnow():
            continue
        for kind, when in (("water", row.water_next_at), ("fertilize", row.fertilize_next_at)):
            if when and when <= soon:
                due.append({"plantId": row.id, "name": row.name, "task": kind, "at": when.isoformat()})
    return due


@router.get("/me/plants/{row_id}")
def get_plant(row_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    return _plant(_mine(db, OwnedPlant, user, row_id))


@router.put("/me/plants/{row_id}")
def update_plant(row_id: int, body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    row = _mine(db, OwnedPlant, user, row_id)
    for src, dest in (("name", "name"), ("location", "location"), ("notes", "notes"), ("room", "room"), ("photoUrl", "photo_url")):
        if src in body:
            setattr(row, dest, str(body[src]))
    return _plant(row)


@router.delete("/me/plants/{row_id}")
def delete_plant(row_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    _mine(db, OwnedPlant, user, row_id).deleted_at = utcnow()
    return {"ok": True}


@router.post("/me/plants/{row_id}/water")
def water(row_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    row = _mine(db, OwnedPlant, user, row_id)
    _schedule(row, "water_next_at", row.water_every_days)
    return _plant(row)


@router.post("/me/plants/{row_id}/fertilize")
def fertilize(row_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    row = _mine(db, OwnedPlant, user, row_id)
    _schedule(row, "fertilize_next_at", row.fertilize_every_days)
    return _plant(row)


@router.post("/me/plants/{row_id}/health")
def health(row_id: int, body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    row = _mine(db, OwnedPlant, user, row_id)
    log = PlantHealthLog(owned_plant_id=row.id, user_id=user.id, status=str(body.get("status") or "ok"),
                         notes=str(body.get("notes") or "")[:1000], photo_url=str(body.get("photoUrl") or ""))
    db.add(log)
    db.flush()
    return {"id": log.id}


@router.post("/me/plants/{row_id}/care")
def care_task(row_id: int, body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    row = _mine(db, OwnedPlant, user, row_id)
    task = str(body.get("task") or "")
    days = getattr(row, f"{task}_every_days", 0)
    if task not in {"mist", "rotate", "repot", "prune"} or not days:
        raise APIError(400, "unknown_task")
    _schedule(row, f"{task}_next_at", days)
    return _plant(row)


@router.post("/me/plants/{row_id}/snooze")
def snooze(row_id: int, body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    row = _mine(db, OwnedPlant, user, row_id)
    row.snoozed_until = utcnow() + timedelta(days=int(body.get("days") or 1))
    return _plant(row)


@router.post("/me/plants/{row_id}/diagnosis")
@router.post("/me/plants/{row_id}/care-plan")
def care_note(row_id: int, body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    row = _mine(db, OwnedPlant, user, row_id)
    row.notes = (row.notes + "\n" + str(body.get("note") or body.get("message") or "")).strip()[:1000]
    return _plant(row)


@router.get("/me/plants/{row_id}/card")
def care_card(row_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    row = _mine(db, OwnedPlant, user, row_id)
    return {**_plant(row), "advice": f"Water {row.name} every {row.water_every_days} days. Fertilize every {row.fertilize_every_days} days."}


@router.post("/me/plants/import-orders")
def import_orders(db: Session = Depends(get_db), user: User = Depends(member)):
    from app.models import OrderItem
    items = db.scalars(
        select(OrderItem).join(Order, OrderItem.order_id == Order.id).where(Order.user_id == user.id, Order.payment_status == "paid")
    ).all()
    added = 0
    for item in items:
        if db.scalar(select(OwnedPlant.id).where(OwnedPlant.user_id == user.id, OwnedPlant.product_id == item.product_id, alive(OwnedPlant))):
            continue
        db.add(OwnedPlant(user_id=user.id, name=item.name[:80], product_id=item.product_id, water_every_days=7, fertilize_every_days=30))
        added += 1
    return {"added": added}


def _prefs(row: NotificationPreference) -> dict:
    return {
        "orderUpdates": row.order_updates, "promotions": row.promotions, "careReminders": row.care_reminders,
        "weatherAlerts": row.weather_alerts, "doothaAlerts": row.dootha_alerts, "reminderHour": row.reminder_hour,
        "quietStartHour": row.quiet_start_hour, "quietEndHour": row.quiet_end_hour,
    }


@router.get("/notification-preferences")
def get_prefs(db: Session = Depends(get_db), user: User = Depends(member)):
    row = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user.id))
    if row is None:
        row = NotificationPreference(user_id=user.id)
        db.add(row)
        db.flush()
    return _prefs(row)


@router.put("/notification-preferences")
def put_prefs(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    row = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user.id)) or NotificationPreference(user_id=user.id)
    db.add(row)
    mapping = {"orderUpdates": "order_updates", "promotions": "promotions", "careReminders": "care_reminders",
               "weatherAlerts": "weather_alerts", "doothaAlerts": "dootha_alerts", "reminderHour": "reminder_hour"}
    for src, dest in mapping.items():
        if src in body:
            setattr(row, dest, body[src])
    return _prefs(row)


@router.get("/notifications")
def list_notes(db: Session = Depends(get_db), user: User = Depends(member)):
    rows = db.scalars(select(AppNotification).where(alive(AppNotification), AppNotification.user_id == user.id).order_by(AppNotification.id.desc()).limit(50)).all()
    return [{"id": row.id, "kind": row.kind, "title": row.title, "body": row.body, "href": row.href,
             "readAt": row.read_at.isoformat() if row.read_at else None} for row in rows]


@router.post("/notifications/read-all")
def read_all(db: Session = Depends(get_db), user: User = Depends(member)):
    for row in db.scalars(select(AppNotification).where(AppNotification.user_id == user.id, AppNotification.read_at.is_(None))):
        row.read_at = utcnow()
    return {"ok": True}


@router.patch("/notifications/{row_id}/read")
def read_one(row_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    _mine(db, AppNotification, user, row_id).read_at = utcnow()
    return {"ok": True}


@router.get("/me/saved")
def saved(request: Request, db: Session = Depends(get_db), user: User = Depends(member)):
    rows = db.scalars(select(SavedItem).where(alive(SavedItem), SavedItem.user_id == user.id)).all()
    return [{"id": row.id, "productId": row.product_id, "quantity": row.quantity, "pot": row.pot} for row in rows]


@router.post("/me/saved")
def save_item(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    row = SavedItem(user_id=user.id, product_id=int(body["productId"]), product_size_id=body.get("productSizeId"),
                    quantity=int(body.get("quantity") or 1), pot=str(body.get("pot") or ""))
    db.add(row)
    db.flush()
    return {"id": row.id}


@router.delete("/me/saved/{row_id}")
def unsave(row_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    _mine(db, SavedItem, user, row_id).deleted_at = utcnow()
    return {"ok": True}


@router.get("/me/payment-methods")
def payment_methods(db: Session = Depends(get_db), user: User = Depends(member)):
    rows = db.scalars(select(SavedPaymentMethod).where(alive(SavedPaymentMethod), SavedPaymentMethod.user_id == user.id)).all()
    return [{"id": row.id, "kind": row.kind, "label": row.label, "detail": row.detail, "isDefault": row.is_default} for row in rows]


@router.post("/me/payment-methods")
def save_method(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    detail = str(body.get("detail") or "")
    if len(detail) > 4 and detail.replace(" ", "").isdigit():
        detail = "•••• " + detail[-4:]
    row = SavedPaymentMethod(user_id=user.id, kind=str(body.get("kind") or "upi"), label=str(body.get("label") or "")[:40], detail=detail[:80])
    db.add(row)
    db.flush()
    return {"id": row.id}


@router.delete("/me/payment-methods/{row_id}")
def delete_method(row_id: int, db: Session = Depends(get_db), user: User = Depends(member)):
    _mine(db, SavedPaymentMethod, user, row_id).deleted_at = utcnow()
    return {"ok": True}


@router.get("/me/referral")
def referral(db: Session = Depends(get_db), user: User = Depends(member)):
    if not user.referral_code:
        user.referral_code = secrets.token_hex(4)
    balance = db.scalar(select(StoreCredit.balance).where(StoreCredit.user_id == user.id)) or 0
    return {"code": user.referral_code, "balance": balance}


@router.post("/me/referral")
def claim_referral(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    """₹50 for the referrer and ₹50 for the new customer, once."""
    if user.referred_by:
        raise APIError(409, "already_claimed")
    code = str(body.get("code") or "").strip().lower()
    owner = db.scalar(select(User).where(User.referral_code == code, alive(User)))
    if owner is None or owner.id == user.id:
        raise APIError(404, "invalid_code")
    user.referred_by = owner.id
    for person in (owner, user):
        credit = db.scalar(select(StoreCredit).where(StoreCredit.user_id == person.id))
        if credit is None:
            credit = StoreCredit(user_id=person.id, balance=0)
            db.add(credit)
            db.flush()
        credit.balance = round(credit.balance + 50, 2)
        db.add(CreditEntry(user_id=person.id, amount=50, reason="referral"))
    return {"ok": True, "amount": 50}


@router.post("/me/recently-viewed")
def add_recent(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    product_id = int(body.get("productId") or 0)
    row = db.scalar(select(RecentView).where(RecentView.user_id == user.id, RecentView.product_id == product_id))
    if row is None:
        db.add(RecentView(user_id=user.id, product_id=product_id))
    else:
        row.viewed_at = utcnow()
    return {"ok": True}


@router.get("/me/recently-viewed")
def recent(request: Request, db: Session = Depends(get_db), user: User = Depends(member)):
    rows = db.scalars(select(RecentView).where(alive(RecentView), RecentView.user_id == user.id).order_by(RecentView.viewed_at.desc()).limit(12)).all()
    base = request.app.state.settings.image_base_url
    out = []
    for row in rows:
        product = db.get(Product, row.product_id)
        if product and product.deleted_at is None:
            out.append({"productId": product.id, "name": product.name, "slug": product.slug, "imageUrl": image_url(base, product.image_key), "viewedAt": row.viewed_at.isoformat()})
    return out


@router.post("/me/cart-signals")
def cart_signals(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    items = body.get("items") or []
    row = db.scalar(select(CartSnapshot).where(CartSnapshot.user_id == user.id))
    if row is None:
        row = CartSnapshot(user_id=user.id)
        db.add(row)
    row.items_json = json.dumps(items)[:20000]
    row.item_count = len(items)
    return {"ok": True}


@router.get("/me/offers")
def offers(db: Session = Depends(get_db), user: User = Depends(member)):
    from app.models import Coupon
    rows = db.scalars(select(Coupon).where(alive(Coupon), Coupon.active.is_(True)).limit(20)).all()
    return [{"code": row.code, "description": row.description, "type": row.type, "value": row.value} for row in rows]


@router.get("/me/quotes")
def my_quotes(db: Session = Depends(get_db), user: User = Depends(member)):
    rows = db.scalars(select(QuoteRequest).where(QuoteRequest.user_id == user.id).order_by(QuoteRequest.id.desc())).all()
    return [{"id": row.id, "estimateNo": row.estimate_no, "summary": row.summary, "amount": row.amount, "status": row.status} for row in rows]


@router.get("/me/chat")
def chat_history(db: Session = Depends(get_db), user: User = Depends(member)):
    rows = db.scalars(select(ChatTurn).where(ChatTurn.user_id == user.id).order_by(ChatTurn.id.desc()).limit(40)).all()
    return [{"role": row.role, "content": row.content, "at": row.created_at.isoformat()} for row in reversed(rows)]


@router.post("/me/images")
async def my_image(request: Request, user: User = Depends(member)):
    from app.routers.admin import store_upload
    form = await request.form()
    upload = form.get("image")
    if upload is None:
        raise APIError(400, "image_required")
    return store_upload(upload, "customers", request.app.state.settings.image_base_url)


@router.post("/me/scan-alert")
@router.post("/me/care-followup")
def followup(body: dict, db: Session = Depends(get_db), user: User = Depends(member)):
    db.add(AppNotification(user_id=user.id, kind="care", title="Plant check", body=str(body.get("message") or "We saved your note.")[:500], dedupe_key=secrets.token_hex(8)))
    return {"ok": True}
