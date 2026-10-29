"""One process. Routes are thin. Money decisions live in shop.py.

Boot does not open Postgres until the lifespan starts, so importing the
app in tests does not need a database. /healthz never checks dependencies.
/readyz treats Postgres as fatal and Redis as degraded.
"""

import asyncio
import logging
from datetime import timedelta
from pathlib import Path

import uvicorn
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from prometheus_client import make_asgi_app
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from starlette.responses import JSONResponse

from app import mail, shop
from app.codes import Box
from app.config import Settings
from app.db import engine_for, ping, sessions_for
from app.http import APIError, handler, limit
from app.http import Limiter
from app.models import Base, Category, Order, Product, User, alive, utcnow
from app.routers import account, admin, auth, catalog, checkout, extras, orders, webhooks
from app.security import hash_password

log = logging.getLogger("growman")
UPLOADS = Path("data/uploads")


def _redis(settings: Settings):
    if not settings.redis_url:
        return None
    import redis
    client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1, decode_responses=True)
    try:
        client.ping()
        return client
    except Exception:
        log.warning("redis is down; catalog hits Postgres and limits stay in-process")
        return None


def _seed(db) -> None:
    if db.scalar(select(User.id)):
        return
    db.add(User(
        name="Admin", email="admin@growman.local", phone="9000000000",
        password_hash=hash_password("admin12345"), role="admin", email_verified=True,
        provider="local", referral_code="admin",
    ))
    category = Category(name="Indoor", slug="indoor", description="Plants that live in rooms")
    db.add(category)
    db.flush()
    db.add(Product(
        name="Money Plant", slug="money-plant", short_desc="An easy trailing vine",
        price=299, mrp=399, stock=20, status="active", featured=True,
        tags=["indoor", "beginner"], category_id=category.id, size_class="small",
    ))


def _sweep(app: FastAPI) -> None:
    db = app.state.sessions()
    try:
        pending = shop.sweep(db)
        db.commit()
    except Exception:
        db.rollback()
        log.exception("abandoned-order sweep")
        return
    finally:
        db.close()
    for order in pending:
        mail.send(app.state.settings, order.customer_email, "Your plants are back on the shelf",
                  "The hold expired. Place the order again when you are ready.")


def _book(app: FastAPI) -> None:
    settings = app.state.settings
    if not settings.shiprocket_token and not settings.shiprocket_email:
        return
    db = app.state.sessions()
    try:
        rows = db.scalars(
            select(Order).where(
                alive(Order), Order.payment_status == "paid", Order.fulfillment_channel == "courier", Order.awb_number == "",
            ).options(selectinload(Order.items)).limit(10)
        ).all()
        for order in rows:
            try:
                admin.book_courier(settings, order)
            except Exception:
                log.warning("courier booking skipped for order %s", order.id)
        db.commit()
    except Exception:
        db.rollback()
        log.exception("courier sweep")
    finally:
        db.close()


def _forget(app: FastAPI) -> None:
    db = app.state.sessions()
    try:
        cutoff = utcnow() - timedelta(days=180)
        db.execute(text("DELETE FROM chat_turns WHERE created_at < :cutoff"), {"cutoff": cutoff})
        db.commit()
    except Exception:
        db.rollback()
        log.exception("retention")
    finally:
        db.close()


async def _loop(app: FastAPI, stop: asyncio.Event) -> None:
    shipped = forgotten = 0.0
    loop = asyncio.get_running_loop()
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
            return
        except asyncio.TimeoutError:
            pass
        await asyncio.to_thread(_sweep, app)
        now = loop.time()
        if now - shipped > 15 * 60:
            shipped = now
            await asyncio.to_thread(_book, app)
        if now - forgotten > 24 * 3600:
            forgotten = now
            await asyncio.to_thread(_forget, app)


async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO)
    settings: Settings = app.state.settings
    settings.check()
    UPLOADS.mkdir(parents=True, exist_ok=True)
    engine = engine_for(settings)
    app.state.engine = engine
    app.state.sessions = sessions_for(engine)
    app.state.redis = _redis(settings)
    if settings.auto_migrate:
        Base.metadata.create_all(engine)
    if settings.seed_on_startup:
        db = app.state.sessions()
        try:
            _seed(db)
            db.commit()
        finally:
            db.close()
    stop = asyncio.Event()
    task = asyncio.create_task(_loop(app, stop))
    yield
    stop.set()
    task.cancel()
    engine.dispose()


def create_app() -> FastAPI:
    settings = Settings()
    UPLOADS.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="Growman", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.redis = None
    app.state.box = Box()
    app.state.limiter = Limiter()
    app.add_exception_handler(APIError, handler)

    @app.middleware("http")
    async def shield(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > 11 * 1024 * 1024:
            return JSONResponse({"error": "payload_too_large"}, status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Length", "Content-Type"],
    )

    @app.get("/healthz")
    def health():
        return {"status": "ok"}

    @app.get("/readyz")
    def ready(request: Request):
        db = request.app.state.sessions()
        try:
            ping(db)
        except Exception:
            return JSONResponse({"status": "down", "postgres": "down"}, status_code=503)
        finally:
            db.close()
        redis_state = "off"
        if request.app.state.redis is not None:
            try:
                request.app.state.redis.ping()
                redis_state = "ok"
            except Exception:
                redis_state = "down"
        return {"status": "ok", "postgres": "ok", "redis": redis_state}

    api = APIRouter(prefix="/api/v1", dependencies=[Depends(limit("api", 250, 60))])
    def version():
        return {"service": "growman", "version": "0.1.0"}

    api.add_api_route("/healthz", health, methods=["GET"])
    api.add_api_route("/debug/version", version, methods=["GET"])
    for group in (auth.router, catalog.router, checkout.router, orders.router, account.router, admin.router, extras.router):
        api.include_router(group)
    app.include_router(webhooks.router)
    app.include_router(api)
    app.mount("/uploads", StaticFiles(directory=str(UPLOADS)), name="uploads")
    app.mount("/metrics", make_asgi_app())
    return app


app = create_app()


def main() -> None:
    settings = Settings()
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.py_port, reload=not settings.prod)
