"""Sign-in.

Password, Google, phone OTP (MSG91), and Truecaller all end at the same
``users`` row. A brand-new phone account with no name gets an
``onboarding`` token, which can only call ``/auth/profile/complete``.
Every other private route demands ``full``.

Phone lookup tries 10-digit, ``91…``, and ``+91…`` because older rows
used all three.
"""

from __future__ import annotations

import logging
import re

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts import (
    authenticate,
    find_or_create_by_phone,
    hash_password,
    scope_for,
)
from app.auth import SCOPE_FULL, issue_token, require_onboarding, require_user
from app.errors import APIError
from app.notify import alert_ops, send_email, smtp_ready
from app.otp import (
    consume_proof,
    generate_email_otp,
    issue_proof,
    send_phone_otp,
    verify_email_otp,
    verify_phone_otp,
    verify_widget_token,
)
from app.phone import lookup_variants, ten_digit
from app.present import user_brief, user_profile
from app.ratelimit import limit
from app.models import User, alive
from app.routers.deps import get_db

log = logging.getLogger("growman.auth")
router = APIRouter(dependencies=[Depends(limit("auth", 20, 60, fail_closed=True))])

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class LoginIn(BaseModel):
    email: str = ""
    password: str = ""


class SignupIn(BaseModel):
    name: str = ""
    email: str
    password: str = Field(min_length=8)
    phone: str = ""


def _token_response(settings, user: User) -> dict:
    scope = scope_for(user)
    return {"token": issue_token(settings.jwt_secret, user.id, user.role, scope), "user": user_brief(user), "scope": scope}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = authenticate(db, body.email, body.password)
    return _token_response(request.app.state.settings, user)


@router.post("/auth/admin/login")
def admin_login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = authenticate(db, body.email, body.password)
    if user.role not in {"admin", "superadmin"}:
        raise APIError(403, "admin access required")
    return _token_response(request.app.state.settings, user)


@router.post("/auth/signup")
def signup(body: SignupIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise APIError(400, "invalid email format")
    if db.scalar(select(User.id).where(User.email == email, alive(User))):
        raise APIError(409, "email already registered")
    phone = ten_digit(body.phone) if body.phone else None
    if phone and db.scalar(select(User.id).where(User.phone.in_(lookup_variants(phone)), alive(User))):
        raise APIError(409, "phone already registered")
    user = User(
        name=body.name.strip(),
        email=email,
        phone=phone,
        password_hash=hash_password(body.password),
        role="user",
        provider="local",
    )
    db.add(user)
    db.flush()
    alert_ops(request.app.state.settings, f"New signup: {user.name} <{email}>")
    return _token_response(request.app.state.settings, user)


class GoogleIn(BaseModel):
    idToken: str = ""
    id_token: str = ""


def _google_profile(settings, body: GoogleIn) -> dict:
    token = body.idToken or body.id_token
    if not token:
        raise APIError(400, "idToken is required")
    if not settings.google_client_id:
        raise APIError(503, "google_unavailable")
    # Google checks the signature. We then check the audience ourselves so
    # a token minted for a different app cannot sign in here.
    try:
        response = httpx.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": token},
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise APIError(502, "google_unavailable") from exc
    if response.status_code != 200:
        raise APIError(401, "invalid google token")
    data = response.json()
    if data.get("aud") != settings.google_client_id:
        raise APIError(401, "invalid google token")
    if str(data.get("email_verified")).lower() != "true":
        raise APIError(401, "google email is not verified")
    return data


@router.post("/auth/google")
@router.post("/auth/google-signup")
def google(body: GoogleIn, request: Request, db: Session = Depends(get_db)):
    profile = _google_profile(request.app.state.settings, body)
    email = profile["email"].lower()
    user = db.scalar(select(User).where(User.email == email, alive(User)))
    if user is None:
        user = User(
            name=profile.get("name") or "",
            email=email,
            email_verified=True,
            provider="google",
            role="user",
        )
        db.add(user)
        db.flush()
    return _token_response(request.app.state.settings, user)


class EmailIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    email: str
    password: str = Field(min_length=8)
    proof: str = ""
    verificationToken: str = ""


@router.post("/auth/forgot-password/send-otp")
def send_reset_otp(body: EmailIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email, alive(User)))
    # Do not reveal whether the email exists. Still only store a code when it does.
    if user is None:
        return {"message": "If that account exists, a code is on its way."}
    _send_email_code(request, email, purpose="reset")
    return {"message": "If that account exists, a code is on its way.", "cooldown": 60}


@router.post("/auth/forgot-password/verify-otp")
def verify_reset_otp(body: dict, request: Request):
    email = str(body.get("email") or "").strip().lower()
    code = str(body.get("otp") or "")
    if not verify_email_otp(request.app.state.redis, f"reset:{email}", code):
        raise APIError(400, "invalid or expired OTP")
    proof = issue_proof(request.app.state.redis, f"reset:{email}")
    return {"success": True, "verificationToken": proof, "expiresIn": 900}


@router.post("/auth/forgot-password/reset")
def reset_password(body: ResetIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    token = body.verificationToken or body.proof
    if not consume_proof(request.app.state.redis, f"reset:{email}", token):
        raise APIError(403, "email_not_verified", reason="Verify the code again, then choose a password.")
    user = db.scalar(select(User).where(User.email == email, alive(User)))
    if user is None:
        raise APIError(404, "user not found")
    user.password_hash = hash_password(body.password)
    return {"ok": True}


def _send_email_code(request: Request, email: str, purpose: str = "email") -> None:
    settings = request.app.state.settings
    if settings.is_prod and not smtp_ready(settings):
        raise APIError(503, "email_unavailable")
    code, retry = generate_email_otp(request.app.state.redis, f"{purpose}:{email}")
    if code is None:
        raise APIError(429, "otp_cooldown", retry_after=retry)
    if smtp_ready(settings):
        send_email(settings, email, "Your Growman code", f"Your code is {code}. It expires in 10 minutes.")
    else:
        # Development only. Production already returned 503 above.
        log.warning("SMTP is not configured. %s OTP for %s is %s", purpose, email, code)


class PhoneIn(BaseModel):
    phone: str


class PhoneVerifyIn(BaseModel):
    phone: str
    otp: str


@router.post("/auth/otp/send")
def send_phone(body: PhoneIn, request: Request):
    settings = request.app.state.settings
    if not settings.msg91_auth_key or not settings.msg91_template_id:
        raise APIError(503, "otp_unavailable")
    try:
        send_phone_otp(settings, body.phone)
    except Exception as exc:  # noqa: BLE001
        log.warning("msg91 send: %s", exc)
        raise APIError(502, "otp_unavailable") from exc
    return {"message": "OTP sent"}


@router.post("/auth/otp/verify")
def verify_phone(body: PhoneVerifyIn, request: Request, db: Session = Depends(get_db)):
    settings = request.app.state.settings
    try:
        verify_phone_otp(settings, body.phone, body.otp)
    except Exception as exc:  # noqa: BLE001
        raise APIError(400, "invalid or expired OTP") from exc
    user = find_or_create_by_phone(db, body.phone, provider="phone")
    return _token_response(settings, user)


class WidgetIn(BaseModel):
    accessToken: str = ""
    access_token: str = ""


@router.post("/auth/otp/widget/verify")
def verify_widget(body: WidgetIn, request: Request, db: Session = Depends(get_db)):
    token = body.accessToken or body.access_token
    if not token:
        raise APIError(400, "accessToken is required")
    try:
        phone = verify_widget_token(request.app.state.settings, token)
    except Exception as exc:  # noqa: BLE001
        raise APIError(401, "invalid widget token") from exc
    user = find_or_create_by_phone(db, phone, provider="phone")
    return _token_response(request.app.state.settings, user)


class TruecallerIn(BaseModel):
    code: str
    codeVerifier: str = ""
    code_verifier: str = ""


@router.post("/auth/truecaller")
def truecaller(body: TruecallerIn, request: Request, db: Session = Depends(get_db)):
    settings = request.app.state.settings
    if not settings.truecaller_client_id:
        raise APIError(503, "truecaller_unavailable")
    verifier = body.codeVerifier or body.code_verifier
    try:
        token_res = httpx.post(
            "https://oauth-account-noneu.truecaller.com/v1/token",
            data={
                "grant_type": "authorization_code",
                "client_id": settings.truecaller_client_id,
                "code": body.code,
                "code_verifier": verifier,
            },
            timeout=15,
        )
        token_res.raise_for_status()
        access = token_res.json()["access_token"]
        info = httpx.get(
            "https://oauth-account-noneu.truecaller.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access}"},
            timeout=15,
        )
        info.raise_for_status()
        profile = info.json()
    except Exception as exc:  # noqa: BLE001
        log.warning("truecaller: %s", exc)
        raise APIError(502, "truecaller_unavailable") from exc
    phone = profile.get("phone_number") or ""
    name = " ".join(p for p in (profile.get("given_name"), profile.get("family_name")) if p)
    user = find_or_create_by_phone(db, phone, name=name, provider="truecaller")
    return _token_response(settings, user)


@router.get("/auth/check-user")
def check_user(request: Request, db: Session = Depends(get_db)):
    email = (request.query_params.get("email") or "").strip().lower()
    phone = request.query_params.get("phone") or ""
    exists = False
    if email:
        exists = db.scalar(select(User.id).where(User.email == email, alive(User))) is not None
    elif phone:
        variants = lookup_variants(phone)
        exists = bool(variants) and db.scalar(select(User.id).where(User.phone.in_(variants), alive(User))) is not None
    return {"exists": exists}


class ProfileIn(BaseModel):
    name: str


@router.post("/auth/profile/complete")
def complete_profile(body: ProfileIn, request: Request, db: Session = Depends(get_db), claims=Depends(require_onboarding)):
    """The only route an onboarding token may call. A name promotes it to full."""
    name = body.name.strip()
    if len(name) < 2:
        raise APIError(400, "please enter your name")
    user = db.get(User, claims.user_id)
    if user is None or user.deleted_at is not None:
        raise APIError(401, "invalid token")
    user.name = name
    return {"token": issue_token(request.app.state.settings.jwt_secret, user.id, user.role, SCOPE_FULL), "user": user_brief(user)}


@router.get("/auth/me")
def me(db: Session = Depends(get_db), claims=Depends(require_user)):
    user = db.get(User, claims.user_id)
    if user is None or user.deleted_at is not None:
        raise APIError(401, "invalid token")
    return user_profile(user)


class ProfileUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    addressLine: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    country: str | None = None


@router.put("/auth/profile")
def update_profile(body: ProfileUpdate, db: Session = Depends(get_db), claims=Depends(require_user)):
    user = db.get(User, claims.user_id)
    if user is None:
        raise APIError(401, "invalid token")
    for field, value in (
        ("name", body.name),
        ("address_line", body.addressLine),
        ("city", body.city),
        ("state", body.state),
        ("pincode", body.pincode),
        ("country", body.country),
    ):
        if value is not None:
            setattr(user, field, value)
    if body.phone:
        ten = ten_digit(body.phone)
        if not ten:
            raise APIError(400, "invalid phone number format")
        user.phone = ten
    return user_profile(user)


class LocationIn(BaseModel):
    latitude: float
    longitude: float


@router.post("/auth/save-location")
def save_location(body: LocationIn, db: Session = Depends(get_db), claims=Depends(require_user)):
    user = db.get(User, claims.user_id)
    if user is None:
        raise APIError(401, "invalid token")
    user.latitude = body.latitude
    user.longitude = body.longitude
    return {"ok": True}
