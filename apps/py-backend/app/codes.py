"""Short-lived secrets: OTP codes and guest-checkout proofs.

Redis when it is up. This process otherwise, so a single dev server
still works. Stored value is a hash, so a dump of Redis is not the code.
"""

import hashlib
import hmac
import threading
import time


class Box:
    def __init__(self) -> None:
        self._mem: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()

    def put(self, redis, key: str, value: str, ttl: int) -> None:
        if redis is not None:
            try:
                redis.setex(key, ttl, value)
                return
            except Exception:
                pass
        with self._lock:
            self._mem[key] = (time.time() + ttl, value)

    def get(self, redis, key: str) -> str:
        if redis is not None:
            try:
                raw = redis.get(key)
                if raw:
                    return raw.decode() if isinstance(raw, bytes) else raw
            except Exception:
                pass
        with self._lock:
            row = self._mem.get(key)
            if not row or row[0] < time.time():
                self._mem.pop(key, None)
                return ""
            return row[1]

    def drop(self, redis, key: str) -> None:
        if redis is not None:
            try:
                redis.delete(key)
            except Exception:
                pass
        with self._lock:
            self._mem.pop(key, None)


def _digest(value: str) -> str:
    return hashlib.sha256(value.strip().encode()).hexdigest()


def save(box: Box, redis, key: str, secret: str, ttl: int) -> None:
    box.put(redis, key, _digest(secret), ttl)


def take(box: Box, redis, key: str, secret: str) -> bool:
    current = box.get(redis, key)
    if not current or not hmac.compare_digest(current, _digest(secret)):
        return False
    box.drop(redis, key)
    return True
