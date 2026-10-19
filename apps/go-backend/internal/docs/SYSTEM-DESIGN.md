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
- Track and manage orders through fulfillment — courier booking, AWB, tracking, delivery — and escalate delivery/refund issues to human support.
- Hold stock from the moment an order is created, so two shoppers cannot both pay for the last plant.
- Cancel and refund an order, including refunds initiated from the payment provider's own dashboard.
- Issue a GST tax invoice per order and a monthly report an accountant can reconcile against a GSTR filing.
- Accept discount codes whose value is decided by the server, never by the client.
- Collect moderated product reviews with a verified-purchase signal.
- An AI chat assistant that answers plant-care questions, surfaces relevant products, and can read the caller's own orders/wishlist when logged in.
- Identify a plant from a photo (Pl@ntNet).
- An admin surface: catalog CRUD, order status management, support-ticket triage, and a request-volume-by-region dashboard.

**Non-functional**
- **Low read latency** on the catalog — it's the majority of traffic and directly affects conversion.
- **Graceful degradation** — Redis, GCS, SMTP, the AI provider, and every third-party integration are all individually optional; losing one should degrade a feature, not take down the API.
- **Low operating cost** — free-tier-friendly choices where reasonable (e.g. Gemini's free-tier model as the default AI provider, a single small VM/container rather than a fleet).
- **India-specific correctness** — phone-number formats, ₹ currency, Razorpay (not Stripe), MSG91 (not Twilio), GST-inclusive pricing, April–March financial years.
- **Regulatory compliance** — the DPDP Act 2023 and DPDP Rules 2025 govern consent, access, erasure and retention, and two of their requirements conflict; see [§11](#11-privacy-and-data-retention).
- **No money moves without a record of it** — a payment, refund or stock movement must never be observable at the provider but absent locally, and must never be applied twice.
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
factored out as plain functions. See [§13](#13-trade-offs--where-this-would-need-to-change)
for when a layer would start paying for itself.

Three background workers run in the same process, started from
`cmd/server/main.go` before the listener and stopped by a shared context
cancelled on `SIGINT`/`SIGTERM`: an inventory sweeper that returns stock
from abandoned checkouts, a shipment worker that books couriers and
refreshes tracking, and a retention sweeper that enforces DPDP retention.
They are in-process for the same reason there is no service layer — they
need the same dependencies the handlers already have, and a second
deployable would be more operational surface than it saves. See
[01](./01-architecture.md#background-workers).

## 4. Component responsibilities

| Package | Owns |
|---|---|
| `internal/server` | The route table and the global middleware chain — the one place HTTP paths are wired to handler methods. |
| `internal/handlers` | Every endpoint's business logic, plus the background workers. Organized by domain (`auth.go`, `products.go`, `checkout.go`, `payments.go`, `webhooks.go`, `orders.go`, `inventory.go`, `coupons.go`, `refunds.go`, `invoicing.go`, `shipments.go`, `reviews.go`, `privacy.go`, `addresses.go`, `chat.go`, `plants.go`, `dashboard.go`, ...). |
| `internal/models` | The Postgres schema, as GORM structs. Source of truth for `AutoMigrate`. |
| `internal/cache` | Two-tier response cache + the `ServePublic`/`ServePrivate` HTTP helpers. |
| `internal/auth` | JWT issuance/parsing and the auth/admin middleware. |
| `internal/middlewares` | Security headers, rate limiting, IP resolution, request logging, Prometheus timing. |
| `internal/config` | Env-var configuration, with every integration optional. |
| `internal/db` | Postgres and Redis connection setup and pooling. |
| `internal/services` | Email (SMTP), OTP and verification-proof tokens (Redis + memory fallback), and GST invoice PDF rendering — used across auth, checkout, password reset and invoicing. |
| `internal/services/storage` | The image-storage abstraction (GCS today). |
| `internal/fulfillment` | Delivery zones, channels and fee policy — the authority on what a delivery costs and which channels can serve an address. |
| `internal/shiprocket` | The courier client: credential exchange and the serviceability check (`client.go`), and order/AWB/pickup/tracking calls (`shipments.go`). |
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

User ──< Address                      Order ──< Refund
Coupon ──< CouponRedemption >── Order

RequestedProduct        — standalone demand-signal table (chat- or form-sourced)
OrderSupportRequest     — standalone support-ticket table (chat-sourced), optionally linked to Order/User
BackInStockRequest      — restock notification subscription; doubles as a demand signal
ConsentRecord           — append-only DPDP consent/withdrawal audit trail
WebhookEvent            — idempotency ledger for inbound provider webhooks
```

Three patterns recur across the schema and are worth calling out because they
shape a lot of handler code:

- **Snapshot, don't reference, at order time.** `OrderItem` copies the
  product's name and image key rather than joining `Product` live — so an
  order's receipt stays accurate even if the product is later edited,
  repriced, or deleted.
- **Storage key vs. resolved URL.** Every image field is stored as a
  provider-agnostic key (`image_key`); the absolute URL is computed at read
  time from `IMAGE_BASE_URL`. See [07](./07-images-and-storage.md).
- **A unique index is a concurrency control, not just a constraint.**
  `webhook_events.event_id`, `(reviews.product_id, reviews.user_id)`,
  `payments.razorpay_payment_id` and `orders.public_token` are each load-
  bearing: the first makes webhook dedup atomic without a lock, the second
  enforces one review per customer per product, the third lets a replayed
  payment upsert rather than error, and the fourth is what makes a guest's
  order handle unguessable *and* single-purpose. See
  [10](./10-database-and-migrations.md).

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
create-order is the only way to start a payment, and almost everything it
does is a refusal to trust the request. It validates the shipping address,
resolves every line item against the database (`buildOrderItems`) in one
batched query per entity — never N+1 — and takes each line's **price from
the product row**, ignoring the price the client sent. A guest must
present the single-use proof token that `verify-email-otp` minted for that
exact address. The chosen fulfillment channel is required, because the
server re-runs the delivery quote against it and the repricing check was
otherwise skippable by omitting one field. Any coupon code is re-evaluated
server-side. Only then does it create the order in Razorpay, and the local
`Order` row, its stock reservation and its coupon redemption commit in a
single transaction — an order without its reservation would oversell, a
reservation without an order would leak stock.

Once the client completes payment, `verify` (or, independently, Razorpay's
own webhook) calls `markOrderPaid`, which is intentionally idempotent:
both the client-driven verify call and the server-to-server webhook can
race to confirm the same payment, and only the first is allowed to trigger
the confirmation email, the merchant alert and the stock commit. See
[§7](#7-correctness-under-concurrency) for how that exactly-once property
is obtained.

## 7. Correctness under concurrency

A shop has a handful of places where two callers can legitimately arrive
at the same moment and only one of them may win: the last plant in stock,
the hundredth use of a coupon capped at a hundred, the same payment
confirmed by both a browser callback and a webhook. The system resolves
all of them the same way, and the choice is worth stating explicitly
because it is what keeps the architecture simple.

**The database arbitrates; the application does not lock.** Every
contended transition is expressed either as a conditional
`UPDATE ... WHERE <the condition>` whose `RowsAffected` tells the caller
whether it won, or as an insert that races on a unique index. Postgres is
already a transactional, single-primary system that serialises these for
us; adding an application mutex or a Redis lock on top would add a
dependency that can fail — and a Redis lock in particular can fail *open*,
which is exactly the wrong direction for an oversell or a double refund.

Where the pattern is used:

| Transition | Primitive | What losing looks like |
|---|---|---|
| Order → paid | `UPDATE orders SET payment_status='paid' WHERE id = ? AND payment_status <> 'paid'` | `RowsAffected == 0`; the caller skips notifications and the stock commit, so the confirmation email is sent exactly once however the payment is reported |
| Reserve stock | `UPDATE products SET stock = stock - ? WHERE id = ? AND (track_inventory = false OR stock >= ?)` | `RowsAffected == 0` rolls back the whole order transaction and answers `409 out_of_stock` |
| Release stock | `UPDATE orders SET inventory_released = true WHERE id = ? AND inventory_released = false` | The release is claimed before any units are credited, so a replayed failure event or a sweep racing a webhook cannot inflate stock |
| Webhook dedup | `INSERT INTO webhook_events (event_id, ...)` against a unique index | The duplicate delivery gets a unique violation and returns `200 {"duplicate": true}` without reprocessing |
| Coupon cap | `UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ? AND usage_count < usage_limit` | `RowsAffected == 0` rejects the redemption, so two simultaneous checkouts cannot push a global cap past its limit |

Each row of that table is the same idea: **put the check inside the
statement that acts on it**, so there is no window between deciding and
doing. A read-then-write version of any of them has a race that is
invisible in testing and expensive in production.

### Inventory: reserve, commit, release

Stock is held from **order creation**, not from payment. The window
between the two is minutes, and a customer who has reached the payment
screen should not lose the plant to someone who is still browsing. The
cost of that choice is that an abandoned checkout holds stock it is never
going to buy, which is what the sweeper exists to undo.

The lifecycle has exactly three transitions, all in
`internal/handlers/inventory.go`:

- **Reserve** at order creation, inside the order transaction.
- **Commit** on the paid transition. Usually the units are still deducted
  and this only stops the sweep from clawing them back. The case that
  needs care is a payment that lands *after* the sweep already returned
  the stock — a slow bank redirect, a tab left open — where simply
  clearing the flag would mark an order paid against units now back on the
  shelf. So a released reservation is re-taken, and if the units can no
  longer be had the order still stands (the money has been taken; refusing
  would leave a real payment with no order) and a support request is
  raised for a human to source or refund. An oversell someone is told
  about is strictly better than one discovered at packing time.
- **Release** on payment failure, cancellation, or the abandoned-order
  sweep after `abandonedOrderTTL` (30 minutes).

The sweep deliberately leaves `payment_status` alone and only marks the
order `abandoned`, precisely because a late payment is still possible and
`markOrderPaid` knows how to re-reserve. `inventory_reservation_conflicts_total`
counts how often two shoppers raced for the last unit, which doubles as
the signal that stock levels have drifted from reality.

## 8. Caching strategy

Detailed in [04](./04-caching.md); the short version, and why:

- **L1 (in-process) + L2 (Redis)**, because a Redis round trip — even a fast
  one — costs more than a map lookup, and hot catalog keys are read on
  nearly every request.
- **`singleflight`-coalesced loads**, because a cache entry expiring under
  load is exactly when a "thundering herd" of duplicate DB queries is most
  costly — coalescing collapses N concurrent misses into 1 DB query.
- **Redis is optional for caching** — a `nil` Redis client makes
  `cache.Helper` fall back to L1-only, which is slower but correct.
  Rate limiting is deliberately *not* uniformly optional; see
  [§9](#9-reliability-what-happens-when-a-dependency-is-down) for the
  fail-open/fail-closed split and why a blanket fail-open policy was the
  wrong default.
- **TTLs are tuned per resource volatility**, not uniform: a single
  product's detail page (30 min) changes less often than a list/search
  result (5–10 min), which changes less often than a user's order list
  (2 min, since status updates are the whole point of checking it).

## 9. Reliability: what happens when a dependency is down

| Dependency down | Effect |
|---|---|
| **Redis** | Caching falls back to the in-process L1 tier. Rate limiting splits: catalogue reads fail open, while the buckets that guard credentials or spend money fail closed onto an in-process counter (below). Phone-OTP send returns 503 (the one hard dependency, because the send caps need atomic counters). |
| **Google Cloud Storage** | Image uploads return 500; already-stored `image_key`s just resolve to empty `ImageURL`s instead of erroring — the API stays usable without pictures. |
| **SMTP** | OTP-email and password-reset endpoints return 503 up front (checked before attempting to send); order-confirmation/merchant-alert emails are fire-and-forget goroutines, so a payment still succeeds even if the confirmation email fails. |
| **OpenAI/Gemini** | Chat falls back to canned, keyword-matched plant-care answers (`getFallbackResponse`) — never a 500, never a blank response. |
| **Razorpay** | Checkout/payment endpoints fail loudly (500/502) — there's no safe fallback for a payment provider being down, and there shouldn't be. |
| **MSG91 / Truecaller / Google OAuth / Pl@ntNet / Cloudflare Analytics** | Each returns a scoped 503/502/400 from only the endpoints that need it; unrelated endpoints are unaffected because none of these are constructed unless configured. |
| **Postgres** | Not optional. Every handler needs it; the server won't boot without a working `DATABASE_URL`/`HYPERDRIVE_URL`. |

The pattern underneath all of this: **construct optional dependencies once
at boot as `nil`-or-real, and let every call site's zero-value behavior be
"degrade this one feature," never "crash."**

### Fail open or fail closed

"Degrade, don't crash" is the right instinct for a read path and the wrong
one for a rate limiter. Every limiter used to fail **open**: any Redis
error, or no Redis at all, and the request went through unlimited. As a
blanket policy that has a bad property — a single Redis outage silently
removes every limit in the system at once, which is precisely the moment
abuse becomes cheapest, and nothing alerts, because from the outside the
API is simply up and fast.

So the decision is made per bucket, by asking what an unlimited request
costs. Catalogue reads still fail open: the worst case is cache-bypassing
read load on Postgres, a capacity problem, and refusing to serve the shop
to protect against it is a worse outcome than serving it. Login and OTP,
checkout, chat and plant identification fail **closed** — they guard
credentials, reserve inventory, or call a paid SMS or AI provider, and an
outage that makes credential stuffing free or an AI bill unbounded is not
a degradation anyone would choose.

Failing closed does not mean refusing everything, because that would hand
an attacker a cheap outage instead. A fail-closed bucket falls back to
`localLimiter`, an in-process fixed-window counter. It is honestly worse
than the Redis version: it is per-process, so with N replicas the
effective limit is N times the configured one and the windows are not
aligned. But N× a bounded budget is still bounded, where failing open is
not bounded at all. Detail and the per-bucket table are in
[08](./08-middleware-and-security.md).

### Liveness versus readiness

The two probes answer different questions and must not be conflated.
`GET /healthz` is **liveness** and performs no dependency checks at all.
That is a requirement rather than an omission: a liveness probe that
touches a datastore will fail during a database incident, the orchestrator
will restart every pod, and a recoverable dependency outage becomes a
self-inflicted rolling restart that also throws away every in-process
cache.

`GET /readyz` is **readiness** — whether this instance should receive
traffic — and grades its dependencies by whether the instance is still
useful without them. Postgres is fatal (`503`, `down`), because a worker
that cannot query the database cannot serve a request. Redis is not
(`200`, `degraded`), because the application was specifically built to
work without it, and pulling every instance out of rotation over Redis
would manufacture the outage the design avoids. Checks run under a
2-second timeout so a hung database cannot hang the probe itself.

## 10. Security model

- **AuthN**: HS256 JWTs (`internal/auth`), 24h TTL, with a `Scope` claim
  (`full`/`onboarding`) that lets a brand-new phone/Truecaller signup get a
  token immediately while restricting it to the profile-completion endpoint
  until a name is set. Scope is enforced **where the route is mounted**,
  not inside handlers: the private group runs under `FullAuthMiddleware`,
  so the default for any route added to it later is the strict one. A
  scope check living in a handler protects only the handler that
  remembered to do it, and its failure mode is silence.
- **Capability tokens**: the two opaque handles the system issues —
  `Order.PublicToken` for guest order lookup, and the checkout
  email-verification proof — are each bound to one subject and authorise
  exactly one thing. Neither is a session and neither widens with the
  holder's identity, which is what makes handing one to a guest's browser
  acceptable.
- **AuthZ**: role check (`admin`/`superadmin`) via `appauth.IsAdminRole`,
  applied either as router-level middleware (product/image mutations) or as
  an inline guard at the top of a handler (order/support/dashboard admin
  actions) — both paths go through the same one function, not duplicated
  string comparisons.
- **Payment integrity**: HMAC-SHA256 signatures are verified and
  **enforced** on both paths — the Razorpay webhook over the raw body, and
  the client-driven verify call over `"<order_id>|<payment_id>"`. The two
  use deliberately different secrets, which is why the shared primitive
  takes the secret as a parameter rather than reading config. Verification
  can only be relaxed by an explicitly non-production `APP_ENV`; a missing
  secret does *not* disable it, and production refuses to boot without
  both. `GET /order` is authorised by owner or opaque token rather than by
  a sequential ID. See [05](./05-orders-checkout-payments.md).
- **Transport/headers**: HSTS, `X-Frame-Options: DENY`, `nosniff`, a
  locked-down `Permissions-Policy`, and no CSP (a pure JSON API has nothing
  for a CSP to protect).
- **Abuse control**: per-route Redis rate limits (tighter on auth/checkout/
  chat/plant-ID than general reads), plus MSG91-specific per-number/per-IP
  OTP throttling on top.
- **Secrets**: environment variables only, loaded once at boot; nothing is
  hardcoded, and production refuses to boot on a default/empty
  `JWT_SECRET` or a missing Razorpay secret.
- **Observability of security failures**:
  `payment_signature_failures_total{stage}` and
  `inventory_reservation_conflicts_total` exist so a correctness or
  configuration failure is visible rather than silent — a sustained jump
  on `stage="webhook"` means a mismatched webhook secret, and the label
  says which secret to look at.

## 11. Privacy and data retention

India's DPDP Act 2023 and the DPDP Rules 2025 are the binding constraint
on how long customer data may be kept, and they contain two requirements
that pull in opposite directions:

- **Rule 8(3)** requires transactional personal data and processing logs
  to be retained for at least **one year** from the date of processing —
  *even after the user deletes their account*.
- **Section 8(7)** requires erasure once the purpose for which the data
  was collected has been served.

A literal reading of either one alone produces a non-compliant system. A
blanket delete on request breaches the retention floor and destroys the
record of a transaction that may still be disputed or audited. Keeping
everything until the year elapses ignores an erasure right the data
principal can exercise today.

The resolution is to treat erasure as a change in *what* is held rather
than a single moment of deletion: **scrub now, retain minimised, then
sweep**. `POST /privacy/erase` (`internal/handlers/privacy.go`) scrubs
account identifiers immediately — name, email and phone are overwritten,
the user row surviving only as a tombstone so order foreign keys stay
valid — deletes the things that serve no retained purpose at all (saved
addresses, wishlist, back-in-stock subscriptions), anonymises reviews
rather than deleting them (the content is useful to other shoppers and is
no longer personal data once detached from an identity), and **minimises**
the order rows by dropping contact details while keeping the transaction
record itself. `SweepExpiredData`, run daily by `StartRetentionSweeper`,
then removes those minimised rows and the webhook-event processing logs
once `transactionalRetention` (365 days) has passed.

Two further properties follow from the same reasoning:

- **Erasure is refused while an order is in transit**, with an explanatory
  `409`. The delivery address is the only thing that can get the parcel to
  the customer, and the purpose it was collected for is demonstrably not
  yet served.
- **Consent is append-only.** A withdrawal is a new `consent_records` row
  with `granted = false`, never a mutation of the original grant, because
  the question an audit asks is what was agreed *and when* — which a
  mutated row cannot answer. Records carry the `NoticeVersion` they were
  given against, so consent to a superseded notice does not silently carry
  forward.

`GET /privacy/export` answers the right of access, and includes the
retention notice explicitly so a customer reading their own export is not
surprised that order records outlive their account.

## 12. Scalability

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
  response latency. Provider webhooks take this furthest: they are
  acknowledged as soon as the event is durably claimed and processed
  afterwards, because Razorpay wants a 2xx within five seconds and treats a
  timeout as a delivery failure — doing the work inline would push it into
  a retry cycle against work already in progress.
- **The tickers scale with replica count, which is the one thing here that
  does not want to.** Every replica runs all three workers. Correctness is
  not at risk, because each transition is claim-based, but the duplicated
  scanning is real and is the first thing to move out if replica count
  grows.

## 13. Trade-offs — where this would need to change

Documented deliberately, not accidentally:

- **No repository/service layer.** Correct trade-off *today* — this domain
  has one data store and one consumer of each query shape. It would stop
  being correct if: multiple handler families needed the same complex
  business query with independently-evolving business rules, or the
  project needed to swap GORM/Postgres for something else. Neither is true
  yet; introducing the layer earlier would just be indirection with no
  payoff.
- **One order-creation endpoint.** There used to be two —
  `/checkout/create-order` and `/razorpay/order` — sharing validation but
  not their guarantees: the second built a Razorpay order from a
  client-supplied amount with no cart validation at all. Keeping it for
  backward compatibility meant keeping a path around the repricing,
  stock-reservation and email-verification checks the other one performs,
  so it was removed rather than maintained. The cost is that an old client
  gets a `404` instead of a silently wrong order, which is the better
  failure.
- **Fail-closed rate limiting degrades to a per-process counter**, so the
  effective limit during a Redis outage is N× the configured one across N
  replicas. The alternative — a shared store that is itself the thing that
  is down — does not exist, and refusing all traffic would convert an
  abuse-prevention measure into an outage.
- **The in-process L1 cache can diverge across replicas** for up to its
  TTL. Acceptable because it only holds catalogue reads, where a few
  minutes of staleness is invisible; it would not be acceptable for
  anything that gates a write.
- **Tests cover decisions, not integrations.** Unit tests now reach the
  parts of the handler package where being wrong costs money — signature
  verification, GST extraction, financial-year boundaries, proof-token
  single-use, fail-open versus fail-closed limiting — but there is still
  no suite that exercises a handler against a real Postgres. The handlers
  are structured to make that addable: `*gorm.DB` and `*redis.Client` are
  both nil-able/swappable and `handlers.New` takes them as plain
  constructor arguments rather than reaching for globals.
- **Background workers run in the API process**, which means every replica
  runs every sweep. The transitions they perform are all idempotent and
  claim-based ([§7](#7-correctness-under-concurrency)), so concurrent
  sweeps are safe rather than merely unlikely to collide — but it is
  duplicated work, and at a larger replica count these would want to be a
  single scheduled job.
- **Single-region, single-primary Postgres.** Appropriate for the traffic
  shape in [§1](#1-what-this-system-is); would need read replicas and/or
  regional caching before it'd be appropriate for global, write-heavy
  traffic.

## 14. Deployment topology

```
cmd/server binary  →  Postgres (schema owned by AutoMigrate)
                    →  Redis (cache + rate limits + OTP; optional)
                    →  Google Cloud Storage (images; optional)
                    →  Razorpay / Shiprocket (inbound webhooks on / , not /api/v1)
                    →  Prometheus scrapes /metrics  →  Grafana dashboards
   (same process)   →  inventory sweeper · shipment worker · retention sweeper
```

Orchestrator probes should point at `/readyz`, not `/healthz` — see
[§9](#9-reliability-what-happens-when-a-dependency-is-down). The two
provider webhook paths must be reachable from the public internet
independently of `/api/v1`, since they are mounted on the root router.

`docker-compose.yml` (repo root) runs Postgres, Redis, Prometheus, and
Grafana for local development; `cmd/server` itself is typically run
directly with `go run`/a compiled binary rather than in that compose stack.
Configuration is 100% environment-variable driven
([01](./01-architecture.md#config)), so the same binary runs unmodified in
dev, staging, and production.

## 15. If you're extending this system

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
- **A new inbound provider webhook**: claim the event through
  `claimWebhookEvent` before doing anything with it, acknowledge, then
  process in the background — and refuse the request outright when the
  expected secret or token is unconfigured. Treating an empty expected
  value as "skip the check" turns an incomplete deployment into an open
  endpoint for mutating order state.
- **A new transition two callers can race for**: express the check inside
  the statement that acts on it and branch on `RowsAffected`, the way the
  paid transition, the stock reservation and the coupon counter already do
  ([§7](#7-correctness-under-concurrency)). Reaching for a lock is the
  signal that the condition has been left outside the write.
- **A query shape reused by 3+ handlers**: that's the signal to promote it
  from a handler-local query into `query.go`, the way `productCardQuery`
  and `applyOrderFilters` already are — not a signal to introduce a
  repository layer for the whole codebase.
