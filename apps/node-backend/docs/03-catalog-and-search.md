# Catalog and search

Say this first: product pages are cached reads. Search is Postgres `ILIKE` with a rank, not the Python vector index. Dootha’s hybrid search is a different index over care text. Prices on a card always come from the `products` row.

## Why the catalog is not the RAG index

The shop has about 60 plants, sizes, stock, and prices that change. A product card must be exact. The care corpus is prose. Mixing them would let a stale sentence answer “how much is the snake plant?”. Catalog search lives in `internal/handlers/products.js`. Care search lives in `apps/ai`.

## Card shape

`internal/handlers/query.js` defines the grid payload: id, name, slug, prices, stock, tags, sizes, category, brand. Detail adds attributes and approved reviews. Handlers load those relations in one Prisma read with `include`, not one query per size.

Why a card type: list pages must not ship the full description and every review. The alternative, one fat product JSON everywhere, makes the home page slow and the cache large.

## Search rank

`searchProducts` matches name, short description, tags, category name, brand name, and description. The `ORDER BY` is a `CASE`:

1. Exact name
2. Name prefix
3. Name contains
4. Tag
5. Short description
6. Everything else, then newest

The match and the rank are SQL because Prisma’s `contains` cannot express that `CASE` or `unnest(tags)`. The ids come back in rank order. Prisma then loads the cards. Snapshot prices are not part of this query.

Trigram indexes (`pg_trgm` on name and short description) exist so `ILIKE '%snake%'` does not scan blindly as the catalog grows. They are created in `handler.ensureSearchIndexes`.

Alternative: Elasticsearch. Rejected at this catalog size. The operational cost is larger than the query. Meilisearch is the same argument. pgvector is for the care corpus if it grows, not for “snake plant” as a product name.

## Writes

Admin create and update run in a transaction: product, sizes, attributes. Then `invalidateCatalog` deletes `products:*`, `categories:*`, brands, tags, and the catalog nav key. A write that forgets invalidation serves the old price until the TTL. That is why invalidation sits next to the write, not in a nightly job.

## Reviews

One review per user per product, unique index. New reviews are `pending` until moderation. The average on the product is denormalized so a list page does not aggregate reviews. Recalculate on approve, do not increment in the request, or a double-submit drifts the average.

## Interview line

“Shop search is lexical and ranked in Postgres. Plant-care search is hybrid RAG in Python. I can tell you which index answers which question.”
