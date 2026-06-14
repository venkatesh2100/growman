"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { ShoppingCart, Zap } from "lucide-react";
import { useCartStore } from "../../lib/store/cartStore";
import { useRouter } from "next/navigation";
import { toast } from "../../lib/toast";

import { Product } from "../../lib/types";

// Extended Product type to handle API variations
type ProductWithVariations = Product & {
  sizeLabel?: string;
  images?: string[];
  featuredImage?: string;
  image?: string;
  thumbnail?: string;
};

// Accept any product-like object for flexibility
type AnyProduct =
  | Product
  | ProductWithVariations
  | {
      id: string | number;
      name: string;
      price?: number;
      mrp?: number;
      stock?: number;
      slug: string;
      imageUrl?: string;
      sizes?: Array<{
        id?: string | number;
        price: number;
        stock: number;
        label: string;
        images?: string[];
      }>;
      category?: {
        name: string;
      };
      [key: string]: unknown;
    };

export default function ProductCard({ product }: { product: AnyProduct }) {
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
      const extendedProduct = product as ProductWithVariations;
      const fallback = {
        price: product.price ?? (product as { mrp?: number }).mrp ?? 0,
        stock: product.stock ?? 0,
        label: extendedProduct.sizeLabel ?? "Default",
        images: extendedProduct.images ?? [],
      };
      return [fallback];
    }
    return [];
  }, [product]);

  const extendedProduct = product as ProductWithVariations;
  const fallbackImages =
    extendedProduct?.images ||
    extendedProduct?.featuredImage ||
    extendedProduct?.image ||
    extendedProduct?.thumbnail ||
    product?.imageUrl ||
    [];

  const allImages = (() => {
    const fromSizes = normalizedSizes.flatMap((size) => size?.images || []);
    if (fromSizes.length > 0) return fromSizes;
    if (Array.isArray(fallbackImages)) return fallbackImages;
    if (typeof fallbackImages === "string") return [fallbackImages];
    return [];
  })();
  const hasMultipleSizes = normalizedSizes.length > 1;

  // Normalize prices to numbers to avoid toFixed crashes
  const numericPrices = normalizedSizes
    .map((s) => Number(s?.price))
    .filter((p: number) => Number.isFinite(p));

  const totalStock =
    normalizedSizes.reduce(
      (sum: number, size) => sum + (size?.stock || 0),
      0
    ) ??
    product?.stock ??
    0;

  const firstPrice = numericPrices[0] ?? null;

  const numericMrp = Number(product.mrp);
  const effectiveMrp =
    Number.isFinite(numericMrp) && numericMrp > 0 ? numericMrp : null;

  const hasDiscount =
    effectiveMrp !== null &&
    firstPrice !== null &&
    firstPrice > 0 &&
    effectiveMrp > firstPrice;

  const discountPercent = hasDiscount
    ? Math.round((1 - firstPrice / effectiveMrp) * 100)
    : 0;
  return (
    <div className="w-full bg-white md:rounded-xl md:overflow-hidden md:shadow-sm md:hover:shadow-xl md:active:shadow-lg md:transition-shadow md:duration-200 md:border md:border-gray-100 flex flex-col group h-full touch-manipulation md:flex-col">
      {/* Mobile: Amazon-like minimal design */}
      <div className="md:hidden">
        <Link
          href={`/product/${product?.slug ?? ""}`}
          target="_blank"
          rel="noopener noreferrer"
          className="relative block bg-gray-50 touch-manipulation"
        >
          <div className="relative w-full aspect-square">
            {allImages.length > 0 && allImages[0] ? (
              <Image
                src={allImages[0]}
                alt={product.name}
                fill
                sizes="(max-width: 640px) 50vw, 25vw"
                className="object-cover"
                loading="lazy"
                onError={(e) => {
                  console.error("Image failed to load:", e);
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-100">
                <span className="text-gray-400 text-xs">No image</span>
              </div>
            )}
            {/* Discount badge - minimal */}
            {discountPercent > 0 && (
              <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-semibold">
                {discountPercent}% OFF
              </div>
            )}
          </div>
        </Link>

        <div className="p-2.5 flex flex-col">
          {/* Product Name - 2 line clamp */}
          <Link
            href={`/product/${product?.slug ?? ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-manipulation mb-1.5"
          >
            {product.category?.name && (
              <span className="text-[10px] sm:text-xs text-emerald-600 font-medium mb-1">
                {product.category.name}
              </span>
            )}

            <h2 className="font-medium text-gray-900 text-sm leading-tight  min-h-10">
              {product.name}
            </h2>
          </Link>

          {/* Pricing - clean and minimal */}
          {firstPrice !== null && firstPrice !== undefined && firstPrice > 0 ? (
            <div className="mb-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-base font-semibold text-gray-900">
                  ₹{firstPrice ? firstPrice.toFixed(0) : "0"}
                </span>
                {hasDiscount && effectiveMrp !== null && (
                    <span className="text-xs text-gray-500 line-through">
                      ₹{effectiveMrp.toFixed(0)}
                    </span>
                  )}
              </div>
              {hasMultipleSizes && product.sizes && (
                <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">
                  {product.sizes.length} sizes available
                </p>
              )}
            </div>
          ) : null}

          {/* Stock indicator - minimal */}

          {/* Action Buttons - Mobile */}
          <div className="mt-auto flex gap-1.5 pt-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (normalizedSizes.length > 0 && totalStock > 0) {
                  const firstSize = normalizedSizes[0];
                  if (firstSize) {
                    const sizeId = "id" in firstSize ? firstSize.id : undefined;
                    addItem({
                      productId:
                        typeof product.id === "number"
                          ? product.id
                          : Number(product.id),
                      productSizeId: sizeId
                        ? typeof sizeId === "number"
                          ? sizeId
                          : Number(sizeId)
                        : undefined,
                      name: product.name,
                      mrp: product.mrp,
                      price: firstSize.price,
                      label: firstSize.label,
                      quantity: 1,
                      image: firstSize.images?.[0] || product.imageUrl || "",
                    });
                    toast(`${product.name} added to cart!`);
                  }
                } else {
                  toast("This item is out of stock", "error");
                }
              }}
              disabled={totalStock === 0}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold transition-all touch-manipulation active:scale-95 ${
                totalStock === 0
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-white border border-emerald-600 text-emerald-600 active:bg-emerald-50"
              }`}
            >
              <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
              <span>Add</span>
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (normalizedSizes.length > 0 && totalStock > 0) {
                  const firstSize = normalizedSizes[0];
                  if (firstSize) {
                    const sizeId = "id" in firstSize ? firstSize.id : undefined;
                    addItem({
                      productId:
                        typeof product.id === "number"
                          ? product.id
                          : Number(product.id),
                      productSizeId: sizeId
                        ? typeof sizeId === "number"
                          ? sizeId
                          : Number(sizeId)
                        : undefined,
                      name: product.name,
                      mrp: product.mrp,
                      price: firstSize.price,
                      label: firstSize.label,
                      quantity: 1,
                      image: firstSize.images?.[0] || product.imageUrl || "",
                    });
                    router.push("/checkout");
                  }
                }
              }}
              disabled={totalStock === 0}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold transition-all touch-manipulation active:scale-95 ${
                totalStock === 0
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-emerald-600 text-white active:bg-emerald-700"
              }`}
            >
              <Zap className="w-3.5 h-3.5 shrink-0" />
              <span>Buy</span>
            </button>
          </div>
        </div>
      </div>

      {/* Desktop: Original design */}
      <div className="hidden md:block">
        <Link
          href={`/product/${product?.slug ?? ""}`}
          target="_blank"
          rel="noopener noreferrer"
          className="relative block overflow-hidden aspect-square bg-gray-50 touch-manipulation"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div className="relative w-full h-full">
            {allImages.length > 0 && allImages[0] ? (
              <Image
                src={hovered && allImages[1] ? allImages[1] : allImages[0]}
                alt={product.name}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                className="object-cover transition-transform duration-300 group-hover:scale-105 will-change-transform"
                loading="lazy"
                onError={(e) => {
                  console.error("Image failed to load:", e);
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-200">
                <span className="text-gray-400 text-xs sm:text-sm">
                  No image
                </span>
              </div>
            )}
            {/* Stock badge */}
            <div
              className={`absolute top-2 right-2 px-2 py-1 rounded-full text-[10px] sm:text-xs font-medium shadow-sm ${
                totalStock > 0
                  ? "bg-green-500 text-white"
                  : "bg-red-500 text-white"
              }`}
            >
              {totalStock > 0 ? "In Stock" : "Sold Out"}
            </div>
            {/* Discount badge */}
            {discountPercent > 0 && (
              <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-red-500 text-white text-[10px] sm:text-xs font-bold shadow-sm">
                {discountPercent}% OFF
              </div>
            )}
          </div>
        </Link>

        <div className="p-3 sm:p-4 flex flex-col flex-1">
          {/* Category */}
          {product.category?.name && (
            <span className="text-[10px] sm:text-xs text-emerald-600 font-medium mb-1">
              {product.category.name}
            </span>
          )}

          {/* Product Name */}
          <Link
            href={`/product/${product?.slug ?? ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-manipulation"
          >
            <h2 className="font-semibold text-gray-900 text-xs sm:text-sm line-clamp-2 mb-2 min-h-10 sm:min-h-12 hover:text-emerald-600 active:text-emerald-700 transition-colors">
              {product.name}
            </h2>
          </Link>

          {/* Pricing Display */}
          {firstPrice !== null && firstPrice !== undefined && firstPrice > 0 ? (
            <div className="mb-2 sm:mb-3">
              <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap">
                <span className="text-base sm:text-lg font-bold text-gray-900">
                  ₹{firstPrice ? firstPrice.toFixed(0) : "0"}
                </span>
                {hasDiscount && effectiveMrp !== null && (
                    <>
                      <span className="text-xs sm:text-sm text-gray-500 line-through">
                        ₹{effectiveMrp.toFixed(0)}
                      </span>
                      <span className="text-xs sm:text-sm text-green-600 font-medium">
                        {discountPercent}% off
                      </span>
                    </>
                  )}
              </div>
              {hasMultipleSizes && product.sizes && (
                <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">
                  {product.sizes.length} sizes available
                </p>
              )}
            </div>
          ) : null}

          {/* Action Buttons */}
          <div className="mt-auto flex gap-1.5 sm:gap-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (normalizedSizes.length > 0 && totalStock > 0) {
                  const firstSize = normalizedSizes[0];
                  if (firstSize) {
                    const sizeId = "id" in firstSize ? firstSize.id : undefined;
                    addItem({
                      productId:
                        typeof product.id === "number"
                          ? product.id
                          : Number(product.id),
                      productSizeId: sizeId
                        ? typeof sizeId === "number"
                          ? sizeId
                          : Number(sizeId)
                        : undefined,
                      name: product.name,
                      mrp: product.mrp,
                      price: firstSize.price,
                      label: firstSize.label,
                      quantity: 1,
                      image: firstSize.images?.[0] || product.imageUrl || "",
                    });
                    toast(`${product.name} added to cart!`);
                  }
                } else {
                  toast("This item is out of stock", "error");
                }
              }}
              disabled={totalStock === 0}
              className={`flex-1 flex items-center justify-center gap-1 sm:gap-1.5 py-2.5 sm:py-2 rounded-lg text-[11px] sm:text-xs font-semibold transition-all touch-manipulation active:scale-95 ${
                totalStock === 0
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-white border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100"
              }`}
            >
              <ShoppingCart className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="hidden sm:inline">Add to Cart</span>
              <span className="sm:hidden">Add</span>
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (normalizedSizes.length > 0 && totalStock > 0) {
                  const firstSize = normalizedSizes[0];
                  if (firstSize) {
                    const sizeId = "id" in firstSize ? firstSize.id : undefined;
                    addItem({
                      productId:
                        typeof product.id === "number"
                          ? product.id
                          : Number(product.id),
                      productSizeId: sizeId
                        ? typeof sizeId === "number"
                          ? sizeId
                          : Number(sizeId)
                        : undefined,
                      name: product.name,
                      mrp: product.mrp,
                      price: firstSize.price,
                      label: firstSize.label,
                      quantity: 1,
                      image: firstSize.images?.[0] || product.imageUrl || "",
                    });
                    router.push("/checkout");
                  }
                }
              }}
              disabled={totalStock === 0}
              className={`flex-1 flex items-center justify-center gap-1 sm:gap-1.5 py-2.5 sm:py-2 rounded-lg text-[11px] sm:text-xs font-semibold transition-all touch-manipulation active:scale-95 ${
                totalStock === 0
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-md active:shadow-sm"
              }`}
            >
              <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="hidden sm:inline">Buy Now</span>
              <span className="sm:hidden">Buy</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
