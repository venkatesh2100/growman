import { ReactNode } from "react";
import ProductCard from "./ProductCard";
import type { Product } from "../../lib/types";

interface ProductGridProps {
  products: Product[];
  /** Grid container classes — each page keeps its own responsive column layout. */
  className?: string;
  emptyState: ReactNode;
  /** Optional control shown on each card's image, e.g. a remove button. */
  renderAction?: (product: Product) => ReactNode;
}

/**
 * Renders a product grid or its empty state. Shared by the pages that list
 * products outside of `ProductsDisplay` (wishlist, category/subcategory pages),
 * which each use a different column layout, so the grid classes stay configurable.
 */
export default function ProductGrid({
  products,
  className = "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-5",
  emptyState,
  renderAction,
}: ProductGridProps) {
  if (products.length === 0) return <>{emptyState}</>;

  return (
    <div className={className}>
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          cornerAction={renderAction?.(product)}
        />
      ))}
    </div>
  );
}
