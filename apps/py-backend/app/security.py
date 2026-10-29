"""Who is calling. Passwords are bcrypt. Sessions are JWTs.

A token has a scope. "full" can shop. "onboarding" can only finish a
phone signup. Admin routes need a full token and role admin or superadmin.
"""

import time

import bcrypt
import jwt
from fastapi import Depends, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.http import APIError
from app.models import User, alive

FULL = "full"
ONBOARDING = "onboarding"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def password_ok(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def issue(secret: str, user: User, scope: str = FULL) -> str:
    now = int(time.time())
    return jwt.encode(
        {"userId": user.id, "role": user.role, "scope": scope, "iat": now, "exp": now + 86400},
        secret,
        algorithm="HS256",
    )


def read_token(secret: str, header: str) -> dict:
    if not header.lower().startswith("bearer "):
        raise APIError(401, "missing_token")
    try:
        return jwt.decode(header.split(" ", 1)[1], secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise APIError(401, "invalid_token") from exc


def _load(db: Session, claims: dict, scope: str | None) -> User:
    got = claims.get("scope") or FULL
    if scope == FULL and got == ONBOARDING:
        raise APIError(403, "profile_incomplete")
    if scope == ONBOARDING and got != ONBOARDING:
        raise APIError(403, "wrong_scope")
    user = db.get(User, claims.get("userId"))
    if user is None or user.deleted_at is not None:
        raise APIError(401, "invalid_token")
    return user


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    header = request.headers.get("authorization", "")
    if not header:
        return None
    claims = read_token(request.app.state.settings.jwt_secret, header)
    return _load(db, claims, None)


def member(request: Request, db: Session = Depends(get_db)) -> User:
    claims = read_token(request.app.state.settings.jwt_secret, request.headers.get("authorization", ""))
    return _load(db, claims, FULL)


def onboarding(request: Request, db: Session = Depends(get_db)) -> User:
    claims = read_token(request.app.state.settings.jwt_secret, request.headers.get("authorization", ""))
    return _load(db, claims, ONBOARDING)


def admin(user: User = Depends(member)) -> User:
    if user.role not in {"admin", "superadmin"}:
        raise APIError(403, "admin_required")
    return user


def ten_digit(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    if digits.startswith("91") and len(digits) >= 12:
        digits = digits[-10:]
    if len(digits) == 10 and digits[0] in "6789":
        return digits
    return ""


def phone_variants(value: str) -> list[str]:
    ten = ten_digit(value)
    if not ten:
        return []
    return [ten, f"91{ten}", f"+91{ten}"]


def find_user(db: Session, *, email: str = "", phone: str = "") -> User | None:
    clauses = []
    if email:
        clauses.append(User.email == email.strip().lower())
    variants = phone_variants(phone)
    if variants:
        clauses.append(User.phone.in_(variants))
    if not clauses:
        return None
    return db.scalar(select(User).where(alive(User), or_(*clauses)))
