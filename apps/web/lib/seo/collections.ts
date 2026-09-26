/**
 * Editorial introductions for collection pages.
 *
 * Category listings are otherwise just a grid of products, which reads as a
 * thin page. These short introductions give each collection genuinely useful,
 * non-duplicated content written to help a customer choose — not to repeat
 * keywords.
 *
 * Keys are the category slugs that exist in the catalog. Anything not listed
 * falls back to a generated introduction, so an unrecognised category still
 * renders correctly.
 */

const CATEGORY_INTROS: Record<string, string> = {
  "indoor-plants":
    "Indoor plants bring greenery into rooms, offices and balconies that get little or no direct sun. The main thing to get right is light: most foliage plants want bright but indirect light, while a smaller group genuinely tolerates a north-facing room or a dim corner. Choose based on the spot you have in mind, and remember that pots indoors dry out far more slowly during the monsoon than through summer.",
  "outdoor-plants":
    "Outdoor plants are grown for terraces, gardens, balconies and boundaries where they get several hours of direct sun. Check your real sun exposure before choosing — a west-facing balcony above the third floor is a much harsher position than an east-facing one. Good drainage matters more outdoors than anywhere else, because pots here take the full monsoon.",
  "flowering-plants":
    "Flowering plants add seasonal colour to balconies, terraces and gardens. Most flower best in full sun and reward regular deadheading, and many are seasonal rather than year-round, so it is worth planning for what will be in bloom when.",
  "ornamental-plants":
    "Ornamental plants are chosen for their foliage, form and structure rather than their flowers — variegated leaves, sculpted shapes and plants that hold their look through the year. They work well as feature plants in entrances, living rooms and landscaped beds.",
  "fruit-plants":
    "Fruit plants can be grown in pots on a terrace or balcony as well as in the ground. They need more sun, more root space and more consistent feeding than ornamental plants, so pick a position that gets direct light for most of the day and plan to move up a pot size as the plant establishes.",
  medicinal:
    "Medicinal and herbal plants are grown for their leaves, roots and traditional household uses. Most are hardy, tolerate containers well and prefer a sunny spot with free-draining soil. Consult a qualified practitioner before using any plant medicinally.",
  avenue:
    "Avenue plants are the tall, columnar and canopy species used along driveways, boundaries, roads and large landscapes. They are selected for height, uniform shape and low maintenance once established, and are usually planted directly into the ground rather than kept in pots.",
};

/** Introduction for a category page: curated where available, generated otherwise. */
export function getCategoryIntro(options: {
  slug: string;
  name: string;
  /** Description supplied by the catalog, used ahead of a generated fallback. */
  description?: string;
}): string {
  const curated = CATEGORY_INTROS[options.slug];
  if (curated) return curated;

  const fromCatalog = options.description?.trim();
  if (fromCatalog) return fromCatalog;

  return `Browse Growman's ${options.name.toLowerCase()} collection. Each plant is grown at our nursery and listed with the sizes currently available, so you can pick one that suits your space and light.`;
}

/**
 * Introduction for a subcategory page. Subcategory names repeat across
 * categories (for example "flowering" under several parents), so the parent
 * category is included to keep every page's copy distinct.
 */
export function getSubcategoryIntro(options: {
  subcategoryName: string;
  categoryName: string;
  description?: string;
}): string {
  const fromCatalog = options.description?.trim();
  if (fromCatalog) return fromCatalog;

  return `${options.subcategoryName} plants from Growman's ${options.categoryName.toLowerCase()} range. Every plant below is in the catalog with its available sizes and current pricing, and ships from our nursery in Kadiam, Andhra Pradesh.`;
}
