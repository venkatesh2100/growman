"""Request-scoped database session.

Handlers receive a ``Session`` and query it. There is no repository in
between. The session commits when the handler returns and rolls back when
it raises, including ``APIError``.
"""

from __future__ import annotations

from fastapi import Request


def get_db(request: Request):
    db = request.app.state.session_factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
