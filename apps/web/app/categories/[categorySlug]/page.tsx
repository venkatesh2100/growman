'use client';

import { useEffect, useState } from "react";
import PlantsLoading from "../../../components/loading";
import ProductCard from "../../../components/productspage/ProductCard";
import SubcategoryCard from "../../../components/productspage/SubcategoryCard";
import { apiFetch } from "../../../lib/api";
interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  subcategories?: Subcategory[];
}

interface Subcategory {
  id: string;
  name: string;
  slug: string;
  _count?: {
    products: number;
  };
  category: {
    slug: string;
  };
}

// Simplified Product interface for category pages
interface CategoryProduct {
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

export default function CategoryPage({
  params,
}: {
  params: Promise<{ categorySlug: string }>;
}) {
  const [resolvedParams, setResolvedParams] = useState<{ categorySlug: string } | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [products, setProducts] = useState<CategoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Resolve the params promise
    async function resolveParams() {
      const resolvedParamsValue = await params;
      setResolvedParams(resolvedParamsValue);
    }

    resolveParams();
  }, [params]);

  useEffect(() => {
    async function fetchData() {
      if (!resolvedParams) return;

      setLoading(true);
      setError(null);

      try {
        // Fetch category data (which includes subcategories)
        const categoryRes = await apiFetch(`/categories/${resolvedParams.categorySlug}`);
        if (!categoryRes.ok) {
          throw new Error(`Category not found (${categoryRes.status})`);
        }
        const categoryData = await categoryRes.json();
        const categoryInfo = categoryData.category || categoryData;

        setCategory(categoryInfo);
        setSubcategories(categoryInfo.subcategories || []);

        // Fetch products for this category
        const productsRes = await apiFetch(`/categories/${resolvedParams.categorySlug}/products`);
        if (!productsRes.ok) {
          throw new Error(`Failed to load products (${productsRes.status})`);
        }
        const productsData = await productsRes.json();
        // Handle paginated response
        if (productsData.data && Array.isArray(productsData.data)) {
          setProducts(productsData.data);
        } else if (Array.isArray(productsData)) {
          setProducts(productsData);
        } else if (productsData.products && Array.isArray(productsData.products)) {
          setProducts(productsData.products);
        } else {
          setProducts([]);
        }
      } catch (err: unknown) {
        console.error("Error fetching category page data:", err);
        setError(err instanceof Error ? err.message : "Failed to load category data");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [resolvedParams]);
  // console.log("Category:", category);


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

  if (!category) {
    return (
      <div className="flex justify-center items-center min-h-screen text-red-500 px-4">
        <p className="text-sm sm:text-base">Category not found</p>
      </div>
    );
  }
  // Format subcategories for the SubcategoryCard component
  const formattedSubcategories = subcategories.map(subcategory => ({
    ...subcategory,
    products: subcategory._count?.products || 0,
    category: {
      slug: category.slug
    }
  }));

  return (
    <div className="max-w-7xl mx-auto mt-4 sm:mt-6 md:mt-8 px-3 sm:px-4">
      {/* Header */}
      <div className="mb-4 sm:mb-6 md:mb-8">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-green-800 mb-1 sm:mb-2">{category.name}</h1>
        <p className="text-sm sm:text-base text-gray-600">
          Explore our collection of {category.name} plants
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8">
        <div className="lg:col-span-4">
          {/* Subcategories */}
          {subcategories.length > 0 && (
            <section className="mb-8 sm:mb-10 md:mb-12">
              <h2 className="text-xl sm:text-2xl font-semibold text-green-800 mb-4 sm:mb-6">Browse Subcategories</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
                {formattedSubcategories.map((subcategory) => (
                  <SubcategoryCard
                    key={subcategory.id}
                    subcategory={subcategory}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Products */}
          <section>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 sm:mb-6 gap-2">
              <h2 className="text-xl sm:text-2xl font-semibold text-green-800">
                {category.name} Plants
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
                  No plants found
                </h3>
                <p className="text-sm sm:text-base text-gray-600">
                  {subcategories.length > 0
                    ? "Browse our subcategories to find plants you'll love"
                    : "Check back later for new additions to our collection"
                  }
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}