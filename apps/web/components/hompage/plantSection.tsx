import Link from "next/link";
import ProductCard from "../productspage/ProductCard";
import { apiFetch } from "../../lib/api";
import { Product } from "../../lib/types";

/**
 * Featured products, fetched on the server so the product names, prices and
 * links are present in the HTML a crawler receives. Previously this ran in a
 * `useEffect`, which left the homepage with no product content at all for
 * search engines.
 */
async function getFeaturedProducts(): Promise<Product[]> {
  try {
    const res = await apiFetch("/products/featured", {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as unknown;
    if (Array.isArray(data)) return data as Product[];
    if (data && typeof data === "object") {
      const payload = data as {
        data?: Product[];
        products?: Product[];
        featured?: Product[];
      };
      return payload.data ?? payload.products ?? payload.featured ?? [];
    }
    return [];
  } catch (error) {
    console.warn("Failed to fetch featured products:", error);
    return [];
  }
}

export default async function PlantSection() {
  const featuredProducts = await getFeaturedProducts();

  return (
    <section className="py-8 sm:py-12 md:py-16 bg-emerald-50">
      <div className="container mx-auto px-3 sm:px-4">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 sm:mb-8 md:mb-12">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-green-900 mb-1 sm:mb-2">
              Featured Plants
            </h2>
            <p className="text-sm sm:text-base text-green-700">
              A selection from our current collection
            </p>
          </div>
          <Link
            href="/categories"
            className="mt-4 md:mt-0 px-5 sm:px-6 py-2 border-2 border-emerald-700 text-emerald-700 rounded-full font-medium hover:bg-emerald-700 hover:text-white active:bg-emerald-700 transition duration-300 text-sm sm:text-base touch-manipulation"
          >
            View all categories
          </Link>
        </div>

        {featuredProducts.length > 0 ? (
          <div
            className="
      flex flex-nowrap gap-4 overflow-x-auto pb-4
      snap-x snap-mandatory scroll-smooth
      scrollbar-hide
      -mx-3 sm:-mx-4 px-3 sm:px-4 scroll-px-3 sm:scroll-px-4
  "
          >
            {featuredProducts.map((product: Product) => (
              <div
                key={product.id}
                className="
                 shrink-0
                 w-[75%] sm:w-[45%] md:w-[280px] lg:w-[300px]
               snap-start"
              >
                <ProductCard product={product} />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-600">
              No featured plants available at the moment.{" "}
              <Link href="/shop" className="text-emerald-700 underline">
                Browse the full collection
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
