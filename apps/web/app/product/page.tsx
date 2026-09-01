
import { FilterSidebar } from '../../components/productspage/FilterSideBar';
import CategoryCard from '../../components/productspage/categoryCard';
import ProductsDisplay from '../../components/productspage/ProductsDisplay';
import { fetchProductsData, filterProducts } from '../../lib/data';

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
    <div className="max-w-7xl pt-10 mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-green-800 mb-2">Plant Categories</h1>
        <p className="text-gray-600">
          Explore our wide variety of plant categories and find the perfect plants for your home
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
            <h2 className="text-2xl font-semibold text-green-800 mb-6">Browse Categories</h2>
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
            title="All Plants"
            showCount={true}
          />
        </div>
      </div>
    </div>
  );
}
