"""Process entrypoint.

Boot order matches the Go server: config, Postgres, Redis (optional),
schema, seed, background workers, then the listener. Shutdown cancels the
workers before closing the pool, so a sweep is not mid-statement while
the connections disappear.

Run it with:

    uvicorn app.main:app --reload --port 8081
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager

import redis as redis_lib
import uvicorn
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings
from app.cache import Cache
from app.db import make_engine, make_session_factory, migrate
from app.errors import APIError
from app.images import UPLOAD_ROOT
from app.metrics import metrics_app
from app.ratelimit import limit
from app.routers import account, admin, auth_routes, catalog, chat, checkout, health, misc, orders, plants, webhooks
from app.seed import ensure_sample_data
from app.shiprocket import Shiprocket
from app.workers import run_workers

log = logging.getLogger("growman")

# Catalogue reads fail open. See ratelimit.py for why the others do not.
_READ_LIMIT = limit("api", 250, 60, fail_closed=False)


def create_app() -> FastAPI:
    settings = Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.validate_boot()
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
        engine = make_engine(settings)
        factory = make_session_factory(engine)
        app.state.engine = engine
        app.state.session_factory = factory
        if settings.auto_migrate:
            migrate(engine)
        if settings.seed_on_startup:
            db = factory()
            try:
                ensure_sample_data(db)
            finally:
                db.close()
        client = None
        if settings.redis_url:
            client = redis_lib.Redis.from_url(settings.redis_url, max_connections=settings.redis_pool_size)
            try:
                client.ping()
            except Exception as exc:  # noqa: BLE001
                # Redis is optional for caching. Boot anyway; the cache
                # helper treats a dead client as a miss.
                log.warning("redis unavailable, continuing without it: %s", exc)
                client = None
        app.state.redis = client
        app.state.cache = Cache(client)
        app.state.shiprocket = Shiprocket(settings.shiprocket_email, settings.shiprocket_password, settings.shiprocket_token)
        stop = asyncio.Event()
        worker = asyncio.create_task(run_workers(app, stop))
        log.info("listening on %s", settings.py_port)
        try:
            yield
        finally:
            stop.set()
            worker.cancel()
            engine.dispose()
            if client is not None:
                client.close()

    app = FastAPI(title="Growman API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    # Present before startup so imports and tests can read settings.
    # Routes that touch the database run only after the lifespan connects.
    app.state.redis = None
    app.state.cache = Cache(None)
    app.state.shiprocket = Shiprocket(settings.shiprocket_email, settings.shiprocket_password, settings.shiprocket_token)
    app.state.engine = None
    app.state.session_factory = None

    app.middleware("http")(_security_and_limits)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        allow_headers=["Accept", "Authorization", "Content-Type", "Origin", "X-Requested-With"],
        expose_headers=["ETag", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
        max_age=600,
    )

    @app.exception_handler(APIError)
    async def _api_error(_request: Request, exc: APIError):
        body = {"error": exc.message, **exc.extra}
        return JSONResponse(body, status_code=exc.status)

    app.mount("/metrics", metrics_app)
    app.include_router(health.router)
    app.include_router(webhooks.router)

    api_dependencies = [Depends(_READ_LIMIT)]
    app.include_router(auth_routes.router, prefix="/api/v1", dependencies=api_dependencies)
    app.include_router(catalog.router, prefix="/api/v1", dependencies=api_dependencies)
    app.include_router(checkout.router, prefix="/api/v1", dependencies=api_dependencies)
    app.include_router(orders.router, prefix="/api/v1", dependencies=api_dependencies)
    app.include_router(account.router, prefix="/api/v1", dependencies=api_dependencies)
    app.include_router(admin.router, prefix="/api/v1", dependencies=api_dependencies)
    app.include_router(chat.router, prefix="/api/v1", dependencies=api_dependencies)
    app.include_router(plants.router, prefix="/api/v1", dependencies=api_dependencies)
    app.include_router(misc.router, prefix="/api/v1", dependencies=api_dependencies)
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(UPLOAD_ROOT)), name="uploads")
    return app


async def _security_and_limits(request: Request, call_next):
    # 11 MB covers a plant photo plus the multipart envelope.
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > 11 * 1024 * 1024:
        return JSONResponse({"error": "payload too large"}, status_code=413)
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled error %s", request_id)
        response = JSONResponse({"error": "internal error"}, status_code=500)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # A JSON API has nothing for a Content-Security-Policy to protect.
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    limit_state = getattr(request.state, "rate_limit", None)
    if limit_state:
        response.headers["X-RateLimit-Limit"] = str(limit_state[0])
        response.headers["X-RateLimit-Remaining"] = str(limit_state[1])
    return response


app = create_app()


def main() -> None:
    settings = Settings()
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.py_port, proxy_headers=True)
