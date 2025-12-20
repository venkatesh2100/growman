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
    <div className="max-w-7xl mx-auto pt-10 px-4">
      {/* Header Section */}
      <div className="mb-8 text-center lg:text-left">
        <h1 className="text-3xl font-bold text-green-800 mb-2">
          Plant Categories
        </h1>
        <p className="text-gray-600">
          Explore our wide variety of plant categories and find the perfect plants for your home
        </p>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-4">
          {/* Categories Section */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-green-800 mb-6">
              Browse Categories
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {categories.map((category) => (
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
            products={productsBySize}
            title="All Plants"
            showCount={true}
          />
        </div>
      </div>
    </div>
  );
}

export default function CategoriesPage() {
  return (
    <Suspense fallback={<PlantsLoading />}>
      <CategoriesContent />
    </Suspense>
  );
}