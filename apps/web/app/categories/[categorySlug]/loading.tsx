import { ProductCardSkeleton } from "../../../components/loading/SkeletonLoader";

export default function CategoryLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8" aria-busy="true">
      <div className="h-4 w-56 animate-pulse rounded bg-gray-200" />
      <div className="mt-4 h-8 w-64 animate-pulse rounded-md bg-gray-200" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
      <span className="sr-only">Loading this category</span>
    </div>
  );
}
