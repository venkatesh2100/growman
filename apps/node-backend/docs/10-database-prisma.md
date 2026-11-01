# Database and Prisma

Say this first: Prisma is the query layer over the existing Postgres tables. Soft delete hides rows. The statements that must be atomic under concurrency stay as SQL. An empty database gets tables once. An existing database only gets indexes.

## Why Prisma

The handlers were written as `Product.findAll({ where, include })`. `internal/db/records.js` implements that shape on Prisma Client so the route files keep the same calls. `prisma/schema.prisma` maps camelCase fields onto snake_case columns (`image_key`, `payment_status`, and `product_size` on order items).

Alternative: call `prisma.product.findMany` in every handler. Clearer if you rewrite the handlers. Rejected for this pass because a mechanical rewrite of checkout and payments is how stock bugs land. The raw stock updates were already SQL and stayed SQL.

Alternative: keep Sequelize. It worked. Prisma is the schema you can read in one file, and the client is generated. The Go service uses GORM against the same tables. Do not run Go `AutoMigrate` and `prisma db push` against one database as two owners.

## Soft delete

`deleted_at` on the shop tables. Normal reads add `deleted_at IS NULL`. `destroy` sets `deleted_at`. `force: true` hard-deletes. Wishlist re-add clears `deleted_at` on the old row so the unique `(user_id, product_id)` index does not block a second save.

`present()` in `internal/models/present.js` strips password hashes, `deletedAt`, webhook payloads, push tokens, client IP, and user agent before JSON.

## Tables worth naming

| Table | Why it exists |
|---|---|
| `users`, `products`, `orders`, `order_items`, `payments` | The shop |
| `product_sizes` | One plant, many pots, each with stock |
| `webhook_events` | Idempotency. Unique `event_id` |
| `refunds` | A row before the provider call |
| `coupons`, `coupon_redemptions` | Server-side discount and per-user caps, including guests by email |
| `addresses` | Repeat checkout |
| `consent_records` | Append-only DPDP trail |
| `back_in_stock_requests` | Email when stock crosses from 0 to 1. Also a demand signal |
| `owned_plants`, `plant_health_logs` | The customer’s own plants, not the catalog |
| `chat_turns` | Account chat history. Not sent to Python as a database read |
| `quote_requests` | Bulk quotations |

`OrderItem.productSizeId` is stored in column `product_size`. The schema `@map` exists so Prisma does not look for `product_size_id`.

## Indexes

`ensureSearchIndexes` creates trigram indexes for search, partial indexes for “alive” slugs, unpaid orders, and active coupons, and unique partial indexes for referral codes, guest tokens, and invoice numbers (empty string must not collide). Prisma cannot express a `WHERE deleted_at IS NULL` index, so those stay SQL.

## Migrations

| Situation | What runs |
|---|---|
| Fresh database, no `users` table | `prisma db push` once, then indexes |
| Database already created by Go or an earlier boot | Indexes only |
| `pnpm migrate` | Connect, same step, exit |
| `pnpm db:generate` | Regenerate the client after a schema edit |

`SEED_ON_STARTUP` is idempotent sample data. Leave it false in production.

## Bigint ids

Postgres ids are `bigint`. The API speaks numbers. The record wrapper converts `bigint` to `Number` on the way out. That is safe while ids fit in `2^53`. Say that limit if someone asks. A string id is the alternative at a larger scale.

## Interview line

“The ORM is for reads and ordinary writes. The one-statement updates are SQL because the row count is the lock. The schema file is Prisma. The partial indexes are SQL.”
