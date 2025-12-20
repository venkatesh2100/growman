'use client';

import { useEffect, useState } from "react";
import ProductCard from "../../components/ProductCard";
import SubcategoryCard from "../../components/subCategoryCard";
import PlantsLoading from "../../components/loading";
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

interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
  description?: string;
  slug: string;
}

export default function CategoryPage({
  params,
}: {
  params: Promise<{ categorySlug: string }>;
}) {
  const [resolvedParams, setResolvedParams] = useState<{ categorySlug: string } | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
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
        setProducts(productsData.products || productsData);
      } catch (err: any) {
        console.error("Error fetching category page data:", err);
        setError(err.message || "Failed to load category data");
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

  if (!category) {
    return (
      <div className="flex justify-center items-center min-h-screen text-red-500">
        Category not found
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
    <div className="max-w-7xl mx-auto mt-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-green-800 mb-2">{category.name}</h1>
        <p className="text-gray-600">
          Explore our collection of {category.name} plants
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-4">
          {/* Subcategories */}
          {subcategories.length > 0 && (
            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-green-800 mb-6">Browse Subcategories</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
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
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-2">
              <h2 className="text-2xl font-semibold text-green-800">
                {category.name} Plants
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
                  No plants found
                </h3>
                <p className="text-gray-600">
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