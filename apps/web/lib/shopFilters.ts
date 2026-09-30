import type { Category, Subcategory } from "./types";

export type ShopCatalog = {
  tags: string[];
  categories: Array<Category & { subcategories?: Subcategory[] }>;
};

export type ShopFilter =
  | { type: "tag"; value: string }
  | { type: "category"; value: string }
  | { type: "subcategory"; category: string; value: string };

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/** Shopper-facing names for catalog tags, which are stored in whatever form they were entered. */
const TAG_LABELS: Record<string, string> = {
  gift: "Gift plants",
  "good-luck": "Good luck plants",
  office: "Office and desk plants",
  "stress-free": "Easy-care plants",
  easycare: "Easy-care plants",
  "air purify": "Air-purifying plants",
  "low-light": "Low-light plants",
  bonsai: "Bonsai",
  topiary: "Topiary",
  decorational: "Decorative plants",
  foliage: "Foliage plants",
  flowering: "Flowering plants",
  medicinal: "Medicinal plants",
  herbal: "Herbal plants",
  balcony: "Balcony plants",
  terrace: "Terrace plants",
  indoor: "Indoor plants",
  outdoor: "Outdoor plants",
  climber: "Climbers",
  fruit: "Fruit plants",
};

export function tagLabel(tag: string): string {
  const known = TAG_LABELS[tag.trim().toLowerCase()];
  if (known) return known;
  const words = tag.trim().replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Build a shop/category URL from a known filter — no API call needed. */
export function buildFilterHref(filter: ShopFilter): string {
  if (filter.type === "tag") {
    return `/shop?tag=${encodeURIComponent(filter.value)}#shop-products`;
  }
  if (filter.type === "category") {
    return `/shop?category=${encodeURIComponent(filter.value)}#shop-products`;
  }
  return `/categories/${filter.category}/${filter.value}`;
}

export function getShopTitle(
  searchParams: { [key: string]: string | string[] | undefined },
  catalog?: ShopCatalog
): string {
  const tag = Array.isArray(searchParams.tag)
    ? searchParams.tag[0]
    : searchParams.tag;
  if (tag) return tagLabel(tag);

  const categorySlug = Array.isArray(searchParams.category)
    ? searchParams.category[0]
    : searchParams.category;
  if (categorySlug) {
    const category = catalog?.categories.find((item) => item.slug === categorySlug);
    return category ? category.name : tagLabel(categorySlug);
  }

  return "All plants";
}

export function hasShopFilter(
  searchParams: { [key: string]: string | string[] | undefined }
): boolean {
  return Boolean(searchParams.tag || searchParams.category || searchParams.brand);
}

export function getActiveFilterLabel(
  searchParams: { [key: string]: string | string[] | undefined },
  catalog?: ShopCatalog
): string | null {
  const tag = Array.isArray(searchParams.tag)
    ? searchParams.tag[0]
    : searchParams.tag;
  if (tag) return tagLabel(tag);

  const categorySlug = Array.isArray(searchParams.category)
    ? searchParams.category[0]
    : searchParams.category;
  if (categorySlug) {
    return catalog?.categories.find((c) => c.slug === categorySlug)?.name ?? categorySlug;
  }

  return null;
}
