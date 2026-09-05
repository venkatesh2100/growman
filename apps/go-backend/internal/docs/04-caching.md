# Caching

Almost every public GET endpoint in this API is cached. The design goal is:
serve hot reads without hitting Postgres, survive Redis being slow/down
without failing requests, and avoid a "thundering herd" of duplicate DB
queries when a cache entry expires under load.

## `cache.Helper` — two-tier cache (`internal/cache/cache.go`)

```
Request → L1 (in-process map, ~2 min TTL, capped at 4096 keys)
              │ miss
              ▼
          L2 (Redis, resource-specific TTL, e.g. 5–30 min)
              │ miss
              ▼
          singleflight-coalesced DB load → populate L2 (async) → populate L1
```

- **L1** (`Helper.local`, guarded by `sync.RWMutex`) exists purely to avoid a
  Redis round trip on every request for very hot keys. It's capped at 4096
  entries; when full, it first sweeps expired entries, and if still full,
  evicts an arbitrary ~12.5% (`localMaxKeys/8`) rather than doing real LRU —
  a deliberately cheap eviction strategy for a cache that's already
  short-lived (2 minutes).
- **L2** (Redis) reads use a **120ms** timeout (`redisGetWait`); writes are
  **fire-and-forget in a background goroutine** with a 200ms timeout
  (`redisSetWait`) — a slow Redis write never blocks the response, since the
  value is already in L1 by then.
- **`GetOrLoadRaw(ctx, key, ttl, load)`** is the core pattern used by nearly
  every handler: check cache, and on a miss, run `load()` **inside a
  `golang.org/x/sync/singleflight` group keyed by the cache key** — so if 50
  concurrent requests miss the same cache key at once, only one of them
  actually queries Postgres; the other 49 wait on the same in-flight call and
  share its result. This is the stampede protection mentioned throughout the
  handler code.
- A `Helper` with a `nil` Redis client still works — `GetRaw`/`SetRaw`
  transparently become L1-only. A `nil` `*Helper` itself is also safe to call
  methods on (every method nil-checks `c`), so handlers never need to branch
  on whether caching is configured.

## Where caching is (and isn't) applied

**Public, cached** (via `GetOrLoadRaw` + `cache.ServePublic`): product list/
detail/search/featured/related, category list/detail/subcategories/products,
brands, tags, catalog nav. TTLs are named constants in `cache.go`
(`FeaturedProductsTTL` 10m, `AllProductsTTL` 5m, `ProductDetailTTL` 30m,
`CategoryDetailTTL` 15m, etc.) — product *lists* have shorter TTLs than
individual product *details* since lists change more often (new products,
stock/status edits) while a single product's core content changes less.

**Private, cached, shorter TTL** (`ListOrders`, `internal/handlers/orders.go`):
manually caches the page **and its total count as two separate keys**
(`cacheHelper.Get`/`Set` directly, not `GetOrLoadRaw`), scoped by
`user:<id>` or `admin:all` plus every filter (status/orderId/search/page/
size) baked into the key. 2-minute TTL for the page, 5 for the total — orders
change often (status updates) so this is intentionally short-lived, mostly to
absorb repeated polling/refreshes rather than to serve stale data for long.

**Not cached**: anything requiring a JWT-scoped, frequently-changing, or
side-effecting result — `GetOrder` (single order by ID), wishlist, chat, OTP
endpoints, checkout/payment endpoints, admin dashboard map (which hits
Cloudflare Analytics directly).

## `ServePublic` vs `ServePrivate` (`cache.go`)

- **`ServePublic(w, r, raw)`** — sets `Cache-Control: public, max-age=120,
  stale-while-revalidate=300`, an `ETag` (FNV-1a hash of the body,
  `etagOf`), and honors `If-None-Match` with a `304`. This lets a CDN/browser
  in front of the API cache responses too, layered on top of the
  server-side Redis/L1 cache.
- **`ServePrivate(w, raw)`** — `Cache-Control: private, no-store`, no ETag.
  For user-specific data that must never be cached by a shared cache.
  `ListOrders` doesn't use it today (it serves via plain `httpjson.JSON`);
  since responses to a request carrying `Authorization` are already
  excluded from shared caches by default (RFC 7234) unless explicitly
  allowed, this is a latent option rather than a live gap — worth wiring up
  explicitly only if a CDN/shared cache is ever placed in front of `/orders`.

## Cache keys

Prefixes are centralized as constants (`KeyPrefixFeaturedProducts`,
`KeyPrefixProductDetail`, etc.) so invalidation code and read code can't drift
independently. List/paginated endpoints append page/size (and for search, a
`cache.HashKey(query)` — a truncated SHA-1 — to keep the key short and safe
regardless of query content) to the prefix.

## Invalidation

**`h.invalidateCatalog(ctx)`** (`internal/handlers/query.go`) is the one
invalidation entry point, wired into `CreateProduct`/`UpdateProduct`/
`DeleteProduct`. It wildcard-deletes `products:*` and `categories:*`, plus
the standalone `brands`/`tags`/`catalog` keys — broad rather than surgical
(a per-slug `InvalidateProductDetail` would touch fewer keys per edit), but
simple and cheap enough at this traffic volume that the extra precision
isn't worth the extra code: `DeletePattern` is a non-blocking Redis
`SCAN`+`UNLINK` loop, harmless to call broadly.

`DeletePattern` clears both the local L1 map (prefix-matched in-process, no
Redis round trip needed) and Redis (`SCAN` in batches of 200, `UNLINK` —
non-blocking delete — on each batch).

`ListOrders`'s cache uses the same `DeletePattern(ctx, "orders:*")` after any
`UpdateOrderStatus`/`UpdateOrderExpectedDeliveryDate` — broad but simple: any
order mutation invalidates every cached order-list page for every user/admin,
rather than tracking which cached pages a given order could appear in.
