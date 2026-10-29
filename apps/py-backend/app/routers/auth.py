"""Accounts: password, Google, phone, and password reset.

A phone signup with no name gets an onboarding token. That token can
only call /auth/profile/complete. Every other signed-in route wants a
full account.
"""

import logging
import secrets

import httpx
from fastapi import APIRouter, Depends, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import codes, mail
from app.db import get_db
from app.http import APIError, limit
from app.models import User, utcnow
from app.security import (
    FULL,
    ONBOARDING,
    find_user,
    hash_password,
    issue,
    member,
    onboarding,
    password_ok,
    ten_digit,
)
from app.serialize import user_out

log = logging.getLogger("growman")
router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(limit("auth", 20, 60, True))])


def _token(request: Request, user: User, scope: str = FULL) -> dict:
    return {"token": issue(request.app.state.settings.jwt_secret, user, scope)}


def _code() -> str:
    return f"{secrets.randbelow(900000) + 100000}"


def _cool(request: Request, key: str) -> None:
    box, redis = request.app.state.box, request.app.state.redis
    if box.get(redis, key):
        raise APIError(429, "otp_cooldown")
    box.put(redis, key, "1", 30)


@router.post("/signup")
def signup(body: dict, request: Request, db: Session = Depends(get_db)):
    name, email, phone = str(body.get("name") or "").strip(), str(body.get("email") or "").strip().lower(), ten_digit(str(body.get("phone") or ""))
    password = str(body.get("password") or "")
    if not name or "@" not in email or not phone or not 8 <= len(password) <= 72:
        raise APIError(400, "invalid_signup")
    if find_user(db, email=email, phone=phone):
        raise APIError(409, "account_exists")
    user = User(name=name, email=email, phone=phone, password_hash=hash_password(password),
                provider="local", role="user", referral_code=secrets.token_hex(4))
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        raise APIError(409, "account_exists") from exc
    return _token(request, user)


@router.post("/login")
def login(body: dict, request: Request, db: Session = Depends(get_db)):
    user = find_user(db, email=str(body.get("email") or ""))
    if user is None or not password_ok(str(body.get("password") or ""), user.password_hash):
        raise APIError(401, "invalid_login")
    return _token(request, user)


@router.post("/admin/login")
def admin_login(body: dict, request: Request, db: Session = Depends(get_db)):
    user = find_user(db, email=str(body.get("email") or ""))
    if user is None or not password_ok(str(body.get("password") or ""), user.password_hash):
        raise APIError(401, "invalid_login")
    if user.role not in {"admin", "superadmin"}:
        raise APIError(403, "admin_required")
    return _token(request, user)


@router.get("/check-user")
def check_user(db: Session = Depends(get_db), email: str = "", phone: str = ""):
    if not email and not phone:
        raise APIError(400, "email or phone is required")
    return {"exists": find_user(db, email=email, phone=phone) is not None}


@router.get("/me")
def me(user: User = Depends(member)):
    return user_out(user)


@router.put("/profile")
def update_profile(body: dict, user: User = Depends(member)):
    for src, dest in (("name", "name"), ("addressLine", "address_line"), ("city", "city"),
                      ("state", "state"), ("pincode", "pincode"), ("country", "country")):
        if src in body and body[src] is not None:
            setattr(user, dest, str(body[src])[:200])
    return user_out(user)


@router.post("/save-location")
def save_location(body: dict, user: User = Depends(member)):
    user.latitude = body.get("latitude")
    user.longitude = body.get("longitude")
    return {"ok": True}


@router.post("/profile/complete")
def complete_profile(body: dict, request: Request, user: User = Depends(onboarding)):
    name = str(body.get("name") or "").strip()
    if len(name) < 2:
        raise APIError(400, "name_required")
    user.name = name[:200]
    if body.get("email"):
        user.email = str(body["email"]).strip().lower()
    return _token(request, user, FULL)


def _phone_user(db: Session, phone: str) -> tuple[User, bool]:
    user = find_user(db, phone=phone)
    if user:
        user.phone_verified_at = utcnow()
        return user, False
    user = User(name="", phone=phone, phone_verified_at=utcnow(), provider="phone", role="user", referral_code=secrets.token_hex(4))
    db.add(user)
    db.flush()
    return user, True


def _phone_token(request: Request, user: User, created: bool) -> dict:
    scope = ONBOARDING if not user.name.strip() else FULL
    return {**_token(request, user, scope), "isNewUser": scope == ONBOARDING, "isNewAccount": created, "verified": True}


@router.post("/otp/send")
def send_phone_otp(body: dict, request: Request):
    phone = ten_digit(str(body.get("phone") or ""))
    if not phone:
        raise APIError(400, "invalid_phone")
    settings = request.app.state.settings
    _cool(request, f"otp:cool:phone:{phone}")
    if settings.msg91_auth_key and settings.msg91_widget_id:
        response = httpx.post(
            "https://control.msg91.com/api/v5/widget/sendOtpMobile",
            json={"widgetId": settings.msg91_widget_id, "tokenAuth": settings.msg91_token_auth, "identifier": f"91{phone}"},
            headers={"authkey": settings.msg91_auth_key},
            timeout=15,
        )
        if response.status_code >= 300:
            raise APIError(502, "otp_failed")
        return {"cooldownSeconds": 30, "reqId": response.json().get("message", "")}
    if settings.msg91_auth_key and settings.msg91_template_id:
        response = httpx.post(
            "https://control.msg91.com/api/v5/otp",
            headers={"authkey": settings.msg91_auth_key},
            json={"template_id": settings.msg91_template_id, "mobile": f"91{phone}"},
            timeout=15,
        )
        if response.status_code >= 300:
            raise APIError(502, "otp_failed")
        return {"cooldownSeconds": 30}
    if settings.prod:
        raise APIError(503, "phone_otp_unavailable")
    code = _code()
    codes.save(request.app.state.box, request.app.state.redis, f"otp:phone:{phone}", code, 600)
    log.info("phone otp for %s is %s", phone, code)
    return {"cooldownSeconds": 30}


@router.post("/otp/verify")
def verify_phone_otp(body: dict, request: Request, db: Session = Depends(get_db)):
    phone = ten_digit(str(body.get("phone") or ""))
    otp = str(body.get("otp") or "")
    settings = request.app.state.settings
    if settings.msg91_auth_key and settings.msg91_template_id:
        response = httpx.get(
            "https://control.msg91.com/api/v5/otp/verify",
            params={"otp": otp, "mobile": f"91{phone}"},
            headers={"authkey": settings.msg91_auth_key},
            timeout=15,
        )
        if response.status_code >= 300:
            raise APIError(401, "invalid_otp")
    elif not codes.take(request.app.state.box, request.app.state.redis, f"otp:phone:{phone}", otp):
        raise APIError(401, "invalid_otp")
    user, created = _phone_user(db, phone)
    return _phone_token(request, user, created)


@router.post("/otp/widget/verify")
def verify_widget(body: dict, request: Request, db: Session = Depends(get_db)):
    settings = request.app.state.settings
    token = str(body.get("accessToken") or "")
    if not settings.msg91_auth_key:
        raise APIError(503, "phone_otp_unavailable")
    response = httpx.post(
        "https://control.msg91.com/api/v5/widget/verifyAccessToken",
        data={"authkey": settings.msg91_auth_key, "access-token": token},
        timeout=15,
    )
    if response.status_code >= 300:
        raise APIError(401, "invalid_otp")
    phone = ten_digit(str(response.json().get("message") or body.get("identifier") or ""))
    if not phone:
        raise APIError(401, "invalid_otp")
    user, created = _phone_user(db, phone)
    return _phone_token(request, user, created)


@router.post("/truecaller")
def truecaller(body: dict, request: Request, db: Session = Depends(get_db)):
    settings = request.app.state.settings
    if not settings.truecaller_client_id:
        raise APIError(503, "truecaller_unavailable")
    token_res = httpx.post(
        "https://oauth-account-noneu.truecaller.com/v1/token",
        data={"grant_type": "authorization_code", "client_id": settings.truecaller_client_id,
              "code": body.get("code", ""), "code_verifier": body.get("codeVerifier", "")},
        timeout=15,
    )
    access = token_res.json().get("access_token", "")
    if not access:
        raise APIError(401, "invalid_truecaller")
    profile = httpx.get("https://oauth-account-noneu.truecaller.com/v1/userinfo",
                        headers={"Authorization": f"Bearer {access}"}, timeout=15).json()
    phone = ten_digit(str(profile.get("phone_number") or ""))
    if not phone:
        raise APIError(401, "invalid_truecaller")
    user, created = _phone_user(db, phone)
    if profile.get("given_name") and not user.name:
        user.name = f"{profile.get('given_name', '')} {profile.get('family_name', '')}".strip()
    return _phone_token(request, user, created)


def _google(settings, token: str) -> tuple[str, str, bool]:
    if settings.prod and not settings.google_client_id:
        raise APIError(503, "google_unavailable")
    if token.count(".") == 2:
        data = httpx.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": token}, timeout=10).json()
        if settings.google_client_id and data.get("aud") != settings.google_client_id:
            raise APIError(401, "invalid_google_token")
        email = str(data.get("email") or "")
        return email, str(data.get("name") or email), str(data.get("email_verified")) == "true"
    data = httpx.get("https://www.googleapis.com/oauth2/v3/userinfo",
                     headers={"Authorization": f"Bearer {token}"}, timeout=10)
    if data.status_code >= 300:
        raise APIError(401, "invalid_google_token")
    body = data.json()
    return str(body.get("email") or ""), str(body.get("name") or body.get("email") or ""), bool(body.get("email_verified"))


@router.post("/google")
@router.post("/google-signup")
def google(body: dict, request: Request, db: Session = Depends(get_db)):
    email, name, verified = _google(request.app.state.settings, str(body.get("token") or ""))
    if "@" not in email:
        raise APIError(401, "invalid_google_token")
    user = find_user(db, email=email)
    if user is None:
        user = User(name=name[:200], email=email.lower(), email_verified=verified, provider="google",
                    role="user", referral_code=secrets.token_hex(4))
        db.add(user)
        db.flush()
    return _token(request, user)


@router.post("/forgot-password/send-otp")
def send_reset(body: dict, request: Request, db: Session = Depends(get_db)):
    email = str(body.get("email") or "").strip().lower()
    if find_user(db, email=email) is None:
        return {"ok": True}
    _cool(request, f"otp:cool:reset:{email}")
    code = _code()
    codes.save(request.app.state.box, request.app.state.redis, f"otp:email:reset:{email}", code, 600)
    mail.send(request.app.state.settings, email, "Reset your Growman password", f"Your code is {code}. It expires in 10 minutes.")
    return {"ok": True}


@router.post("/forgot-password/verify-otp")
def verify_reset(body: dict, request: Request):
    email = str(body.get("email") or "").strip().lower()
    if not codes.take(request.app.state.box, request.app.state.redis, f"otp:email:reset:{email}", str(body.get("otp") or "")):
        raise APIError(401, "invalid_otp")
    proof = secrets.token_urlsafe(24)
    codes.save(request.app.state.box, request.app.state.redis, f"otp:proof:reset:{email}", proof, 600)
    return {"verificationToken": proof}


@router.post("/forgot-password/reset")
def reset_password(body: dict, request: Request, db: Session = Depends(get_db)):
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    if not 8 <= len(password) <= 72:
        raise APIError(400, "invalid_password")
    if not codes.take(request.app.state.box, request.app.state.redis, f"otp:proof:reset:{email}", str(body.get("verificationToken") or "")):
        raise APIError(403, "reset_expired")
    user = find_user(db, email=email)
    if user is None:
        raise APIError(404, "not_found")
    user.password_hash = hash_password(password)
    return {"ok": True}
