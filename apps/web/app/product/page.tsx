import type { Metadata } from 'next';
import { FilterSidebar } from '../../components/productspage/FilterSideBar';
import CategoryCard from '../../components/productspage/categoryCard';
import ProductsDisplay from '../../components/productspage/ProductsDisplay';
import { fetchProductsData, filterProducts } from '../../lib/data';
import { buildCanonicalUrl } from '../../lib/seo/metadata';

/**
 * This listing duplicates /categories (same heading, same content) and /shop
 * (same filtering), so it is kept working but excluded from the index and
 * canonicalised to /categories to avoid competing duplicate pages.
 *
 * TODO: redirect /product to /categories permanently once it is confirmed
 * that nothing links to or bookmarks this URL.
 */
export const metadata: Metadata = {
  title: 'All Plants',
  robots: { index: false, follow: true },
  alternates: { canonical: buildCanonicalUrl('/categories') },
};

export default async function ProductsPage(
  {
    searchParams,
  }: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  }) {
  const resolvedSearchParams = await searchParams;

  // Fetch all data using shared utility (with caching)
  const {
    productsBySize,
    categories,
    categoryFilters,
    brandFilters,
    tags,
    priceRange,
  } = await fetchProductsData();

  // Filter products based on search params
  const filteredProducts = filterProducts(productsBySize, resolvedSearchParams);

  return (
    <main className="mx-auto max-w-7xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8">
      <div className="mb-8">
        <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
          All plants
        </h1>
        <p className="mt-1.5 text-sm text-gray-600 sm:text-[15px]">
          Browse by category or narrow the list with the filters.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <FilterSidebar
            filterOptions={{
              categories: categoryFilters,
              brands: brandFilters,
              tags,
              priceRange,
            }}
            searchParams={resolvedSearchParams}
          />
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3">
          {/* Categories Grid */}
          <section className="mb-12">
            <h2 className="mb-5 font-space text-xl font-semibold text-green-900 sm:text-2xl">Categories</h2>
            <div
              className="
                flex flex-nowrap gap-3 sm:gap-4 overflow-x-auto pb-3
                snap-x snap-mandatory scroll-smooth scrollbar-hide
                -mx-3 sm:-mx-4 px-3 sm:px-4
              "
            >
              {categories.map(category => (
                <div
                  key={category.id}
                  className="shrink-0 w-[58%] sm:w-[200px] md:w-[220px] snap-start"
                >
                  <CategoryCard
                    category={{
                      ...category,
                      products: categoryFilters.find(c => c.id === category.id)?.count || 0
                    }}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* All Plants Section */}
          <ProductsDisplay
            products={filteredProducts}
            title="Plants"
            showCount={true}
          />
        </div>
      </div>
    </main>
  );
}
