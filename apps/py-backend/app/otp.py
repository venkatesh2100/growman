"""One-time codes and the single-use proof a guest needs to check out.

Email OTP is generated here and kept in Redis when Redis exists, otherwise
in process memory. Phone OTP is sent by MSG91; we do not invent a code the
SMS provider does not know about.

The proof token is the important part. Verifying the OTP is not enough if
``create-order`` does not require the proof: a client could skip the OTP
call. The proof is bound to one email, expires, and is deleted on use.
"""

from __future__ import annotations

import logging
import secrets
import threading
import time

import httpx

from app.phone import msg91_mobile

log = logging.getLogger("growman.otp")

OTP_TTL = 10 * 60
PROOF_TTL = 15 * 60
COOLDOWN = 60

_mem: dict[str, tuple[float, str]] = {}
_lock = threading.Lock()


def _put(redis, key: str, value: str, ttl: int) -> None:
    if redis is not None:
        redis.set(key, value, ex=ttl)
        return
    with _lock:
        _mem[key] = (time.time() + ttl, value)


def _get(redis, key: str) -> str | None:
    if redis is not None:
        raw = redis.get(key)
        if raw is None:
            return None
        return raw.decode() if isinstance(raw, bytes) else raw
    with _lock:
        item = _mem.get(key)
        if not item or item[0] < time.time():
            _mem.pop(key, None)
            return None
        return item[1]


def _take(redis, key: str) -> str | None:
    if redis is not None:
        # GETDEL is atomic. Two requests cannot both consume one proof.
        raw = redis.getdel(key) if hasattr(redis, "getdel") else None
        if raw is None and not hasattr(redis, "getdel"):
            pipe = redis.pipeline()
            pipe.get(key)
            pipe.delete(key)
            raw, _ = pipe.execute()
        if raw is None:
            return None
        return raw.decode() if isinstance(raw, bytes) else raw
    with _lock:
        item = _mem.pop(key, None)
        if not item or item[0] < time.time():
            return None
        return item[1]


def generate_email_otp(redis, email: str) -> tuple[str | None, int]:
    """Return ``(code, retry_after)``. ``code is None`` means still cooling down."""
    email = email.strip().lower()
    cool_key = f"otp:cool:{email}"
    if _get(redis, cool_key):
        if redis is not None:
            ttl = int(redis.ttl(cool_key) or COOLDOWN)
        else:
            with _lock:
                ttl = max(int(_mem.get(cool_key, (time.time(), ""))[0] - time.time()), 1)
        return None, ttl
    code = f"{secrets.randbelow(1_000_000):06d}"
    _put(redis, f"otp:email:{email}", code, OTP_TTL)
    _put(redis, cool_key, "1", COOLDOWN)
    return code, 0


def verify_email_otp(redis, email: str, code: str) -> bool:
    email = email.strip().lower()
    stored = _take(redis, f"otp:email:{email}")
    if not stored or not code:
        return False
    return secrets.compare_digest(stored, code.strip())


def issue_proof(redis, email: str) -> str:
    token = secrets.token_urlsafe(32)
    _put(redis, f"otp:proof:{token}", email.strip().lower(), PROOF_TTL)
    return token


def consume_proof(redis, email: str, token: str) -> bool:
    if not token:
        return False
    bound = _take(redis, f"otp:proof:{token.strip()}")
    return bool(bound) and secrets.compare_digest(bound, email.strip().lower())


def send_phone_otp(settings, phone: str) -> None:
    if not settings.msg91_auth_key or not settings.msg91_template_id:
        raise RuntimeError("msg91 not configured")
    mobile = msg91_mobile(phone)
    response = httpx.post(
        "https://control.msg91.com/api/v5/otp",
        params={"template_id": settings.msg91_template_id, "mobile": mobile, "otp_length": 6, "otp_expiry": 10},
        headers={"authkey": settings.msg91_auth_key, "Accept": "application/json"},
        timeout=15,
    )
    body = response.json()
    if body.get("type") != "success":
        raise RuntimeError(body.get("message") or "msg91 send failed")


def verify_phone_otp(settings, phone: str, otp: str) -> None:
    if not settings.msg91_auth_key:
        raise RuntimeError("msg91 not configured")
    response = httpx.get(
        "https://control.msg91.com/api/v5/otp/verify",
        params={"mobile": msg91_mobile(phone), "otp": otp},
        headers={"authkey": settings.msg91_auth_key, "Accept": "application/json"},
        timeout=15,
    )
    body = response.json()
    if body.get("type") != "success":
        raise RuntimeError(body.get("message") or "invalid otp")


def verify_widget_token(settings, access_token: str) -> str:
    """Return the phone MSG91 says this widget token belongs to."""
    if not settings.msg91_auth_key:
        raise RuntimeError("msg91 not configured")
    response = httpx.post(
        "https://control.msg91.com/api/v5/widget/verifyAccessToken",
        data={"authkey": settings.msg91_auth_key, "access-token": access_token},
        timeout=15,
    )
    body = response.json()
    if body.get("type") not in {None, "", "success"} and body.get("type") != "success":
        raise RuntimeError(str(body.get("message") or "widget verify failed"))
    for key in ("mobile", "phone", "identifier"):
        if body.get(key):
            return str(body[key])
    message = body.get("message")
    if isinstance(message, str) and any(ch.isdigit() for ch in message):
        return message
    raise RuntimeError("widget token had no phone")
