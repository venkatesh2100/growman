# System Design

This is the system-design view of the Growman backend: the problem it
solves, the shape of the solution, and the trade-offs behind that shape. The
other docs in this directory ([01](./01-architecture.md)–[11](./11-api-reference-docs.md))
explain *how* each part is implemented; this one explains *why* the system
looks the way it does, end to end.

## 1. What this system is

A single Go service that is the entire backend for an Indian plant-and-garden
e-commerce app: product catalog, cart/checkout, payments, order management,
user accounts, an AI plant-care chat assistant, plant photo identification,
and an internal admin dashboard. It's called by a Next.js web app and a
mobile app, both outside this repo.

**Scale & traffic shape.** Read-heavy: browsing and searching the catalog
vastly outnumbers writes (orders, reviews, profile edits). Traffic is
India-concentrated with predictable daily/seasonal patterns, not
global-follow-the-sun. This shape drives nearly every design choice below —
aggressive caching on reads, a single-writer relational database that isn't
under write pressure, and no need for multi-region active-active complexity.

## 2. Requirements

**Functional**
- Browse/search/filter a plant catalog (categories, brands, tags, free-text search).
- Cart → checkout → Razorpay payment → order confirmation, as a guest or a logged-in user.
- Authenticate via password, Google, Indian mobile OTP (MSG91), or Truecaller — converging on one `User` table.
- Track and manage orders; escalate delivery/refund issues to human support.
- An AI chat assistant that answers plant-care questions, surfaces relevant products, and can read the caller's own orders/wishlist when logged in.
- Identify a plant from a photo (Pl@ntNet).
- An admin surface: catalog CRUD, order status management, support-ticket triage, and a request-volume-by-region dashboard.

**Non-functional**
- **Low read latency** on the catalog — it's the majority of traffic and directly affects conversion.
- **Graceful degradation** — Redis, GCS, SMTP, the AI provider, and every third-party integration are all individually optional; losing one should degrade a feature, not take down the API.
- **Low operating cost** — free-tier-friendly choices where reasonable (e.g. Gemini's free-tier model as the default AI provider, a single small VM/container rather than a fleet).
- **India-specific correctness** — phone-number formats, ₹ currency, Razorpay (not Stripe), MSG91 (not Twilio).
- **Horizontal scalability of the API layer** — the service itself must be able to run as N stateless replicas behind a load balancer.

## 3. High-level architecture

```
                         ┌─────────────────────────┐
                         │   Web app / Mobile app   │
                         └────────────┬─────────────┘
                                      │ HTTPS / JSON
                                      ▼
                    ┌──────────────────────────────────┐
                    │            chi Router             │
                    │  RequestID → RealIP → Security-   │
                    │  Headers → Recoverer → Prometheus │
                    │  → Timeout → Throttle → Compress  │
                    │  → Logger → CORS → (per-route:    │
                    │  rate limit, JWT auth)             │
                    └────────────────┬───────────────────┘
                                     │
                                     ▼
                    ┌──────────────────────────────────┐
                    │      handlers.Handler (1 per      │
                    │      process; every route is a    │
                    │      method on it)                 │
                    └───┬──────────┬──────────┬─────────┘
                        │          │          │
           ┌────────────┘          │          └─────────────┐
           ▼                       ▼                         ▼
 ┌───────────────────┐  ┌────────────────────┐   ┌────────────────────────┐
 │  cache.Helper       │  │   GORM → Postgres   │   │  External HTTP clients │
 │  L1 (in-process)    │  │   (products, users,  │   │  Razorpay · MSG91 ·    │
 │  + L2 (Redis) +      │  │   orders, payments,  │   │  Truecaller · Google · │
 │  singleflight        │  │   ...)                │   │  OpenAI/Gemini ·       │
 └───────────────────┘  └────────────────────┘   │  Pl@ntNet · Cloudflare │
                                                    │  Analytics · SMTP       │
                                                    └────────────────────────┘
                                                              │
                                                              ▼
                                                   ┌────────────────────┐
                                                   │  Google Cloud       │
                                                   │  Storage (images)   │
                                                   └────────────────────┘
```

There is deliberately **no service/repository layer** between HTTP handlers
and GORM. For a codebase this size, an extra abstraction layer would mean
more files and more indirection for the same behavior — the kind of
boilerplate "clean architecture" is meant to avoid, not require. Handlers
call GORM directly; the handful of genuinely reusable pieces (query
builders in `query.go`, the auth-role check, the cache helper) are already
factored out as plain functions. See [§9](#9-trade-offs--where-this-would-need-to-change)
for when a layer would start paying for itself.

## 4. Component responsibilities

| Package | Owns |
|---|---|
| `internal/server` | The route table and the global middleware chain — the one place HTTP paths are wired to handler methods. |
| `internal/handlers` | Every endpoint's business logic. Organized by domain (`auth.go`, `products.go`, `checkout.go`, `payments.go`, `webhooks.go`, `orders.go`, `chat.go`, `plants.go`, `dashboard.go`, ...). |
| `internal/models` | The Postgres schema, as GORM structs. Source of truth for `AutoMigrate`. |
| `internal/cache` | Two-tier response cache + the `ServePublic`/`ServePrivate` HTTP helpers. |
| `internal/auth` | JWT issuance/parsing and the auth/admin middleware. |
| `internal/middlewares` | Security headers, rate limiting, IP resolution, request logging, Prometheus timing. |
| `internal/config` | Env-var configuration, with every integration optional. |
| `internal/db` | Postgres and Redis connection setup and pooling. |
| `internal/services` | Email (SMTP) and OTP (Redis + memory fallback) — used across auth, checkout, and password reset. |
| `internal/services/storage` | The image-storage abstraction (GCS today). |
| `internal/msg91`, `internal/truecaller`, `internal/phoneutil` | Phone-auth building blocks: MSG91 OTP client + throttle, Truecaller OAuth client, Indian phone-number normalization. |
| `internal/metrics` | Prometheus collectors for the `/metrics` scrape endpoint. |
| `internal/docs` | The embedded live API reference (Swagger/ReDoc) plus this narrative doc set. |
| `pkg/httpjson`, `pkg/pagination` | Dependency-free JSON and pagination helpers, kept outside `internal` by convention. |
| `seed` | Idempotent local dev sample data. |

Full detail on any of these lives in the correspondingly-named doc —
[02](./02-auth.md) for auth, [03](./03-catalog-and-search.md) for catalog,
[05](./05-orders-checkout-payments.md) for payments, and so on.

## 5. Data model

```
User ──< Review                       User ──< Order ──< OrderItem >── Product
  │                                              │
  │                                              └── Payment (1:1 per successful charge)
  └──< Wishlist >── Product

Category ──< Subcategory ──< Product ──< ProductSize
   │                            │
   │                            ├──< Attribute
Brand ─────────────────────────<┘   ├──< Review
                                     └──< OrderItem (name/image snapshotted at order time)

RequestedProduct        — standalone demand-signal table (chat- or form-sourced)
OrderSupportRequest     — standalone support-ticket table (chat-sourced), optionally linked to Order/User
```

Two patterns recur across the schema and are worth calling out because they
shape a lot of handler code:

- **Snapshot, don't reference, at order time.** `OrderItem` copies the
  product's name and image key rather than joining `Product` live — so an
  order's receipt stays accurate even if the product is later edited,
  repriced, or deleted.
- **Storage key vs. resolved URL.** Every image field is stored as a
  provider-agnostic key (`image_key`); the absolute URL is computed at read
  time from `IMAGE_BASE_URL`. See [07](./07-images-and-storage.md).

## 6. Request lifecycle — two concrete paths

**A cached catalog read** (`GET /products/{slug}`):
`router → GetProduct → cache.GetOrLoadRaw` checks the in-process map, then
Redis; on a full miss, `singleflight` ensures only one concurrent caller
actually queries Postgres — `loadProductDetail` fans the product's
associations (sizes, attributes, reviews, category, subcategory, brand) out
over `errgroup` goroutines instead of five sequential GORM preloads, because
each round trip costs real latency against a remote database. The result is
written back through both cache tiers and served with an `ETag` so an
unchanged client request short-circuits to a `304`.

**A checkout write** (`POST /checkout/create-order` → `POST /razorpay/verify`):
create-order validates the shipping address and every line item
(`buildOrderItems`, shared with the legacy `/razorpay/order` endpoint) in
one batched query per entity — never N+1 — then creates the order in
Razorpay before persisting the local `Order`+`OrderItem` rows. Once the
client completes payment, `verify` (or, independently, Razorpay's own
webhook — see below) calls `markOrderPaid`, which is intentionally
idempotent: both the client-driven verify call and the server-to-server
webhook can race to confirm the same payment, and only the first is allowed
to trigger the confirmation email and merchant alert.

## 7. Caching strategy

Detailed in [04](./04-caching.md); the short version, and why:

- **L1 (in-process) + L2 (Redis)**, because a Redis round trip — even a fast
  one — costs more than a map lookup, and hot catalog keys are read on
  nearly every request.
- **`singleflight`-coalesced loads**, because a cache entry expiring under
  load is exactly when a "thundering herd" of duplicate DB queries is most
  costly — coalescing collapses N concurrent misses into 1 DB query.
- **Redis is optional everywhere it's used for caching or rate limiting** —
  a `nil` Redis client makes `cache.Helper` fall back to L1-only and makes
  rate limiters fail open. The one deliberate exception is phone-OTP
  throttling, which requires Redis's atomicity to enforce send caps
  correctly and returns `503` without it.
- **TTLs are tuned per resource volatility**, not uniform: a single
  product's detail page (30 min) changes less often than a list/search
  result (5–10 min), which changes less often than a user's order list
  (2 min, since status updates are the whole point of checking it).

## 8. Reliability: what happens when a dependency is down

| Dependency down | Effect |
|---|---|
| **Redis** | Caching and rate limiting fail open (slower, unlimited — not broken). Phone-OTP send returns 503 (the one hard dependency). |
| **Google Cloud Storage** | Image uploads return 500; already-stored `image_key`s just resolve to empty `ImageURL`s instead of erroring — the API stays usable without pictures. |
| **SMTP** | OTP-email and password-reset endpoints return 503 up front (checked before attempting to send); order-confirmation/merchant-alert emails are fire-and-forget goroutines, so a payment still succeeds even if the confirmation email fails. |
| **OpenAI/Gemini** | Chat falls back to canned, keyword-matched plant-care answers (`getFallbackResponse`) — never a 500, never a blank response. |
| **Razorpay** | Checkout/payment endpoints fail loudly (500/502) — there's no safe fallback for a payment provider being down, and there shouldn't be. |
| **MSG91 / Truecaller / Google OAuth / Pl@ntNet / Cloudflare Analytics** | Each returns a scoped 503/502/400 from only the endpoints that need it; unrelated endpoints are unaffected because none of these are constructed unless configured. |
| **Postgres** | Not optional. Every handler needs it; the server won't boot without a working `DATABASE_URL`/`HYPERDRIVE_URL`. |

The pattern underneath all of this: **construct optional dependencies once
at boot as `nil`-or-real, and let every call site's zero-value behavior be
"degrade this one feature," never "crash."**

## 9. Security model

- **AuthN**: HS256 JWTs (`internal/auth`), 24h TTL, with a `Scope` claim
  (`full`/`onboarding`) that lets a brand-new phone/Truecaller signup get a
  token immediately while restricting it to the profile-completion endpoint
  until a name is set.
- **AuthZ**: role check (`admin`/`superadmin`) via `appauth.IsAdminRole`,
  applied either as router-level middleware (product/image mutations) or as
  an inline guard at the top of a handler (order/support/dashboard admin
  actions) — both paths go through the same one function, not duplicated
  string comparisons.
- **Payment integrity**: HMAC-SHA256 signatures verify the Razorpay
  *webhook* (rejected on mismatch) and are checked (logged, not yet
  rejected) on the client-driven *verify* call — see
  [05](./05-orders-checkout-payments.md) for the current, intentionally
  documented gap.
- **Transport/headers**: HSTS, `X-Frame-Options: DENY`, `nosniff`, a
  locked-down `Permissions-Policy`, and no CSP (a pure JSON API has nothing
  for a CSP to protect).
- **Abuse control**: per-route Redis rate limits (tighter on auth/checkout/
  chat/plant-ID than general reads), plus MSG91-specific per-number/per-IP
  OTP throttling on top.
- **Secrets**: environment variables only, loaded once at boot; nothing is
  hardcoded, and production refuses to boot on a default/empty `JWT_SECRET`.

## 10. Scalability

- **The API layer is stateless** — no in-process session state beyond the
  L1 cache (which is a *cache*, safe to lose or diverge across replicas).
  This means `cmd/server` can run as any number of horizontally-scaled
  replicas behind a load balancer with no coordination needed beyond
  sharing the same Postgres and Redis.
- **The database connection pool is the practical ceiling** —
  `DB_MAX_OPEN_CONNS` (default 40) per replica, tuned rather than
  unbounded, because Postgres connections are the scarcer resource. Scaling
  replica count further eventually means scaling this budget or adding
  PgBouncer in front, not a code change here.
- **Reads scale via caching, not database replicas** — the two-tier cache
  absorbs the overwhelming majority of catalog read traffic before it ever
  reaches Postgres, which is why this system doesn't need (and doesn't
  have) read replicas at its current scale.
- **Direct Postgres over Hyperdrive from this process** — Hyperdrive
  (Cloudflare's connection-pooling proxy) is designed for short-lived
  edge/Worker connections; a long-running Go process gets *worse* latency
  through it than connecting directly, so `db.Connect` prefers
  `DATABASE_URL` and only falls back to `HYPERDRIVE_URL`.
- **Background work never blocks a request** — every non-critical side
  effect (confirmation emails, merchant alerts, silent plant-photo uploads)
  runs in a goroutine, so slow downstream calls (SMTP, GCS) can't add to
  response latency.

## 11. Trade-offs — where this would need to change

Documented deliberately, not accidentally:

- **No repository/service layer.** Correct trade-off *today* — this domain
  has one data store and one consumer of each query shape. It would stop
  being correct if: multiple handler families needed the same complex
  business query with independently-evolving business rules, or the
  project needed to swap GORM/Postgres for something else. Neither is true
  yet; introducing the layer earlier would just be indirection with no
  payoff.
- **Two order-creation endpoints** (`/checkout/create-order` and the
  legacy `/razorpay/order`) share validation via `buildOrderItems`
  (`internal/handlers/payments.go`) but remain separate routes for backward
  compatibility. Retiring the legacy one is a frontend-coordination task,
  not a backend blocker.
- **Payment signature verification is advisory on the client-driven verify
  path** (logged, not rejected) while the webhook path enforces it. This is
  a real gap, called out rather than silently "fixed" by this pass — see
  [05](./05-orders-checkout-payments.md) — because tightening it changes
  production payment behavior and deserves its own deliberate rollout.
- **No integration test suite.** Unit tests cover the pure-logic packages
  (`auth`, `cache`, `middlewares`, `docs`); handler behavior is currently
  verified manually against the deployed frontend. The handlers are already
  structured to make this addable later — GORM's `*gorm.DB` and the cache's
  `*redis.Client` are both nil-able/swappable, and `handlers.New` takes them
  as plain constructor arguments rather than reaching for globals.
- **Single-region, single-primary Postgres.** Appropriate for the traffic
  shape in [§1](#1-what-this-system-is); would need read replicas and/or
  regional caching before it'd be appropriate for global, write-heavy
  traffic.

## 12. Deployment topology

```
cmd/server binary  →  Postgres (schema owned by AutoMigrate)
                    →  Redis (cache + rate limits + OTP; optional)
                    →  Google Cloud Storage (images; optional)
                    →  Prometheus scrapes /metrics  →  Grafana dashboards
```

`docker-compose.yml` (repo root) runs Postgres, Redis, Prometheus, and
Grafana for local development; `cmd/server` itself is typically run
directly with `go run`/a compiled binary rather than in that compose stack.
Configuration is 100% environment-variable driven
([01](./01-architecture.md#config)), so the same binary runs unmodified in
dev, staging, and production.

## 13. If you're extending this system

- **New payment provider**: mirror the Razorpay pattern in `payments.go` —
  an HTTP client function, a webhook handler verified by that provider's
  signature scheme, and the shared `markOrderPaid`/`notifyOrderPaid` pair so
  order-confirmation logic isn't duplicated per provider.
- **New storage provider**: implement `storage.StorageProvider`
  (`Upload`/`Delete`/`Exists`) and branch on it in
  `storage.NewStorageProvider` — `ImageService` and every handler that calls
  it are already provider-agnostic.
- **New auth method**: converge on `models.User` the way phone-OTP and
  Truecaller both do via `findOrCreateByPhone` (`auth.go`) — look up by
  every known identifier variant, create if missing, and decide the JWT
  scope from whether the user has a name yet.
- **A query shape reused by 3+ handlers**: that's the signal to promote it
  from a handler-local query into `query.go`, the way `productCardQuery`
  and `applyOrderFilters` already are — not a signal to introduce a
  repository layer for the whole codebase.
