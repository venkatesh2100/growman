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
    <main className="mx-auto max-w-7xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8">
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

      <div className="mb-8">
        <Breadcrumbs items={breadcrumbs} className="mb-3" />

        <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
          {subcategory.name} {category.name}
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-600 sm:text-[15px]">{intro}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8">
        <div className="lg:col-span-4">
          <section>
            <div className="mb-5 flex items-baseline justify-between gap-3">
              <h2 className="font-space text-xl font-semibold text-green-900 sm:text-2xl">
                {subcategory.name} plants
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
                    No plants of this type right now
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Browse all{" "}
                    <Link
                      href={`/categories/${category.slug}`}
                      className="font-medium text-emerald-700 hover:text-emerald-900"
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
            <section className="mt-12 border-t border-emerald-100 pt-6">
              <h2 className="mb-3 text-base font-semibold text-green-900">
                More in {category.name}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {siblings.map((sibling) => (
                  <li key={sibling.id}>
                    <Link
                      href={`/categories/${category.slug}/${sibling.slug}`}
                      className="inline-block rounded-full border border-emerald-100 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:border-emerald-300 hover:text-green-900"
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
