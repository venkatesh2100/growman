# Go Backend — Developer Documentation

This is the Growman e-commerce/plant-care API: a Go (chi router + GORM/Postgres +
Redis) backend serving a Next.js web app and a mobile app. These docs explain
**how the system works internally** — architecture, request flow, and the
reasoning behind each subsystem — for anyone picking up this codebase.

> These are hand-written developer notes, separate from the live, embedded
> API reference (Swagger/ReDoc) served at `/docs` and `/redoc` — see
> [11-api-reference-docs.md](./11-api-reference-docs.md) for how that's wired.

**Start with [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md)** for the *why*: requirements,
architecture rationale, data model, caching/reliability/security/scalability
strategy, and the trade-offs made along the way. The numbered docs below are
the *how* — implementation detail per subsystem.

The cross-client study guide (mobile + this API + web, plus how to add a feature) lives at [../../../../docs/COMPLETE-GUIDE.md](../../../../docs/COMPLETE-GUIDE.md). A copy is in the mobile repo at `docs/COMPLETE-GUIDE.md`. The files below stay the detailed backend reference.

## Where to start

| Doc | Covers |
|---|---|
| [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md) | System-design overview: requirements, architecture, data model, correctness under concurrency, caching/reliability/security/privacy/scalability, trade-offs |
| [01-architecture.md](./01-architecture.md) | Project layout, boot sequence, config and its production guardrails, DB/Redis connections, background workers, router & middleware stack, dependency-injected `Handler` and who owns which handler file |
| [02-auth.md](./02-auth.md) | JWT scopes, the five auth middlewares and which routes each guards, password/Google/phone-OTP/Truecaller login, onboarding flow, password reset, the guest checkout verification proof |
| [03-catalog-and-search.md](./03-catalog-and-search.md) | Products, categories, brands, tags, search ranking, parallel detail loading |
| [04-caching.md](./04-caching.md) | Two-tier (in-process + Redis) cache helper, TTLs, key conventions, invalidation |
| [05-orders-checkout-payments.md](./05-orders-checkout-payments.md) | Checkout and server-side repricing, Razorpay order/verify/webhook, inventory reserve-commit-release, coupons, cancellation and refunds, GST invoicing, shipping and tracking, background workers, order admin, support tickets |
| [06-chat-and-ai.md](./06-chat-and-ai.md) | "Dootha" AI chat assistant, intent routing, account chat, plant identification |
| [07-images-and-storage.md](./07-images-and-storage.md) | GCS-backed image storage, image-key vs resolved-URL pattern, upload endpoint |
| [08-middleware-and-security.md](./08-middleware-and-security.md) | Middleware stack, fail-open vs fail-closed rate limiting, provider webhook authentication, payment signature verification, boot-time config guards, security headers, CORS, client-IP resolution, liveness vs readiness, metrics |
| [09-external-integrations.md](./09-external-integrations.md) | Razorpay (including its two distinct secrets), Shiprocket, MSG91, Truecaller, Google Sign-In, SMTP email, Cloudflare Analytics, Pl@ntNet |
| [10-database-and-migrations.md](./10-database-and-migrations.md) | GORM models, the operational and compliance tables, load-bearing indexes, AutoMigrate, manual SQL migrations, seed data |
| [11-api-reference-docs.md](./11-api-reference-docs.md) | The embedded OpenAPI/Swagger/ReDoc package living in this same directory |

## If you are here for something specific

A few subjects are spread across more than one doc, because the *why* and
the *how* live in different places. The short answers:

- **Payment security.** Start with
  [08-middleware-and-security.md](./08-middleware-and-security.md) — it
  covers signature verification on both the webhook and the client-driven
  verify path, why verification fails closed, why a missing secret does not
  disable it, and why `config.Load()` refuses to boot a production deploy
  without both Razorpay secrets. Which secret signs which message, and the
  full set of handled webhook events, is in
  [09-external-integrations.md](./09-external-integrations.md); the order
  lifecycle those events drive is in
  [05-orders-checkout-payments.md](./05-orders-checkout-payments.md).
- **DPDP compliance.** The design — how the Rule 8(3) one-year retention
  floor is reconciled with the Section 8(7) erasure right — is in
  [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md#11-privacy-and-data-retention).
  The consent, export and erasure endpoints are in
  [02-auth.md](./02-auth.md) and the tables backing them in
  [10-database-and-migrations.md](./10-database-and-migrations.md).
- **Why two shoppers cannot buy the same last plant.** The pattern, which
  recurs for payments, coupons and webhook dedup as well as stock, is in
  [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md#7-correctness-under-concurrency);
  the stock lifecycle itself is in
  [05-orders-checkout-payments.md](./05-orders-checkout-payments.md).
- **Which auth middleware a new route should use.** The table in
  [02-auth.md](./02-auth.md#which-middleware-guards-which-routes-internalserverroutergo),
  and the reasoning in the same doc's "Notable design choices".

## 30-second mental model

```
Client (web/mobile)                    Razorpay / Shiprocket
   │  HTTPS                               │  POST /webhooks/*  (HMAC body
   │                                      │  signature or x-api-key, no JWT,
   ▼                                      ▼  outside /api/v1)
chi Router  (internal/server/router.go)
   │  middleware chain: RequestID → RealIP → SecurityHeaders → Recoverer →
   │  Prometheus → Timeout → Throttle → Compress → Logger → CORS
   │  route-group middleware: MaxBytes, per-route Redis rate limits
   │  (some fail closed), Full/Onboarding/Optional/Admin auth
   ▼
Handler methods  (internal/handlers/*.go)
   │  one *handlers.Handler struct carries every dependency
   ▼
   ├─ GORM ──────► Postgres (products, orders, users, …)
   ├─ cache.Helper ► Redis (+ in-process L1 cache)
   ├─ ImageService ► Google Cloud Storage (product images)
   ├─ Shiprocket ──► courier serviceability, booking, AWB, tracking
   └─ external HTTP ► Razorpay, MSG91, Truecaller, Google, OpenAI/Gemini,
                       Pl@ntNet, Cloudflare Analytics, SMTP

Same process, started before the listener and stopped on SIGINT/SIGTERM:
   inventory sweeper (5m) · shipment worker (15m) · retention sweeper (24h)
```

Everything hangs off one struct, `handlers.Handler` (`internal/handlers/handler.go`),
built once in `cmd/server/main.go` and passed into `server.NewRouter`. Every
handler is a method on `*Handler`, so any handler can reach the DB, cache,
config, image service or courier client without extra plumbing — and so can
the background workers, which is why they live in this process rather than a
second deployable.

Two probes sit outside `/api/v1`: `GET /healthz` is liveness and touches no
dependency at all, `GET /readyz` is readiness and pings Postgres and Redis.
Orchestrators should route on the second.

## Running locally

```bash
cd apps/go-backend
cp .env.example .env   # if present — otherwise set DATABASE_URL/HYPERDRIVE_URL + JWT_SECRET
go run ./cmd/server
```

`AUTO_MIGRATE=true` (default) runs `AutoMigrate` + `EnsureSearchIndexes` on
boot — no separate migration step is required for a fresh dev database. See
[10-database-and-migrations.md](./10-database-and-migrations.md) for details
and the standalone `cmd/migrate` binary.

`docker-compose.yml` (repo root) provides Postgres, Redis, Prometheus, and
Grafana for local development; the Go backend service itself is commented out
there and is normally run directly with `go run`.

Locally, `APP_ENV` defaults to `development`, which is also the only kind of
value that lets payment signature verification be skipped — so a dev
environment needs no Razorpay credentials to exercise checkout. A
**production** deploy is stricter and will refuse to start without
`JWT_SECRET`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`; see
[01-architecture.md](./01-architecture.md#config).
