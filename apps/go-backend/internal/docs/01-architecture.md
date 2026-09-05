# Architecture

## Project layout

```
apps/go-backend/
├── cmd/
│   ├── server/main.go      # HTTP server entrypoint
│   └── migrate/main.go     # standalone "run AutoMigrate and exit" binary
├── internal/
│   ├── auth/                # JWT issuing/parsing + HTTP auth middleware
│   ├── cache/                # two-tier (in-process + Redis) cache helper
│   ├── config/                # env-var configuration loader
│   ├── db/                     # Postgres (GORM) + Redis connection setup
│   ├── docs/                    # embedded OpenAPI/Swagger/ReDoc + these .md files
│   ├── handlers/                 # all HTTP handlers (the bulk of business logic)
│   ├── metrics/                  # Prometheus registration + middleware hook
│   ├── middlewares/              # security headers, rate limiting, logging, IP
│   ├── models/                   # GORM models (Postgres schema as Go structs)
│   ├── msg91/                     # MSG91 phone-OTP HTTP client + throttling
│   ├── phoneutil/                  # Indian phone-number normalization helpers
│   ├── server/                     # chi router assembly (route table)
│   ├── services/                    # email (SMTP), OTP (Redis-backed), storage/
│   └── truecaller/                    # Truecaller OAuth client
├── pkg/
│   ├── httpjson/                       # JSON response/decode helpers
│   └── pagination/                      # page/pageSize query parsing + meta
├── migrations/                          # hand-written SQL scripts (see doc 10)
├── seed/                                 # dev-only sample data seeder
└── docker-compose.yml (repo root)         # Postgres/Redis/Prometheus/Grafana for local dev
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
   `*handlers.Handler` used by every route.
6. **`h.AutoMigrate()`** — runs if `AUTO_MIGRATE=true` (default). See
   [10-database-and-migrations.md](./10-database-and-migrations.md).
7. **`seed.EnsureSampleData(dbConn)`** — runs only if `SEED_ON_STARTUP=true`
   (default `false`). Idempotent (`FirstOrCreate`), safe to leave on in dev.
8. **`server.NewRouter(h, cfg)`** — assembles the chi router (see below).
9. Starts `http.Server` with conservative timeouts (`ReadHeaderTimeout: 5s`,
   `ReadTimeout: 30s`, `WriteTimeout: 60s`, `IdleTimeout: 90s`,
   `MaxHeaderBytes: 64KiB`) and a goroutine that calls `srv.Shutdown` on
   `SIGINT`/`SIGTERM` with a 10s grace period.

`cmd/migrate/main.go` reuses the same `config.Load` → `db.Connect` →
`handlers.New` → `h.AutoMigrate()` sequence as a one-shot binary, for
environments that run migrations as a separate deploy step instead of
`AUTO_MIGRATE=true` on every boot.

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
- **Production guardrail**: if `GO_ENV`/`APP_ENV` is `production`/`prod` and
  `JWT_SECRET` is empty or still the dev default, `Load()` returns an error —
  the server refuses to start with a weak secret in prod.
- **CORS origins**: comma-separated `CORS_ORIGINS`, defaults to the two local
  Next.js dev ports.
- Every third-party integration (Razorpay, SMTP, GCS, OpenAI/Gemini, PlantNet,
  Google OAuth, Cloudflare, MSG91, Truecaller) is optional at the config level
  — the corresponding handlers check for empty credentials and respond
  `503 Service Unavailable` rather than panicking. See
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
route groups add tighter Redis rate limits (auth, checkout, plant-ID, chat);
private routes require a JWT (`appauth.AuthMiddleware`); a few mutation routes
additionally require `appauth.AdminMiddleware`. Full breakdown in
[08-middleware-and-security.md](./08-middleware-and-security.md).

Top-level (non-`/api/v1`) routes:
- `GET /healthz` — liveness check
- `GET /metrics` — Prometheus scrape endpoint
- `GET /docs`, `/docs/openapi.yaml`, `/redoc`, `/swagger` — embedded API docs
  (see [11-api-reference-docs.md](./11-api-reference-docs.md))
- `POST /webhooks/razorpay` — Razorpay payment webhook (outside `/api/v1`,
  authenticated by HMAC signature instead of JWT — see doc 05)

Everything else lives under `/api/v1/...` and is grouped by resource:
auth, checkout, products, categories/brands/tags/catalog, images, plant
identification, chat, requested-products, orders/payments, and a block of
JWT-protected "private" routes (profile, wishlist, orders, dashboard,
order-support) mounted together at the bottom of the route table.

## The `Handler` struct — dependency injection

```go
// internal/handlers/handler.go
type Handler struct {
    DB           *gorm.DB
    Cfg          config.Config
    Redis        *redis.Client
    Cache        *cache.Helper
    ImageService *storage.ImageService
}
```

There's exactly one `Handler` instance per process, constructed once in
`main.go` and closed over by every route. All ~30 handler files
(`internal/handlers/*.go`) declare methods on `*Handler` and share this one
struct — there's no per-request handler construction, no interfaces to mock
per domain, and no separate "service" layer between HTTP handlers and GORM;
business logic lives directly in the handler methods. `h.db(ctx)` (in
`internal/handlers/query.go`) is the one indirection point — it just wraps
`h.DB.WithContext(ctx)` so every DB call carries the request's context
(cancellation/timeout) without repeating that boilerplate everywhere.

## Tests

A handful of packages carry unit tests: `internal/auth/jwt_test.go`,
`internal/cache/cache_test.go`, `internal/middlewares/security_test.go`,
`internal/docs/handler_test.go`. Most business logic (handlers) is not
covered by automated tests today — the surface area is generally exercised by
integration/manual testing against the deployed frontend instead.
