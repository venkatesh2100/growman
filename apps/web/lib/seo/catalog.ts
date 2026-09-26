import { cache } from "react";
import { apiFetch } from "../api";
import type { Category, Product, Subcategory } from "../types";
import { COLLECTION_TILE_IMAGES } from "./collectionImages";

/** Categories come back from `/categories` with their subcategories inlined. */
export type CategoryWithSubcategories = Category & {
  subcategories?: Subcategory[] | null;
};

/** How long catalog reads used for SEO surfaces stay cached, in seconds. */
export const CATALOG_REVALIDATE = 600;

const PRODUCT_PAGE_SIZE = 100;

/**
 * All categories, deduplicated by slug. `cache` collapses repeat calls within
 * a single render (metadata + page body) into one request, while
 * `next.revalidate` shares the result across requests.
 */
export const getCategories = cache(
  async (): Promise<CategoryWithSubcategories[]> => {
    try {
      const res = await apiFetch("/categories", {
        next: { revalidate: CATALOG_REVALIDATE },
      });
      if (!res.ok) return [];
      const payload = (await res.json()) as unknown;
      if (!Array.isArray(payload)) return [];

      const bySlug = new Map<string, CategoryWithSubcategories>();
      for (const category of payload as CategoryWithSubcategories[]) {
        if (category?.slug && !bySlug.has(category.slug)) {
          bySlug.set(category.slug, category);
        }
      }
      return [...bySlug.values()];
    } catch (error) {
      console.warn("[seo] failed to load categories:", error);
      return [];
    }
  }
);

/** A single category by slug, or null when it does not exist. */
export const getCategoryBySlug = cache(
  async (slug: string): Promise<CategoryWithSubcategories | null> => {
    const categories = await getCategories();
    return categories.find((category) => category.slug === slug) ?? null;
  }
);

/**
 * Full detail for one category, including its subcategories, from the
 * dedicated endpoint. Returns null for an unknown slug so callers can render a
 * real 404.
 */
export const getCategoryDetail = cache(
  async (slug: string): Promise<CategoryWithSubcategories | null> => {
    try {
      const res = await apiFetch(`/categories/${slug}`, {
        next: { revalidate: CATALOG_REVALIDATE },
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as {
        category?: CategoryWithSubcategories;
      } & CategoryWithSubcategories;
      const category = payload.category ?? payload;
      return category?.slug ? category : null;
    } catch (error) {
      console.warn(`[seo] failed to load category "${slug}":`, error);
      return null;
    }
  }
);

type ProductsPayload = {
  data?: Product[];
  pagination?: { hasNext?: boolean; totalPages?: number; page?: number };
  products?: Product[];
};

/** Normalise the several list shapes the products endpoints can return. */
function readProductList(payload: unknown): Product[] {
  if (Array.isArray(payload)) return payload as Product[];
  if (payload && typeof payload === "object") {
    const typed = payload as ProductsPayload;
    if (Array.isArray(typed.data)) return typed.data;
    if (Array.isArray(typed.products)) return typed.products;
  }
  return [];
}

/** Products listed under a category slug, server-rendered for crawlers. */
export const getCategoryProducts = cache(
  async (slug: string): Promise<Product[]> => {
    try {
      const res = await apiFetch(`/categories/${slug}/products`, {
        next: { revalidate: CATALOG_REVALIDATE },
      });
      if (!res.ok) return [];
      return readProductList(await res.json());
    } catch (error) {
      console.warn(`[seo] failed to load products for "${slug}":`, error);
      return [];
    }
  }
);

/** Products listed under a subcategory slug. */
export const getSubcategoryProducts = cache(
  async (categorySlug: string, subcategorySlug: string): Promise<Product[]> => {
    try {
      const res = await apiFetch(
        `/categories/${categorySlug}/subcategories/${subcategorySlug}/products`,
        { next: { revalidate: CATALOG_REVALIDATE } }
      );
      if (!res.ok) return [];
      return readProductList(await res.json());
    } catch (error) {
      console.warn(
        `[seo] failed to load products for "${categorySlug}/${subcategorySlug}":`,
        error
      );
      return [];
    }
  }
);

/**
 * Every product in the catalog. Paginates through the list endpoint so the
 * sitemap stays complete as the catalog grows, rather than silently
 * truncating at the first page.
 */
export const getAllProducts = cache(async (): Promise<Product[]> => {
  const products: Product[] = [];
  let page = 1;
  // Hard ceiling so a misbehaving pagination response cannot loop forever.
  const maxPages = 200;

  try {
    while (page <= maxPages) {
      const res = await apiFetch(
        `/products?page=${page}&pageSize=${PRODUCT_PAGE_SIZE}`,
        { next: { revalidate: CATALOG_REVALIDATE } }
      );
      if (!res.ok) break;

      const payload = (await res.json()) as ProductsPayload | Product[];
      const batch = Array.isArray(payload) ? payload : (payload.data ?? []);
      if (batch.length === 0) break;
      products.push(...batch);

      const pagination = Array.isArray(payload) ? undefined : payload.pagination;
      if (!pagination?.hasNext) break;
      page += 1;
    }
  } catch (error) {
    console.warn("[seo] failed to load products:", error);
  }

  return products;
});

/** Products belonging to one category, resolved from the full catalog. */
export async function getProductsForCategory(
  categoryId: number
): Promise<Product[]> {
  const products = await getAllProducts();
  return products.filter((product) => product.categoryId === categoryId);
}

/** Products belonging to one subcategory. */
export async function getProductsForSubcategory(
  subcategoryId: number
): Promise<Product[]> {
  const products = await getAllProducts();
  return products.filter((product) => product.subcategoryId === subcategoryId);
}

/**
 * Photos standing in for a whole collection.
 *
 * Neither `categories` nor `subcategories` has an image column in the
 * database, so rather than shipping stock art we reuse photos of products
 * that are actually in the collection. `urls` is ordered by preference and
 * may contain several candidates — some catalog `imageUrl` values 404 in
 * GCS, so the tile component walks the list until one loads.
 *
 * The first candidate is normally a tile-sized copy served from `public/`,
 * snapshotted by `scripts/sync-collection-images.mjs`; the object-storage URLs
 * stay behind it so a collection added since the last snapshot still renders.
 */
export type CollectionImage = { urls: string[]; productName: string };

export type IndexableCategory = {
  category: CategoryWithSubcategories;
  productCount: number;
  image: CollectionImage | null;
  subcategories: Array<{
    subcategory: Subcategory;
    productCount: number;
    image: CollectionImage | null;
  }>;
};

/**
 * Prefer size-level images over the product-level `imageUrl`.
 *
 * Size images are what the shop cards actually show, and in practice the
 * product-level URL is often a stale key that no longer exists in GCS.
 */
function collectProductImageUrls(product: Product): string[] {
  const fromSizes = (product.sizes ?? []).flatMap(
    (size) => size.images?.filter(Boolean) ?? []
  );
  const all = [...fromSizes, product.imageUrl].filter(
    (url): url is string => typeof url === "string" && url.length > 0
  );
  return Array.from(new Set(all));
}

/**
 * Builds an ordered candidate list for a collection tile.
 *
 * Featured products come first so merchandising choices still win when their
 * photos are intact; every other product with images fills in as fallbacks.
 */
function pickCollectionImage(products: Product[]): CollectionImage | null {
  const withImages = products.filter(
    (product) => collectProductImageUrls(product).length > 0
  );
  if (withImages.length === 0) return null;

  const ordered = [
    ...withImages.filter((product) => product.featured),
    ...withImages.filter((product) => !product.featured),
  ];

  const urls: string[] = [];
  for (const product of ordered) {
    for (const url of collectProductImageUrls(product)) {
      if (!urls.includes(url)) urls.push(url);
    }
    // A handful of fallbacks is enough; walking the whole catalog here
    // would just bloat the RSC payload.
    if (urls.length >= 6) break;
  }

  return urls.length > 0
    ? { urls, productName: ordered[0]!.name }
    : null;
}

/**
 * Puts the locally committed copy of a tile photo ahead of the remote ones.
 *
 * `key` is the category slug, or `categorySlug/subcategorySlug` for a plant
 * type — the same keys the sync script writes.
 */
function withLocalImage(
  key: string,
  image: CollectionImage | null
): CollectionImage | null {
  const local = COLLECTION_TILE_IMAGES[key];
  if (!local) return image;

  const urls = [local, ...(image?.urls ?? [])];
  return { urls, productName: image?.productName ?? "" };
}

/**
 * Categories and subcategories that actually contain products, with counts.
 *
 * Empty collections are excluded so the sitemap never advertises thin pages.
 * Counts are computed from the product list rather than one request per
 * collection, which keeps this an O(1)-request operation.
 */
export const getIndexableCollections = cache(
  async (): Promise<IndexableCategory[]> => {
    const [categories, products] = await Promise.all([
      getCategories(),
      getAllProducts(),
    ]);

    const byCategory = new Map<number, Product[]>();
    const bySubcategory = new Map<number, Product[]>();
    const push = (map: Map<number, Product[]>, key: number, item: Product) => {
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    };

    for (const product of products) {
      push(byCategory, product.categoryId, product);
      if (product.subcategoryId) {
        push(bySubcategory, product.subcategoryId, product);
      }
    }

    return categories
      .map((category) => {
        const own = byCategory.get(category.id) ?? [];
        return {
          category,
          productCount: own.length,
          image: withLocalImage(category.slug, pickCollectionImage(own)),
          subcategories: (category.subcategories ?? [])
            .map((subcategory) => {
              const items = bySubcategory.get(subcategory.id) ?? [];
              return {
                subcategory,
                productCount: items.length,
                image: withLocalImage(
                  `${category.slug}/${subcategory.slug}`,
                  pickCollectionImage(items)
                ),
              };
            })
            .filter((entry) => entry.productCount > 0),
        };
      })
      .filter((entry) => entry.productCount > 0);
  }
);
