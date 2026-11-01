# Caching

Say this first: public catalog GETs use memory, then Redis, then one database load shared by every waiter. Checkout, payments, and a single order are not cached. Redis down means the shop still reads Postgres.

## The helper

`internal/cache/cache.js` `CacheHelper`:

```
request -> L1 Map (about 2 minutes, max 4096 keys)
        -> Redis (resource TTL, 5–30 minutes)
        -> singleflight: one load(), everyone else waits
        -> fill Redis, fill L1
```

Why L1: a hot product should not pay a Redis round trip on every hit. Why it expires sooner than Redis: a stock edit should show up on this process within about two minutes even if a delete was missed. Why the cap is 4096 with a cheap eviction, not LRU: the map is already short-lived. LRU bookkeeping costs more than it saves.

Why singleflight: when a key expires under load, 50 requests must not run 50 product queries. `inflight` is a Map of promises keyed by the cache key. The Go version uses `singleflight`. This is the same idea.

A null Redis client is L1 only. A Redis error is a miss, not a 500.

## TTLs, and why they differ

| Key | TTL | Why |
|---|---|---|
| Product detail | 30 min | The description changes rarely. Stock still moves. Invalidation on admin write is the real update. The TTL is the backstop |
| Featured, lists, search | 5–10 min | Lists change when anything is added |
| Category detail | 15 min | Nav is stable |
| Brands | 15 min | Almost static |
| In-process copy | 2 min | Bounds staleness per process |
| Dootha answer, in Python | 10 min | Only when there is no chat history |
| Care sheet after a photo | 14 days | Species care does not change daily. Stored by Node, not by the model |

## What is not cached, and why

Checkout, Razorpay verify, webhooks, OTP, wishlist mutations, and `GET` of one order. Caching those would replay a side effect or show another user’s order. Order list pages can be cached briefly per user because the key includes the user id and the filters. The body is private. `servePublic` is only for catalog JSON.

## HTTP cache

`servePublic` sets `Cache-Control: public, max-age=120` and an `ETag` (SHA of the body). `If-None-Match` returns 304. That lets a browser or Cloudflare keep the JSON. `servePrivate` is `no-store` for anything tied to a person.

Alternative: cache only at the CDN and skip Redis. Then every app instance misses together after a purge. The in-process plus Redis pair absorbs that. Alternative: cache stock in Redis as the counter. Rejected. Stock is a Postgres conditional update.

## Interview line

“I cache the read that dominates traffic, I coalesce the miss, and I never cache the write that moves money.”
