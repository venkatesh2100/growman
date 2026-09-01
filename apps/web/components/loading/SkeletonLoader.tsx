import { Leaf } from "lucide-react";

export function ProductCardSkeleton() {
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-emerald-100 bg-[#f7fbf7] shadow-[0_10px_28px_rgba(6,95,70,0.08)]"
      aria-hidden
    >
      <div className="skeleton-shimmer relative aspect-square overflow-hidden bg-[linear-gradient(145deg,#d8f0dc_0%,#eef8ee_52%,#d4ebe3_100%)]">
        {/* <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 22% 18%, rgba(255,255,255,0.9) 0 18%, transparent 42%), radial-gradient(circle at 78% 72%, rgba(16,185,129,0.18) 0 22%, transparent 48%)",
          }}
        /> */}
        {/* <Leaf
          className="absolute inset-0 m-auto h-14 w-14 text-emerald-600/25"
          strokeWidth={1.25}
        /> */}
        {/* <div className="absolute top-2 right-2 h-5 w-[4.25rem] rounded-full bg-white/70 ring-1 ring-emerald-200/80" /> */}
      </div>

      <div className="flex flex-1 flex-col bg-white p-2.5 sm:p-3">
        <div className="mb-2 h-3 w-[4.5rem] rounded-full bg-emerald-100" />
        <div className="mb-1.5 h-4 w-[90%] rounded-md bg-slate-200/90" />
        <div className="mb-3 h-4 w-[58%] rounded-md bg-slate-200/70" />
        <div className="mb-1 h-5 w-14 rounded-md bg-slate-200" />
        <div className="mt-auto flex gap-1.5 pt-3">
          {/* <div className="h-9 flex-1 rounded-lg  border-emerald-200 bg-emerald-50" /> */}
          {/* <div className="h-9 flex-1 rounded-lg bg-emerald-500/80" /> */}
        </div>
      </div>
    </div>
  );
}

export function CartItemSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 flex flex-col sm:flex-row gap-4 items-center animate-pulse">
      <div className="w-24 h-24 rounded-lg bg-gray-200"></div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-5 bg-gray-200 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
      </div>
      <div className="h-10 bg-gray-200 rounded w-24"></div>
      <div className="h-6 bg-gray-200 rounded w-20"></div>
    </div>
  );
}

export function OrderSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 animate-pulse">
      <div className="flex justify-between mb-4">
        <div className="space-y-2">
          <div className="h-5 bg-gray-200 rounded w-32"></div>
          <div className="h-4 bg-gray-200 rounded w-24"></div>
        </div>
        <div className="h-6 bg-gray-200 rounded w-20"></div>
      </div>
      <div className="border-t pt-4 space-y-3">
        <div className="flex gap-4">
          <div className="w-16 h-16 bg-gray-200 rounded-lg"></div>
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
