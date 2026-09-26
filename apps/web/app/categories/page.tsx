import type { Metadata } from 'next';
import ProductsDisplay from '../../components/productspage/ProductsDisplay';
import PlantsLoading from "../../components/loading";
import Breadcrumbs from '../../components/seo/Breadcrumbs';
import CategoryLinksSection from '../../components/hompage/CategoryLinksSection';
import { fetchProductsData } from '../../lib/data';
import { Suspense } from 'react';
import { createBreadcrumbs, createPageMetadata } from '../../lib/seo/metadata';

export const metadata: Metadata = createPageMetadata({
  title: 'All Plant Categories',
  description:
    "Browse every plant category Growman stocks — indoor, outdoor, ornamental, flowering, fruit, medicinal and avenue plants — and find the collection that suits your space.",
  path: '/categories',
});

async function CategoriesContent() {
  const { productsBySize } = await fetchProductsData();

  return (
    <main className="max-w-7xl mx-auto pt-6 sm:pt-8 md:pt-10 px-3 sm:px-4">
      <div className="mb-6 sm:mb-8 text-center lg:text-left">
        <Breadcrumbs
          items={createBreadcrumbs([{ name: 'Plants', path: '/categories' }])}
          className="mb-3 flex justify-center lg:justify-start"
        />
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-green-800 mb-1 sm:mb-2">
          Plant Categories
        </h1>
        <p className="mx-auto max-w-3xl text-sm sm:text-base text-gray-600 lg:mx-0">
          Every collection Growman stocks.
        </p>
      </div>

      {/* Same circular tiles as the homepage — shared component, shared catalog. */}
      <CategoryLinksSection
        title="Browse Categories"
        description={null}
        withContainer={false}
        plantTypesLayout="scroll"
        className="mb-8 sm:mb-10 md:mb-12 py-0"
      />

      <ProductsDisplay
        products={productsBySize}
        title="All Plants"
        showCount={true}
      />
    </main>
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
