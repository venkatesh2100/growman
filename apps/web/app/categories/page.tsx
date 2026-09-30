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
    <main className="mx-auto max-w-7xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8">
      <div className="mb-8">
        <Breadcrumbs
          items={createBreadcrumbs([{ name: 'Plants', path: '/categories' }])}
          className="mb-3"
        />
        <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
          Plant categories
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-gray-600 sm:text-[15px]">
          Every collection Growman stocks, from indoor foliage to avenue trees.
        </p>
      </div>

      {/* Same circular tiles as the homepage — shared component, shared catalog. */}
      <CategoryLinksSection
        title="Collections"
        description={null}
        withContainer={false}
        plantTypesLayout="scroll"
        className="mb-12 py-0"
      />

      <ProductsDisplay
        products={productsBySize}
        title="All plants"
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
