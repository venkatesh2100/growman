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

## Where to start

| Doc | Covers |
|---|---|
| [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md) | System-design overview: requirements, architecture, data model, caching/reliability/security/scalability, trade-offs |
| [01-architecture.md](./01-architecture.md) | Project layout, boot sequence, config, DB/Redis connections, router & middleware stack, dependency-injected `Handler` |
| [02-auth.md](./02-auth.md) | JWT scopes, password/Google/phone-OTP/Truecaller login, onboarding flow, password reset |
| [03-catalog-and-search.md](./03-catalog-and-search.md) | Products, categories, brands, tags, search ranking, parallel detail loading |
| [04-caching.md](./04-caching.md) | Two-tier (in-process + Redis) cache helper, TTLs, key conventions, invalidation |
| [05-orders-checkout-payments.md](./05-orders-checkout-payments.md) | Checkout, Razorpay orders/verify/webhook, order admin, support tickets |
| [06-chat-and-ai.md](./06-chat-and-ai.md) | "Dootha" AI chat assistant, intent routing, account chat, plant identification |
| [07-images-and-storage.md](./07-images-and-storage.md) | GCS-backed image storage, image-key vs resolved-URL pattern, upload endpoint |
| [08-middleware-and-security.md](./08-middleware-and-security.md) | Middleware stack, rate limiting, security headers, CORS, client-IP resolution |
| [09-external-integrations.md](./09-external-integrations.md) | MSG91, Truecaller, Google Sign-In, Razorpay, SMTP email, Cloudflare Analytics, Pl@ntNet |
| [10-database-and-migrations.md](./10-database-and-migrations.md) | GORM models, AutoMigrate, manual SQL migrations, seed data |
| [11-api-reference-docs.md](./11-api-reference-docs.md) | The embedded OpenAPI/Swagger/ReDoc package living in this same directory |

## 30-second mental model

```
Client (web/mobile)
   │  HTTPS
   ▼
chi Router  (internal/server/router.go)
   │  middleware chain: RequestID → RealIP → SecurityHeaders → Recoverer →
   │  Prometheus → Timeout → Throttle → Compress → Logger → CORS
   │  route-group middleware: MaxBytes, per-route Redis rate limits, JWT auth
   ▼
Handler methods  (internal/handlers/*.go)
   │  one *handlers.Handler struct carries every dependency
   ▼
   ├─ GORM ──────► Postgres (products, orders, users, …)
   ├─ cache.Helper ► Redis (+ in-process L1 cache)
   ├─ ImageService ► Google Cloud Storage (product images)
   └─ external HTTP ► Razorpay, MSG91, Truecaller, Google, OpenAI/Gemini,
                       Pl@ntNet, Cloudflare Analytics, SMTP
```

Everything hangs off one struct, `handlers.Handler` (`internal/handlers/handler.go`),
built once in `cmd/server/main.go` and passed into `server.NewRouter`. Every
handler is a method on `*Handler`, so any handler can reach the DB, cache,
config, or image service without extra plumbing.

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
