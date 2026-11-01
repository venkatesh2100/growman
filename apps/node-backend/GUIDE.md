# Growman production guide — Node API and Dootha

The interview set, with architecture, alternatives, and spoken answers, is in [docs/README.md](./docs/README.md). This file is the short operator view.

Production is three processes:

```
Expo app and Next.js storefront (apps/web)
        |
        |  HTTPS  /api/v1
        v
Node API  (apps/node-backend, port 8080)
Prisma, Postgres, Redis
        |
        |  POST /v1/answer and /v1/care
        |  header X-Growman-RAG-Secret
        v
Python RAG  (apps/ai, its own port)
BM25 + BGE + reciprocal rank fusion + cross-encoder
Gemini only for route fallback and comparisons
```

The storefront never calls the Python service. It calls the Node API. Node calls Python when a shopper asks Dootha a plant question, and when a Pl@ntNet identification needs a care sheet.

`apps/go-backend` documents the same shop rules and is left unchanged. Do not run it on 8080 at the same time as Node.

## What each side owns

| Piece | Owns |
|---|---|
| `apps/web` and the Expo app | Pages, cart UI, Razorpay checkout widget. `NEXT_PUBLIC_API_URL` points at `http://<node>/api/v1`. |
| `apps/node-backend` | Accounts, catalog, prices, stock, orders, coupons, invoices, delivery quotes, images, chat routing. |
| `apps/ai` | Grounded plant answers. No database. No orders. Prices in its corpus are stripped. |
| Postgres | The shop tables in `prisma/schema.prisma`. |
| Redis | Catalog cache, OTP, rate limits. The API still serves if Redis is down, except limits that must fail closed. |

## Boot

`cmd/server/main.js` follows the Go server:

1. `config.load()` reads the same env vars (`GO_PORT`, `DATABASE_URL`, `JWT_SECRET`, Razorpay, `RAG_SERVICE_URL`, and the rest of `example.env`).
2. `db/postgres.js` opens Prisma. `DATABASE_URL` wins. `HYPERDRIVE_URL` is the fallback.
3. Redis is optional. A failed Redis connection becomes in-process cache and rate limits.
4. Image storage is optional. A missing bucket disables uploads and the API still starts.
5. One `Handler` is built. Every route is a method on it. The Shiprocket client is null when courier credentials are empty, and delivery quotes fall back to the static fee.
6. When `AUTO_MIGRATE=true` (the default), missing tables are created once with `prisma db push` if `users` does not exist. An existing database is not rewritten. Search indexes are created with `CREATE INDEX IF NOT EXISTS`.
7. `SEED_ON_STARTUP=true` inserts sample rows. Leave it off in production.
8. Three timers start before the port opens: unpaid stock every 5 minutes, shipments every 15 minutes, privacy retention once a day.
9. Express listens until `SIGINT` or `SIGTERM`. Timers stop first, then the HTTP server, then Prisma.

`GET /healthz` does not touch the database. `GET /readyz` pings Postgres. Redis trouble is degraded, not down.

## Files

The folders match the Go service. Business rules stay in the same files.

```
apps/node-backend/
├── cmd/server/main.js          boot
├── cmd/migrate/main.js         indexes, then exit
├── prisma/schema.prisma        tables Prisma reads and writes
├── internal/server/router.js   URL map
├── internal/handlers/          one file per area, methods on Handler
├── internal/db/                Prisma client, query helpers
├── internal/models/index.js    User, Order, Product, … re-exported for handlers
├── internal/cache/cache.js     memory plus Redis
├── internal/auth/jwt.js        scoped JWT
├── internal/fulfillment/       distance, zone, fee
├── internal/shiprocket/        courier HTTP
├── internal/msg91/             phone OTP
├── internal/truecaller/
├── internal/plantnet/          photo identification
├── internal/services/          email, invoice PDF, image storage
└── internal/middlewares/       headers, rate limit, client IP
```

`internal/handlers/handler.js` loads every handler module onto one class. A route calls `handler.listProducts`. Inside that function, `this` is the handler, so it can reach Prisma, Redis, config, images, and Shiprocket.

`this.sequelize` is the Prisma handle. The property keeps that name because the route files were written against it. It exposes `query`, `transaction`, `escape`, and `literal`. It is not the Sequelize library. The `sequelize` package is not installed.

## Prisma

`prisma/schema.prisma` names every shop table. Column names are the existing snake_case columns (`@map`), so this service can use a database that already has those tables.

Handlers still call `Product.findAll`, `Order.update`, and `User.findOne`. Those functions live in `internal/db/records.js` and run Prisma underneath:

- Soft-deleted rows (`deleted_at`) stay out of normal reads.
- `include` loads sizes, category, brand, order items, and the other relations.
- A filter written with `Op.in`, `Op.ne`, `Op.gte`, and the same operators becomes a Prisma `where`.
- Search SQL that ranks names, and stock `UPDATE … WHERE stock >= $1`, stay raw SQL executed by Prisma. Those statements are the ones that must not be split into a read plus a write.
- `present()` strips password hashes, soft-delete times, webhook payloads, and the client IP before JSON is sent.

Generate the client after install (`pnpm install` runs `prisma generate`). Commit the schema. Do not commit `.env`.

On an empty database, the first boot with `AUTO_MIGRATE=true` runs `prisma db push` because `users` is missing. After that, boot only adds indexes. Do not point `db push` at a database you still migrate with the Go server.

## Request path

```
Client
  -> Express
       request id, security headers, metrics, 60s timeout,
       throttle, gzip, logs, CORS
  -> /healthz and /readyz
  -> /webhooks/razorpay and /webhooks/shiprocket
       raw body, signature, no shopper JWT
  -> /api/v1
       JSON, 250 requests/minute/IP when Redis is up
       then the route's own auth and limit
  -> Handler method
       Prisma, cache, catalog tools, or the Python RAG
```

Public catalog routes do not require a token. Checkout accepts a guest and still reads a token when one is sent. Account routes require a full JWT. Admin routes require the admin role.

Auth methods are email and password, Google, MSG91 OTP, and Truecaller. They mint one scoped JWT. Password hashes never appear in JSON.

## Catalog

Product lists, category pages, and search use `internal/handlers/query.js` for the card shape: price, stock, tags, sizes, category, brand. Responses are cached. An admin write deletes the product, category, brand, tag, and catalog cache keys.

Search matches name, short description, tags, category, brand, and description. An exact name ranks first, then a prefix, then a substring. The rank SQL runs in Postgres. The page of ids is loaded through Prisma so sizes and category still come back with the card.

Prices and stock in API responses are the live columns. The Python corpus is not allowed to answer a price.

## Checkout, stock, and payments

The client does not send the price we charge. The server prices the cart, the delivery fee, the coupon, and store credit.

Stock is one conditional update inside the checkout transaction:

```sql
UPDATE products SET stock = stock - $1
WHERE id = $2 AND (track_inventory = false OR stock >= $1)
```

A sized plant updates `product_sizes` the same way. Zero rows means the other buyer took the last unit. That request gets HTTP 409. The unpaid hold lasts 30 minutes. The 5-minute sweeper marks those orders abandoned and puts the plants back. A plant that returns from zero can email the back-in-stock list.

Razorpay orders are created with the server amount. The webhook and the client verify call both check the HMAC. The webhook secret and the key secret are different. An event id is stored in `webhook_events` before the side effect, so a retry does not capture twice. The first transition to `paid` keeps the stock hold and assigns the invoice number. A nested savepoint rolls the stock change back if the plants are already gone, and the payment itself stays captured so staff can refund or source the plant.

Coupons decrement `usage_count` only while it is still under the cap. The coupon row is locked with `FOR UPDATE` in that transaction.

## Dootha and apps/ai

`POST /api/v1/chat` is the only chat URL the storefront uses. Node decides the intent before any model call:

1. Order-support phrases open a support request.
2. Wishlist and order-status questions are answered from Prisma for the signed-in user. The Python service is not given the account.
3. Anything else is a plant, policy, or product question.

If `RAG_SERVICE_URL` is set, Node posts to the Python service:

| Node | Python | Body |
|---|---|---|
| `rag_client.askRAG` | `POST /v1/answer` | `{ message, history }` |
| `rag_client.askRAGCare` | `POST /v1/care` | species, common names, origin countries |

The header is `X-Growman-RAG-Secret`. It must match `RAG_SHARED_SECRET` on both sides. The browser does not see that secret. A non-200 from Python falls back to the canned replies in the Node chat handler.

Python returns `response`, `productSlugs`, `route`, and `usedLlm`. Node turns the slugs into shop cards with `productsBySlugs` (at most three active products). It does not trust a price written by the model. The Python service reads the public catalog over HTTP when it needs a live price, and it deletes any rupee amount that was not in that payload.

Plant identification is Pl@ntNet, called from Node, with the daily quota in mind. The species then goes to `/v1/care`. Node caches that care sheet for 14 days.

Leave `RAG_SERVICE_URL` empty only when you want chat to stay on the canned answers. Production sets it to the Python service.

The Python pipeline, for the interview and for operators:

1. Chunk `corpus/growman.txt` by section and plant. Rupee amounts are removed from the text the model can see.
2. BM25 and local BGE embeddings score the question.
3. Reciprocal rank fusion merges the two top-20 lists (`1 / (60 + rank)`).
4. A MiniLM cross-encoder keeps 4 passages.
5. Rules route greetings, orders, prices, policy, medicinal plants, and care. Gemini classifies only when every rule declines.
6. Gemini writes a reply only for comparisons. Other answers are the passage or a catalog sentence.

Details of that service are in `apps/ai/INTERVIEW.md`.

## Cache and limits

Catalog reads use an in-process cache and Redis behind it. A stampede for one key shares one load. Redis errors fall through to memory. TTLs differ by resource. List responses can answer `304` when the `ETag` matches.

Auth, checkout, and chat use the strict limiter: when Redis is down they still count in this process and return 429 over the limit. Catalog limits let the request through if Redis cannot be reached, so a cache outage does not close the shop.

## Runbook

Local:

```bash
cd apps/node-backend
cp example.env .env
# DATABASE_URL, JWT_SECRET, and the frontend origin
# RAG_SERVICE_URL=http://localhost:8090
# RAG_SHARED_SECRET= the same value as apps/ai
pnpm install
pnpm start
```

Python, from `apps/ai`, on the port you put in `RAG_SERVICE_URL`. The storefront `NEXT_PUBLIC_API_URL` is `http://localhost:8080/api/v1`.

Production checks before traffic:

- `APP_ENV=production` and a real `JWT_SECRET`.
- Both Razorpay secrets set. A missing webhook secret must not mean "accept unsigned events".
- `RAG_SERVICE_URL` and `RAG_SHARED_SECRET` set, and the Python service healthy.
- `AUTO_MIGRATE=true` on the first boot of an empty database, then leave it on so new indexes still apply.
- Redis URL set. The shop runs without it, with a weaker cache and local rate limits.
- One API process on 8080. Not the Go server.

Useful commands:

| Command | What it does |
|---|---|
| `pnpm start` | API |
| `pnpm migrate` | Connect and apply indexes, then exit |
| `pnpm db:generate` | Regenerate the Prisma client after a schema edit |

`LOG_SQL=1` prints Prisma queries. `LOG_HTTP=1` prints every request. The quiet logger otherwise prints slow ones.
