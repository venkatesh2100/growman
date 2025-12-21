"use client";
import { useEffect, useState } from "react";
import ProductCard from "../../../../components/productspage/ProductCard";
import Link from "next/link";
import PlantsLoading from "../../../../components/loading";
import { apiFetch } from "../../../../lib/api";
// Simplified Product interface for subcategory pages
interface SubcategoryProduct {
  id: string | number;
  name: string;
  price: number;
  image?: string;
  imageUrl?: string;
  description?: string;
  slug: string;
  mrp?: number;
  stock?: number;
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
}

export default function SubcategoryPage({
  params,
}: {
  params: Promise<{ categorySlug: string; subcategorySlug: string }>;
}) {
  const [resolvedParams, setResolvedParams] = useState<{
    categorySlug: string;
    subcategorySlug: string;
  } | null>(null);
  const [products, setProducts] = useState<SubcategoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Resolve the params promise
    // Note: searchParams is not used in this component, so we don't need to resolve or store it
    async function resolveParams() {
      const resolved = await params;
      setResolvedParams(resolved);
    }

    resolveParams();
  }, [params]);

  useEffect(() => {
    async function fetchData() {
      if (!resolvedParams) return;

      setLoading(true);
      setError(null);

      try {
        // Fetch products for this subcategory
        const productRes = await apiFetch(
          `/categories/${resolvedParams.categorySlug}/subcategories/${resolvedParams.subcategorySlug}/products`
        );
        if (!productRes.ok) {
          throw new Error("Failed to fetch products");
        }
        const productData = await productRes.json();
        // Handle paginated response
        if (productData.data && Array.isArray(productData.data)) {
          setProducts(productData.data);
        } else if (Array.isArray(productData)) {
          setProducts(productData);
        } else if (productData.products && Array.isArray(productData.products)) {
          setProducts(productData.products);
        } else {
          setProducts([]);
        }
      } catch (err: unknown) {
        console.error("Error fetching products:", err);
        setError(err instanceof Error ? err.message : "Failed to load products");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [resolvedParams]);


  if (loading) {
    return(
      <PlantsLoading/>
    )
  }

  if (error) {
    return (
      <div className="flex justify-center items-center min-h-screen text-red-500 px-4">
        <div className="text-center max-w-md w-full">
          <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4">Error</h2>
          <p className="mb-4 text-sm sm:text-base">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-green-600 text-white px-5 sm:px-6 py-2.5 sm:py-2 rounded-lg hover:bg-green-700 active:bg-green-800 transition-colors text-sm sm:text-base touch-manipulation"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Format slug to display name (convert "outdoor-plants" to "Outdoor Plants")
  const formatSlugToName = (slug: string) => {
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const categoryName = resolvedParams ? formatSlugToName(resolvedParams.categorySlug) : '';
  const subcategoryName = resolvedParams ? formatSlugToName(resolvedParams.subcategorySlug) : '';

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8">
      {/* Breadcrumb */}
      <div className="mb-4 sm:mb-6 md:mb-8">
        <div className="flex items-center text-xs sm:text-sm text-gray-500 mb-3 sm:mb-4 flex-wrap gap-1">
          <Link href="/categories" className="hover:text-emerald-600 transition-colors active:text-emerald-700">
            Categories
          </Link>
          <span className="mx-1 sm:mx-2">/</span>
          <Link
            href={`/categories/${resolvedParams?.categorySlug}`}
            className="hover:text-emerald-600 transition-colors active:text-emerald-700 truncate max-w-[120px] sm:max-w-none"
          >
            {categoryName}
          </Link>
          <span className="mx-1 sm:mx-2">/</span>
          <span className="text-emerald-600 font-medium truncate">{subcategoryName}</span>
        </div>

        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-green-800 mb-1 sm:mb-2">
          {subcategoryName}
        </h1>
        <p className="text-sm sm:text-base text-gray-600">
          Explore our collection of {subcategoryName} plants
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8">
        {/* Main Content */}
        <div className="lg:col-span-4">
          {/* Products Section */}
          <section>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 sm:mb-6 gap-2">
              <h2 className="text-xl sm:text-2xl font-semibold text-green-800">
                {subcategoryName} Plants
              </h2>
              <div className="text-xs sm:text-sm text-emerald-600">
                Showing {products.length} plants
              </div>
            </div>

            {products.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5 md:gap-6">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl p-6 sm:p-8 text-center border border-green-100">
                <h3 className="text-base sm:text-lg font-medium text-gray-800 mb-2">
                  No plants found in this subcategory
                </h3>
                <p className="text-sm sm:text-base text-gray-600">
                  Check back later for new additions to our {subcategoryName} collection
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}