import type { MetadataRoute } from "next";
import { buildCanonicalUrl } from "../lib/seo/metadata";
import { isPrivatePath } from "../lib/seo/site";
import {
  getAllProducts,
  getIndexableCollections,
} from "../lib/seo/catalog";
import { getAllPosts } from "../lib/seo/blog";

/** Regenerate the sitemap on the same cadence as the catalog cache. */
// Next.js requires this to be a literal; keep it in step with
// CATALOG_REVALIDATE in lib/seo/catalog.ts.
export const revalidate = 600;

/** Public, indexable pages that are not generated from catalog data. */
const STATIC_PATHS: Array<{
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}> = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/shop", priority: 0.9, changeFrequency: "daily" },
  { path: "/categories", priority: 0.8, changeFrequency: "weekly" },
  { path: "/bulk", priority: 0.7, changeFrequency: "weekly" },
  { path: "/blog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/about", priority: 0.5, changeFrequency: "yearly" },
  { path: "/help-center", priority: 0.4, changeFrequency: "yearly" },
  { path: "/privacy-policy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
];

function toDate(value: string | undefined): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Serves /sitemap.xml from live catalog data, so publishing a product or
 * category automatically makes it discoverable.
 *
 * Private routes are filtered out defensively via `isPrivatePath` — the same
 * list that drives robots.txt — so the two can never drift apart. Empty
 * categories are already excluded upstream by `getIndexableCollections`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [collections, products] = await Promise.all([
    getIndexableCollections(),
    getAllProducts(),
  ]);

  const entries: MetadataRoute.Sitemap = [];

  for (const entry of STATIC_PATHS) {
    entries.push({
      url: buildCanonicalUrl(entry.path),
      lastModified: new Date(),
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
    });
  }

  for (const { category, subcategories } of collections) {
    entries.push({
      url: buildCanonicalUrl(`/categories/${category.slug}`),
      lastModified: toDate(category.updatedAt),
      changeFrequency: "weekly",
      priority: 0.8,
    });

    for (const { subcategory } of subcategories) {
      entries.push({
        url: buildCanonicalUrl(
          `/categories/${category.slug}/${subcategory.slug}`
        ),
        lastModified: toDate(subcategory.updatedAt),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  for (const product of products) {
    if (!product.slug) continue;
    entries.push({
      url: buildCanonicalUrl(`/product/${product.slug}`),
      lastModified: toDate(product.updatedAt),
      changeFrequency: "weekly",
      priority: 0.9,
    });
  }

  for (const post of getAllPosts()) {
    entries.push({
      url: buildCanonicalUrl(`/blog/${post.slug}`),
      lastModified: toDate(post.updatedAt ?? post.publishedAt),
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }

  // Deduplicate and drop anything private before emitting.
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const path = new URL(entry.url).pathname;
    if (isPrivatePath(path)) return false;
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
