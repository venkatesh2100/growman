"""JSON Web Tokens and the dependencies that guard routes.

A token carries three things: who (``userId``), what they may do
(``role``), and how finished the account is (``scope``).

``full`` is a normal account. ``onboarding`` is a phone or Truecaller
signup that does not have a name yet. Scope is enforced here, where the
route is mounted, not inside each handler. A check that lives in a
handler protects only the handler that remembered to do it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.errors import APIError

SCOPE_FULL = "full"
SCOPE_ONBOARDING = "onboarding"
TOKEN_TTL = timedelta(hours=24)

_bearer = HTTPBearer(auto_error=False)


@dataclass
class Claims:
    user_id: int
    role: str
    scope: str


def is_admin(role: str) -> bool:
    return (role or "").strip().lower() in {"admin", "superadmin"}


def issue_token(secret: str, user_id: int, role: str, scope: str = SCOPE_FULL) -> str:
    if not scope:
        scope = SCOPE_FULL
    now = datetime.now(timezone.utc)
    payload = {
        "userId": user_id,
        "role": role or "user",
        "scope": scope,
        "iat": int(now.timestamp()),
        "exp": int((now + TOKEN_TTL).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def parse_token(secret: str, token: str) -> Claims:
    try:
        # algorithms=[...] refuses the "none" algorithm and any other method.
        data = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise APIError(401, "invalid token") from exc
    scope = data.get("scope") or SCOPE_FULL
    return Claims(user_id=int(data["userId"]), role=str(data.get("role") or "user"), scope=scope)


def _read(request: Request, creds: HTTPAuthorizationCredentials | None) -> Claims | None:
    if creds is None or not creds.credentials:
        return None
    return parse_token(request.app.state.settings.jwt_secret, creds.credentials)


def optional_claims(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Claims | None:
    """Guest routes that *may* also be signed in.

    A missing or bad token is not a 401 here. The guest path is legitimate;
    the handler decides what the caller may see.
    """
    if creds is None or not creds.credentials:
        return None
    try:
        return parse_token(request.app.state.settings.jwt_secret, creds.credentials)
    except APIError:
        return None


def require_scope(scope: str):
    """Build a dependency that demands a Bearer token of this scope.

    ``scope="full"`` rejects onboarding tokens. ``scope="onboarding"``
    accepts only those. ``scope="admin"`` also demands an admin role.
    """

    def _dep(
        request: Request,
        creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> Claims:
        claims = _read(request, creds)
        if claims is None:
            raise APIError(401, "missing Authorization header")
        if scope == SCOPE_FULL and claims.scope == SCOPE_ONBOARDING:
            raise APIError(403, "complete your profile first")
        if scope == SCOPE_ONBOARDING and claims.scope != SCOPE_ONBOARDING:
            raise APIError(403, "invalid token scope")
        if scope == "admin":
            if claims.scope == SCOPE_ONBOARDING:
                raise APIError(403, "complete your profile first")
            if not is_admin(claims.role):
                raise APIError(403, "admin access required")
        return claims

    return _dep


require_user = require_scope(SCOPE_FULL)
require_onboarding = require_scope(SCOPE_ONBOARDING)
require_admin = require_scope("admin")
