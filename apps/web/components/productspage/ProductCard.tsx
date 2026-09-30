"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { useCartStore } from "../../lib/store/cartStore";
import { toast } from "../../lib/toast";
import { buildCartLine } from "../../lib/cart";
import { formatPrice, getDiscount } from "../../lib/format";
import OptimizedImage from "../ui/OptimizedImage";

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
      brand?: {
        name: string;
        slug: string;
      };
      sizes?: Array<{
        id?: string | number;
        price: number;
        stock: number;
        label: string;
        images?: string[];
      }>;
      category?: {
        name: string;
        slug?: string;
      };
      tags?: string[];
      [key: string]: unknown;
    };

function isGrowmanBrand(product: AnyProduct): boolean {
  const brand = product.brand;
  if (!brand || typeof brand !== "object") return false;
  const name = "name" in brand ? String(brand.name).trim().toLowerCase() : "";
  const slug = "slug" in brand ? String(brand.slug).trim().toLowerCase() : "";
  return name === "growman" || slug === "growman";
}

function GrowmanLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6 12C6 15.3137 8.68629 18 12 18C14.6124 18 16.8349 16.3304 17.6586 14H12V10H21.8047V14H21.8C20.8734 18.5645 16.8379 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C15.445 2 18.4831 3.742 20.2815 6.39318L17.0039 8.68815C15.9296 7.06812 14.0895 6 12 6C8.68629 6 6 8.68629 6 12Z"
        fill="currentColor"
      />
    </svg>
  );
}

function GrowmanGuaranteeBadge() {
  return (
    <div
      className="pointer-events-none absolute right-2 bottom-2 z-[1] flex flex-col items-end leading-none text-emerald-950 opacity-[0.18] select-none"
      aria-hidden
    >
      <span className="text-[8px] font-medium tracking-[0.22em] uppercase sm:text-[9px]">
        Growman
      </span>
      <div className="mt-0.5 flex items-center gap-0.5 pr-0.5">
        <GrowmanLogo className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span className="text-xs font-black tracking-tighter sm:text-sm">GG</span>
      </div>
    </div>
  );
}

type ProductCardProps = {
  product: AnyProduct;
  /** Optional control pinned to the image corner, e.g. "Remove from wishlist". */
  cornerAction?: ReactNode;
};

/**
 * Product tile used on every listing. One markup for all screen sizes: the
 * whole card links to the product, and the cart buttons sit above that link.
 */
export default function ProductCard({ product, cornerAction }: ProductCardProps) {
  const [hovered, setHovered] = useState(false);
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);

  // Normalize sizes so we can still render if backend omits them
  const normalizedSizes = useMemo(() => {
    if (Array.isArray(product?.sizes) && product.sizes.length > 0) {
      return product.sizes;
    }
    const extendedProduct = product as ProductWithVariations;
    return [
      {
        price: product.price ?? (product as { mrp?: number }).mrp ?? 0,
        stock: product.stock ?? 0,
        label: extendedProduct.sizeLabel ?? "Default",
        images: extendedProduct.images ?? [],
      },
    ];
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

  const numericPrices = normalizedSizes
    .map((s) => Number(s?.price))
    .filter((p: number) => Number.isFinite(p));
  const totalStock = normalizedSizes.reduce((sum: number, size) => sum + (size?.stock || 0), 0);
  const inStock = totalStock > 0;

  const firstPrice = numericPrices[0] ?? null;
  const { effectiveMrp, hasDiscount, percent: discountPercent } = getDiscount(
    firstPrice,
    product.mrp
  );
  const sizeCount = Array.isArray(product.sizes) ? product.sizes.length : 0;

  const productUrl = `/product/${product?.slug ?? ""}`;
  const image = hovered && allImages[1] ? allImages[1] : allImages[0];

  const handleAdd = (mode: "cart" | "buy") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const firstSize = normalizedSizes[0];
    if (!firstSize || !inStock) {
      toast("This plant is out of stock.", "error");
      return;
    }
    addItem(buildCartLine(product, firstSize, 1));
    if (mode === "cart") toast(`${product.name} added to cart`);
    else router.push("/checkout");
  };

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-sm transition-shadow duration-300 ease-out hover:shadow-[0_18px_40px_rgba(15,23,42,0.14)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative aspect-square overflow-hidden bg-gray-50">
        {image ? (
          <OptimizedImage
            src={image}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gray-200 text-xs text-gray-400">
            No image
          </div>
        )}

        <div className="absolute top-2 left-2 z-[2] flex flex-col items-start gap-1">
          {!inStock ? (
            <span className="rounded-full bg-red-500 px-2 py-1 text-[10px] font-medium text-white shadow-sm sm:text-xs">
              Sold out
            </span>
          ) : discountPercent > 0 ? (
            <span className="rounded-md bg-red-600 px-2 py-1 text-[10px] font-bold text-white shadow-sm sm:text-xs">
              {discountPercent}% off
            </span>
          ) : null}
        </div>
        {cornerAction ? <div className="absolute top-2 right-2 z-20">{cornerAction}</div> : null}
        {isGrowmanBrand(product) ? <GrowmanGuaranteeBadge /> : null}
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {product.category?.name ? (
          <p className="mb-1 truncate text-[10px] font-bold tracking-[0.16em] text-emerald-700 uppercase sm:text-[11px]">
            {product.category.name}
          </p>
        ) : null}

        {/* h3: cards always sit under a section's h2 ("Featured plants",
            "Indoor plants" and so on), so this keeps the document outline
            correct on every listing page. */}
        <h3 className="line-clamp-2 min-h-10 text-sm leading-snug font-bold text-slate-900 transition-colors group-hover:text-emerald-800 sm:text-[15px]">
          <Link
            href={productUrl}
            className="after:absolute after:inset-0 after:z-10 focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>

        {firstPrice !== null && firstPrice > 0 ? (
          <div className="mt-1.5 mb-3">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-base font-bold text-gray-900 sm:text-lg">
                {formatPrice(firstPrice)}
              </span>
              {hasDiscount && effectiveMrp !== null ? (
                <span className="text-xs text-gray-500 line-through sm:text-sm">
                  {formatPrice(effectiveMrp)}
                </span>
              ) : null}
            </div>
            {sizeCount > 1 ? (
              <p className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">{sizeCount} sizes</p>
            ) : null}
          </div>
        ) : (
          <div className="mb-3" />
        )}

        <div className="relative z-20 mt-auto flex gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={handleAdd("cart")}
            disabled={!inStock}
            aria-label={`Add ${product.name} to cart`}
            className="flex flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-lg border-2 border-emerald-700 bg-white py-2 text-xs font-semibold text-emerald-700 transition-all hover:bg-emerald-50 active:scale-95 active:bg-emerald-100 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-gray-200 disabled:text-gray-400 sm:text-[13px]"
          >
            <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
            <span className="sm:hidden">Add</span>
            <span className="hidden sm:inline">Add to cart</span>
          </button>
          <button
            type="button"
            onClick={handleAdd("buy")}
            disabled={!inStock}
            className="flex flex-1 touch-manipulation items-center justify-center rounded-lg bg-emerald-700 py-2 text-xs font-semibold text-white shadow-md transition-all hover:bg-emerald-800 active:scale-95 active:bg-emerald-900 active:shadow-sm disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none sm:text-[13px]"
          >
            Buy now
          </button>
        </div>
      </div>
    </article>
  );
}
