import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProductGrid from "../../../components/productspage/ProductGrid";
import SubcategoryCard from "../../../components/productspage/SubcategoryCard";
import Breadcrumbs from "../../../components/seo/Breadcrumbs";
import JsonLd from "../../../components/seo/JsonLd";
import {
  getCategoryDetail,
  getCategoryProducts,
  getIndexableCollections,
} from "../../../lib/seo/catalog";
import { getCategoryIntro } from "../../../lib/seo/collections";
import {
  createBreadcrumbs,
  createCategoryMetadata,
  getProductImages,
} from "../../../lib/seo/metadata";
import {
  createCollectionPageJsonLd,
  createItemListJsonLd,
} from "../../../lib/seo/jsonLd";

/**
 * This page is now a server component. It previously fetched the category and
 * its products in `useEffect`, which meant crawlers received an empty loading
 * shell and no category page was indexable.
 */
// Next.js requires this to be a literal; keep it in step with
// CATALOG_REVALIDATE in lib/seo/catalog.ts.
export const revalidate = 600;

/**
 * Pre-render the categories that exist today; anything added later is rendered
 * on demand and then cached.
 */
export async function generateStaticParams() {
  const collections = await getIndexableCollections();
  return collections.map(({ category }) => ({ categorySlug: category.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ categorySlug: string }>;
}): Promise<Metadata> {
  const { categorySlug } = await params;
  const category = await getCategoryDetail(categorySlug);

  if (!category) {
    return {
      title: "Category not found",
      robots: { index: false, follow: false },
    };
  }

  const products = await getCategoryProducts(categorySlug);

  return createCategoryMetadata({
    name: category.name,
    path: `/categories/${category.slug}`,
    description: getCategoryIntro({
      slug: category.slug,
      name: category.name,
      description: category.description,
    }),
    productCount: products.length,
    images: products[0] ? getProductImages(products[0]).slice(0, 1) : undefined,
  });
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ categorySlug: string }>;
}) {
  const { categorySlug } = await params;
  const category = await getCategoryDetail(categorySlug);

  // An unknown category slug is a genuine 404, not a 200 error message.
  if (!category) {
    notFound();
  }

  const [products, collections] = await Promise.all([
    getCategoryProducts(categorySlug),
    getIndexableCollections(),
  ]);

  const counts =
    collections.find((entry) => entry.category.slug === categorySlug)
      ?.subcategories ?? [];
  const countsBySubcategoryId = new Map(
    counts.map((entry) => [entry.subcategory.id, entry.productCount])
  );

  const subcategories = category.subcategories ?? [];
  const intro = getCategoryIntro({
    slug: category.slug,
    name: category.name,
    description: category.description,
  });

  const breadcrumbs = createBreadcrumbs([
    { name: "Plants", path: "/categories" },
    { name: category.name, path: `/categories/${category.slug}` },
  ]);

  // Sibling categories, so every collection page links laterally to the rest.
  const otherCategories = collections
    .filter((entry) => entry.category.slug !== categorySlug)
    .slice(0, 6);

  return (
    <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8">
      <JsonLd
        id="category-jsonld"
        data={[
          createCollectionPageJsonLd({
            name: `${category.name} — Growman`,
            description: intro,
            path: `/categories/${category.slug}`,
          }),
          createItemListJsonLd({
            name: `${category.name} plants`,
            path: `/categories/${category.slug}`,
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
          {category.name}
        </h1>
        <p className="max-w-3xl text-sm sm:text-base text-gray-600">{intro}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8">
        <div className="lg:col-span-4">
          {/* Subcategories */}
          {subcategories.length > 0 && (
            <section className="mb-8 sm:mb-10 md:mb-12">
              <h2 className="text-xl sm:text-2xl font-semibold text-green-800 mb-4 sm:mb-6">
                Browse {category.name} Subcategories
              </h2>
              <div
                className="
                  flex flex-nowrap gap-3 sm:gap-4 overflow-x-auto pb-3
                  snap-x snap-mandatory scroll-smooth scrollbar-hide
                  -mx-3 sm:-mx-4 px-3 sm:px-4
                "
              >
                {subcategories.map((subcategory) => (
                  <div
                    key={subcategory.id}
                    className="shrink-0 w-[58%] sm:w-[200px] md:w-[220px] snap-start"
                  >
                    <SubcategoryCard
                      subcategory={{
                        id: String(subcategory.id),
                        name: subcategory.name,
                        slug: subcategory.slug,
                        products: countsBySubcategoryId.get(subcategory.id) ?? 0,
                        category: { slug: category.slug },
                      }}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Products */}
          <section>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 sm:mb-6 gap-2">
              <h2 className="text-xl sm:text-2xl font-semibold text-green-800">
                {category.name} Plants
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
                    No plants found
                  </h3>
                  <p className="text-sm sm:text-base text-gray-600">
                    {subcategories.length > 0
                      ? "Browse our subcategories to find plants you'll love"
                      : "Check back later for new additions to our collection"}
                  </p>
                </div>
              }
            />
          </section>

          {/* Lateral internal links to the other collections */}
          {otherCategories.length > 0 && (
            <section className="mt-10 border-t border-emerald-100 pt-6">
              <h2 className="text-lg sm:text-xl font-semibold text-green-800 mb-3">
                Other Plant Categories
              </h2>
              <ul className="flex flex-wrap gap-2">
                {otherCategories.map(({ category: other }) => (
                  <li key={other.id}>
                    <Link
                      href={`/categories/${other.slug}`}
                      className="inline-block rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                    >
                      {other.name}
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
