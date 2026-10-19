import { ProductCardSkeleton } from "../../components/loading/SkeletonLoader";

export default function WishlistLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8" aria-busy="true">
      <div className="h-7 w-32 animate-pulse rounded-md bg-gray-200" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
      <span className="sr-only">Loading your wishlist</span>
    </div>
  );
}
