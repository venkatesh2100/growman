"use client";

import { Star, Package, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import ImageGallery from "./ImageGallery";
import ProductTabs from "./ProductTabs";
import AddToCart from "./AddCart";
import SizeSelector from "./sizeSelector";
import RelatedProducts from "./RealatedProducts";
import { useState, useEffect } from "react";
import { apiFetch } from "../../../lib/api";
import type { Product } from "../../../lib/types";

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

  const avgRating =
    product.reviews.length > 0
      ? product.reviews.reduce((acc, review) => acc + review.rating, 0) /
        product.reviews.length
      : 0;

  // Fetch related products from API
  useEffect(() => {
    async function fetchRelatedProducts() {
      try {
        setLoadingRelated(true);
        const response = await apiFetch(`/products/${productSlug}/related`);
        if (response.ok) {
          const data = await response.json() as Product[] | { products: Product[] };
          const products = Array.isArray(data) ? data : data.products || [];
          // console.log("Setting related products:", products);
          // console.log("First product check:", products[0] ? {
          //   id: products[0].id,
          //   name: products[0].name,
          //   hasSizes: !!products[0].sizes,
          //   sizesType: typeof products[0].sizes,
          //   sizesIsArray: Array.isArray(products[0].sizes),
          //   sizesLength: products[0].sizes?.length,
          //   sizes: products[0].sizes
          // } : "No products");
          setRelatedProducts(products);
          // console.log("Related products in client", relatedProducts);
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.error("Failed to fetch related products:", response.status, errorData);
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
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8 bg-gradient-to-r from-green-50 to-emerald-50">
      {/* Breadcrumbs - Mobile optimized */}
      <div className="text-xs sm:text-sm text-gray-500 mb-4 sm:mb-6 flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-2 sm:gap-y-2">
        <Link href="/" className="hover:text-green-600 transition-colors">Home</Link>
        <span className="text-gray-400">/</span>

        <Link
          href={`/categories/${product.category.slug}`}
          className="hover:text-green-600 transition-colors"
        >
          {product.category.name}
        </Link>
        <span className="text-gray-400">/</span>

        {product.subcategory && (
          <>
            <Link
              href={`/categories/${product.category.slug}/${product.subcategory.slug}`}
              className="hover:text-green-600 transition-colors"
            >
              {product.subcategory.name}
            </Link>
            <span className="text-gray-400">/</span>
          </>
        )}

        <span className="text-gray-900 font-medium truncate max-w-[120px] sm:max-w-[250px]">
          {product.name}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
        {/* Image Gallery - Mobile optimized */}
        <div className="md:p-4 md:rounded-xl md:border md:border-gray-100">
          <div className="md:p-4 md:rounded-xl md:shadow md:border md:border-green-100 product-image-gallery">
            <ImageGallery images={selectedSize?.images} />
          </div>
        </div>

        {/* Product Details - Mobile optimized */}
        <div className="p-0 sm:p-2">
          <div className="border-b border-gray-200 pb-4 sm:pb-6">
            {/* Title */}
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 sm:mb-3">{product.name}</h1>

            {/* Ratings + Stock - Mobile compact */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-0 mb-3 sm:mb-4">
              <div className="flex">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    size={16}
                    className={
                      i < Math.floor(avgRating)
                        ? "text-yellow-500 fill-yellow-400"
                        : "text-gray-300"
                    }
                  />
                ))}
              </div>

              <span className="text-xs sm:text-sm text-gray-600 ml-1 sm:ml-2">
                {product.reviews.length} reviews
              </span>

              <span className="hidden sm:inline mx-2 text-gray-300">|</span>

              <span
                className={`text-xs sm:text-sm font-medium ${
                  (selectedSize?.stock ?? 0) > 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {(selectedSize?.stock ?? 0) > 0 ? "In Stock" : "Out of Stock"}
              </span>
            </div>

            {/* Brand - Mobile compact */}
            {product.brand && (
              <div className="mb-3 sm:mb-4">
                <span className="text-xs sm:text-sm text-gray-600">Brand: </span>
                <Link
                  href={`/brand/${product.brand.slug}`}
                  className="text-xs sm:text-sm font-medium text-green-700 hover:underline"
                >
                  {product.brand.name}
                </Link>
              </div>
            )}

            {/* Price - Mobile optimized */}
            <div className="mb-4 sm:mb-6">
              <div className="flex flex-wrap items-baseline gap-2 sm:gap-3">
                <span className="text-2xl sm:text-3xl font-bold text-gray-900">
                  ₹{selectedSize?.price.toFixed(0)}
                </span>

                {product.mrp && selectedSize && product.mrp > selectedSize.price && (
                  <>
                    <span className="text-sm sm:text-base text-gray-500 line-through">
                      ₹{product.mrp.toFixed(0)}
                    </span>

                    <span className="text-sm sm:text-base text-green-600 font-medium">
                      {Math.round((1 - selectedSize.price / product.mrp) * 100)}% off
                    </span>
                  </>
                )}
              </div>

              {product.taxInfo && (
                <p className="text-xs sm:text-sm text-gray-500 mt-1">+ {product.taxInfo}</p>
              )}
            </div>

            {/* Description - Mobile compact */}
            <p className="text-sm sm:text-base text-gray-700 mb-4 sm:mb-6 leading-relaxed">
              {product.shortDescription}
            </p>

            {/* Size Selector - Mobile optimized */}
            <div className="mb-4 sm:mb-6">
              <h3 className="font-semibold text-gray-900 mb-2 sm:mb-3 text-base sm:text-lg">
                Available Sizes:
              </h3>

              {selectedSize && (
                <SizeSelector
                  sizes={product.sizes}
                  selectedSize={selectedSize}
                  productSlug={product.slug}
                />
              )}
            </div>

            {/* Attributes - Mobile optimized */}
            {product.attributes.length > 0 && (
              <div className="mb-4 sm:mb-6">
                <h3 className="font-semibold text-gray-900 mb-2 sm:mb-3 text-base sm:text-lg">
                  Key Features:
                </h3>

                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                  {product.attributes.map((attr, idx: number) => (
                    <li key={idx} className="flex items-start">
                      <span className="text-green-600 mr-2 mt-1">•</span>
                      <span className="text-sm sm:text-base text-gray-700">
                        <span className="font-medium">{attr.name}:</span>{" "}
                        {attr.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Add to Cart - Mobile optimized */}
            {selectedSize && (
              <div className="mb-4 sm:mb-0">
                <AddToCart product={product} selectedSize={selectedSize} />
              </div>
            )}
          </div>

          {/* Benefits - Mobile optimized */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 pt-4 sm:pt-6">
            {[
              { icon: Truck, title: "Free Delivery", sub: "Delivery in 2-4 days" },
              { icon: Package, title: "Easy Returns", sub: "10 Day Policy" },
              { icon: ShieldCheck, title: "Warranty", sub: "Genuine Parts" },
            ].map(({ icon: Icon, title, sub }, i) => (
              <div
                key={i}
                className="flex items-center p-2.5 sm:p-3 rounded-lg border border-gray-100"
              >
                <div className="bg-green-50 p-1.5 sm:p-2 rounded-full mr-2 sm:mr-3">
                  <Icon className="text-green-600" size={18} />
                </div>

                <div>
                  <p className="text-xs sm:text-sm font-medium text-gray-900">{title}</p>
                  <p className="text-[10px] sm:text-xs text-gray-500">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* Tabs - Mobile optimized */}
      <div className="mt-6 sm:mt-8">
        <ProductTabs
          fullDescription={product.fullDescription || product.description || ''}
          specifications={product.specifications}
          reviews={product.reviews}
        />
      </div>

      {/* Related Products - Mobile optimized */}
      {loadingRelated ? (
        <div className="mt-6 sm:mt-10">
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 px-2 sm:px-0">
            Related Products
          </h2>
          <p className="text-sm sm:text-base text-gray-500">Loading related products...</p>
        </div>
      ) : (
        <div className="mt-6 sm:mt-10">
          <RelatedProducts products={relatedProducts} />
        </div>
      )}
    </div>
  );
}
