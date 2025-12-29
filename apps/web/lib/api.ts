import { useAuthStore } from './store/authStore';

/**
 * Get the base API URL from environment variable or default to local API
 * In production, NEXT_PUBLIC_GO_API_URL must be set to your Cloud Run backend URL
 */
export function getApiUrl(): string {
  const browserValue = process.env.NEXT_PUBLIC_GO_API_URL || process.env.NEXT_PUBLIC_API_URL;

  if (typeof window !== 'undefined') {
    // In browser, only use NEXT_PUBLIC_ prefixed vars
    const apiUrl = browserValue || 'http://localhost:8080/api/v1';

    // Debug logging - check if we're using localhost in production
    if (!browserValue && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      console.error('❌ CORS Error: NEXT_PUBLIC_GO_API_URL is not set!');
      console.error('Current origin:', window.location.origin);
      console.error('Set NEXT_PUBLIC_GO_API_URL in Cloudflare Pages environment variables');
      console.error('Expected format: https://your-backend-xxxxx-xx.a.run.app/api/v1');
    } else if (browserValue) {
      // Log the API URL being used (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.log('API URL configured:', apiUrl);
      }
    }

    return apiUrl;
  }

  // Server-side: can use both public and private env vars
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
      credentials: 'include', // Important for CORS with credentials
    });

    // Enhanced CORS error detection
    if (response.status === 0 || (url.includes('localhost') && typeof window !== 'undefined' && window.location.hostname !== 'localhost')) {
      console.error('🚨 CORS/Network Error Detected:', {
        requestedUrl: url,
        apiUrl,
        currentOrigin: typeof window !== 'undefined' ? window.location.origin : 'server',
        status: response.status,
        issue: url.includes('localhost')
          ? 'Frontend is using localhost URL in production! Set NEXT_PUBLIC_GO_API_URL in Cloudflare Pages.'
          : 'CORS configuration issue. Check CORS_ORIGINS in Cloud Run.',
      });
    }

    return response;
  } catch (error) {
    // Enhanced error logging
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const isLocalhostIssue = url.includes('localhost') && typeof window !== 'undefined' && window.location.hostname !== 'localhost';

      console.error('❌ Network/CORS Error:', {
        error: error.message,
        requestedUrl: url,
        apiUrl,
        currentOrigin: typeof window !== 'undefined' ? window.location.origin : 'server',
        issue: isLocalhostIssue
          ? 'Frontend is trying to use localhost in production. Set NEXT_PUBLIC_GO_API_URL in Cloudflare Pages environment variables.'
          : 'Backend may be unreachable or CORS not configured. Check CORS_ORIGINS in Cloud Run.',
        fix: isLocalhostIssue
          ? 'Go to Cloudflare Pages → Settings → Environment Variables → Add NEXT_PUBLIC_GO_API_URL=https://your-backend.a.run.app/api/v1'
          : 'Go to Cloud Run → Edit Service → Variables → Add CORS_ORIGINS=https://your-frontend-domain.com',
      });
    }
    throw error;
  }
}

import { Product } from './types';

/**
 * Search products by query string
 * Returns paginated response with data and pagination metadata
 */
export async function searchProducts(query: string, page: number = 1, pageSize: number = 20): Promise<{data: Product[], pagination: {page: number, pageSize: number, total: number, totalPages: number, hasNext: boolean, hasPrev: boolean}}> {
  if (!query || query.trim() === '') {
    return { data: [], pagination: { page: 1, pageSize, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }

  try {
    const res = await apiFetch(`/products/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`);
    if (!res.ok) {
      throw new Error('Failed to search products');
    }
    const result = await res.json();
    // Handle paginated response
    if (result.data && result.pagination) {
      return result;
    }
    // Fallback for non-paginated response
    return { data: Array.isArray(result) ? result : [], pagination: { page: 1, pageSize, total: result.length || 0, totalPages: 1, hasNext: false, hasPrev: false } };
  } catch (error) {
    console.error('Error searching products:', error);
    return { data: [], pagination: { page: 1, pageSize, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }
}
