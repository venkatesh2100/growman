"use client";

import { ChevronRight, CreditCard, Star, Store, Truck } from "lucide-react";
import Link from "next/link";
import ImageGallery from "./ImageGallery";
import ProductTabs from "./ProductTabs";
import AddToCart from "./AddCart";
import SizeSelector from "./sizeSelector";
import RelatedProducts from "./RealatedProducts";
import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "../../../lib/api";
import type { Product } from "../../../lib/types";
import { ProductCareTips } from "../../../lib/careTips";
import { formatPrice } from "../../../lib/format";
import { buildFilterHref, tagLabel } from "../../../lib/shopFilters";
import { business } from "../../../lib/seo/site";

const LOW_STOCK_THRESHOLD = 5;

export default function ProductPageClient({
  product,
  searchParams,
  productSlug
}: {
  product: Product;
  searchParams: { size?: string };
  productSlug: string;
}) {
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(true);
  const selectedSizeId = searchParams?.size
    ? parseInt(searchParams.size)
    : product.sizes[0]?.id;

  const selectedSize =
    product.sizes.find((size) => size.id === selectedSizeId) ||
    product.sizes[0] ||
    null;

  const galleryImages = useMemo(() => {
    const sizeImages = selectedSize?.images?.filter(Boolean) ?? [];
    if (sizeImages.length > 0) return sizeImages;
    if (product.imageUrl) return [product.imageUrl];
    return [];
  }, [selectedSize?.images, product.imageUrl]);

  // Null when the product has no reviews, so the UI never shows a rating the
  // product has not actually earned.
  const reviews = product.reviews ?? [];
  const avgRating =
    reviews.length > 0
      ? reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length
      : null;

  const discountPercent =
    product.mrp && selectedSize && product.mrp > selectedSize.price
      ? Math.round((1 - selectedSize.price / product.mrp) * 100)
      : 0;

  const stock = selectedSize?.stock ?? 0;
  const productTags = product.tags ?? [];
  const attributes = product.attributes ?? [];

  useEffect(() => {
    async function fetchRelatedProducts() {
      try {
        setLoadingRelated(true);
        const response = await apiFetch(`/products/${productSlug}/related`);
        if (response.ok) {
          const data = await response.json() as Product[] | { products: Product[] };
          setRelatedProducts(Array.isArray(data) ? data : data.products || []);
        } else {
          console.error("Failed to fetch related products:", response.status);
          setRelatedProducts([]);
        }
      } catch (error) {
        console.error("Error fetching related products:", error);
        setRelatedProducts([]);
      } finally {
        setLoadingRelated(false);
      }
    }

    if (productSlug) {
      fetchRelatedProducts();
    }
  }, [productSlug]);

  return (
    <main className="mx-auto max-w-7xl px-4 pt-5 pb-16 sm:px-6 sm:pt-8 lg:px-8">
      {/* Breadcrumbs — the trail here must stay in step with the
          BreadcrumbList JSON-LD emitted by the server page. */}
      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500 sm:text-sm">
          <li>
            <Link href="/" className="hover:text-green-900">Home</Link>
          </li>
          <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5 text-gray-400" /></li>
          <li>
            <Link href="/categories" className="hover:text-green-900">Plants</Link>
          </li>
          <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5 text-gray-400" /></li>
          <li>
            <Link href={`/categories/${product.category.slug}`} className="hover:text-green-900">
              {product.category.name}
            </Link>
          </li>
          {product.subcategory && (
            <>
              <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5 text-gray-400" /></li>
              <li>
                <Link
                  href={`/categories/${product.category.slug}/${product.subcategory.slug}`}
                  className="hover:text-green-900"
                >
                  {product.subcategory.name}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5 text-gray-400" /></li>
          <li aria-current="page" className="max-w-[160px] truncate font-medium text-green-900 sm:max-w-[280px]">
            {product.name}
          </li>
        </ol>
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-12">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <ImageGallery images={galleryImages} alt={product.name} />
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <Link
              href={`/categories/${product.category.slug}`}
              className="font-semibold tracking-wide text-emerald-700 uppercase hover:text-emerald-900"
            >
              {product.category.name}
            </Link>
            {product.subcategory && (
              <>
                <span className="text-gray-300" aria-hidden="true">·</span>
                <Link
                  href={`/categories/${product.category.slug}/${product.subcategory.slug}`}
                  className="font-medium text-gray-600 hover:text-green-900"
                >
                  {product.subcategory.name}
                </Link>
              </>
            )}
          </div>

          <h1 className="font-space text-2xl leading-tight font-semibold tracking-tight text-green-900 sm:text-3xl">
            {product.name}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {avgRating !== null && (
              <span className="inline-flex items-center gap-1.5" aria-label={`Rated ${avgRating.toFixed(1)} out of 5`}>
                <span className="flex" aria-hidden="true">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${i < Math.round(avgRating) ? "fill-amber-400 text-amber-400" : "text-gray-300"}`}
                    />
                  ))}
                </span>
                <span className="font-medium text-green-900">{avgRating.toFixed(1)}</span>
                <span className="text-gray-500">
                  ({reviews.length} {reviews.length === 1 ? "review" : "reviews"})
                </span>
              </span>
            )}
            {product.brand && (
              <span className="text-gray-500">
                Brand:{" "}
                {/* There is no /brand route; link to the shop filtered by
                    brand instead of emitting a 404. */}
                <Link
                  href={`/shop?brand=${product.brand.slug}`}
                  className="font-medium text-green-900 hover:underline"
                >
                  {product.brand.name}
                </Link>
              </span>
            )}
          </div>

          {selectedSize && (
            <div className="mt-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-space text-3xl font-semibold text-green-900">
                  {formatPrice(selectedSize.price)}
                </span>
                {discountPercent > 0 && product.mrp && (
                  <>
                    <span className="text-base text-gray-400 line-through">
                      {formatPrice(product.mrp)}
                    </span>
                    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-900">
                      {discountPercent}% off
                    </span>
                  </>
                )}
              </div>
              {product.taxInfo && (
                <p className="mt-1 text-xs text-gray-500">{product.taxInfo}</p>
              )}
              <p
                className={`mt-2 text-sm font-medium ${
                  stock === 0
                    ? "text-red-700"
                    : stock <= LOW_STOCK_THRESHOLD
                      ? "text-amber-700"
                      : "text-emerald-700"
                }`}
              >
                {stock === 0
                  ? "Out of stock in this size"
                  : stock <= LOW_STOCK_THRESHOLD
                    ? `Only ${stock} left in stock`
                    : "In stock"}
              </p>
            </div>
          )}

          {(product.shortDescription || product.description) && (
            <p className="mt-4 text-[15px] leading-relaxed text-gray-700">
              {product.shortDescription || product.description}
            </p>
          )}

          {selectedSize && product.sizes.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2.5 text-sm font-semibold text-green-900">
                Size: <span className="font-normal text-gray-600">{selectedSize.label}</span>
              </h2>
              <SizeSelector
                sizes={product.sizes}
                selectedSize={selectedSize}
                productSlug={product.slug}
              />
            </div>
          )}

          {selectedSize && (
            <div className="mt-6">
              <AddToCart product={product} selectedSize={selectedSize} />
            </div>
          )}

          <ul className="mt-6 divide-y divide-emerald-50 rounded-2xl border border-emerald-100 bg-white text-sm">
            <li className="flex items-start gap-3 px-4 py-3">
              <Truck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <p>
                <span className="font-medium text-green-900">Delivery across India.</span>{" "}
                <span className="text-gray-600">The fee for your address is shown at checkout.</span>
              </p>
            </li>
            <li className="flex items-start gap-3 px-4 py-3">
              <Store className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <p>
                <span className="font-medium text-green-900">Pick up in {business.address.locality}.</span>{" "}
                <span className="text-gray-600">Reserve from your cart and collect at the nursery.</span>
              </p>
            </li>
            <li className="flex items-start gap-3 px-4 py-3">
              <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <p>
                <span className="font-medium text-green-900">Secure payment.</span>{" "}
                <span className="text-gray-600">UPI, cards, netbanking and wallets through Razorpay.</span>
              </p>
            </li>
          </ul>

          <ProductCareTips category={product.category} tags={productTags} />

          {attributes.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2.5 text-sm font-semibold text-green-900">Details</h2>
              <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {attributes.map((attr, idx) => (
                  <div key={idx} className="flex gap-3 border-b border-emerald-50 py-2 text-sm">
                    <dt className="w-2/5 shrink-0 text-gray-500">{attr.name}</dt>
                    <dd className="text-green-900">{attr.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {productTags.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {productTags.map((tag) => (
                <Link
                  key={tag}
                  href={buildFilterHref({ type: "tag", value: tag })}
                  className="rounded-full border border-emerald-100 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-emerald-200 hover:text-green-900"
                >
                  {tagLabel(tag)}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <ProductTabs
        fullDescription={product.fullDescription || product.description || ""}
        specifications={product.specifications}
        reviews={reviews}
      />

      {loadingRelated ? (
        <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-white" />
          ))}
        </div>
      ) : (
        <RelatedProducts products={relatedProducts} />
      )}
    </main>
  );
}
