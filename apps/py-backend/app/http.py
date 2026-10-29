"""HTTP details that every route shares: errors, pages, and rate limits.

The body is {"error": "..."} so the web app can read it directly.
A limit is fail-open for browsing and fail-closed for login, checkout,
chat, and plant identify: if Redis is down, those fall back to a counter
in this process instead of becoming unlimited.
"""

import threading
import time

from fastapi import Request
from starlette.responses import JSONResponse


class APIError(Exception):
    def __init__(self, status: int, error: str, **extra):
        self.status = status
        self.body = {"error": error, **extra}


def handler(_request, exc: APIError) -> JSONResponse:
    return JSONResponse(exc.body, status_code=exc.status)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def page_of(page: int, page_size: int, total: int) -> dict:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    pages = max(1, -(-total // page_size)) if total else 0
    return {
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": pages,
        "hasNext": page < pages,
        "hasPrev": page > 1,
    }


class Limiter:
    def __init__(self) -> None:
        self._hits: dict[str, tuple[float, int]] = {}
        self._lock = threading.Lock()

    def allow(self, redis, name: str, ip: str, limit: int, window: int, closed: bool) -> None:
        key = f"rl:{name}:{ip or 'unknown'}"
        if redis is not None:
            try:
                count = int(redis.incr(key))
                if count == 1:
                    redis.expire(key, window)
                if count > limit:
                    raise APIError(429, "rate_limited")
                return
            except APIError:
                raise
            except Exception:
                if not closed:
                    return
        self._local(key, limit, window)

    def _local(self, key: str, limit: int, window: int) -> None:
        now = time.monotonic()
        with self._lock:
            start, count = self._hits.get(key, (now, 0))
            if now - start >= window:
                start, count = now, 0
            count += 1
            self._hits[key] = (start, count)
        if count > limit:
            raise APIError(429, "rate_limited")


def limit(name: str, hits: int, window: int, closed: bool = False):
    def dep(request: Request) -> None:
        request.app.state.limiter.allow(
            request.app.state.redis, name, client_ip(request), hits, window, closed
        )

    return dep
