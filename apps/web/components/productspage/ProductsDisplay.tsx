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
  emptyMessage = 'No plants match this selection right now.',
}: ProductsDisplayProps) {

  return (
    <section>
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-space text-xl font-semibold text-green-900 sm:text-2xl">{title}</h2>
        {showCount && (
          <p className="shrink-0 text-sm text-gray-500">
            {countLabel ??
              `${products.length} ${products.length === 1 ? "plant" : "plants"}`}
          </p>
        )}
      </div>

      {products.length === 0 ? (
        <div className="rounded-2xl border border-emerald-100 bg-white py-12 text-center text-sm text-gray-600">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-5">
          {products.map(product => (
            <ProductCard
              key={`${product.id}-${product.sizes?.[0]?.id || 'default'}`}
              product={product}
            />
          ))}
        </div>
      )}
    </section>
  );
}
