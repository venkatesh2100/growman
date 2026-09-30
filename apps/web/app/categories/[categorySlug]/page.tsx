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
    <main className="mx-auto max-w-7xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8">
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

      <div className="mb-8">
        <Breadcrumbs items={breadcrumbs} className="mb-3" />

        <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
          {category.name}
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-600 sm:text-[15px]">{intro}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8">
        <div className="lg:col-span-4">
          {/* Subcategories */}
          {subcategories.length > 0 && (
            <section className="mb-8 sm:mb-10 md:mb-12">
              <h2 className="mb-4 font-space text-lg font-semibold text-green-900 sm:text-xl">
                Shop by type
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
            <div className="mb-5 flex items-baseline justify-between gap-3">
              <h2 className="font-space text-xl font-semibold text-green-900 sm:text-2xl">
                Plants in this category
              </h2>
              <p className="shrink-0 text-sm text-gray-500">
                {products.length} {products.length === 1 ? "plant" : "plants"}
              </p>
            </div>

            <ProductGrid
              products={products}
              emptyState={
                <div className="rounded-2xl border border-emerald-100 bg-white p-8 text-center">
                  <h3 className="text-base font-semibold text-green-900">
                    No plants in this category right now
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    {subcategories.length > 0
                      ? "Try one of the plant types above."
                      : "New stock is added regularly. Please check back soon."}
                  </p>
                </div>
              }
            />
          </section>

          {/* Lateral internal links to the other collections */}
          {otherCategories.length > 0 && (
            <section className="mt-12 border-t border-emerald-100 pt-6">
              <h2 className="mb-3 text-base font-semibold text-green-900">
                Other plant categories
              </h2>
              <ul className="flex flex-wrap gap-2">
                {otherCategories.map(({ category: other }) => (
                  <li key={other.id}>
                    <Link
                      href={`/categories/${other.slug}`}
                      className="inline-block rounded-full border border-emerald-100 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:border-emerald-300 hover:text-green-900"
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
