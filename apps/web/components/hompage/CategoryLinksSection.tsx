import Link from "next/link";
import {
  getIndexableCollections,
  type CollectionImage,
  type IndexableCategory,
} from "../../lib/seo/catalog";
import CollectionTileImage from "./CollectionTileImage";
import HorizontalScrollRow from "./HorizontalScrollRow";

type TileProps = {
  href: string;
  name: string;
  caption: string;
  image: CollectionImage | null;
  priority?: boolean;
  /** Extra classes on the `<li>` (e.g. `shrink-0` for a scroll row). */
  className?: string;
};

/**
 * One circular collection link.
 *
 * The photo is decorative: the label directly beneath it is the link's
 * accessible name and already says where the link goes, so giving the image
 * alt text here would make screen readers announce the destination twice.
 */
function CollectionTile({
  href,
  name,
  caption,
  image,
  priority = false,
  className = "",
}: TileProps) {
  return (
    // Fixed width so flex rows stay even; leftover tiles on the last row
    // center via the parent `justify-center` instead of sticking left.
    <li className={`w-24 sm:w-28 lg:w-36 ${className}`.trim()}>
      <Link href={href} className="group flex flex-col items-center text-center">
        <div className="relative aspect-square w-full overflow-hidden rounded-full bg-emerald-50 ring-1 ring-emerald-100 transition group-hover:ring-2 group-hover:ring-emerald-400">
          <CollectionTileImage
            urls={image?.urls ?? []}
            fallbackLabel={name}
            priority={priority}
          />
        </div>

        {/* `capitalize` only affects names the catalog stores lower-case,
            such as "bonsai"; already-capitalised names are unchanged. */}
        <span className="mt-3 text-sm font-semibold capitalize text-green-900 group-hover:text-emerald-700 sm:text-base">
          {name}
        </span>
        <span className="mt-0.5 text-xs text-emerald-700">{caption}</span>
      </Link>
    </li>
  );
}

/** Flex wrap + center so a short last row (one Seasonal tile, etc.) sits in the middle. */
const TILE_ROW =
  "flex flex-wrap justify-center gap-x-4 gap-y-6 sm:gap-x-6 lg:gap-x-8";

export type CategoryLinksSectionProps = {
  /** Override the section H2. Defaults to the homepage copy. */
  title?: string;
  /** Pass `null` to hide the supporting sentence. */
  description?: string | null;
  /** When false, only the top-level category row is rendered. */
  showPlantTypes?: boolean;
  /**
   * How the plant-type tiles lay out.
   * - `wrap` (default): multi-row centered grid — homepage.
   * - `scroll`: one horizontal snap row — `/categories`.
   */
  plantTypesLayout?: "wrap" | "scroll";
  /**
   * When false, skip the inner `container` wrapper — use this when the
   * parent page already constrains width (e.g. `/categories`).
   */
  withContainer?: boolean;
  className?: string;
};

function buildPlantTypes(collections: IndexableCategory[]) {
  // Subcategory names repeat across parents — "Flowering" exists under
  // Avenue, Medicinal and Outdoor Plants. Naming the parent underneath keeps
  // each tile's link text unique, so neither a shopper nor a crawler sees
  // three identical labels pointing at three different pages.
  return collections.flatMap(({ category, subcategories }) =>
    subcategories.map((entry) => ({
      ...entry,
      categorySlug: category.slug,
      parentName: category.name,
    }))
  );
}

/**
 * Server-rendered circular links to every category and subcategory that
 * actually has products.
 *
 * Shared by the homepage and `/categories` so both surfaces stay in sync with
 * the live catalog.
 */
export default async function CategoryLinksSection({
  title = "Shop Plants by Category",
  description = "Browse our collections and pick plants suited to your space.",
  showPlantTypes = true,
  plantTypesLayout = "wrap",
  withContainer = true,
  className = "py-8 sm:py-12 md:py-16",
}: CategoryLinksSectionProps = {}) {
  const collections = await getIndexableCollections();
  if (collections.length === 0) return null;

  const plantTypes = showPlantTypes ? buildPlantTypes(collections) : [];
  const headingId = "shop-by-category";
  const plantTypesScroll = plantTypesLayout === "scroll";

  const body = (
    <>
      <h2
        id={headingId}
        className="text-2xl sm:text-3xl font-bold text-green-900 mb-1 sm:mb-2"
      >
        {title}
      </h2>
      {description ? (
        <p className="text-sm sm:text-base text-green-700 mb-6 sm:mb-8">
          {description}
        </p>
      ) : (
        <div className="mb-6 sm:mb-8" />
      )}

      <ul className={TILE_ROW}>
        {collections.map(({ category, productCount, image }, index) => (
          <CollectionTile
            key={category.id}
            href={`/categories/${category.slug}`}
            name={category.name}
            caption={`${productCount} ${productCount === 1 ? "plant" : "plants"}`}
            image={image}
            // The first row sits high enough on the homepage to be worth
            // loading eagerly rather than waiting on the lazy observer.
            priority={index < 3}
          />
        ))}
      </ul>

      {plantTypes.length > 0 && (
        <>
          <h3 className="mt-10 mb-6 text-xl sm:text-2xl font-bold text-green-900 sm:mt-14">
            Shop by Plant Type
          </h3>
          {plantTypesScroll ? (
            <HorizontalScrollRow label="Shop by Plant Type">
              {plantTypes.map(
                ({ subcategory, image, categorySlug, parentName }) => (
                  <CollectionTile
                    key={`${categorySlug}/${subcategory.slug}`}
                    href={`/categories/${categorySlug}/${subcategory.slug}`}
                    name={subcategory.name}
                    caption={`in ${parentName}`}
                    image={image}
                    className="shrink-0 snap-start"
                  />
                )
              )}
            </HorizontalScrollRow>
          ) : (
            <ul className={TILE_ROW}>
              {plantTypes.map(
                ({ subcategory, image, categorySlug, parentName }) => (
                  <CollectionTile
                    key={`${categorySlug}/${subcategory.slug}`}
                    href={`/categories/${categorySlug}/${subcategory.slug}`}
                    name={subcategory.name}
                    caption={`in ${parentName}`}
                    image={image}
                  />
                )
              )}
            </ul>
          )}
        </>
      )}
    </>
  );

  return (
    <section className={className} aria-labelledby={headingId}>
      {withContainer ? (
        <div className="container mx-auto px-3 sm:px-4">{body}</div>
      ) : (
        body
      )}
    </section>
  );
}
