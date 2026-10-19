import { OrderSkeleton } from "../../components/loading/SkeletonLoader";

/**
 * Orders is behind auth and fetches on the client, so without this the
 * route showed a blank frame during navigation. The skeleton count matches
 * the typical first page of orders.
 */
export default function OrdersLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8" aria-busy="true">
      <div className="h-7 w-40 animate-pulse rounded-md bg-gray-200" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2].map((i) => (
          <OrderSkeleton key={i} />
        ))}
      </div>
      <span className="sr-only">Loading your orders</span>
    </div>
  );
}
