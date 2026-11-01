# System design

Say this first: Growman is a read-heavy plant shop. One Node API owns money, stock, and identity. A separate Python process answers plant questions from a text corpus and is not allowed to see orders. Postgres decides who wins the last plant. Redis only makes reads faster.

## 1. What the system is

An Indian nursery shop: catalog, guest checkout, Razorpay, GST invoices, courier quotes, four login methods, a plant-care chat called Dootha, and photo identification. The Next.js storefront and the Expo app are clients. They are not backends.

Traffic is mostly browsing. Orders are rare next to product-page reads. That is why the catalog is cached aggressively and the database stays a single Postgres primary. There is no multi-region write path, because the shop does not need one at this size, and a second writer would make stock harder, not easier.

## 2. Requirements that force the shape

- A shopper must not be charged a price the browser invented.
- Two shoppers must not both pay for the last plant.
- A Razorpay retry must not capture, email, or restock twice.
- Dootha must not invent a rupee amount or a dosage.
- Redis, the courier, email, Gemini, and Pl@ntNet can each be down without taking the catalog offline.
- Phone numbers, rupees, GST, and Razorpay are India-specific. Stripe and Twilio are the wrong defaults here.
- Personal data has a consent record and an erasure path (DPDP). Some order and payment rows still have to be kept for tax.

## 3. The picture

```
Web (apps/web) and Expo
        |  HTTPS JSON, NEXT_PUBLIC_API_URL -> /api/v1
        v
Express  (apps/node-backend, port 8080)
  middleware, then one Handler object
        |                         |
        |                         +--> Python RAG (apps/ai)
        |                              shared secret, no database
        v
Prisma --> Postgres
Cache  --> Redis (optional) + in-process L1
Images --> object storage, URL built from a key
Workers in the same process: stock sweep, shipments, retention
```

Python calls back to the public catalog HTTP API when it needs a live price. It does not open Postgres. That callback is why a prompt injection in chat cannot become `SELECT * FROM orders`.

## 4. Why the pieces sit where they sit

| Piece | Why it exists | Why it is here, not somewhere else | Alternative rejected |
|---|---|---|---|
| One Node process | The shop is one domain: user, cart, stock, payment | A second commerce service would split the checkout transaction | Microservices per resource. More deploys, no clearer stock rule |
| Handler methods, no repository layer | The rules are in the route files and are easy to read next to the URL | A repository interface would rename Prisma without changing behavior | Clean-architecture layers. Worth it if a second database or a second API appears |
| Prisma in `internal/db` | Typed access to the existing tables | Schema lives in `prisma/schema.prisma`. Handlers keep `findAll` so the route files stay stable | Raw SQL everywhere. Fine for stock, noisy for a product card with three joins |
| Python `apps/ai` | Retrieval and guardrails are a different failure domain from checkout | A model process with a database password is a larger blast radius | Calling Gemini from the Next.js server. The browser would hold the key, and prices would be ungrounded |
| In-process workers | They need the same DB, mail, and courier client | A cron container would duplicate config and can run while the pool is closing | A queue (SQS, Bull). Right when the sweep must survive a deploy gap or fan out to many workers |
| Redis optional | Cache and shared rate limits | The shop still has to open if Redis is down | Redis as the source of truth for stock. It can fail open |

## 5. Two requests, so the design is concrete

**Catalog read** `GET /api/v1/products/:slug`

Middleware, then `getProduct`. The cache checks memory, then Redis. On a miss, one in-flight load reads the product, sizes, attributes, reviews, category, and brand. The JSON is stored in both tiers and sent with an `ETag`. A repeat with `If-None-Match` is a 304. Postgres is not on the hot path.

**Checkout write** `POST /api/v1/checkout/create-order`

The handler ignores the client price. It loads each plant from Postgres, recomputes delivery and any coupon, and requires a guest email proof when there is no account. Order row, stock decrement, and coupon redemption commit in one transaction. The stock statement updates a row only when enough units remain. Zero rows rolls the transaction back and returns 409.

Payment confirmation is a second step. The browser verify call and the Razorpay webhook can both arrive. `UPDATE … WHERE payment_status <> 'paid'` lets only one of them win.

## 6. Concurrency rule

Postgres arbitrates. The application does not hold a lock in Redis.

| Race | What wins | What the loser sees |
|---|---|---|
| Last plant | `UPDATE … WHERE stock >= quantity` | 409, transaction rolled back |
| Pay twice | `UPDATE orders … WHERE payment_status <> 'paid'` | Second caller does not send a second email |
| Release stock twice | `UPDATE … SET inventory_released = true WHERE inventory_released = false` | Second caller adds nothing back |
| Webhook retry | Unique `webhook_events.event_id` | Duplicate insert, HTTP 200, no second side effect |
| Coupon cap | `UPDATE coupons SET usage_count = usage_count + 1 WHERE usage_count < limit` after `FOR UPDATE` | The code is rejected |

A Redis lock was rejected because if Redis is down you must choose fail-open (oversell) or fail-closed (no checkout). The stock truth is already in Postgres.

## 7. Data model, the part worth memorizing

- `OrderItem` copies the name and image key at purchase time. A later catalog edit must not rewrite a receipt.
- Images are stored as keys. The public URL is `IMAGE_BASE_URL` plus the key, computed when the JSON is built.
- Unique indexes are concurrency controls: webhook event id, one review per user per product, Razorpay payment id, guest `public_token`.
- `ConsentRecord` is append-only. A withdrawal is a new row with `granted = false`, not an edit of the old row, because an audit asks what was agreed and when.

## 8. Privacy

Erasure and tax retention pull in opposite directions. The account and marketing fields can be wiped. Invoices and payment identifiers stay for the statutory window. The retention sweeper deletes personal data whose keep-until date has passed. It does not delete the row that an accountant still needs. The design is in `internal/handlers/privacy.js`.

## 9. What you would change, and when

| Pressure | Change |
|---|---|
| Catalog read p95 misses the budget | Keep the two-tier cache. Add a CDN in front of public GETs. Do not cache `/orders` |
| More than one API replica and stale L1 | L1 is per process and expires in about 2 minutes. Explicit delete on write still clears Redis. Accept a short L1 window, or drop L1 if that window is too long |
| Checkout transactions get slow | Split read-only catalog from the write primary. Do not split the stock update from the order insert |
| Chat traffic dwarfs the shop | Scale `apps/ai` separately. It is already a separate process |
| Corpus grows past a few hundred chunks | Move vectors to pgvector. The NumPy array is correct at ~60 plants |
| A second team owns payments | Then a repository boundary around orders is worth the files |

## 10. Interview close

“I kept one writer for money and stock, cached the read path, and put the model in a process that cannot see the database. The alternatives were a Redis lock, a model inside the web app, and a microservice per table. Each of those adds a failure mode on the path that has to be correct.”
