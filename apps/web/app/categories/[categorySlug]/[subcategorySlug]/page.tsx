"use client";
import { useEffect, useState } from "react";
import ProductCard from "../../../components/ProductCard";
import Link from "next/link";
import PlantsLoading from "../../../components/loading";
import { apiFetch } from "../../../../lib/api";
interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
  description?: string;
  slug: string;
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
  const [products, setProducts] = useState<Product[]>([]);
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
          `/categories/${resolvedParams.categorySlug}/${resolvedParams.subcategorySlug}/products`
        );
        if (!productRes.ok) {
          throw new Error("Failed to fetch products");
        }
        const productData = await productRes.json();
        setProducts(productData.products || productData);
      } catch (err: any) {
        console.error("Error fetching products:", err);
        setError(err.message || "Failed to load products");
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
      <div className="flex justify-center items-center min-h-screen text-red-500">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-4">Error</h2>
          <p className="mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors"
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
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="mb-8">
        <div className="flex items-center text-sm text-gray-500 mb-4">
          <Link href="/categories" className="hover:text-emerald-600 transition-colors">
            Categories
          </Link>
          <span className="mx-2">/</span>
          <Link
            href={`/categories/${resolvedParams?.categorySlug}`}
            className="hover:text-emerald-600 transition-colors"
          >
            {categoryName}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-emerald-600 font-medium">{subcategoryName}</span>
        </div>

        <h1 className="text-3xl font-bold text-green-800 mb-2">
          {subcategoryName}
        </h1>
        <p className="text-gray-600">
          Explore our collection of {subcategoryName} plants
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-4">
          {/* Products Section */}
          <section>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-2">
              <h2 className="text-2xl font-semibold text-green-800">
                {subcategoryName} Plants
              </h2>
              <div className="text-sm text-emerald-600">
                Showing {products.length} plants
              </div>
            </div>

            {products.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl p-8 text-center border border-green-100">
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  No plants found in this subcategory
                </h3>
                <p className="text-gray-600">
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