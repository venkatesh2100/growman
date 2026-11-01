# Architecture

Say this first: `cmd/server/main.js` boots config, Prisma, optional Redis, optional images, one Handler, three timers, then Express. Every URL is a method on that Handler. The folder layout matches the Go service so a route is easy to find. Python is a second process, not a folder inside Node.

## Why one Handler

`internal/handlers/handler.js` builds one object with the database handle, config, Redis, cache, image service, and Shiprocket client. Route modules are copied onto that object’s prototype. `router.js` calls `handler.listProducts`. Inside the function, `this` is the handler.

Why here: workers and HTTP handlers need the same courier client and the same pool. Passing five arguments through every function was the alternative. A dependency-injection framework was rejected because there is one composition root, `main.js`.

`this.sequelize` is the Prisma handle from `internal/db/records.js`. The name stayed so the route files did not have to be renamed. It is not the Sequelize package.

## Boot order, and why that order

| Step | File | Why this order |
|---|---|---|
| Config | `internal/config/config.js` | Fail before opening a pool if the database URL is missing. Production should also refuse a default JWT and empty Razorpay secrets |
| Prisma | `internal/db/postgres.js` | The API cannot serve a catalog without Postgres. `DATABASE_URL` wins over `HYPERDRIVE_URL` because a long-lived Node process should not pay Hyperdrive’s extra hop |
| Redis | `internal/db/redis.js` | Optional. Null means memory cache and local rate limits |
| Images | `internal/services/storage` | Optional. A bad bucket disables uploads and the process still listens |
| Handler | `internal/handlers/handler.js` | Shiprocket is null when credentials are empty. Quotes then use the static fee |
| Schema | `ensureSchema` + search indexes | Create tables only when `users` is missing. After that, only `CREATE INDEX IF NOT EXISTS`. Do not `db push` over a database Go is also migrating |
| Seed | `seed/seed.js` | Off unless `SEED_ON_STARTUP=true` |
| Workers | inventory 5 min, shipments 15 min, retention 24 h | Started before listen, so abandoned stock returns even if nobody calls the API. Stopped before Prisma disconnects, so a deploy does not kill a transaction mid-statement |
| HTTP | `internal/server/router.js` | Header timeout 5s, request body 30s, keep-alive 90s |

`cmd/migrate/main.js` is the same connect and index step, then exit. Use it when the platform wants a migration job separate from the web process.

## Folder map

| Path | Owns | Why not inside handlers |
|---|---|---|
| `internal/server/router.js` | The only URL table | So “which function serves this path” is one file |
| `internal/handlers/*.js` | Business rules, one domain per file | The URL stays thin |
| `internal/db` | Prisma client, soft delete, raw SQL helper | Handlers should not each construct a client |
| `internal/models/index.js` | Re-exports `User`, `Order`, `Product` | Import path the handlers already use |
| `prisma/schema.prisma` | Table and column names | One schema for generate and for an empty database |
| `internal/cache` | L1 + Redis + singleflight | Every catalog handler would otherwise invent a key |
| `internal/auth/jwt.js` | Sign, parse, four middlewares | Auth is cross-cutting |
| `internal/middlewares` | Headers, IP, limits, metrics | Run before any handler |
| `internal/fulfillment` | Zone, distance, fee policy | Pure rules, testable without HTTP |
| `internal/shiprocket`, `msg91`, `truecaller`, `plantnet` | HTTP clients | A client is not a route |
| `internal/services` | Email, OTP proofs, PDFs, storage | Used by auth, checkout, and workers |
| `apps/ai` | Retrieval and Gemini | Different process, different deploy |

`pkg/httpjson` and `pkg/pagination` have no shop types. They sit outside `internal` by convention. Nothing else in the monorepo imports them today.

## Middleware order

Request id, client IP, security headers, Prometheus, 60s timeout, throttle, gzip, logger, CORS. Then the route group adds body size, rate limit, and JWT.

Why this order: a request id exists before logs. Security headers exist even on a 401. Webhooks are mounted before the shopper rate limit, because slowing Razorpay only makes Razorpay retry. Auth is per route, not global, because the catalog is public.

## Health

`GET /healthz` does not touch Postgres. `GET /readyz` runs `SELECT 1`. Redis down is degraded. Orchestrators should route on readiness.

## Alternative

A NestJS module graph, or a Go chi server, would express the same routes. Nest was rejected to keep the file-for-file match with the existing handler split. Go remains the reference implementation in `apps/go-backend` and is not started on port 8080 beside Node.

## Where Python sits

Node’s `RAG_SERVICE_URL` is the only pointer. Chat and care sheets are HTTP. There is no Python import inside Node. That is deliberate: the model runtime (PyTorch, BGE) does not belong in the commerce process memory.
