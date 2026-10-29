"""Postgres. Handlers ask for a session; they do not open connections."""

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings


def engine_for(settings: Settings):
    return create_engine(
        settings.db_url,
        pool_pre_ping=True,
        pool_size=min(settings.db_max_open_conns, 20),
        max_overflow=max(settings.db_max_open_conns - 20, 0),
    )


def sessions_for(engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db(request: Request) -> Iterator[Session]:
    db: Session = request.app.state.sessions()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def ping(db: Session) -> None:
    db.execute(text("SELECT 1"))
