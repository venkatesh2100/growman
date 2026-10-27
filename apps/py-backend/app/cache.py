"""Two-tier cache: process memory, then Redis, with stampede protection.

A catalog read is the common request. A Redis round trip costs more than
a dict lookup, so hot keys live in the process (L1) for two minutes and
in Redis (L2) for the resource TTL.

When a key expires under load, every concurrent request would otherwise
query Postgres. ``singleflight`` collapses those misses into one load.
Redis may be missing: L1 alone is slower and not shared across replicas,
but it is still correct. Nothing that gates a write is cached here.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future

log = logging.getLogger("growman.cache")

LOCAL_TTL = 120
LOCAL_MAX = 4096


class Cache:
    def __init__(self, redis_client=None):
        self.redis = redis_client
        self._local: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
        self._mu = threading.Lock()
        self._flight: dict[str, Future] = {}
        self._flight_mu = threading.Lock()

    def get_raw(self, key: str) -> bytes | None:
        now = time.monotonic()
        with self._mu:
            item = self._local.get(key)
            if item and item[0] > now:
                self._local.move_to_end(key)
                return item[1]
            if item:
                self._local.pop(key, None)
        if self.redis is None:
            return None
        try:
            raw = self.redis.get(key)
        except Exception as exc:  # noqa: BLE001 — a cache miss is not an outage
            log.debug("redis get %s: %s", key, exc)
            return None
        if not raw:
            return None
        data = raw if isinstance(raw, bytes) else raw.encode()
        self._remember(key, data, LOCAL_TTL)
        return data

    def set_raw(self, key: str, data: bytes, ttl: float) -> None:
        if not data:
            return
        self._remember(key, data, min(LOCAL_TTL, ttl) if ttl else LOCAL_TTL)
        if self.redis is None:
            return

        def _write() -> None:
            try:
                self.redis.set(key, data, ex=max(int(ttl), 1))
            except Exception as exc:  # noqa: BLE001
                log.debug("redis set %s: %s", key, exc)

        # The response already has the value in L1. Do not make the
        # client wait on a Redis write.
        threading.Thread(target=_write, daemon=True).start()

    def get_or_load(self, key: str, ttl: float, load) -> bytes:
        """Return cached bytes, or call ``load`` once for this key."""
        hit = self.get_raw(key)
        if hit is not None:
            return hit

        with self._flight_mu:
            fut = self._flight.get(key)
            leader = fut is None
            if leader:
                fut = Future()
                self._flight[key] = fut
        if not leader:
            return fut.result()

        try:
            # Another leader may have filled L1 while we waited for the lock.
            again = self.get_raw(key)
            if again is not None:
                fut.set_result(again)
                return again
            raw = load()
            if not isinstance(raw, bytes):
                raw = json.dumps(raw).encode()
            self.set_raw(key, raw, ttl)
            fut.set_result(raw)
            return raw
        except Exception as exc:
            fut.set_exception(exc)
            raise
        finally:
            with self._flight_mu:
                self._flight.pop(key, None)

    def delete(self, *keys: str) -> None:
        with self._mu:
            for key in keys:
                self._local.pop(key, None)
        if self.redis is not None and keys:
            try:
                self.redis.delete(*keys)
            except Exception as exc:  # noqa: BLE001
                log.debug("redis delete: %s", exc)

    def delete_prefix(self, prefix: str) -> None:
        with self._mu:
            doomed = [k for k in self._local if k.startswith(prefix)]
            for key in doomed:
                self._local.pop(key, None)
        if self.redis is None:
            return
        try:
            # SCAN, not KEYS: KEYS blocks the Redis server on large keyspaces.
            cursor = 0
            while True:
                cursor, found = self.redis.scan(cursor=cursor, match=prefix + "*", count=200)
                if found:
                    self.redis.delete(*found)
                if cursor == 0:
                    break
        except Exception as exc:  # noqa: BLE001
            log.debug("redis scan %s: %s", prefix, exc)

    def invalidate_catalog(self) -> None:
        for prefix in ("products:", "categories:"):
            self.delete_prefix(prefix)
        self.delete("brands:all", "tags:all", "catalog:nav")

    def _remember(self, key: str, data: bytes, ttl: float) -> None:
        with self._mu:
            self._local[key] = (time.monotonic() + ttl, data)
            self._local.move_to_end(key)
            while len(self._local) > LOCAL_MAX:
                self._local.popitem(last=False)
