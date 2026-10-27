"""Fixed-window rate limits.

Catalogue reads fail open: if Redis is down, serve the shop. Login, OTP,
checkout, chat, and plant identification fail closed, because those
requests spend money or guard a password. Failing closed does not mean
"reject everyone". It means fall back to a counter in this process.

That counter is worse than Redis: N replicas means N times the limit,
and the windows are not aligned. N times a budget is still a budget.
Unlimited is not.
"""

from __future__ import annotations

import logging
import threading
import time

from fastapi import Request

from app.errors import APIError

log = logging.getLogger("growman.ratelimit")

_LUA = """
local n = redis.call("INCR", KEYS[1])
if n == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return n
"""


class LocalLimiter:
    def __init__(self) -> None:
        self._mu = threading.Lock()
        self._counts: dict[str, int] = {}
        self._reset: dict[str, float] = {}

    def incr(self, key: str, window: int) -> int:
        now = time.monotonic()
        with self._mu:
            reset = self._reset.get(key, 0)
            if now >= reset:
                self._counts[key] = 0
                self._reset[key] = now + window
                if len(self._counts) > 10000:
                    stale = [k for k, r in self._reset.items() if now >= r]
                    for k in stale:
                        self._counts.pop(k, None)
                        self._reset.pop(k, None)
            self._counts[key] = self._counts.get(key, 0) + 1
            return self._counts[key]


_local = LocalLimiter()


def client_ip(request: Request) -> str:
    # The first X-Forwarded-For hop is the client when a trusted proxy
    # appended the rest. Do not deploy this behind an untrusted proxy.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    if request.client:
        return request.client.host
    return "unknown"


def limit(name: str, max_hits: int, window_seconds: int, *, fail_closed: bool):
    """Dependency factory. One bucket per IP, named so keys do not collide."""

    async def _dep(request: Request):
        ident = client_ip(request)
        key = f"rl:{name}:{ident}"
        redis = getattr(request.app.state, "redis", None)
        count: int | None = None
        if redis is not None:
            try:
                count = int(redis.eval(_LUA, 1, key, window_seconds))
            except Exception as exc:  # noqa: BLE001
                log.warning("rate limit redis %s: %s", name, exc)
                count = None
        if count is None:
            if not fail_closed:
                return
            count = _local.incr(key, window_seconds)
        remaining = max(max_hits - count, 0)
        request.state.rate_limit = (max_hits, remaining)
        if count > max_hits:
            raise APIError(429, "rate_limited", retry_after=window_seconds)

    return _dep
