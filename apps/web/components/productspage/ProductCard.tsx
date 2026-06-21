"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { ShoppingCart, Zap, Sun, Droplets, BarChart3, Leaf, TreePine, Flower2, Wind, Gift, Building2, Scissors, CloudSun } from "lucide-react";
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

function GrowmanGuaranteeBadge({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`pointer-events-none absolute z-[1] flex select-none flex-col items-end leading-none text-emerald-950 opacity-[0.18] transition-opacity duration-500 group-hover:opacity-[0.24] ${
        compact ? "bottom-1.5 right-1.5" : "bottom-2.5 right-2.5"
      }`}
      aria-hidden
    >
      <span
        className={`font-medium uppercase tracking-[0.22em] ${
          compact ? "text-[7px]" : "text-[9px] sm:text-[10px]"
        }`}
      >
        Growman
      </span>
      <div
        className={`mt-0.5 flex items-center gap-0.5 pr-0.5 ${
          compact ? "scale-90 origin-bottom-right" : ""
        }`}
      >
        <GrowmanLogo className={compact ? "h-3.5 w-3.5" : "h-4 w-4 sm:h-5 sm:w-5"} />
        <span
          className={`font-black tracking-tighter ${
            compact ? "text-[11px]" : "text-sm sm:text-base"
          }`}
        >
          GG
        </span>
      </div>
    </div>
  );
}

type CareTipIcon =
  | "sun"
  | "water"
  | "easy"
  | "outdoor"
  | "air"
  | "shade"
  | "gift"
  | "office"
  | "bonsai"
  | "leaf";

type CareTip = { icon: CareTipIcon; text: string };

const DEFAULT_CARE_TIPS: CareTip[] = [
  { icon: "sun", text: "Bright indirect light" },
  { icon: "water", text: "Keep soil moist" },
  { icon: "easy", text: "Easy to care" },
];

const CATEGORY_CARE_TIPS: Record<string, CareTip[]> = {
  "indoor-plants": [
    { icon: "sun", text: "Bright indirect light" },
    { icon: "water", text: "Keep soil moist" },
    { icon: "easy", text: "Easy to care" },
  ],
  "outdoor-plants": [
    { icon: "sun", text: "Full sun preferred" },
    { icon: "water", text: "Water regularly" },
    { icon: "outdoor", text: "Outdoor hardy" },
  ],
  avenue: [
    { icon: "sun", text: "Full sunlight" },
    { icon: "outdoor", text: "Avenue planting" },
    { icon: "easy", text: "Low maintenance" },
  ],
  "ornamental-plants": [
    { icon: "sun", text: "Moderate light" },
    { icon: "water", text: "Even moisture" },
    { icon: "easy", text: "Decorative foliage" },
  ],
};

const TAG_CARE_TIPS: Record<string, CareTip> = {
  "low-light": { icon: "shade", text: "Low light tolerant" },
  "air-purify": { icon: "air", text: "Air purifying" },
  "air purify": { icon: "air", text: "Air purifying" },
  bonsai: { icon: "bonsai", text: "Needs pruning" },
  gift: { icon: "gift", text: "Perfect gift plant" },
  office: { icon: "office", text: "Office friendly" },
  "good-luck": { icon: "gift", text: "Good luck plant" },
  "stress-free": { icon: "easy", text: "Stress-free care" },
  indoor: { icon: "sun", text: "Indoor suitable" },
  outdoor: { icon: "outdoor", text: "Best outdoors" },
  medicinal: { icon: "leaf", text: "Medicinal plant" },
};

function normalizeCategoryKey(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

function getCareTips(
  category?: { name?: string; slug?: string },
  tags?: string[]
): CareTip[] {
  const slugKey = normalizeCategoryKey(category?.slug);
  const nameKey = normalizeCategoryKey(category?.name);
  const base =
    CATEGORY_CARE_TIPS[slugKey] ??
    CATEGORY_CARE_TIPS[nameKey] ??
    DEFAULT_CARE_TIPS;

  const tips = [...base];
  const seen = new Set(tips.map((tip) => tip.text));

  for (const tag of tags ?? []) {
    const tagTip =
      TAG_CARE_TIPS[normalizeCategoryKey(tag)] ?? TAG_CARE_TIPS[tag.trim().toLowerCase()];
    if (tagTip && !seen.has(tagTip.text)) {
      tips.push(tagTip);
      seen.add(tagTip.text);
    }
  }

  return tips.slice(0, 3);
}

function CategoryIcon({
  category,
  className,
}: {
  category?: { name?: string; slug?: string };
  className?: string;
}) {
  const key = normalizeCategoryKey(category?.slug) || normalizeCategoryKey(category?.name);

  if (key.includes("indoor")) return <Leaf className={className} strokeWidth={2} />;
  if (key.includes("outdoor")) return <Sun className={className} strokeWidth={2} />;
  if (key.includes("avenue")) return <TreePine className={className} strokeWidth={2} />;
  if (key.includes("ornamental")) return <Flower2 className={className} strokeWidth={2} />;
  return <Leaf className={className} strokeWidth={2} />;
}

function CareTipIcon({ icon, className }: { icon: CareTipIcon; className?: string }) {
  switch (icon) {
    case "sun":
      return <Sun className={className} strokeWidth={2} />;
    case "water":
      return <Droplets className={className} strokeWidth={2} />;
    case "easy":
      return <BarChart3 className={className} strokeWidth={2} />;
    case "outdoor":
      return <TreePine className={className} strokeWidth={2} />;
    case "air":
      return <Wind className={className} strokeWidth={2} />;
    case "shade":
      return <CloudSun className={className} strokeWidth={2} />;
    case "gift":
      return <Gift className={className} strokeWidth={2} />;
    case "office":
      return <Building2 className={className} strokeWidth={2} />;
    case "bonsai":
      return <Scissors className={className} strokeWidth={2} />;
    case "leaf":
      return <Leaf className={className} strokeWidth={2} />;
    default:
      return <Leaf className={className} strokeWidth={2} />;
  }
}

function CategoryBadge({
  category,
  compact = false,
}: {
  category: { name: string; slug?: string };
  compact?: boolean;
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <CategoryIcon
        category={category}
        className={`shrink-0 text-emerald-600 ${compact ? "h-3 w-3" : "h-3.5 w-3.5"}`}
      />
      <span
        className={`font-bold uppercase tracking-[0.16em] text-emerald-700 ${
          compact ? "text-[10px]" : "text-[10px] sm:text-[11px]"
        }`}
      >
        {category.name}
      </span>
    </div>
  );
}

function CareTipsStrip({
  tips,
  productSlug,
  revealOnHover = true,
}: {
  tips: CareTip[];
  productSlug: string;
  revealOnHover?: boolean;
}) {
  if (tips.length === 0) return null;

  const tipsContent = (
    <div className="border-t border-slate-100 pt-2.5">
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {tips.map((tip) => (
          <div
            key={tip.text}
            className="flex min-w-0 flex-col items-center gap-1 text-center sm:flex-row sm:items-start sm:gap-1.5 sm:text-left"
          >
            <CareTipIcon
              icon={tip.icon}
              className="h-3.5 w-3.5 shrink-0 text-emerald-600 sm:h-4 sm:w-4"
            />
            <span className="text-[9px] leading-snug text-slate-600 sm:text-[10px]">
              {tip.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Link
      href={`/product/${productSlug}`}
      className={
        revealOnHover
          ? "grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity,margin] duration-300 ease-out group-hover/card:grid-rows-[1fr] group-hover/card:opacity-100 group-hover/card:mt-2.5 hover:text-emerald-800"
          : "mt-2 block opacity-100"
      }
      onClick={(e) => e.stopPropagation()}
    >
      <div className="overflow-hidden">{tipsContent}</div>
    </Link>
  );
}

function DoothaAskPanel({ productName }: { productName: string }) {
  const openDootha = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("growman:chatbot-prefill", {
        detail: {
          message: `Tell me how to care for ${productName}. What light, watering, and soil does it need?`,
        },
      })
    );
  };

  return (
    <button
      type="button"
      onClick={openDootha}
      className="pointer-events-none absolute right-0 top-[42%] z-50 flex translate-x-2 items-center gap-2 rounded-l-full border border-emerald-200 border-r-0 bg-white py-2 pl-2 pr-3 opacity-0 shadow-[0_8px_24px_rgba(16,185,129,0.18)] transition-all duration-300 ease-out group-hover/card:pointer-events-auto group-hover/card:translate-x-full group-hover/card:opacity-100 hover:bg-emerald-50"
      aria-label={`Ask Dootha AI about ${productName}`}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50">
        <Image src="/dootha.svg" alt="" width={22} height={22} />
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-600">
          Ask Dootha
        </span>
        <span className="text-xs font-semibold text-emerald-900">AI plant care</span>
      </span>
    </button>
  );
}

export default function ProductCard({ product }: { product: AnyProduct }) {
  const [hovered, setHovered] = useState(false);
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const productTags = Array.isArray(product.tags) ? product.tags : [];
  const careTips = useMemo(
    () => getCareTips(product.category, productTags),
    [product.category, productTags]
  );

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

  const isRemoteImage = (src: string) => src.startsWith("http");
  const showGrowmanGuarantee = isGrowmanBrand(product);

  const productUrl = `/product/${product?.slug ?? ""}`;

  return (
    <div className="relative h-full w-full md:overflow-visible">
      {/* Mobile: Amazon-like minimal design */}
      <div className="flex h-full flex-col bg-white touch-manipulation md:hidden">
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
                unoptimized={isRemoteImage(allImages[0])}
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
            {showGrowmanGuarantee && <GrowmanGuaranteeBadge compact />}
          </div>
        </Link>

        <div className="p-2.5 flex flex-col">
          <Link
            href={`/product/${product?.slug ?? ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-manipulation mb-1.5"
          >
            {product.category?.name && (
              <CategoryBadge category={product.category} compact />
            )}

            <h2 className="min-h-10 text-sm font-semibold leading-snug text-slate-900">
              {product.name}
            </h2>
          </Link>

          <CareTipsStrip
            tips={careTips}
            productSlug={product.slug}
            revealOnHover={false}
          />

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

      {/* Desktop: hover lift + care tips + Dootha panel */}
      <div className="relative hidden h-full md:block">
        <div className="group/card relative flex h-full flex-col overflow-visible rounded-xl border border-gray-100 bg-white shadow-sm transition-all duration-300 ease-out hover:z-40 hover:scale-[1.04] hover:shadow-[0_20px_40px_rgba(15,23,42,0.12)]">
          {/* <DoothaAskPanel productName={product.name} /> */}

          <Link
            href={productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="relative block aspect-square overflow-hidden bg-gray-50 touch-manipulation"
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
                className="object-cover transition-transform duration-300 group-hover/card:scale-105 will-change-transform"
                loading="lazy"
                unoptimized={isRemoteImage(
                  hovered && allImages[1] ? allImages[1] : allImages[0]
                )}
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
            {showGrowmanGuarantee && <GrowmanGuaranteeBadge />}
          </div>
          </Link>

          <div className="flex flex-1 flex-col p-3 sm:p-4">
            {product.category?.name && <CategoryBadge category={product.category} />}

            <Link
              href={productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="touch-manipulation"
            >
              <h2 className="mb-0 min-h-10 line-clamp-2 text-sm font-bold leading-snug text-slate-900 transition-colors group-hover/card:text-emerald-800 sm:min-h-12 sm:text-[15px]">
                {product.name}
              </h2>
            </Link>

            <CareTipsStrip tips={careTips} productSlug={product.slug} />

          {/* Pricing Display */}
          {firstPrice !== null && firstPrice !== undefined && firstPrice > 0 ? (
            <div className="mb-2 mt-2 sm:mb-3 sm:mt-3">
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
    </div>
  );
}
