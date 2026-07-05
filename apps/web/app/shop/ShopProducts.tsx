import Link from "next/link";
import ProductsDisplay from "../../components/productspage/ProductsDisplay";
import { fetchProductsData, filterProducts } from "../../lib/data";
import {
  getActiveFilterLabel,
  getShopTitle,
  hasShopFilter,
} from "../../lib/shopFilters";

export default async function ShopProducts({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { productsBySize, categories, tags } = await fetchProductsData();
  const catalog = { tags, categories };
  const filteredProducts = filterProducts(productsBySize, resolvedSearchParams);
  const activeFilter = hasShopFilter(resolvedSearchParams);
  const filterLabel = getActiveFilterLabel(resolvedSearchParams, catalog);

  return (
    <div id="shop-products">
      {activeFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg  border-emerald-100 bg-emerald-50 px-4 py-3">
          <span className="text-sm text-emerald-900">
            Filter: <strong>{filterLabel}</strong>
            {" · "}
            {filteredProducts.length}{" "}
            {filteredProducts.length === 1 ? "plant" : "plants"}
          </span>
          <Link
            href="/shop"
            className="ml-auto text-sm font-medium text-emerald-700 underline hover:text-emerald-900"
          >
            Clear filter
          </Link>
        </div>
      )}

      <ProductsDisplay
        products={filteredProducts}
        title={getShopTitle(resolvedSearchParams, catalog)}
        emptyMessage={
          activeFilter
            ? "No plants match this filter. Try another category or browse all plants."
            : "No plants found. Please check back later."
        }
      />

      {activeFilter && filteredProducts.length === 0 && (
        <div className="mt-6 text-center">
          <Link
            href="/shop"
            className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            View all plants
          </Link>
        </div>
      )}
    </div>
  );
}
