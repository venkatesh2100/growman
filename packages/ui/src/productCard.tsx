'use client';

import Link from "next/link";
import { useMemo, useState } from "react";
//! Currently Not using UI Component!
export default function ProductCard({ product }: { product: any }) {
  const [hovered, setHovered] = useState(false);

  // Normalize sizes so we can still render if backend omits them
  const normalizedSizes = useMemo(() => {
    if (Array.isArray(product?.sizes) && product.sizes.length > 0) {
      return product.sizes;
    }
    // Try to build a single pseudo-size from top-level fields to avoid blank cards
    if (product) {
      const fallback = {
        price: product.price ?? product.mrp ?? 0,
        stock: product.stock ?? 0,
        label: product.sizeLabel ?? "Default",
        images: product.images ?? [],
      };
      return [fallback];
    }
    return [];
  }, [product]);

  const fallbackImages =
    product?.images ||
    product?.featuredImage ||
    product?.image ||
    product?.thumbnail ||
    [];

  const allImages = (() => {
    const fromSizes = normalizedSizes.flatMap((size: any) => size?.images || []);
    if (fromSizes.length > 0) return fromSizes;
    if (Array.isArray(fallbackImages)) return fallbackImages;
    if (typeof fallbackImages === "string") return [fallbackImages];
    return [];
  })();
  const hasMultipleSizes = normalizedSizes.length > 1;

  // Normalize prices to numbers to avoid toFixed crashes
  const numericPrices = normalizedSizes
    .map((s: any) => Number(s?.price))
    .filter((p: number) => Number.isFinite(p));

  const minPrice = numericPrices.length > 0 ? Math.min(...numericPrices) : null;
  const maxPrice = numericPrices.length > 0 ? Math.max(...numericPrices) : null;

  const totalStock =
    normalizedSizes.reduce(
      (sum: number, size: any) => sum + (size?.stock || 0),
      0
    ) ?? product?.stock ?? 0;

  return (
    <Link
      href={`/product/${product?.slug ?? ""}`}
      prefetch
      className="w-full bg-white rounded-xl  overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 border border-green-50 flex flex-col group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Image container */}
      <div className="relative overflow-hidden aspect-square bg-gray-100">
        {allImages.length > 0 ? (
          <img
            src={hovered && allImages[1] ? allImages[1] : allImages[0]}
            alt={product.name}
            className="w-full h-full object-cover transition-opacity duration-500"
            onError={(e) => {
              console.error("Image failed to load:", e);
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-200">
            <span className="text-gray-400 text-sm">No image</span>
          </div>
        )}
        <div className={`absolute top-2 right-2 sm:top-3 sm:right-3 px-2 py-0.5 sm:px-2 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium ${totalStock > 0 ? 'bg-green-100 text-green-800' : 'bg-rose-100 text-rose-800'}`}>
          {totalStock > 0 ? `${totalStock} in stock` : 'Sold out'}
        </div>
      </div>

      <div className="p-3 sm:p-4 flex flex-col flex-1">
        <div className="flex gap-1 sm:gap-2 mb-1 sm:mb-2">
          {product.category?.name && (
            <span className="bg-emerald-50 text-emerald-700 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full">
              {product.category.name}
            </span>
          )}
        </div>

        <div className="mb-1 sm:mb-2">
          <h2 className="font-medium text-gray-900 text-sm sm:text-base line-clamp-2 min-h-[2.5rem] sm:min-h-[3rem]">
            {product.name}
          </h2>
          <div className="mt-1 flex items-center flex-wrap">
            <span className="text-base sm:text-lg font-bold text-emerald-700">
              {hasMultipleSizes && minPrice !== null && maxPrice !== null
                ? `₹${minPrice.toFixed(2)} - ₹${maxPrice.toFixed(2)}`
                : numericPrices.length > 0
                  ? `₹${numericPrices[0].toFixed(2)}`
                  : "Price unavailable"}
            </span>
            {hasMultipleSizes && (
              <span className="ml-1 sm:ml-2 text-[10px] sm:text-xs text-gray-500 bg-gray-100 px-1 sm:px-1.5 py-0.5 rounded">
                {product.sizes.length} sizes
              </span>
            )}
          </div>
        </div>

        <p className="text-gray-500 text-xs sm:text-sm line-clamp-2 mb-2 sm:mb-3 mt-auto">
          {product.shortDescription}
        </p>

        <div className="mt-1 mb-2 sm:mt-2 sm:mb-3">
          <div className="flex flex-wrap gap-1">
            {normalizedSizes.slice(0, 4).map((size: any, index: number) => (
              <div
                key={index}
                className="text-[10px] sm:text-xs bg-emerald-50 text-emerald-800 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full border border-emerald-100"
              >
                {size.label === "S" ? "small" : size.label === "M" ? "medium" : size.label === "L" ? "large" : size.label}
              </div>
            ))}
            {normalizedSizes.length > 4 && (
              <div className="text-[10px] sm:text-xs bg-gray-100 text-gray-600 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full">
                +{normalizedSizes.length - 4} more
              </div>
            )}
          </div>
        </div>

        {/* Optional: you can style the "View Details" div to look like a button, but not a <Link> */}
        <div className="mt-auto w-full py-1.5 sm:py-2 text-center rounded-lg bg-emerald-600 group-hover:bg-emerald-700 text-white text-sm sm:font-medium transition-colors duration-300">
          View Details
        </div>
      </div>
    </Link>
  );
}
