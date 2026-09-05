import { ReactNode } from "react";
import ProductCard from "./ProductCard";
import type { Product } from "../../lib/types";

interface ProductGridProps {
  products: Product[];
  /** Grid container classes — each page keeps its own responsive column layout. */
  className?: string;
  emptyState: ReactNode;
}

/**
 * Renders a product grid or its empty state. Shared by the pages that list
 * products outside of `ProductsDisplay` (wishlist, category/subcategory pages),
 * which each use a different column layout, so the grid classes stay configurable.
 */
export default function ProductGrid({
  products,
  className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5 md:gap-6",
  emptyState,
}: ProductGridProps) {
  if (products.length === 0) return <>{emptyState}</>;

  return (
    <div className={className}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
