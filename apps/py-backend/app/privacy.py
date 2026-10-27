"""DPDP Act: scrub now, keep the minimised transaction, delete it after a year.

Two rules pull in opposite directions. Rule 8(3) says transactional data
is kept for at least a year even after the account is deleted. Section
8(7) says data is erased once its purpose is served. Doing only one of
those is non-compliant.

Erasure therefore changes *what* is held. Name, email, and phone are
overwritten immediately. The user row stays as a tombstone so order
foreign keys still point at something. Addresses, wishlist, and
back-in-stock rows are deleted because they have no retained purpose.
Reviews are anonymised, not deleted: the text helps other shoppers and
is no longer personal once the identity is gone. Orders drop contact
details and keep the money record.

A daily sweep then deletes those minimised rows after 365 days.
Erasure is refused while a parcel is still in transit: the address is
the only thing that can deliver it, so the purpose is not served yet.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.errors import APIError
from app.models import (
    Address,
    BackInStockRequest,
    Order,
    Review,
    SavedItem,
    User,
    WebhookEvent,
    Wishlist,
    alive,
    utcnow,
)

log = logging.getLogger("growman.privacy")

NOTICE_VERSION = "2025-01"
ERASED_NAME = "Deleted user"
RETENTION = timedelta(days=365)
IN_TRANSIT = {"shipped", "in_transit", "out_for_delivery"}


def erase_account(db: Session, user: User) -> None:
    open_order = db.scalar(
        select(Order.id).where(
            Order.user_id == user.id,
            alive(Order),
            Order.payment_status == "paid",
            Order.delivered_at.is_(None),
            Order.cancelled_at.is_(None),
            Order.awb_number != "",
        )
    )
    if open_order:
        raise APIError(
            409,
            "erasure_blocked",
            reason="An order is still on its way. Erasure can run once it is delivered or cancelled.",
        )

    user.name = ERASED_NAME
    user.email = None
    user.phone = None
    user.password_hash = None
    user.address_line = ""
    user.city = ""
    user.state = ""
    user.pincode = ""
    user.latitude = None
    user.longitude = None
    user.referral_code = ""

    db.execute(delete(Address).where(Address.user_id == user.id))
    db.execute(delete(Wishlist).where(Wishlist.user_id == user.id))
    db.execute(delete(SavedItem).where(SavedItem.user_id == user.id))
    db.execute(delete(BackInStockRequest).where(BackInStockRequest.user_id == user.id))
    db.execute(
        update(Review)
        .where(Review.user_id == user.id)
        .values(title="", comment="[removed]", image_keys=[])
    )
    db.execute(
        update(Order)
        .where(Order.user_id == user.id)
        .values(
            customer_name=ERASED_NAME,
            customer_email="",
            customer_phone="",
            address_line="",
            client_ip="",
            user_agent="",
            gift_note="",
        )
    )


def sweep_expired(db: Session) -> int:
    """Drop minimised rows and webhook logs once the one-year floor has passed."""
    cutoff = utcnow() - RETENTION
    orders = db.execute(
        delete(Order).where(
            Order.customer_name == ERASED_NAME,
            Order.created_at < cutoff,
        )
    )
    hooks = db.execute(delete(WebhookEvent).where(WebhookEvent.created_at < cutoff))
    removed = (orders.rowcount or 0) + (hooks.rowcount or 0)
    if removed:
        log.info("retention sweep removed %s rows", removed)
    return removed


def export_account(db: Session, user: User) -> dict:
    orders = db.scalars(select(Order).where(Order.user_id == user.id, alive(Order))).all()
    return {
        "notice": (
            "Order records are kept for one year after processing, including "
            "after account erasure, as required by the DPDP Rules."
        ),
        "noticeVersion": NOTICE_VERSION,
        "profile": {
            "id": user.id,
            "name": user.name,
            "email": user.email or "",
            "phone": user.phone or "",
        },
        "orders": [
            {
                "id": o.id,
                "amount": o.amount,
                "paymentStatus": o.payment_status,
                "createdAt": o.created_at.isoformat() + "Z",
            }
            for o in orders
        ],
    }
