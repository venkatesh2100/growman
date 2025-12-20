
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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {categories.map(category => (
                <CategoryCard
                  key={category.id}
                  category={{
                    ...category,
                    products: categoryFilters.find(c => c.id === category.id)?.count || 0
                  }}
                />
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
