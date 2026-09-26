# Growman SEO Architecture

How search visibility works for **https://growman.live** (the `apps/web` Next.js
application), what is generated automatically, and what still has to be done by
hand.

- **Framework:** Next.js 16 (App Router, Turbopack), React 19
- **Hosting:** Cloudflare Workers via `@opennextjs/cloudflare`
- **Catalog source:** Go backend (`apps/go-backend`) over `NEXT_PUBLIC_API_URL`
- **Currency / market:** INR, India only

---

## 1. Current architecture

All SEO logic lives in two places, so nothing is duplicated across pages:

| Path | Responsibility |
| --- | --- |
| `lib/seo/site.ts` | Canonical origin, brand copy, real business details, private-path list |
| `lib/seo/metadata.ts` | Canonical URL building, metadata builders, product/price/image helpers |
| `lib/seo/jsonLd.ts` | Typed JSON-LD builders (Product, Breadcrumb, Organization, LocalBusiness, Article, FAQ, ItemList, CollectionPage) |
| `lib/seo/catalog.ts` | Cached, server-side catalog reads used by pages and the sitemap |
| `lib/seo/collections.ts` | Editorial introductions for category pages |
| `lib/seo/blog.ts` | File-based blog content model |
| `components/seo/JsonLd.tsx` | Renders JSON-LD safely (escapes `<`) |
| `components/seo/Breadcrumbs.tsx` | Visible breadcrumbs **and** their structured data from one list |

The production origin appears in exactly one place, `SITE_URL` in
`lib/seo/site.ts`. Override it per-environment with `NEXT_PUBLIC_SITE_URL`.

### Rendering model

Search engines must see content without executing JavaScript, so the
commercially important pages are server components:

| Page | Before | Now |
| --- | --- | --- |
| `/` | `'use client'`, featured products fetched in `useEffect` | Server component; products, category links and care guides in the HTML |
| `/categories/[categorySlug]` | `'use client'`, `useEffect` fetch | Server component, SSG via `generateStaticParams` |
| `/categories/[c]/[subcategorySlug]` | `'use client'`, `useEffect` fetch | Server component, SSG |
| `/product/[slug]` | Server-rendered, no metadata | Server-rendered with full metadata and structured data |
| `/shop` | Server-rendered, no `h1` | Server-rendered with `h1`, breadcrumbs and intro copy |

Product detail still reads with `cache: "no-store"` so prices and stock are
never stale. Category and listing data use `revalidate` (600s) — see
`CATALOG_REVALIDATE`.

> **Note:** Next.js requires `export const revalidate` to be a literal. The
> page-level values are therefore hard-coded `600` with a comment pointing at
> `CATALOG_REVALIDATE`. Change both together.

---

## 2. URL structure

Indexable:

```
/                                              Homepage
/shop                                          Full catalog (paginated)
/shop?page=N                                   Self-canonical pagination
/categories                                    Category index
/categories/{categorySlug}                     Category listing
/categories/{categorySlug}/{subcategorySlug}   Subcategory listing
/product/{slug}                                Product detail
/blog                                          Plant care guides index
/blog/{slug}                                   Article
/about                                         Business info + LocalBusiness
/help-center                                   FAQ
/terms, /privacy-policy                        Legal
```

Not indexable:

```
/search, /search?q=...    noindex, follow + robots disallow
/shop?category=…&brand=…  noindex, follow (duplicates category pages)
/product                  noindex, canonical → /categories (legacy duplicate)
/account /cart /checkout /orders /order-success
/login /signup /forgot-password /wishlist /product/add
/delete-account           noindex but crawlable (Google Play requirement)
```

Product URLs were **not** changed, so no redirects were required and no SEO
equity was lost. Slugs come from the backend and are already lowercase and
hyphenated.

---

## 3. Metadata strategy

`app/layout.tsx` sets `metadataBase`, a title template (`%s | Growman`), the
default description, `robots` with `max-image-preview:large`, Open Graph,
Twitter `summary_large_image`, icons and the manifest.

Page metadata is produced by builders, never hand-written per page:

- `createPageMetadata()` — canonical + matching OG/Twitter for static pages
- `createProductMetadata()` — per-product title, description, product images
- `createCategoryMetadata()` — per-collection title and description
- `createNoindexMetadata()` — private routes

Because the layout template appends the brand, builders must **not** include
"Growman" in their titles (a test enforces this).

Dynamic routes use `generateMetadata()` and return
`robots: { index: false }` for records that do not exist, so a missing product
never produces indexable metadata.

### Canonicals

`buildCanonicalUrl()` guarantees `https`, the `growman.live` host, no trailing
slash and no query string. The only opt-in exception is `page`, because
paginated listings must be self-canonical for Google to crawl beyond page one.

---

## 4. Sitemap

`app/sitemap.ts` serves `/sitemap.xml` from live catalog data, so **publishing a
product or category automatically makes it discoverable**. It includes the
homepage, `/shop`, `/categories`, every non-empty category and subcategory,
every product, the blog index and every article, plus `/about`, `/help-center`
and the legal pages.

Safeguards:

- Private routes are filtered through `isPrivatePath()` — the same list that
  drives `robots.ts`, so the two cannot drift apart.
- Empty collections are excluded upstream by `getIndexableCollections()`, which
  prevents advertising thin pages.
- URLs are deduplicated.
- `getAllProducts()` paginates the backend list endpoint, so the sitemap stays
  complete as the catalog grows.

**Scaling:** the catalog is ~60 products today, comfortably inside one sitemap.
A single sitemap is valid to 50,000 URLs. Beyond that, split it using Next's
`generateSitemaps()` and emit a sitemap index.

---

## 5. Robots

`app/robots.ts` allows `/`, disallows only authenticated/transactional/internal
paths, and advertises the sitemap. `/_next/`, CSS, JS and images are
deliberately **not** blocked — blocking them would prevent Google rendering the
site.

`/product/add$` is anchored, because an unanchored `/product/add` would also
block a real product whose slug began with "add".

`apps/admin` has its own `app/robots.ts` that disallows the entire host, plus
`robots: { index: false, follow: false }` in its layout.

---

## 6. Structured data

| Schema | Where |
| --- | --- |
| `Organization` | Every page (root layout), `@id`-referenced elsewhere |
| `WebSite` | Every page (root layout) |
| `GardenStore` (LocalBusiness) | `/` and `/about` |
| `Product` + `Offer`/`AggregateOffer` | `/product/[slug]` |
| `BreadcrumbList` | Product, category, subcategory, shop, blog, about |
| `CollectionPage` + `ItemList` | Category and subcategory pages |
| `Article` | `/blog/[slug]` |
| `FAQPage` | `/help-center` (from the rendered Q&As) |

### Integrity rules

These are enforced by tests in `lib/seo/seo.test.ts`:

- **No fabricated ratings or reviews.** `aggregateRating` and `review` are
  emitted *only* when the backend returns real reviews. The product page also
  previously rendered a hard-coded 4-star rating for products with no reviews;
  that was removed.
- **No invented GTIN/MPN.** The catalog has no GTIN column, so none is claimed.
  `sku` is the stable catalog id.
- **No invented address.** Only `addressLocality` (Hyderabad), `addressRegion`
  (Andhra Pradesh) and `addressCountry` (IN) are asserted — no street address
  or postcode, because none is published.
- **No invented social profiles.** `sameAs` lists only the confirmed Instagram
  profile and the Play Store listing.
- Multi-size products use `AggregateOffer` with a real low/high range.
- Breadcrumb structured data is generated from the same array as the visible
  trail, so they cannot disagree.

---

## 7. Product SEO

Each product page provides a unique title, a description derived from the
product's own fields, canonical URL, product-image OG cards, `Product` and
`BreadcrumbList` JSON-LD, a visible breadcrumb trail, one `h1`, price,
availability, sizes, tags, attributes, care tips and related products.

A missing product returns a real **HTTP 404** via `notFound()` — never a 200
page saying "not found".

---

## 8. Category SEO

Category and subcategory pages are pre-rendered with `generateStaticParams()`,
each with a unique title, a unique introduction (`lib/seo/collections.ts`),
breadcrumbs, a server-rendered product grid and lateral links to sibling
collections.

Subcategory names repeat across parents (for example "flowering" appears under
`avenue`, `medicinal` and `outdoor-plants`), so subcategory titles and copy
include the parent category name to stay unique.

Unknown category or subcategory slugs return HTTP 404.

---

## 9. Blog SEO

`lib/seo/blog.ts` is a typed, file-based content model. Adding an article means
appending one entry to `posts`; its page, metadata, breadcrumbs, sitemap entry
and `Article` structured data are all derived automatically.

Articles are credited to "the Growman team" and the `Organization` node — **no
individual author is invented**. `relatedCategories` must reference real
catalog slugs, and a test enforces this so an article can never link to a 404.

Three guides ship today (indoor plant selection, watering, outdoor/balcony
care). Quality over volume: do not bulk-generate articles.

---

## 10. Local SEO

All business data comes from what the site already published on `/about` and in
the footer, and is centralised in `business` in `lib/seo/site.ts`:

- Locality: Hyderabad, Andhra Pradesh, IN
- Email: growman.live@gmail.com
- Phone: +91 95535 70568
- Hours: 09:00–19:00 IST, all days
- Service area: India
- Parent nursery: Shiridi Sai Nursery

The `/about` metadata previously advertised a "Hyderabad store", contradicting
the Hyderabad location on the same page; that is corrected.

---

## 11. Search Console setup

After deploying:

1. Add `https://growman.live` as a **Domain property** (preferred — it covers
   `http`/`https` and `www`) in Google Search Console, and verify by DNS TXT
   record.
2. Alternatively, for a URL-prefix property, set
   `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` to the verification token and
   redeploy. The layout then emits the `google-site-verification` meta tag. No
   placeholder token is shipped.
3. Submit `https://growman.live/sitemap.xml`.
4. Request indexing for `/`, `/shop` and two or three product pages to seed
   discovery.
5. Check **Page indexing** after a week for pages excluded by `noindex`, and
   confirm only the private routes listed in section 2 appear there.
6. Check the **Products** and **Breadcrumbs** enhancement reports for
   structured-data errors.

---

## 12. Configuration required outside this repository

These cannot be fixed in code and must be done at the hosting/DNS layer:

1. **URL normalisation.** `growman.live` must be the single canonical host.
   Configure Cloudflare redirect rules so that `http://` → `https://` and
   `www.growman.live` → `growman.live` both return **301**. Canonical tags
   alone do not consolidate these.
2. **Trailing slashes.** The app emits canonicals without a trailing slash;
   ensure the host does not add one.
3. **`NEXT_PUBLIC_API_URL` / `GO_API_URL`** must be set in the Cloudflare
   environment. If the backend is unreachable at build time, category and
   product pages fall back to empty lists and the sitemap will be incomplete.
4. **`NEXT_PUBLIC_SITE_URL`** should be left unset in production (it defaults to
   `https://growman.live`). Set it for preview deployments so previews do not
   emit production canonicals.
5. **Google Business Profile** for the Hyderabad nursery, if the business wants
   local map visibility. Keep the name, phone and hours identical to
   `lib/seo/site.ts`.

---

## 13. Google Merchant Center readiness

No product feed is implemented, because the catalog does not yet carry the
required identifiers. The backend `Product` model currently supplies:

| Merchant Center field | Available? | Source |
| --- | --- | --- |
| `id` | Yes | `product.id` |
| `title` | Yes | `product.name` |
| `description` | Yes | `shortDescription` / `description` |
| `link` | Yes | `buildCanonicalUrl("/product/" + slug)` |
| `image_link` | Yes | `imageUrl` / size images |
| `price` | Yes | size price, INR |
| `availability` | Yes | derived from stock |
| `brand` | Yes | `product.brand.name` |
| `gtin` / `mpn` | **No** | Not in the schema — must never be invented |
| `condition` | Derivable | All stock is new |
| `shipping` | **No** | No per-pincode shipping data |

To proceed, add a `gtin`/`mpn` column (nullable) and shipping configuration,
then expose a feed route. Plants are often exempt from the GTIN requirement,
which can be declared as `identifier_exists: false`.

---

## 14. Assumptions and TODOs

**Assumptions**

- `https://growman.live` is the canonical production origin.
- The catalog is the single source of truth for categories; no keyword-only
  category pages were invented. The real categories are `indoor-plants`,
  `outdoor-plants`, `ornamental-plants`, `fruit-plants`, `medicinal`, `avenue`.
- India-only, single-language site, so **no hreflang** was added.

**Open TODOs**

1. Confirm the nursery street address and postcode, then add `streetAddress`,
   `postalCode` and `geo` to `createLocalBusinessJsonLd()`. Needed for a
   Google Business Profile match.
2. Confirm the real Facebook and X/Twitter profile URLs. Both icons previously
   pointed at the Instagram URL or a malformed handle, so they were removed
   from `sameAs`, the footer and `/about`.
3. `/shop`'s hero carousel advertises collections that do not map to catalog
   categories ("Succulents & Cacti", "Air Purifying Plants") and its CTA
   buttons are inert. Point them at real category URLs or replace the copy.
4. Redirect `/product` → `/categories` permanently once it is confirmed nothing
   links to it; it is currently noindex + canonicalised.
5. Product care fields (sunlight, watering, pot size, plant size) are rendered
   from the tag-driven heuristics in `lib/careTips.tsx` rather than dedicated
   columns. Adding real columns would improve product page depth and enable
   richer structured data.
6. `apps/web` has 33 pre-existing lint warnings and 9 pre-existing TypeScript
   errors (in `cart`, `checkout`, `product/add`, `middleware.ts`). `pnpm lint`
   runs with `--max-warnings 0`, so it fails until those are cleared.
   `next.config.ts` also sets `typescript.ignoreBuildErrors: true`, which hides
   them at build time — worth removing once they are fixed.
7. Consider adding `seoTitle` / `seoDescription` columns only if merchandisers
   actually need to override the generated values. The generated output is
   already unique per product, so this is not currently a gap.

---

## 15. Testing

`pnpm --filter web test` runs 39 assertions covering canonical URL rules,
private-path detection, robots content, product and category metadata
uniqueness, breadcrumb ordering, JSON-LD validity, real price/availability,
the no-fake-reviews and no-invented-GTIN guarantees, and blog content
integrity.

Useful manual checks after deploying:

```bash
curl -s https://growman.live/robots.txt
curl -s https://growman.live/sitemap.xml | head -40
curl -s https://growman.live/product/<slug> | grep -o '<link rel="canonical"[^>]*>'
curl -s -o /dev/null -w '%{http_code}\n' https://growman.live/does-not-exist   # 404
```

Then validate a product URL with the
[Rich Results Test](https://search.google.com/test/rich-results) and
[Schema Markup Validator](https://validator.schema.org/).
