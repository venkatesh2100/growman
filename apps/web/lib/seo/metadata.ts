import type { Metadata } from "next";
import { siteConfig, SITE_URL } from "./site";
import type { Category, Product, Subcategory } from "../types";

/** Turn a site-relative path into an absolute `https://growman.live/...` URL. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Canonical URL for a page: no trailing slash and, by default, no query
 * string, so filtered and sorted variants all consolidate onto one URL.
 *
 * `allowedParams` opts specific parameters back in. The only current use is
 * `page`, because paginated listings must be self-canonical for Google to
 * crawl past the first page.
 */
export function buildCanonicalUrl(
  path: string,
  allowedParams: readonly string[] = []
): string {
  const [pathname, query] = path.split("#")[0]!.split("?");
  const clean = (pathname || "/").replace(/\/{2,}/g, "/");
  const base = clean === "/" ? SITE_URL : absoluteUrl(clean.replace(/\/$/, ""));

  if (!query || allowedParams.length === 0) return base;

  const incoming = new URLSearchParams(query);
  const kept = new URLSearchParams();
  for (const param of allowedParams) {
    const value = incoming.get(param);
    if (value) kept.set(param, value);
  }

  const suffix = kept.toString();
  return suffix ? `${base}?${suffix}` : base;
}

/** Collapse whitespace and clip to a length search engines will actually show. */
export function truncateForMeta(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Human-readable label for a slug, used only as a last-resort fallback. */
export function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type BreadcrumbItem = { name: string; url: string };

/** Build a breadcrumb trail whose URLs are canonical, as Google requires. */
export function createBreadcrumbs(
  items: Array<{ name: string; path: string }>
): BreadcrumbItem[] {
  return [
    { name: "Home", url: buildCanonicalUrl("/") },
    ...items.map((item) => ({
      name: item.name,
      url: buildCanonicalUrl(item.path),
    })),
  ];
}

/** The lowest price actually offered for a product, across its sizes. */
export function getProductPrice(product: Product): number | null {
  const sizePrices = (product.sizes ?? [])
    .map((size) => Number(size.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (sizePrices.length > 0) return Math.min(...sizePrices);
  const base = Number(product.price);
  return Number.isFinite(base) && base > 0 ? base : null;
}

/** Total units available across every size. */
export function getProductStock(product: Product): number {
  const sizes = product.sizes ?? [];
  if (sizes.length > 0) {
    return sizes.reduce((sum, size) => sum + (Number(size.stock) || 0), 0);
  }
  return Number(product.stock) || 0;
}

/** Every distinct image for a product, primary image first, absolute URLs. */
export function getProductImages(product: Product): string[] {
  const fromSizes = (product.sizes ?? []).flatMap(
    (size) => size.images?.filter(Boolean) ?? []
  );
  const all = [product.imageUrl, ...fromSizes].filter(
    (url): url is string => typeof url === "string" && url.length > 0
  );
  return Array.from(new Set(all));
}

/**
 * A description built from the product's own data, so no two products share
 * boilerplate. Falls back to the catalog fields the backend actually returns
 * before composing one from category/size facts.
 */
export function createProductDescription(product: Product): string {
  const written =
    product.shortDescription?.trim() ||
    product.description?.trim() ||
    product.fullDescription?.trim();
  if (written) return truncateForMeta(written);

  const facts: string[] = [];
  if (product.category?.name) {
    facts.push(`${product.category.name.toLowerCase()}`);
  }
  const sizeCount = product.sizes?.length ?? 0;
  if (sizeCount > 1) facts.push(`${sizeCount} sizes`);
  const price = getProductPrice(product);
  if (price !== null) facts.push(`from ₹${price.toFixed(0)}`);

  const detail = facts.length > 0 ? ` — ${facts.join(", ")}` : "";
  return truncateForMeta(
    `Buy ${product.name} online from Growman${detail}. Nursery-grown plants delivered across India.`
  );
}

type OgImage = { url: string; alt: string };

function buildOgImages(images: string[], alt: string): OgImage[] {
  const chosen = images.length > 0 ? images : [absoluteUrl(siteConfig.ogImage)];
  return chosen.slice(0, 4).map((url) => ({ url: absoluteUrl(url), alt }));
}

/**
 * Shared metadata shape for indexable pages: canonical plus matching Open
 * Graph and Twitter cards.
 */
export function createPageMetadata(options: {
  title: string;
  description: string;
  path: string;
  images?: string[];
  imageAlt?: string;
  type?: "website" | "article";
  noindex?: boolean;
  /** Query parameters to preserve in the canonical URL, e.g. `["page"]`. */
  canonicalParams?: readonly string[];
}): Metadata {
  const canonical = buildCanonicalUrl(options.path, options.canonicalParams);
  const images = buildOgImages(
    options.images ?? [],
    options.imageAlt ?? options.title
  );

  return {
    title: options.title,
    description: options.description,
    alternates: { canonical },
    ...(options.noindex
      ? { robots: { index: false, follow: true } }
      : { robots: { index: true, follow: true } }),
    openGraph: {
      type: options.type ?? "website",
      title: options.title,
      description: options.description,
      url: canonical,
      siteName: siteConfig.name,
      locale: siteConfig.locale,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: options.title,
      description: options.description,
      images: images.map((image) => image.url),
    },
  };
}

/** Metadata for a single product page. */
export function createProductMetadata(product: Product): Metadata {
  const images = getProductImages(product);
  const inStock = getProductStock(product) > 0;

  return {
    ...createPageMetadata({
      // The brand is appended by the root layout's title template, so it must
      // not be repeated here.
      title: `${product.name} | Buy Online`,
      description: createProductDescription(product),
      path: `/product/${product.slug}`,
      images,
      imageAlt: `${product.name} plant`,
      // A product that is out of stock stays indexable; it is still a real,
      // useful page and stock changes frequently.
      noindex: product.status === "inactive",
    }),
    other: {
      "product:availability": inStock ? "in stock" : "out of stock",
    },
  };
}

/** Metadata for a category or subcategory listing page. */
export function createCategoryMetadata(options: {
  name: string;
  path: string;
  description?: string;
  productCount?: number;
  images?: string[];
}): Metadata {
  const written = options.description?.trim();
  const count = options.productCount;
  const countPhrase =
    typeof count === "number" && count > 0
      ? `Browse ${count} ${count === 1 ? "plant" : "plants"} in this collection`
      : "Browse this collection";

  const description = written
    ? truncateForMeta(
        `${written} ${countPhrase} from Growman, delivered across India.`
      )
    : truncateForMeta(
        `Shop ${options.name.toLowerCase()} online from Growman. ${countPhrase} of nursery-grown plants, with care guidance and delivery across India.`
      );

  return createPageMetadata({
    // Brand appended by the root layout's title template.
    title: `${options.name} Online in India`,
    description,
    path: options.path,
    images: options.images,
    imageAlt: `${options.name} from Growman`,
  });
}

/** Canonical path for a category, so links and canonicals never diverge. */
export function categoryPath(category: Pick<Category, "slug">): string {
  return `/categories/${category.slug}`;
}

/** Canonical path for a subcategory. */
export function subcategoryPath(
  categorySlug: string,
  subcategory: Pick<Subcategory, "slug">
): string {
  return `/categories/${categorySlug}/${subcategory.slug}`;
}

/** Canonical path for a product. */
export function productPath(product: Pick<Product, "slug">): string {
  return `/product/${product.slug}`;
}

/** Metadata for pages that must stay out of the index but remain crawlable. */
export function createNoindexMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: true },
  };
}
