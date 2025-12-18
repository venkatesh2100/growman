'use client';

import ProductCard from "@repo/ui/productCard";

export default function RelatedProducts({ products }: { products: any[] }) {
  // Accept products even if sizes are missing; ProductCard will handle fallbacks
  const displayableProducts = products?.filter(Boolean) ?? [];

  if (displayableProducts.length === 0) {
    return (
      <div className="mt-10">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 px-2 sm:px-0">
          Related Products
        </h2>
        <p className="text-gray-500">No related products found.</p>
      </div>
    );
  }

  // Log what we actually render to catch missing data quickly
  console.log("RelatedProducts renderable count:", displayableProducts.length);

  return (
    <div className="mt-10">
      <h2 className="text-xl sm:text-2xl font-bold mb-4 px-2 sm:px-0">
        Related Products
      </h2>

      {/* Mobile: horizontal scroll, Large: grid */}
      <div className="lg:hidden overflow-x-auto scrollbar-hide">
        <div className="flex gap-4 px-2 snap-x snap-mandatory">
          {displayableProducts.map((product) => {
            // console.log("Rendering product in mobile view:", product.id, product.name);
            return (
              <div
                key={product.id}
                className="snap-start min-w-[250px] sm:min-w-[280px]"
              >
                <ProductCard product={product} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid layout for large screens */}
      <div className="hidden lg:grid grid-cols-2 xl:grid-cols-4 gap-6">
        {displayableProducts.map((product) => {
          console.log("Rendering product in desktop view:", product.id, product.name);
          return (
            <ProductCard key={product.id} product={product} />
          );
        })}
      </div>
    </div>
  );
}
