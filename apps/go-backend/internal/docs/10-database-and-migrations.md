# Database, Models & Migrations

## ORM

GORM (`gorm.io/gorm`) over Postgres (`gorm.io/driver/postgres`, pgx under
the hood). See [01-architecture.md](./01-architecture.md#database--redis-connections)
for connection pool/logger setup.

## Models (`internal/models/models.go`)

All models embed a shared `Base`:

```go
type Base struct {
    ID        uint
    CreatedAt time.Time
    UpdatedAt time.Time
    DeletedAt gorm.DeletedAt `gorm:"index"`  // soft delete
}
```

Soft deletes (`DeletedAt`) are used for `Product` (`DeleteProduct`) and
`Wishlist` — deleted rows are excluded from normal queries automatically by
GORM, but can resurface via `Unscoped()` queries (deliberately used in
`RemoveFromWishlist`/`AddToWishlist` to allow re-adding a previously
soft-deleted wishlist row without violating the `(user_id, product_id)`
unique index — see `internal/handlers/wishlist.go`).

Entity relationships are documented in
[03-catalog-and-search.md](./03-catalog-and-search.md#data-model-internalmodelsmodelsgo)
for the catalog side. Order-side models (`Order`, `OrderItem`, `Payment`,
`OrderSupportRequest`, `RequestedProduct`) are covered in
[05-orders-checkout-payments.md](./05-orders-checkout-payments.md).

### Operational and compliance tables

Beyond the catalog and order core, seven tables exist to make specific
guarantees that cannot be made in application memory:

| Table | Model | What it is for |
|---|---|---|
| `webhook_events` | `WebhookEvent` | Idempotency ledger for inbound provider webhooks (`razorpay`, `shiprocket`). Every event is claimed by its provider event ID before any side effect runs. Rows left in `received`/`failed` are the manual-reconciliation queue. |
| `refunds` | `Refund` | One row per refund against an order, written *before* the provider is called so a timeout cannot move money with no local record. Advanced to a terminal state by `refund.processed` / `refund.failed`. |
| `coupons` | `Coupon` | Discount codes: type and value, minimum subtotal, category/product scope, validity window, global and per-user caps, first-order-only flag. |
| `coupon_redemptions` | `CouponRedemption` | One row per successful application, which is what makes per-user limits enforceable — including for guests, who are identified by `email` rather than `user_id`. |
| `addresses` | `Address` | Saved shipping address book so repeat customers do not retype it. |
| `consent_records` | `ConsentRecord` | The DPDP Act audit trail: purpose, grant/withdrawal, notice version, IP, user agent. Append-only — a withdrawal is a new row with `granted = false`, never a mutation of the original grant, because the question an audit asks is what was agreed *and when*, which a mutated row cannot answer. |
| `back_in_stock_requests` | `BackInStockRequest` | Notification subscriptions for out-of-stock items, which for a nursery doubles as a demand signal for what to propagate next. |

### Columns added to existing tables

`Order` carries most of them, because an order accumulates state from four
separate subsystems after it is created — shipping, tax, cancellation and
inventory:

| Column | Type | Purpose |
|---|---|---|
| `public_token` | `varchar(64)`, uniqueIndex | Opaque guest handle for order lookup (32 random bytes, hex). |
| `shipment_id` | string | Aggregator shipment ID, persisted before the AWB is requested so a retry cannot double-book. |
| `awb_number` | string, `idx_orders_awb` | Courier tracking number. Its presence also makes an order non-cancellable. |
| `tracking_url` | string | Customer-facing tracking link. |
| `shipped_at`, `delivered_at`, `pickup_booked_at` | `*time.Time` | Fulfillment milestones, set from webhook or polled status. |
| `review_requested_at` | `*time.Time` | Stops the post-delivery review email being sent twice. |
| `taxable_value`, `tax_amount` | float | GST split; these sum to `subtotal`, because catalogue prices are tax-inclusive and the tax is extracted rather than added. |
| `invoice_number` | `varchar(32)`, uniqueIndex | Assigned once on the first paid transition, so it stays stable across re-downloads. |
| `invoice_date` | `*time.Time` | Date the number was allocated; drives the financial-year series. |
| `cancelled_at`, `cancel_reason` | `*time.Time`, string | Cancellation bookkeeping. `cancelled_at` being set makes `IsCancellable()` false. |
| `refunded_amount` | float | Running total, credited by a single `UPDATE` so concurrent partial refunds cannot lose an increment. |
| `inventory_released` | bool, default false | The claim flag for the stock-release path: a release sets it conditionally, so a double release cannot inflate stock. |
| `coupon_id`, `coupon_code`, `discount_total` | `*uint`, string, float | The applied coupon and the discount the *server* computed. |

`Product` gains inventory, rating and tax columns:

| Column | Type | Purpose |
|---|---|---|
| `track_inventory` | bool, default true | False means "always available" — made-to-order or effectively unlimited items like seed packets. Checked inside the conditional stock `UPDATE`, so it is the database that decides. |
| `low_stock_threshold` | int, default 5 | Drives the "only N left" cue and the admin low-stock report. |
| `rating_average`, `rating_count` | float, int | Denormalised from approved reviews so list pages never need a join. Recomputed from scratch by `RecalculateProductRating`. |
| `hsn_code` | string | HSN classification for the GST invoice. |
| `gst_rate` | float, default 0 | Per-product rate as a percentage. Zero falls back to `DefaultGSTRate`, which is also 0 — nursery stock is predominantly nil-rated, while pots, soil and tools carry a real rate. |

`Review` gains the columns moderation needs:

| Column | Type | Purpose |
|---|---|---|
| `status` | string, default `pending`, `idx_reviews_status` | Gates public visibility: `pending`, `approved`, `rejected`. Only approved rows are served or counted towards a rating. |
| `title` | string | Optional review headline. |
| `verified_purchase` | bool, default false | Set when the author has a paid order containing the product. Shown as a badge and weighted higher in sorting. |
| `image_keys` | `text[]` | Customer photos — for plants, the most useful part of a review, since buyers want to see real delivered size and condition. |
| `admin_notes` | text | Internal moderation notes, never serialised publicly. |

`models.StringArray` is a custom type implementing `driver.Valuer` +
`sql.Scanner` + JSON marshal/unmarshal, mapping a Go `[]string` onto a
Postgres `text[]` column with manual array-literal escaping — used for
`Product.Tags`, `ProductSize.ImageKeys`, `Review.ImageKeys` and the
`Coupon.CategoryIDs`/`ProductIDs` scope lists.

## Schema creation: `AutoMigrate`

`internal/handlers/handler.go`, `Handler.AutoMigrate()` — runs GORM's
`AutoMigrate` across every model, then calls `EnsureSearchIndexes()`. All 22
structs declared in `internal/models/models.go` are registered in that call,
including the seven newer ones (`WebhookEvent`, `Refund`, `Coupon`,
`CouponRedemption`, `Address`, `ConsentRecord`, `BackInStockRequest`) — worth
checking whenever a model is added, because the list is hand-maintained and an
omission does not fail the boot. The server starts cleanly and the first query
against the missing table fails at runtime instead.

This runs automatically on every boot when `AUTO_MIGRATE=true` (the default) — see
`cmd/server/main.go`. There is no separate versioned-migration tool
(no golang-migrate/goose/atlas) — schema evolution is driven by editing the
Go structs and letting `AutoMigrate` reconcile columns/indexes/constraints
additively (it will add missing columns/tables but never drops or renames
anything, by GORM design).

`EnsureSearchIndexes()` runs a fixed list of idempotent (`IF NOT EXISTS`)
raw SQL statements after `AutoMigrate`:
- `CREATE EXTENSION IF NOT EXISTS pg_trgm` + trigram GIN indexes on
  `products.name`, `products.short_desc`, `categories.name`, `brands.name`
  (powers the `ILIKE`-based search in `SearchProducts`).
- A GIN index on `products.tags` (array containment/search).
- A **partial** unique-ish lookup index `idx_products_slug_alive` on
  `products.slug WHERE deleted_at IS NULL` (speeds slug lookups while
  ignoring soft-deleted rows).
- FK-shaped indexes on `product_sizes.product_id`, `attributes.product_id`.
- A composite `reviews (product_id, created_at DESC)` index for the
  "latest 12 reviews" query in product detail.
- Several **partial, sorted** indexes for the common product-list access
  patterns: `featured = true`, `category_id + created_at`, and a plain
  `created_at DESC` — all filtered to `deleted_at IS NULL` — matching
  exactly the `ORDER BY created_at DESC` queries used by `ListProducts`,
  `FeaturedProducts`, `ProductsByCategory`.
- `idx_reviews_approved` on `reviews (product_id, created_at DESC)
  WHERE status = 'approved'` — approved rows are the only ones ever read
  publicly, so both the product-detail query and the rating recalculation
  filter on it.
- `idx_orders_unpaid_created` on `orders (created_at) WHERE
  payment_status = 'created' AND inventory_released = false` — the
  abandoned-reservation sweep scans unpaid orders by age every five minutes,
  and this keeps that from being a full table scan as the orders table grows.
- `idx_coupons_code_active` on `coupons (code) WHERE active = true` — coupon
  lookup by code happens on every checkout quote.

Each statement's error is logged and **ignored**
(`log.Printf("[DB] search index skipped: %v", err)`) rather than failing
startup — intentional, so a local dev database without permission to
`CREATE EXTENSION` (e.g. some managed Postgres tiers) still boots the
server, just without the search-speed indexes.

## Unique indexes that carry invariants

Everything in `EnsureSearchIndexes()` is a performance index — dropping one
makes a query slow, not wrong. The `uniqueIndex` tags in `models.go` are a
different category: each one is a correctness rule enforced by Postgres
rather than by application code, and that distinction is the point. An
invariant checked in Go is checked once per code path that remembers to check
it, and under concurrency a read-then-write check is not a check at all,
because two requests can both read "absent" before either writes. A unique
index is evaluated inside the insert, for every writer, with no coordination
between them.

Three of them do real work:

**`webhook_events.event_id`** (`uniqueIndex`, `varchar(128)`) is what makes
the exactly-once claim in `claimWebhookEvent` atomic. Razorpay delivers
at-least-once and does not guarantee ordering, so duplicates are normal
traffic, not an anomaly. The handler inserts a row keyed on the provider's
event ID — deliberately *not* an upsert, because the conflict is the signal
it wants — and treats a unique violation as "someone else already has this
one". Concurrent duplicate deliveries race on the insert, exactly one wins,
and the losers return `200 {"duplicate": true}`. The alternative designs are
both worse: a `SELECT` then `INSERT` loses the race outright, and an
application or Redis lock adds a dependency that can fail open and lets a
payment be processed twice. See
[08-middleware-and-security.md](./08-middleware-and-security.md) for the
surrounding verification and replay checks.

**`idx_reviews_user_product`** is a composite unique index declared across
`Review.ProductID` and `Review.UserID`, in that field order, so it is
`(product_id, user_id)`. It enforces one review per customer per product,
which is the whole integrity story for the rating aggregate: without it a
single user could lift a product's `rating_average` as far as they liked by
submitting repeatedly. Re-submitting is therefore an update of the existing
row rather than a second row, and `RecalculateProductRating` recomputes the
aggregate from scratch instead of incrementing, so a moderation reversal
cannot leave it drifting.

**`orders.public_token`** (`uniqueIndex`, `varchar(64)`) is the guest order
handle: 32 random bytes hex-encoded, minted at order creation and returned
once. It exists because order IDs are sequential, so the post-payment success
page cannot be allowed to look an order up by ID — doing so made the entire
order table enumerable, customer name, phone, email and address included.
Uniqueness matters because the token is the *only* credential on that read
path; a collision would hand one customer another's order. See `GetOrder` in
`internal/handlers/payments.go`.

The remainder are identity constraints: `users.email` and `users.phone`
(nullable, which is what lets passwordless phone accounts have no email),
`orders.razorpay_order_id`, `payments.razorpay_payment_id`, `coupons.code`,
`products.slug`, `categories.slug`, `brands.slug`, and
`wishlists (user_id, product_id)`.

One hazard is worth knowing when adding a unique index to a string column:
Postgres permits many `NULL`s in a unique index but treats `''` as an
ordinary value, so two rows holding the empty string collide. GORM writes the
Go zero value for a non-pointer `string` field that has no `default` tag,
which means such a column is only safe under a unique index if every insert
populates it. `orders.public_token` and `orders.razorpay_order_id` satisfy
that — both are set in the same `Create` — but `orders.invoice_number` and
`refunds.razorpay_refund_id` are assigned later (on the first paid transition
and after the provider responds, respectively) and are therefore inserted
empty. Columns in that shape want `*string` or a `default:null` tag.

## `migrations/*.sql` — hand-written scripts

These are **not** auto-applied by the server; they're meant to be run
manually (`psql $DATABASE_URL -f migrations/<file>.sql`) against existing
databases that predate a schema change, before `AutoMigrate`/
`EnsureSearchIndexes` existed or was updated to cover the same ground:

| File | Purpose |
|---|---|
| `phone_otp_auth.sql` | Makes `email`/`password_hash`/`phone` nullable and adds `phone_verified_at` — the schema change that enabled passwordless phone/Truecaller accounts. Normalizes empty strings to `NULL` for the unique indexes to work with multiple phone-only users. |
| `add_image_key_columns.sql` | Adds `image_key`/`image_keys` columns (the storage-key columns described in [07-images-and-storage.md](./07-images-and-storage.md)) with commented-out optional steps to backfill from old `image_url` data and drop the old columns once migrated. |
| `add_wishlists_table.sql` | Creates the `wishlists` table with FKs (`ON DELETE CASCADE`) and the `(user_id, product_id)` unique constraint — same shape `AutoMigrate` produces today, kept as a standalone script for environments that added wishlists before the `Wishlist` model existed. |
| `product_search_indexes.sql` | The same trigram/GIN/partial index set `EnsureSearchIndexes()` now creates programmatically — this file is the original manual version, now effectively superseded but kept for reference/manual runs. |

In short: **on any environment already running current `AutoMigrate` +
`EnsureSearchIndexes`, these scripts are redundant (their `IF NOT EXISTS`
guards make them safe no-ops)** — they're historical/manual-recovery
artifacts rather than a required deploy step.

## Standalone migration binary

`cmd/migrate/main.go` — loads config, connects to the DB, builds a
`Handler`, and calls `h.AutoMigrate()` once, then exits. Useful for a deploy
pipeline step that runs migrations before starting new server instances,
as an alternative to relying on `AUTO_MIGRATE=true` at server boot.

## Seed data (`seed/seed.go`)

`EnsureSampleData(db)` — runs only when `SEED_ON_STARTUP=true` (default
`false`, so production deployments don't accidentally seed fake data).
Creates a small, realistic dev dataset: a seller/buyer/admin user, two
categories with one subcategory each, three brands, one fully-populated
product ("Neem Plant") with three sizes (each with external placeholder
image URLs, not GCS keys — this predates/bypasses the image-key system for
simplicity), four attributes, and two reviews. Every insert uses
`FirstOrCreate` keyed on a natural identifier (email/slug/label/name),
making the whole function safe to run repeatedly without duplicating rows.
