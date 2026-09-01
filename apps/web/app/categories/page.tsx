import CategoryCard from '../../components/productspage/categoryCard';
import ProductsDisplay from '../../components/productspage/ProductsDisplay';
import PlantsLoading from "../../components/loading";
import { fetchProductsData } from '../../lib/data';
import { Suspense } from 'react';

async function CategoriesContent() {
  const {
    productsBySize,
    categories,
    categoryFilters,
  } = await fetchProductsData();

  return (
    <div className="max-w-7xl mx-auto pt-6 sm:pt-8 md:pt-10 px-3 sm:px-4">
      {/* Header Section */}
      <div className="mb-6 sm:mb-8 text-center lg:text-left">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-green-800 mb-1 sm:mb-2">
          Plant Categories
        </h1>
        <p className="text-sm sm:text-base text-gray-600">
          Explore our wide variety of plant categories and find the perfect plants for your home
        </p>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-4">
          {/* Categories Section */}
          {categories.length > 0 && (
            <section className="mb-8 sm:mb-10 md:mb-12">
              <h2 className="text-xl sm:text-2xl font-semibold text-green-800 mb-4 sm:mb-6">
                Browse Categories
              </h2>
              <div
                className="
                  flex flex-nowrap gap-3 sm:gap-4 overflow-x-auto pb-3
                  snap-x snap-mandatory scroll-smooth scrollbar-hide
                  -mx-3 sm:-mx-4 px-3 sm:px-4
                "
              >
                {categories.map((category) => (
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
          )}

          {/* All Plants Section */}
          <ProductsDisplay
            products={productsBySize}
            title="All Plants"
            showCount={true}
          />
        </div>
      </div>
    </div>
  );
}

// Allow static generation but handle API unavailability gracefully
export const revalidate = 60; // Revalidate every 60 seconds

export default function CategoriesPage() {
  return (
    <Suspense fallback={<PlantsLoading />}>
      <CategoriesContent />
    </Suspense>
  );
}