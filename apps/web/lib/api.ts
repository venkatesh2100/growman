import { useAuthStore } from './store/authStore';

/**
 * Get the base API URL from environment variable or default to local API
 */
export function getApiUrl(): string {
  const browserValue = process.env.NEXT_PUBLIC_GO_API_URL || process.env.NEXT_PUBLIC_API_URL;

  if (typeof window !== 'undefined') {
    return browserValue || 'http://localhost:8080/api/v1';
  }

  return process.env.GO_API_URL || browserValue || 'http://localhost:8080/api/v1';
}

/**
 * Fetch from the external API
 * Automatically includes Authorization header if token is available
 */
export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const apiUrl = getApiUrl();
  const url = path.startsWith('/') ? `${apiUrl}${path}` : `${apiUrl}/${path}`;
  
  // Get token from store or localStorage (for backward compatibility)
  let token: string | null = null;
  if (typeof window !== 'undefined') {
    const authStore = useAuthStore.getState();
    token = authStore.token || localStorage.getItem('token');
  }
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options?.headers,
  };
  
  // Add Authorization header if token exists
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Search products by query string
 */
export async function searchProducts(query: string): Promise<any[]> {
  if (!query || query.trim() === '') {
    return [];
  }
  
  try {
    const res = await apiFetch(`/products/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      throw new Error('Failed to search products');
    }
    return await res.json();
  } catch (error) {
    console.error('Error searching products:', error);
    return [];
  }
}
