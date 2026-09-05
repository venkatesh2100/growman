import Link from "next/link";
import ProductsDisplay from "../../components/productspage/ProductsDisplay";
import Pagination from "../../components/productspage/Pagination";
import {
  fetchAllProducts,
  fetchProductsPage,
  filterProducts,
} from "../../lib/data";
import type { ProductsPagination } from "../../lib/data";
import { apiFetch } from "../../lib/api";
import type { Category } from "../../lib/types";
import {
  getActiveFilterLabel,
  getShopTitle,
  hasShopFilter,
} from "../../lib/shopFilters";

const SHOP_PAGE_SIZE = 24;

function singleParam(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function paginateLocal<T>(
  items: T[],
  page: number,
  pageSize: number
): { items: T[]; pagination: ProductsPagination } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    },
  };
}

export default async function ShopProducts({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = await searchParams;
  const pageParam = Number(singleParam(resolvedSearchParams.page) || "1");
  const requestedPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const activeFilter = hasShopFilter(resolvedSearchParams);

  const [categoriesRes, tagsRes] = await Promise.all([
    apiFetch("/categories", { next: { revalidate: 60 } }),
    apiFetch("/tags", { next: { revalidate: 60 } }),
  ]);
  const categories: Category[] = categoriesRes.ok ? await categoriesRes.json() : [];
  const tags: string[] = tagsRes.ok ? await tagsRes.json() : [];
  const catalog = { tags, categories };

  let pageProducts;
  let pagination: ProductsPagination;

  if (activeFilter) {
    // Filters are applied client-side today — load the full catalog, then paginate.
    const all = await fetchAllProducts(100);
    const filtered = filterProducts(all.productsBySize, resolvedSearchParams);
    const sliced = paginateLocal(filtered, requestedPage, SHOP_PAGE_SIZE);
    pageProducts = sliced.items;
    pagination = sliced.pagination;
  } else {
    const result = await fetchProductsPage(requestedPage, SHOP_PAGE_SIZE);
    pageProducts = result.productsBySize;
    pagination = result.pagination;
  }

  const filterLabel = getActiveFilterLabel(resolvedSearchParams, catalog);
  const rangeStart =
    pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = Math.min(
    pagination.page * pagination.pageSize,
    pagination.total
  );

  return (
    <div id="shop-products">
      {activeFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border-emerald-100 bg-emerald-50 px-4 py-3">
          <span className="text-sm text-emerald-900">
            Filter: <strong>{filterLabel}</strong>
            {" · "}
            {pagination.total}{" "}
            {pagination.total === 1 ? "plant" : "plants"}
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
        products={pageProducts}
        title={getShopTitle(resolvedSearchParams, catalog)}
        countLabel={
          pagination.total > 0
            ? `Showing ${rangeStart}–${rangeEnd} of ${pagination.total} plants`
            : undefined
        }
        emptyMessage={
          activeFilter
            ? "No plants match this filter. Try another category or browse all plants."
            : "No plants found. Please check back later."
        }
      />

      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        hasNext={pagination.hasNext}
        hasPrev={pagination.hasPrev}
        searchParams={resolvedSearchParams}
      />

      {activeFilter && pagination.total === 0 && (
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
