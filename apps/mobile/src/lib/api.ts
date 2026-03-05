import { API_URL } from '../config/env';
import { useAuthStore } from '../store/authStore';

/**
 * Get the base API URL from environment variable or default to local API
 */
export function getApiUrl(): string {
  return API_URL;
}

/**
 * Fetch from the external API
 * Automatically includes Authorization header if token is available
 */
export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const apiUrl = getApiUrl();
  const url = path.startsWith('/') ? `${apiUrl}${path}` : `${apiUrl}/${path}`;

  // Get token from store
  const authStore = useAuthStore.getState();
  const token = authStore.token;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  // Add Authorization header if token exists
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    return response;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/**
 * Search products by query string
 */
export async function searchProducts(
  query: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  data: any[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}> {
  if (!query || query.trim() === '') {
    return {
      data: [],
      pagination: {
        page: 1,
        pageSize,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    };
  }

  try {
    const res = await apiFetch(
      `/products/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`
    );
    if (!res.ok) {
      throw new Error('Failed to search products');
    }
    const result = await res.json();
    // Handle paginated response
    if (result.data && result.pagination) {
      return result;
    }
    // Fallback for non-paginated response
    return {
      data: Array.isArray(result) ? result : [],
      pagination: {
        page: 1,
        pageSize,
        total: result.length || 0,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  } catch (error) {
    console.error('Error searching products:', error);
    return {
      data: [],
      pagination: {
        page: 1,
        pageSize,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    };
  }
}

