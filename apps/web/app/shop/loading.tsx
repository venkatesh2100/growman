import { ProductCardSkeleton } from "../../components/loading/SkeletonLoader";

/**
 * The shop grid is server-rendered from the catalog API, so this is what
 * fills the gap while that request is in flight. Twelve cards matches the
 * first page size, which keeps the layout from jumping when real data
 * arrives.
 */
export default function ShopLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded-md bg-gray-200" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-gray-200" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
      <span className="sr-only">Loading plants</span>
    </div>
  );
}
