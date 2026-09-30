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
    <section className="py-12 sm:py-16" aria-labelledby="featured-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2
              id="featured-heading"
              className="font-space text-xl font-semibold tracking-tight text-green-900 sm:text-2xl"
            >
              Featured plants
            </h2>
            <p className="mt-1 text-sm text-gray-600 sm:text-base">
              A selection from the current collection
            </p>
          </div>
          <Link
            href="/shop"
            className="shrink-0 text-sm font-semibold text-emerald-700 hover:text-emerald-900"
          >
            Shop all plants →
          </Link>
        </div>

        {featuredProducts.length > 0 ? (
          <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:gap-4 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8">
            {featuredProducts.map((product: Product) => (
              <div
                key={product.id}
                className="w-[46%] shrink-0 snap-start sm:w-[31%] md:w-[240px] lg:w-[268px]"
              >
                <ProductCard product={product} />
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-emerald-100 bg-white py-8 text-center text-sm text-gray-600">
            There are no featured plants right now.{" "}
            <Link href="/shop" className="font-medium text-emerald-700 hover:text-emerald-900">
              Browse the full catalog
            </Link>
            .
          </p>
        )}
      </div>
    </section>
  );
}
