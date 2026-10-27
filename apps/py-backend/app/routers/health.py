"""Liveness and readiness.

``/healthz`` must not touch the database. A liveness probe that pings
Postgres will restart every replica during a database incident, and the
restart throws away the in-process cache for no benefit.

``/readyz`` answers "should this replica receive traffic?". Postgres down
means no. Redis down means degraded: the API was built to run without it,
and pulling every replica out of rotation would create the outage the
design avoids.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

log = logging.getLogger("growman.health")
router = APIRouter()


@router.get("/healthz")
@router.get("/api/v1/healthz")
def health():
    return {"status": "ok", "service": "py-backend"}


@router.get("/api/v1/debug/version")
def version():
    return {"service": "py-backend", "version": "0.1.0"}


@router.get("/readyz")
def ready(request: Request):
    checks: dict[str, str] = {}
    overall = "ok"
    status = 200
    engine = getattr(request.app.state, "engine", None)
    if engine is None:
        checks["postgres"] = "not connected"
        overall, status = "down", 503
    else:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            checks["postgres"] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks["postgres"] = "error: " + str(exc)
            overall, status = "down", 503
    redis = getattr(request.app.state, "redis", None)
    if redis is None:
        checks["redis"] = "not configured"
    else:
        try:
            redis.ping()
            checks["redis"] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks["redis"] = "error: " + str(exc)
            if overall == "ok":
                overall = "degraded"
    checks["images"] = "ok" if request.app.state.settings.image_base_url else "not configured"
    return JSONResponse({"status": overall, "service": "py-backend", "checks": checks}, status_code=status)
