'use client';

import ProductCard from "../../../components/productspage/ProductCard";
import type { Product } from "../../../lib/types";

export default function RelatedProducts({ products }: { products: Product[] }) {
  // Accept products even if sizes are missing; ProductCard will handle fallbacks
  const displayableProducts = products?.filter(Boolean) ?? [];

  if (displayableProducts.length === 0) return null;

  return (
    <section className="mt-12" aria-labelledby="related-heading">
      <h2
        id="related-heading"
        className="mb-4 font-space text-xl font-semibold text-green-900 sm:text-2xl"
      >
        You may also like
      </h2>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:gap-4 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0 lg:pb-0">
        {displayableProducts.map((product) => (
          <div key={product.id} className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-auto">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
}
