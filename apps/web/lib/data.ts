import { apiFetch } from './api';
import type { Brand, Category, Product } from './types';

// Cache configuration - revalidate every 60 seconds
const REVALIDATE_TIME = 60;

export interface ProductsData {
  products: Product[];
  productsBySize: Product[];
  categories: Category[];
  brands: Brand[];
  tags: string[];
  priceRange: { min: number; max: number };
  categoryFilters: Array<{ id: number; name: string; slug: string; count: number }>;
  brandFilters: Array<{ id: number; name: string; slug: string }>;
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
    const [categoriesRes, brandsRes, productsRes, tagsRes] = await Promise.allSettled([
      apiFetch('/categories', { 
        next: { revalidate: REVALIDATE_TIME } 
      }),
      apiFetch('/brands', { 
        next: { revalidate: REVALIDATE_TIME } 
      }),
      apiFetch('/products', { 
        next: { revalidate: REVALIDATE_TIME } 
      }),
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
    
    // Handle paginated response from backend
    let allProducts: Product[] = [];
    if (productsRes.status === 'fulfilled' && productsRes.value.ok) {
      try {
        const productsData = await productsRes.value.json();
        // Check if response is paginated (has data and pagination keys)
        if (productsData.data && Array.isArray(productsData.data)) {
          allProducts = productsData.data;
        } else if (Array.isArray(productsData)) {
          // Fallback for non-paginated response
          allProducts = productsData;
        }
      } catch (error) {
        console.error('Error parsing products response:', error);
      }
    }
    
    const tagsPayload: string[] = 
      tagsRes.status === 'fulfilled' && tagsRes.value.ok
        ? await tagsRes.value.json()
        : [];

    // Split products by size - create a separate product entry for each size
    const productsBySize: Product[] = Array.isArray(allProducts) ? allProducts.flatMap(product => {
      if (product.sizes && product.sizes.length > 0) {
        return product.sizes.map(size => ({
          ...product,
          price: size.price,
          stock: size.stock,
          imageUrl: size.images && size.images.length > 0 ? size.images[0] : product.imageUrl,
          sizes: [size],
          name: `${product.name} - ${size.label}`,
        }));
      }
      return [product];
    }) : [];

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

  // Filter by tags
  if (searchParams.tag) {
    const tags = Array.isArray(searchParams.tag)
      ? searchParams.tag
      : [searchParams.tag];
    filtered = filtered.filter(p => 
      p.tags && tags.some(tag => p.tags?.includes(tag))
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

