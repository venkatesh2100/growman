"""Shared account lookups. Not a service layer — just the queries several
handlers need, the same way the Go code keeps them in ``auth.go``.
"""

from __future__ import annotations

import secrets

import bcrypt
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.auth import SCOPE_FULL, SCOPE_ONBOARDING
from app.errors import APIError
from app.models import CreditEntry, StoreCredit, User, alive, utcnow
from app.phone import lookup_variants, ten_digit


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, hashed: str | None) -> bool:
    if not hashed or not password:
        return False
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def scope_for(user: User) -> str:
    # A phone signup with no name yet can only finish the profile.
    return SCOPE_FULL if (user.name or "").strip() else SCOPE_ONBOARDING


def authenticate(db: Session, identifier: str, password: str) -> User:
    if not password:
        raise APIError(401, "password required")
    ident = (identifier or "").strip()
    if "@" in ident:
        user = db.scalar(select(User).where(User.email == ident.lower(), alive(User)))
    else:
        variants = lookup_variants(ident)
        user = db.scalar(select(User).where(User.phone.in_(variants), alive(User))) if variants else None
    if user is None or not check_password(password, user.password_hash):
        # Same message for unknown user and bad password, so the endpoint
        # cannot be used to discover which emails have accounts.
        raise APIError(401, "invalid credentials")
    return user


def find_or_create_by_phone(db: Session, phone: str, name: str = "", provider: str = "phone") -> User:
    ten = ten_digit(phone)
    if not ten:
        raise APIError(400, "invalid phone number format")
    user = db.scalar(select(User).where(User.phone.in_(lookup_variants(ten)), alive(User)))
    if user:
        if name and not user.name:
            user.name = name
        return user
    user = User(
        name=name.strip(),
        phone=ten,
        provider=provider,
        role="user",
        phone_verified_at=utcnow(),
    )
    db.add(user)
    db.flush()
    return user


def ensure_referral_code(db: Session, user: User) -> str:
    if user.referral_code:
        return user.referral_code
    for _ in range(5):
        code = secrets.token_hex(4).upper()
        taken = db.scalar(select(User.id).where(User.referral_code == code))
        if taken is None:
            user.referral_code = code
            return code
    raise APIError(500, "could not allocate a referral code")


def credit_balance(db: Session, user_id: int) -> float:
    row = db.scalar(select(StoreCredit).where(StoreCredit.user_id == user_id))
    return row.balance if row else 0.0


def add_credit(db: Session, user_id: int, amount: float, reason: str, order_id: int | None = None) -> None:
    if amount == 0:
        return
    row = db.scalar(select(StoreCredit).where(StoreCredit.user_id == user_id))
    if row is None:
        row = StoreCredit(user_id=user_id, balance=0)
        db.add(row)
        db.flush()
    row.balance = round(row.balance + amount, 2)
    db.add(CreditEntry(user_id=user_id, amount=amount, reason=reason, order_id=order_id))


def spend_credit(db: Session, user_id: int, amount: float, order_id: int) -> None:
    # The balance check is inside the update, so two checkouts cannot both
    # spend the same rupees.
    result = db.execute(
        text(
            """
            UPDATE store_credits
            SET balance = balance - :amount, updated_at = NOW()
            WHERE user_id = :user_id AND balance >= :amount
            """
        ),
        {"amount": amount, "user_id": user_id},
    )
    if result.rowcount == 0:
        raise APIError(409, "credit_changed", reason="Your store credit changed. Please review the total and try again.")
    db.add(CreditEntry(user_id=user_id, amount=-amount, reason="checkout", order_id=order_id))
