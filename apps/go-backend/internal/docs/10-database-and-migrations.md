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

`models.StringArray` is a custom type implementing `driver.Valuer` +
`sql.Scanner` + JSON marshal/unmarshal, mapping a Go `[]string` onto a
Postgres `text[]` column with manual array-literal escaping — used for
`Product.Tags` and `ProductSize.ImageKeys`.

## Schema creation: `AutoMigrate`

`internal/handlers/handler.go`, `Handler.AutoMigrate()` — runs GORM's
`AutoMigrate` across every model, then calls `EnsureSearchIndexes()`. This
runs automatically on every boot when `AUTO_MIGRATE=true` (the default) — see
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

Each statement's error is logged and **ignored**
(`log.Printf("[DB] search index skipped: %v", err)`) rather than failing
startup — intentional, so a local dev database without permission to
`CREATE EXTENSION` (e.g. some managed Postgres tiers) still boots the
server, just without the search-speed indexes.

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
