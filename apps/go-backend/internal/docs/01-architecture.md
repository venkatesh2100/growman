# Architecture

## Project layout

```
apps/go-backend/
├── cmd/
│   ├── server/main.go      # HTTP server entrypoint
│   └── migrate/main.go     # standalone "run AutoMigrate and exit" binary
├── internal/
│   ├── auth/           # JWT issuing/parsing + HTTP auth middleware
│   ├── cache/          # two-tier (in-process + Redis) cache helper
│   ├── config/         # env-var configuration loader
│   ├── db/             # Postgres (GORM) + Redis connection setup
│   ├── docs/           # embedded OpenAPI/Swagger/ReDoc + these .md files
│   ├── fulfillment/    # delivery zones, channels and fee policy
│   ├── handlers/       # all HTTP handlers (the bulk of business logic)
│   ├── metrics/        # Prometheus registration + middleware hook
│   ├── middlewares/    # security headers, rate limiting, logging, IP
│   ├── models/         # GORM models (Postgres schema as Go structs)
│   ├── msg91/          # MSG91 phone-OTP HTTP client + throttling
│   ├── phoneutil/      # Indian phone-number normalization helpers
│   ├── server/         # chi router assembly (route table)
│   ├── services/       # email (SMTP), OTP (Redis-backed), invoice PDF, storage/
│   ├── shiprocket/     # Shiprocket client: serviceability + shipment booking
│   └── truecaller/     # Truecaller OAuth client
├── pkg/
│   ├── httpjson/       # JSON response/decode helpers
│   └── pagination/     # page/pageSize query parsing + meta
├── migrations/         # hand-written SQL scripts (see doc 10)
├── seed/               # dev-only sample data seeder
└── docker-compose.yml (repo root)   # Postgres/Redis/Prometheus/Grafana for local dev
```

`internal/` vs `pkg/`: `pkg/httpjson` and `pkg/pagination` are small, dependency-free
utilities with no ties to this service's domain — they're kept outside `internal`
mostly by convention, not because anything external imports them (this is a
single-module app, not a shared library).

## Boot sequence (`cmd/server/main.go`)

1. **`config.Load()`** — reads env vars (optionally from a `.env` file via
   `godotenv`), applies defaults, and fails fast if `DATABASE_URL`/`HYPERDRIVE_URL`
   or a production `JWT_SECRET` are missing. See [Config](#config) below.
2. **`db.Connect(cfg)`** — opens the GORM/Postgres connection, tunes the pool,
   and pings a few connections to warm it up.
3. **`db.ConnectRedis(cfg)`** — optional. Returns `nil` (not an error) if
   `REDIS_URL` is unset or Redis is unreachable — the whole app is designed to
   degrade gracefully without Redis (see [04-caching.md](./04-caching.md)).
4. **`storage.NewImageServiceFromConfig(cfg)`** — optional. Only constructed if
   `IMAGE_BASE_URL` is set; wraps a Google Cloud Storage client. If it fails to
   init, the server logs and continues with uploads disabled rather than
   crashing.
5. **`handlers.New(dbConn, cfg, rdb, imageService)`** — builds the single
   `*handlers.Handler` used by every route. It also constructs the
   Shiprocket client (`shiprocket.New`), which returns `nil` when no
   courier credentials are set, so delivery quoting falls back to the
   static fee bands and shipment booking is simply absent.
6. **`h.AutoMigrate()`** — runs if `AUTO_MIGRATE=true` (default). See
   [10-database-and-migrations.md](./10-database-and-migrations.md).
7. **`seed.EnsureSampleData(dbConn)`** — runs only if `SEED_ON_STARTUP=true`
   (default `false`). Idempotent (`FirstOrCreate`), safe to leave on in dev.
8. **Background workers** — three tickers start here, *before* the
   listener, because the work they do is not request-driven (the inventory
   sweep in particular has to run even if no request ever arrives). See
   [Background workers](#background-workers) below.
9. **`server.NewRouter(h, cfg)`** — assembles the chi router (see below).
10. Starts `http.Server` with conservative timeouts (`ReadHeaderTimeout: 5s`,
    `ReadTimeout: 30s`, `WriteTimeout: 60s`, `IdleTimeout: 90s`,
    `MaxHeaderBytes: 64KiB`) and a goroutine that, on `SIGINT`/`SIGTERM`,
    cancels the worker context first and then calls `srv.Shutdown` with a
    10s grace period. Once `ListenAndServe` returns, the connection pool is
    closed explicitly — the workers' transactions have already been
    cancelled by then, so there is nothing left to wait for and leaving
    sockets open only delays container exit.

`cmd/migrate/main.go` reuses the same `config.Load` → `db.Connect` →
`handlers.New` → `h.AutoMigrate()` sequence as a one-shot binary, for
environments that run migrations as a separate deploy step instead of
`AUTO_MIGRATE=true` on every boot.

## Background workers

Three tickers run inside the server process rather than as separate cron
jobs or containers. They need the same `*handlers.Handler` — the same DB
pool, the same Shiprocket client, the same email service — and the work is
small enough that a second deployable would be more operational surface
than it saves.

| Worker | Interval | Owns |
|---|---|---|
| `h.StartInventorySweeper(ctx, 5*time.Minute)` | 5 minutes | Returns stock held by orders that were created but never paid (`SweepAbandonedOrders`, `internal/handlers/inventory.go`) |
| `h.StartShipmentWorker(ctx, 15*time.Minute)` | 15 minutes | Books shipments for paid courier orders, refreshes tracking as a backstop for missed webhooks, and sends post-delivery review requests (`internal/handlers/shipments.go`) |
| `h.StartRetentionSweeper(ctx)` | 24 hours | Enforces DPDP purpose-limited retention (`SweepExpiredData`, `internal/handlers/privacy.go`) |

All three take the **same** `context.Context`, created with
`context.WithCancel` in `main.go` and cancelled by the signal handler
before `srv.Shutdown` is called. The ordering is the point: each worker
runs database transactions on its own schedule, and a worker still holding
a query while the pool is closing is a noisy, entirely avoidable crash on
every deploy. Cancelling the shared context first means every ticker has
returned before the pool is touched.

`StartShipmentWorker` returns immediately when `h.Shiprocket` is `nil`, so
a deployment without courier credentials has no shipment automation rather
than a ticker logging the same failure every fifteen minutes.

## Config

`internal/config/config.go` defines a single `Config` struct populated purely
from environment variables (`os.Getenv`, with `getenv`/`getenv Int`/
`firstNonEmpty` helper wrappers for defaults). Notable behavior:

- **Hyperdrive vs direct DB URL**: `HYPERDRIVE_URL` (Cloudflare Hyperdrive, used
  when this backend is deployed alongside Cloudflare Workers) is preferred by
  the config validation, but `db.Connect` actually **prefers `DATABASE_URL`**
  and falls back to `HYPERDRIVE_URL` — going through Hyperdrive from a
  long-running Go process/VM adds multi-second latency per query that direct
  Postgres doesn't have.
- **Production guardrails**: when `GO_ENV`/`APP_ENV` is `production`/`prod`,
  `Load()` returns an error — refusing to start, not warning — if
  `JWT_SECRET` is empty or still the dev default, or if either
  `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET` is empty. The
  payment secrets are guarded because the alternative failure is worse and
  later: the service boots healthy, passes its probes, serves the
  catalogue, and only misbehaves at a real customer's checkout — or does
  not visibly misbehave at all and simply stops verifying payments. A
  deploy that cannot verify a payment should never reach the load
  balancer.
- **CORS origins**: comma-separated `CORS_ORIGINS`, defaults to the two local
  Next.js dev ports.
- Every *other* third-party integration (SMTP, GCS, OpenAI/Gemini, PlantNet,
  Google OAuth, Cloudflare, MSG91, Truecaller, Shiprocket) stays optional at
  the config level — the corresponding handlers check for empty credentials
  and respond `503 Service Unavailable` rather than panicking. See
  [09-external-integrations.md](./09-external-integrations.md).

## Database & Redis connections

`internal/db/postgres.go`:
- Uses `gorm.io/driver/postgres` with `SkipDefaultTransaction: true` and
  `PrepareStmt: true` for latency — GORM normally wraps every write in an
  implicit transaction, which this API opts out of.
- GORM's logger level and slow-query threshold adapt to environment: `Warn`
  at 800ms in development, `Error` at 1500ms elsewhere, or full `Info` at
  200ms if `LOG_SQL=1`.
- Connection pool: `DB_MAX_OPEN_CONNS` (default 40), `DB_MAX_IDLE_CONNS`
  (default 10, capped at max-open), 30-minute max lifetime, 10-minute max idle
  time. Warms up to 4 idle connections with `Ping()` calls at startup.

`internal/db/redis.go`:
- Returns `nil` cleanly (never an error to the caller) if `REDIS_URL` is unset
  or unreachable — every consumer (`cache.Helper`, rate limiters, OTP service)
  is written to treat a `nil` Redis client as "feature degrades, doesn't fail."
- Tight timeouts (`DialTimeout: 1s`, `ReadTimeout`/`WriteTimeout: 500ms`,
  `PoolTimeout: 1s`) so a slow/down Redis can't stall request handling for
  long — callers elsewhere additionally wrap Redis calls in their own short
  `context.WithTimeout` (see [04-caching.md](./04-caching.md)).

## Router & middleware (`internal/server/router.go`)

Global middleware, applied to every request in this order:

```
RequestID → RealIP → SecurityHeaders → Recoverer → Prometheus →
Timeout(60s) → Throttle(512 in-flight) → Compress(level 1) →
QuietLogger (or full Logger if LOG_HTTP=1) → CORS
```

Then route-specific middleware is layered per group — global `/api/v1` gets
`MaxBytes(11MiB)` and (if Redis is up) a named IP rate limiter; individual
route groups add tighter Redis rate limits (auth, checkout, plant-ID, chat),
some of which fail *closed* rather than open. Authentication is layered the
same way, and which middleware a group gets is a security decision rather
than a formality:

- **`appauth.FullAuthMiddleware`** guards the main authenticated group and
  the review-writing route. It accepts only `full`-scope tokens. This is
  the one to reach for by default: `appauth.AuthMiddleware` still exists
  and still accepts a token of *any* scope, which is why mounting it on
  the private group was wrong — a half-registered phone signup carrying an
  `onboarding` token could read orders and write to the wishlist.
- **`appauth.OnboardingAuthMiddleware`** guards `POST /auth/profile/complete`
  and nothing else, which is the only thing an onboarding token may do.
- **`appauth.OptionalAuthMiddleware`** attaches claims when a valid token
  is present and proceeds anonymously otherwise. It serves routes where
  the anonymous path is legitimate and the *handler* decides what the
  caller may see: `GET /order` and `GET /orders/{id}/invoice` (owner by
  `?id=`, guest by opaque `?token=`), the `/checkout/*` group (a guest must
  be able to check out, but a signed-in customer should not be treated as
  one), and `POST /consent` (the cookie banner fires before sign-in).
- **`appauth.AdminMiddleware`** wraps unambiguously admin-only mutations —
  image upload, product CRUD, inventory, review moderation, refunds,
  invoicing and GST reports, shipment booking, coupon CRUD.

Full breakdown in
[08-middleware-and-security.md](./08-middleware-and-security.md), and the
per-route table in [02-auth.md](./02-auth.md).

Top-level (non-`/api/v1`) routes:
- `GET /healthz` — liveness only; performs no dependency checks, so a
  database incident cannot turn into an orchestrator-driven rolling restart
- `GET /readyz` — readiness; pings Postgres (fatal, `503`) and Redis
  (non-fatal, reported as `degraded`)
- `GET /metrics` — Prometheus scrape endpoint
- `GET /docs`, `/docs/openapi.yaml`, `/redoc`, `/swagger` — embedded API docs
  (see [11-api-reference-docs.md](./11-api-reference-docs.md))
- `POST /webhooks/razorpay` — Razorpay payment webhook, authenticated by an
  HMAC signature over the raw body instead of a JWT (see doc 05)
- `POST /webhooks/shiprocket` — courier tracking webhook, authenticated by a
  shared token in the `x-api-key` header

Both webhooks sit outside `/api/v1` and outside its rate limiters: the
caller is a provider rather than a user, and throttling a provider only
converts a delivery into a retry.

Everything else lives under `/api/v1/...` and is grouped by resource:
auth, checkout, products, categories/brands/tags/catalog, images, plant
identification, chat, requested-products, orders/payments, an admin block
(inventory, review moderation, refunds, invoicing, shipments, coupons), and
a block of full-scope-protected "private" routes (profile, wishlist,
orders, addresses, privacy, dashboard, order-support) mounted together at
the bottom of the route table.

## The `Handler` struct — dependency injection

```go
// internal/handlers/handler.go
type Handler struct {
    DB           *gorm.DB
    Cfg          config.Config
    Redis        *redis.Client
    Cache        *cache.Helper
    ImageService *storage.ImageService
    Shiprocket   *shiprocket.Client
}
```

There's exactly one `Handler` instance per process, constructed once in
`main.go` and closed over by every route. All ~40 handler files
(`internal/handlers/*.go`) declare methods on `*Handler` and share this one
struct — there's no per-request handler construction, no interfaces to mock
per domain, and no separate "service" layer between HTTP handlers and GORM;
business logic lives directly in the handler methods. `h.db(ctx)` (in
`internal/handlers/query.go`) is the one indirection point — it just wraps
`h.DB.WithContext(ctx)` so every DB call carries the request's context
(cancellation/timeout) without repeating that boilerplate everywhere.

`ImageService` and `Shiprocket` are both nil-able, and that is the whole
pattern for optional dependencies: they are constructed once at boot as
nil-or-real, and every call site's behaviour on `nil` is "this one feature
degrades," never "crash."

### Who owns what in `internal/handlers`

Handler files are split by domain, and the split matters more than it used
to now that an order's lifecycle touches several of them after it is
created. The order-adjacent ones:

| File | Owns |
|---|---|
| `checkout.go` | `POST /checkout/*`: the email-OTP pair, the verification proof a guest must present, server-side repricing, coupon application, and the one transaction that writes the order, its stock reservation and its coupon redemption together |
| `payments.go` | Razorpay order creation, the client-driven `POST /razorpay/verify` signature check, the shared `markOrderPaid`/`notifyOrderPaid` pair, and `GET /order` |
| `webhooks.go` | `POST /webhooks/razorpay`: raw-body HMAC, replay window, the `webhook_events` idempotency claim, and dispatch of payment/refund/dispute events |
| `inventory.go` | The reserve/commit/release stock lifecycle, the abandoned-order sweep, back-in-stock subscriptions, and the admin stock-adjust and low-stock endpoints |
| `coupons.go` | Server-side coupon evaluation (the client never supplies a discount), redemption recording under a conditional usage counter, and admin coupon CRUD |
| `refunds.go` | Customer cancellation, admin refunds, the local-row-before-provider-call ordering, and `applyRefundOutcome` as the single writer of terminal refund state |
| `invoicing.go` | GST extraction from tax-inclusive prices, financial-year invoice numbering, the invoice PDF endpoint and the GST report |
| `shipments.go` | Shipment booking and pickup, `POST /webhooks/shiprocket`, the courier-status-to-order-status mapping, and the tracking-refresh backstop |
| `reviews.go` | Review submission with verified-purchase detection, moderation, the recomputed rating aggregate, and post-delivery review requests |
| `privacy.go` | DPDP consent records, data export, erasure, and the retention sweep |
| `addresses.go` | The saved shipping address book at `/addresses` |

Two of these lean on packages outside `handlers` for work that is not HTTP
handling: `internal/shiprocket/shipments.go` holds the provider calls that
create an order, assign an AWB, request a pickup and read tracking (its
sibling `client.go` holds auth, the serviceability check and the circuit
breaker), and `internal/services/invoice_pdf.go` renders the tax invoice
itself. Both are there because they are self-contained and have no
dependency on a `*Handler` — not because a layer was introduced.

## Tests

Unit tests cover the pure-logic packages and, increasingly, the parts of
the handler package where being wrong costs money: `internal/auth/jwt_test.go`,
`internal/cache/cache_test.go`, `internal/middlewares/security_test.go`,
`internal/middlewares/ratelimit_test.go`, `internal/docs/handler_test.go`,
`internal/shiprocket/client_test.go`, `internal/services/otp_proof_test.go`,
`internal/handlers/payments_test.go`, `internal/handlers/invoicing_test.go`
and `internal/handlers/fulfillment_test.go`.

What they have in common is that they test decisions, not plumbing —
signature verification against the right secret, fail-open versus
fail-closed rate limiting during a Redis outage, GST extraction from
tax-inclusive prices, financial-year boundaries, and whether a
verification proof token is single-use and bound to one address. These are
all testable without a database precisely because they are plain functions.
Handler paths that need Postgres are still exercised by integration/manual
testing against the deployed frontend; `.github/workflows/ci.yml` runs
gofmt, `go vet`, the build and `go test -race` on every push.
