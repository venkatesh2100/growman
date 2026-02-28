"use client";

import { useEffect, useState } from "react";
// import ProductCard from '@repo/ui/productCard';
import ProductCard from "../productspage/ProductCard";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { Product } from "../../lib/types";

export default function PlantSection() {
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function fetchFeatured() {
      try {
        const res = await apiFetch("/products/featured");
        if (!res.ok) {
          throw new Error("Failed to fetch featured products");
        }
        const data = await res.json();

        // Handle different response formats
        let products = [];
        if (Array.isArray(data)) {
          products = data;
        } else if (data.data && Array.isArray(data.data)) {
          products = data.data;
        } else if (data.products && Array.isArray(data.products)) {
          products = data.products;
        } else if (data.featured && Array.isArray(data.featured)) {
          products = data.featured;
        }

        setFeaturedProducts(products);
      } catch (err) {
        console.error("Failed to fetch featured products:", err);
        setFeaturedProducts([]); // Set empty array on error
      } finally {
        setLoading(false);
      }
    }

    fetchFeatured();
  }, []);

  const skeletons = Array(4).fill(0);

  return (
    <section className="py-8 sm:py-12 md:py-16 bg-emerald-50">
      <div className="container mx-auto px-3 sm:px-4">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 sm:mb-8 md:mb-12">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-green-900 mb-1 sm:mb-2">
              Featured Plants
            </h2>
            <p className="text-sm sm:text-base text-green-700">
              Some randomly selected green beauties
            </p>
          </div>
          <button
            onClick={() => router.push("/categories")}
            className="mt-4 md:mt-0 px-5 sm:px-6 py-2 border-2 border-emerald-600 text-emerald-600 rounded-full font-medium hover:bg-emerald-600 hover:text-white active:bg-emerald-700 transition duration-300 text-sm sm:text-base touch-manipulation"
          >
            View All
          </button>
        </div>

        {/* Cards or Skeletons */}
        <div
          className="
      flex flex-nowrap gap-4 overflow-x-auto pb-4
      snap-x snap-mandatory scroll-smooth
      scrollbar-hide
      -mx-3 sm:-mx-4 px-3 sm:px-4
  "
          style={{ scrollBehavior: 'smooth' }}
        >
          {loading
            ? skeletons.map((_, idx) => (
                <div
                  key={idx}
                  className="
                     shrink-0
                     w-[75%] sm:w-[45%] md:w-[280px] lg:w-[300px]
          snap-start

                   bg-white rounded-xl border border-green-100 p-4 shadow animate-pulse"
                >
                  <div className="aspect-square bg-gray-200 rounded mb-4"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-gray-100 rounded w-1/2 mb-4"></div>
                  <div className="h-8 bg-emerald-100 rounded w-full"></div>
                </div>
              ))
            : Array.isArray(featuredProducts) && featuredProducts.length > 0
              ? featuredProducts.map((product: Product) => (
                  <div
                    key={product.id}
                    className="
                 shrink-0
                 w-[75%] sm:w-[45%] md:w-[280px] lg:w-[300px]
               snap-start"
                  >
                    <ProductCard key={product.id} product={product} />
                  </div>
                ))
              : !loading && (
                  <div className="col-span-full text-center py-8">
                    <p className="text-gray-600">
                      No featured products available at the moment.
                    </p>
                  </div>
                )}
        </div>
      </div>
    </section>
  );
}
