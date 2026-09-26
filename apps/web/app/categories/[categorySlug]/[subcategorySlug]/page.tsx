import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProductGrid from "../../../../components/productspage/ProductGrid";
import Breadcrumbs from "../../../../components/seo/Breadcrumbs";
import JsonLd from "../../../../components/seo/JsonLd";
import {
  getCategoryDetail,
  getIndexableCollections,
  getSubcategoryProducts,
} from "../../../../lib/seo/catalog";
import { getSubcategoryIntro } from "../../../../lib/seo/collections";
import {
  createBreadcrumbs,
  createCategoryMetadata,
  getProductImages,
} from "../../../../lib/seo/metadata";
import {
  createCollectionPageJsonLd,
  createItemListJsonLd,
} from "../../../../lib/seo/jsonLd";
import type { Subcategory } from "../../../../lib/types";
import type { CategoryWithSubcategories } from "../../../../lib/seo/catalog";

/**
 * Server component, for the same reason as the parent category page: the
 * product list has to exist in the initial HTML to be indexable.
 */
// Next.js requires this to be a literal; keep it in step with
// CATALOG_REVALIDATE in lib/seo/catalog.ts.
export const revalidate = 600;

/** Only subcategories that actually contain products are pre-rendered. */
export async function generateStaticParams() {
  const collections = await getIndexableCollections();
  return collections.flatMap(({ category, subcategories }) =>
    subcategories.map(({ subcategory }) => ({
      categorySlug: category.slug,
      subcategorySlug: subcategory.slug,
    }))
  );
}

/** Resolve the category and the subcategory within it, or null if either is unknown. */
async function resolveCollection(
  categorySlug: string,
  subcategorySlug: string
): Promise<{
  category: CategoryWithSubcategories;
  subcategory: Subcategory;
} | null> {
  const category = await getCategoryDetail(categorySlug);
  if (!category) return null;

  const subcategory = (category.subcategories ?? []).find(
    (entry) => entry.slug === subcategorySlug
  );
  if (!subcategory) return null;

  return { category, subcategory };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ categorySlug: string; subcategorySlug: string }>;
}): Promise<Metadata> {
  const { categorySlug, subcategorySlug } = await params;
  const resolved = await resolveCollection(categorySlug, subcategorySlug);

  if (!resolved) {
    return {
      title: "Collection not found",
      robots: { index: false, follow: false },
    };
  }

  const { category, subcategory } = resolved;
  const products = await getSubcategoryProducts(categorySlug, subcategorySlug);

  return createCategoryMetadata({
    // Subcategory names repeat across parents, so the parent category is part
    // of the title to keep each page's metadata unique.
    name: `${subcategory.name} ${category.name}`,
    path: `/categories/${category.slug}/${subcategory.slug}`,
    description: getSubcategoryIntro({
      subcategoryName: subcategory.name,
      categoryName: category.name,
      description: subcategory.description,
    }),
    productCount: products.length,
    images: products[0] ? getProductImages(products[0]).slice(0, 1) : undefined,
  });
}

export default async function SubcategoryPage({
  params,
}: {
  params: Promise<{ categorySlug: string; subcategorySlug: string }>;
}) {
  const { categorySlug, subcategorySlug } = await params;
  const resolved = await resolveCollection(categorySlug, subcategorySlug);

  if (!resolved) {
    notFound();
  }

  const { category, subcategory } = resolved;
  const products = await getSubcategoryProducts(categorySlug, subcategorySlug);
  const intro = getSubcategoryIntro({
    subcategoryName: subcategory.name,
    categoryName: category.name,
    description: subcategory.description,
  });

  const path = `/categories/${category.slug}/${subcategory.slug}`;
  const breadcrumbs = createBreadcrumbs([
    { name: "Plants", path: "/categories" },
    { name: category.name, path: `/categories/${category.slug}` },
    { name: subcategory.name, path },
  ]);

  const siblings = (category.subcategories ?? []).filter(
    (entry) => entry.slug !== subcategory.slug
  );

  return (
    <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8">
      <JsonLd
        id="subcategory-jsonld"
        data={[
          createCollectionPageJsonLd({
            name: `${subcategory.name} — ${category.name} — Growman`,
            description: intro,
            path,
          }),
          createItemListJsonLd({
            name: `${subcategory.name} ${category.name}`,
            path,
            items: products.map((product) => ({
              name: product.name,
              path: `/product/${product.slug}`,
            })),
          }),
        ]}
      />

      <div className="mb-4 sm:mb-6 md:mb-8">
        <Breadcrumbs items={breadcrumbs} className="mb-3 sm:mb-4" />

        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-green-800 mb-1 sm:mb-2">
          {subcategory.name} {category.name}
        </h1>
        <p className="max-w-3xl text-sm sm:text-base text-gray-600">{intro}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8">
        <div className="lg:col-span-4">
          <section>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 sm:mb-6 gap-2">
              <h2 className="text-xl sm:text-2xl font-semibold text-green-800">
                {subcategory.name} Plants
              </h2>
              <div className="text-xs sm:text-sm text-emerald-600">
                Showing {products.length} plants
              </div>
            </div>

            <ProductGrid
              products={products}
              emptyState={
                <div className="bg-white rounded-xl p-6 sm:p-8 text-center border border-green-100">
                  <h3 className="text-base sm:text-lg font-medium text-gray-800 mb-2">
                    No plants found in this subcategory
                  </h3>
                  <p className="text-sm sm:text-base text-gray-600">
                    Browse all{" "}
                    <Link
                      href={`/categories/${category.slug}`}
                      className="text-emerald-700 underline"
                    >
                      {category.name.toLowerCase()}
                    </Link>{" "}
                    instead.
                  </p>
                </div>
              }
            />
          </section>

          {siblings.length > 0 && (
            <section className="mt-10 border-t border-emerald-100 pt-6">
              <h2 className="text-lg sm:text-xl font-semibold text-green-800 mb-3">
                More in {category.name}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {siblings.map((sibling) => (
                  <li key={sibling.id}>
                    <Link
                      href={`/categories/${category.slug}/${sibling.slug}`}
                      className="inline-block rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                    >
                      {sibling.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
