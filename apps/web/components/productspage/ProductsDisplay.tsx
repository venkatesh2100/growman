'use client';

import ProductCard from './ProductCard';
import type { Product } from '../../lib/types';

interface ProductsDisplayProps {
  products: Product[];
  title?: string;
  showCount?: boolean;
  countLabel?: string;
  emptyMessage?: string;
}

export default function ProductsDisplay({
  products,
  title = 'All Plants',
  showCount = true,
  countLabel,
  emptyMessage = 'No plants found. Please check back later.',
}: ProductsDisplayProps) {

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-2 sm:gap-0">
        <h2 className="text-2xl font-semibold text-green-800">{title}</h2>
        {showCount && (
          <div className="text-sm text-emerald-600">
            {countLabel ??
              `Showing ${products.length} ${products.length === 1 ? "plant" : "plants"}`}
          </div>
        )}
      </div>

      {products.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">{emptyMessage}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 items-start gap-2 overflow-visible py-1 md:grid-cols-3 md:gap-6 md:py-2 lg:grid-cols-4">
          {products.map(product => (
            <div
              key={`${product.id}-${product.sizes[0]?.id || 'default'}`}
              className="relative z-0 h-full origin-center transition-[transform,z-index] duration-300 ease-out hover:z-50 hover:scale-[1.03]"
            >
              <ProductCard product={product} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
