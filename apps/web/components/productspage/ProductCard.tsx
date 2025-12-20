'use client';

import Link from "next/link";
import { useMemo, useState } from "react";
import { ShoppingCart, Zap } from "lucide-react";
import { useCartStore } from "../../../lib/store/cartStore";
import { useRouter } from "next/navigation";

export default function ProductCard({ product }: { product: any }) {
  const [hovered, setHovered] = useState(false);
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);

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

  const firstPrice = numericPrices.length > 0 ? numericPrices[0] : null;
  const discountPercent = firstPrice && product.mrp && product.mrp > firstPrice 
    ? Math.round((1 - firstPrice / product.mrp) * 100) 
    : 0;

  return (
    <div className="w-full bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 flex flex-col group h-full">
      {/* Image container */}
      <Link href={`/product/${product?.slug ?? ""}`} className="relative overflow-hidden aspect-square bg-gray-50">
        {allImages.length > 0 ? (
          <img
            src={hovered && allImages[1] ? allImages[1] : allImages[0]}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
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
        {/* Stock badge */}
        <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium shadow-sm ${
          totalStock > 0 ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {totalStock > 0 ? 'In Stock' : 'Sold Out'}
        </div>
        {/* Discount badge */}
        {discountPercent > 0 && (
          <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-red-500 text-white text-xs font-bold shadow-sm">
            {discountPercent}% OFF
          </div>
        )}
      </Link>

      <div className="p-4 flex flex-col flex-1">
        {/* Category */}
        {product.category?.name && (
          <span className="text-xs text-emerald-600 font-medium mb-1">
            {product.category.name}
          </span>
        )}

        {/* Product Name */}
        <Link href={`/product/${product?.slug ?? ""}`}>
          <h2 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-2 min-h-10 sm:min-h-12 hover:text-emerald-600 transition-colors">
            {product.name}
          </h2>
        </Link>

        {/* Pricing Display */}
        {firstPrice !== null && (
          <div className="mb-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-lg font-bold text-gray-900">
                ₹{firstPrice.toFixed(2)}
              </span>
              {product.mrp && product.mrp > firstPrice && (
                <>
                  <span className="text-sm text-gray-500 line-through">
                    ₹{product.mrp.toFixed(2)}
                  </span>
                </>
              )}
            </div>
            {hasMultipleSizes && (
              <p className="text-xs text-gray-500 mt-1">
                {product.sizes.length} sizes available
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-auto flex gap-2">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (normalizedSizes.length > 0 && totalStock > 0) {
                const firstSize = normalizedSizes[0];
                addItem({
                  productId: product.id,
                  productSizeId: firstSize.id,
                  name: product.name,
                  mrp: product.mrp,
                  price: firstSize.price,
                  label: firstSize.label,
                  quantity: 1,
                  image: firstSize.images?.[0] || product.imageUrl || '',
                });
              }
            }}
            disabled={totalStock === 0}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all transform hover:scale-105 active:scale-95 ${
              totalStock === 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-white border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span className="hidden sm:inline">Add to Cart</span>
            <span className="sm:hidden">Add</span>
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (normalizedSizes.length > 0 && totalStock > 0) {
                const firstSize = normalizedSizes[0];
                addItem({
                  productId: product.id,
                  productSizeId: firstSize.id,
                  name: product.name,
                  mrp: product.mrp,
                  price: firstSize.price,
                  label: firstSize.label,
                  quantity: 1,
                  image: firstSize.images?.[0] || product.imageUrl || '',
                });
                router.push('/checkout');
              }
            }}
            disabled={totalStock === 0}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all transform hover:scale-105 active:scale-95 ${
              totalStock === 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-md'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span className="hidden sm:inline">Buy Now</span>
            <span className="sm:hidden">Buy</span>
          </button>
        </div>
      </div>
    </div>
  );
}
