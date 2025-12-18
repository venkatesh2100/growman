
import { FilterSidebar } from '../../components/productspage/FilterSideBar';
import CategoryCard from '../../components/productspage/categoryCard';
import ProductCard from '@repo/ui/productCard';
import { apiFetch } from '../../lib/api';
import type { Brand, Category, Product } from '../../lib/types';

export default async function CategoriesPage(
  {
    searchParams,
  }: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  }) {
  const resolvedSearchParams = await searchParams;

  const [categoriesRes, brandsRes, productsRes, tagsRes] = await Promise.all([
    apiFetch('/categories', { cache: "no-store" }),
    apiFetch('/brands', { cache: "no-store" }),
    apiFetch('/products', { cache: "no-store" }),
    apiFetch('/tags', { cache: "no-store" }),
  ]);

  const categories: Category[] = categoriesRes.ok ? await categoriesRes.json() : [];
  const brands: Brand[] = brandsRes.ok ? await brandsRes.json() : [];
  const allProducts: Product[] = productsRes.ok ? await productsRes.json() : [];
  const tagsPayload: string[] = tagsRes.ok ? await tagsRes.json() : [];

  // Get price range
  const priceRange = allProducts.length
    ? {
        min: Math.min(...allProducts.map(p => p.price)),
        max: Math.max(...allProducts.map(p => p.price)),
      }
    : { min: 0, max: 0 };

  const uniqueTags = tagsPayload.length
    ? Array.from(new Set(tagsPayload))
    : Array.from(new Set(allProducts.flatMap(p => p.tags || [])));

  const categoryFilters = categories.map(c => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    count: allProducts.filter(p => p.categoryId === c.id).length,
  }));

  const brandFilters = brands.map(b => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
  }));

  return (
    <div className="max-w-7xl pt-10 mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-green-800 mb-2">Plant Categories</h1>
        <p className="text-gray-600">
          Explore our wide variety of plant categories and find the perfect plants for your home
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <FilterSidebar
            filterOptions={{
              categories: categoryFilters,
              brands: brandFilters,
              tags: uniqueTags,
              priceRange,
            }}
            searchParams={resolvedSearchParams}
          />
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3">
          {/* Categories Grid */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-green-800 mb-6">Browse Categories</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {categories.map(category => (
                <CategoryCard
                  key={category.id}
                  category={{
                    ...category,
                    products: categoryFilters.find(c => c.id === category.id)?.count || 0
                  }}
                />
              ))}
            </div>
          </section>

          {/* All Plants Section */}
          <section>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-semibold text-green-800">All Plants</h2>
              <div className="text-sm text-emerald-600">
                Showing {allProducts.length} plants
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {allProducts.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
