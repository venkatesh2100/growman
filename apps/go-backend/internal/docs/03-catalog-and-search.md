# Catalog: Products, Categories, Brands, Search

## Data model (`internal/models/models.go`)

```
Category ─┬─< Subcategory ─┬─< Product >─┬─< ProductSize
          │                │             ├─< Attribute
          └────────────────┘             ├─< Review >─ User
Brand ────────────────────< Product

Product.CategoryID     → required
Product.SubcategoryID  → optional (*uint)
Product.BrandID        → optional (*uint)
```

`Product.Tags` is a `models.StringArray` — a hand-rolled `driver.Valuer`/
`sql.Scanner`/JSON marshaler that maps Go `[]string` onto a Postgres `text[]`
column (GORM's default array handling didn't fit here, likely because pgx/GORM
combos vary in native array support — the custom `Value()`/`Scan()` do manual
Postgres array literal escaping/parsing).

Image fields follow a consistent **key vs URL** split across `Product`,
`ProductSize`, and `OrderItem`: `ImageKey`/`ImageKeys` are the only things
persisted in Postgres; `ImageURL`/`Images` are `gorm:"-"` (never persisted)
and computed on read. See [07-images-and-storage.md](./07-images-and-storage.md).

## Query helpers (`internal/handlers/query.go`)

Two shared GORM query builders, chosen based on how much of the product a
caller actually needs:

- **`productCardQuery(ctx)`** — used everywhere a *list* of products is
  rendered (search results, category pages, featured, related). Selects a
  narrow column set, preloads only `Sizes` (with its own narrow `Select`),
  `Category` (id/name/slug), and `Brand` (id/name/slug). No `Attributes`, no
  `Reviews`. This exists purely to cut payload size and preload cost on
  high-traffic list endpoints.
- **`productListQuery(ctx)`** — the "everything" version (full `Sizes`,
  `Attributes`, `Category`, `Subcategory`, `Brand`), defined but not
  currently wired into a handler — product *detail* pages instead use
  `loadProductDetail` (below), which fetches associations concurrently
  instead of via GORM `Preload`.

`h.db(ctx)` wraps `h.DB.WithContext(ctx)` — every handler in this package
goes through it rather than touching `h.DB` directly, so request
cancellation/timeouts propagate into SQL calls.

`invalidateCatalog(ctx)` is the cache-busting function called after any
product/category/brand mutation — see [04-caching.md](./04-caching.md).

## Product detail loading (`internal/handlers/products.go`)

`GetProduct` → `loadProductDetail(ctx, slug)`. Rather than one GORM query
with five `Preload()`s (which, against a remote/Hyperdrive Postgres, means
five sequential round trips), it fetches the base product row first, then
fans out **sizes, attributes, reviews (limit 12), category, subcategory,
brand** concurrently via `golang.org/x/sync/errgroup`. Optional associations
(subcategory, brand) only get a goroutine if the product actually has that
foreign key set, and a not-found on those specifically is swallowed (not
every product has a subcategory/brand). Review authors are then batch-loaded
in one extra `WHERE id IN (...)` query (deduped user IDs) rather than N+1'd
per review.

## Listing & pagination

- `GET /products` (`ListProducts`) — `pkg/pagination.ParsePagination` reads
  `page`/`pageSize` query params (default 20, capped at 100). Count and page
  fetch run concurrently via `errgroup`.
- `GET /products/featured` (`FeaturedProducts`) — fetches `pageSize + 1` rows
  to derive `hasNext` without a separate `COUNT(*)` round trip, then trims
  back to `pageSize`.
- `GET /products/{slug}/related` (`RelatedProducts`) — same category, top 4,
  excluding the product itself.
- `GET /categories/{slug}/products`, `.../subcategories/{subSlug}/products` —
  capped at 200 results, no pagination metadata (simple `LIMIT` list).

## Search (`SearchProducts`, `GET /products/search?q=`)

- Query is trimmed, capped at 80 runes, lowercased; `escapeLike` escapes
  `\`, `%`, `_` before building `ILIKE '%term%'` patterns (prevents user input
  from injecting wildcard behavior).
- Matches across: `name`, `short_desc`, `description`, any tag
  (`unnest(tags)`), category name, and brand name (via `EXISTS` subqueries) —
  all in one `WHERE` clause reused for both the count and the data query.
- **Ranking** is a raw SQL `CASE` expression ordering: exact lowercase name
  match (0) → name prefix match (1) → name substring match (2) → tag match
  (3) → short-desc match (4) → everything else (5), then `created_at DESC`
  within each tier.
- Count and data queries run in two goroutines with plain channels (not
  `errgroup` here, functionally equivalent).
- Page size is capped at 40 for search specifically (tighter than the
  general 100 cap).
- Empty query short-circuits to an empty paginated response without touching
  the DB or cache.

## Categories, brands, tags, catalog nav

- `internal/handlers/categories.go` — `ListCategories`/`GetCategory` (with
  `Subcategories` preloaded), `ListSubcategories`, `ProductsByCategory`,
  `ProductsBySubcategory`.
- `internal/handlers/brands.go` — `ListBrands`, simple alphabetical list.
- `internal/handlers/catalog.go` — `ListTags` runs a
  `CROSS JOIN LATERAL unnest(tags)` to get the distinct set of tags across
  all products; `ListCatalog` (`GET /catalog`) bundles tags + full category
  tree in one response — this is what the frontend uses to build nav/filter
  UI in a single request instead of three.

## Admin mutations (`internal/handlers/products.go`)

`POST /products`, `PUT /products/{slug}`, `DELETE /products/{slug}` are
behind `appauth.AdminMiddleware` in the router.

- `CreateProduct` accepts an embedded `models.Product` plus optional
  `newCategory`/`newSubcategory` name strings — if provided (and no numeric
  ID given), it slugifies the name (`generateSlug`: lowercase, spaces/
  underscores → hyphens, strip anything non `[a-z0-9-]`) and
  `FirstOrCreate`s the category/subcategory on the fly, so an admin UI can
  create a product and a brand-new category in one submission. Category/
  subcategory IDs are still validated (existence + subcategory belongs to
  the given category) even when not auto-created.
- `UpdateProduct` does a full-replace `Save` with `FullSaveAssociations:
  true` (so nested `Sizes`/`Attributes` in the payload replace the existing
  set, not merge with it).
- `DeleteProduct` is a GORM soft delete (`DeletedAt`), not a hard delete.
- All three call `h.invalidateCatalog(ctx)` afterward.

## Image URL resolution

Every read path that returns products calls one of the
`ResolveProductImageURL(Slice)` helpers (`internal/handlers/image_helpers.go`)
right before marshaling the cache entry / response, converting stored
`ImageKey`/`ImageKeys` into absolute `ImageURL`/`Images` via
`h.ImageService`. If `ImageService` is `nil` (GCS not configured), these are
no-ops and URLs stay empty — the API still functions, just without image
links.
