"""Postgres connection, schema creation, and the search indexes.

There is no repository class. Handlers open a ``Session`` and query it.
That is a deliberate match of the Go service: one database, one consumer
of each query, so an extra layer would only add files.
"""

from __future__ import annotations

import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.models import Base

log = logging.getLogger("growman.db")

_SEARCH_INDEXES = (
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",
    "CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS idx_products_short_desc_trgm ON products USING gin (short_desc gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS idx_products_tags_gin ON products USING gin (tags)",
    "CREATE INDEX IF NOT EXISTS idx_products_slug_alive ON products (slug) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_products_featured_created ON products (created_at DESC) WHERE featured = true AND deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_reviews_approved ON reviews (product_id, created_at DESC) WHERE status = 'approved' AND deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_orders_unpaid_created ON orders (created_at) WHERE payment_status = 'created' AND inventory_released = false AND deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_coupons_code_active ON coupons (code) WHERE active = true AND deleted_at IS NULL",
)


def make_engine(settings: Settings):
    # The pool size is the practical ceiling. Postgres connections are
    # scarcer than API processes, so this stays bounded per replica.
    return create_engine(
        settings.sqlalchemy_url,
        pool_size=min(settings.db_max_open_conns, 20),
        max_overflow=max(settings.db_max_open_conns - 20, 0),
        pool_pre_ping=True,
        pool_timeout=10,
    )


def make_session_factory(engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def migrate(engine) -> None:
    Base.metadata.create_all(engine)
    ensure_indexes(engine)


def ensure_indexes(engine) -> None:
    # A local Postgres without permission to CREATE EXTENSION should still
    # boot. The queries fall back to a sequential scan, which is fine for dev.
    with engine.begin() as conn:
        for stmt in _SEARCH_INDEXES:
            try:
                conn.execute(text(stmt))
            except Exception as exc:  # noqa: BLE001 — index setup must not block boot
                log.warning("search index skipped: %s", exc)


def session_scope(factory: sessionmaker[Session]):
    """Commit on success, roll back on any error, always close.

    Request handlers use this as a FastAPI dependency. Background workers
    call it directly because they have no request.
    """
    db = factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
