import { apiFetch } from './api';
import type { Brand, Category, Product } from './types';
import { slugify } from './shopFilters';

// Cache configuration - revalidate every 60 seconds
const REVALIDATE_TIME = 60;

export type ProductsPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type ProductsPageResult = {
  products: Product[];
  productsBySize: Product[];
  pagination: ProductsPagination;
};

export interface ProductsData {
  products: Product[];
  productsBySize: Product[];
  categories: Category[];
  brands: Brand[];
  tags: string[];
  priceRange: { min: number; max: number };
  categoryFilters: Array<{ id: number; name: string; slug: string; count: number }>;
  brandFilters: Array<{ id: number; name: string; slug: string }>;
  pagination?: ProductsPagination;
}

const emptyPagination = (page = 1, pageSize = 24): ProductsPagination => ({
  page,
  pageSize,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrev: false,
});

function expandProductsBySize(allProducts: Product[]): Product[] {
  if (!Array.isArray(allProducts)) return [];
  return allProducts.flatMap((product) => {
    if (product.sizes && product.sizes.length > 0) {
      return product.sizes.map((size) => ({
        ...product,
        price: size.price,
        stock: size.stock,
        imageUrl: size.images && size.images.length > 0 ? size.images[0] : product.imageUrl,
        sizes: [size],
        name: `${product.name} - ${size.label}`,
      }));
    }
    return [product];
  });
}

function parseProductsPayload(productsData: unknown): {
  products: Product[];
  pagination: ProductsPagination;
} {
  if (
    productsData &&
    typeof productsData === "object" &&
    "data" in productsData &&
    Array.isArray((productsData as { data: unknown }).data)
  ) {
    const payload = productsData as {
      data: Product[];
      pagination?: Partial<ProductsPagination>;
    };
    const page = Number(payload.pagination?.page || 1);
    const pageSize = Number(payload.pagination?.pageSize || payload.data.length || 24);
    const total = Number(payload.pagination?.total ?? payload.data.length);
    const totalPages =
      Number(payload.pagination?.totalPages) ||
      Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
    return {
      products: payload.data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: payload.pagination?.hasNext ?? page < totalPages,
        hasPrev: payload.pagination?.hasPrev ?? page > 1,
      },
    };
  }

  if (Array.isArray(productsData)) {
    return {
      products: productsData as Product[],
      pagination: {
        page: 1,
        pageSize: productsData.length,
        total: productsData.length,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  }

  return { products: [], pagination: emptyPagination() };
}

/**
 * Fetch a single products page from the backend list endpoint.
 */
export async function fetchProductsPage(
  page = 1,
  pageSize = 24
): Promise<ProductsPageResult> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));

  try {
    const res = await apiFetch(
      `/products?page=${safePage}&pageSize=${safePageSize}`,
      { next: { revalidate: REVALIDATE_TIME } }
    );
    if (!res.ok) {
      return {
        products: [],
        productsBySize: [],
        pagination: emptyPagination(safePage, safePageSize),
      };
    }
    const parsed = parseProductsPayload(await res.json());
    return {
      products: parsed.products,
      productsBySize: expandProductsBySize(parsed.products),
      pagination: parsed.pagination,
    };
  } catch (error) {
    console.warn("Failed to fetch products page:", error);
    return {
      products: [],
      productsBySize: [],
      pagination: emptyPagination(safePage, safePageSize),
    };
  }
}

/**
 * Fetch every product page (for filtered shop views / catalog metadata).
 */
export async function fetchAllProducts(pageSize = 100): Promise<ProductsPageResult> {
  const first = await fetchProductsPage(1, pageSize);
  if (!first.pagination.hasNext) return first;

  const all = [...first.products];
  let page = 2;
  let meta = first.pagination;

  while (meta.hasNext && page <= meta.totalPages) {
    const next = await fetchProductsPage(page, pageSize);
    all.push(...next.products);
    meta = next.pagination;
    page += 1;
    if (next.products.length === 0) break;
  }

  return {
    products: all,
    productsBySize: expandProductsBySize(all),
    pagination: {
      ...first.pagination,
      page: 1,
      pageSize: all.length,
      total: all.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  };
}

/**
 * Fetches all product-related data in a single optimized call
 * Uses Next.js caching to minimize API requests
 * Handles errors gracefully for build-time when API may not be available
 */
export async function fetchProductsData(): Promise<ProductsData> {
  // Default empty data structure
  const defaultData: ProductsData = {
    products: [],
    productsBySize: [],
    categories: [],
    brands: [],
    tags: [],
    priceRange: { min: 0, max: 0 },
    categoryFilters: [],
    brandFilters: [],
  };

  try {
    const [categoriesRes, brandsRes, productsPage, tagsRes] = await Promise.allSettled([
      apiFetch('/categories', {
        next: { revalidate: REVALIDATE_TIME }
      }),
      apiFetch('/brands', {
        next: { revalidate: REVALIDATE_TIME }
      }),
      fetchAllProducts(100),
      apiFetch('/tags', {
        next: { revalidate: REVALIDATE_TIME }
      }),
    ]);

    const categories: Category[] =
      categoriesRes.status === 'fulfilled' && categoriesRes.value.ok
        ? await categoriesRes.value.json()
        : [];

    const brands: Brand[] =
      brandsRes.status === 'fulfilled' && brandsRes.value.ok
        ? await brandsRes.value.json()
        : [];

    const productsResult =
      productsPage.status === "fulfilled"
        ? productsPage.value
        : {
            products: [] as Product[],
            productsBySize: [] as Product[],
            pagination: emptyPagination(),
          };
    const allProducts = productsResult.products;
    const productsBySize = productsResult.productsBySize;

    const tagsPayload: string[] =
      tagsRes.status === 'fulfilled' && tagsRes.value.ok
        ? await tagsRes.value.json()
        : [];

    // Calculate price range
    const priceRange = productsBySize.length
      ? {
          min: Math.min(...productsBySize.map(p => p.price)),
          max: Math.max(...productsBySize.map(p => p.price)),
        }
      : { min: 0, max: 0 };

    // Extract unique tags
    const uniqueTags = tagsPayload.length
      ? Array.from(new Set(tagsPayload))
      : Array.from(new Set(productsBySize.flatMap(p => p.tags || [])));

    // Create category filters with counts
    const categoryFilters = categories.map(c => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      count: productsBySize.filter(p => p.categoryId === c.id).length,
    }));

    // Create brand filters
    const brandFilters = brands.map(b => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
    }));

    return {
      products: allProducts,
      productsBySize,
      categories,
      brands,
      tags: uniqueTags,
      priceRange,
      categoryFilters,
      brandFilters,
      pagination: productsResult.pagination,
    };
  } catch (error) {
    // Handle connection errors gracefully during build time
    console.warn('Failed to fetch products data (API may not be available during build):', error);
    return defaultData;
  }
}

/**
 * Filters products based on search params
 */
export function filterProducts(
  products: Product[],
  searchParams: { [key: string]: string | string[] | undefined }
): Product[] {
  let filtered = [...products];

  // Filter by categories
  if (searchParams.category) {
    const categorySlugs = Array.isArray(searchParams.category)
      ? searchParams.category
      : [searchParams.category];
    filtered = filtered.filter(p =>
      categorySlugs.includes(p.category?.slug || '')
    );
  }

  // Filter by brands
  if (searchParams.brand) {
    const brandSlugs = Array.isArray(searchParams.brand)
      ? searchParams.brand
      : [searchParams.brand];
    filtered = filtered.filter(p =>
      p.brand && brandSlugs.includes(p.brand.slug)
    );
  }

  // Filter by tags (slug-normalized)
  if (searchParams.tag) {
    const tags = Array.isArray(searchParams.tag)
      ? searchParams.tag
      : [searchParams.tag];
    const normalized = tags.map((tag) => slugify(tag));
    filtered = filtered.filter((product) =>
      product.tags?.some((productTag) => normalized.includes(slugify(productTag)))
    );
  }

  // Filter by price range
  if (searchParams.minPrice) {
    const minPrice = Number(searchParams.minPrice);
    filtered = filtered.filter(p => p.price >= minPrice);
  }

  if (searchParams.maxPrice) {
    const maxPrice = Number(searchParams.maxPrice);
    filtered = filtered.filter(p => p.price <= maxPrice);
  }

  return filtered;
}
