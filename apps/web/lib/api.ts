import { useAuthStore } from './store/authStore';
import { Product } from './types';

/**
 * Get the base API URL from environment variable or default to local API
 * In production, NEXT_PUBLIC_GO_API_URL must be set to your Cloud Run backend URL
 */
export function getApiUrl(): string {
  const browserValue = process.env.NEXT_PUBLIC_GO_API_URL || process.env.NEXT_PUBLIC_API_URL;

  if (typeof window !== 'undefined') {
    const apiUrl = browserValue || 'http://localhost:8080/api/v1';

    if (!browserValue && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      console.error('CORS Error: NEXT_PUBLIC_GO_API_URL is not set!');
      console.error('Current origin:', window.location.origin);
      console.error('Set NEXT_PUBLIC_GO_API_URL in Cloudflare Pages environment variables');
      console.error('Expected format: https://your-backend-xxxxx-xx.a.run.app/api/v1');
    }

    return apiUrl;
  }

  return process.env.GO_API_URL || browserValue || 'http://localhost:8080/api/v1';
}

/**
 * Resolve JWT from zustand store or persisted storage (handles rehydration lag).
 */
export function resolveAuthToken(): string | null {
  const fromStore = useAuthStore.getState().token;
  if (fromStore) return fromStore;

  if (typeof window !== 'undefined') {
    const direct = localStorage.getItem('token');
    if (direct) return direct;
    try {
      const raw = localStorage.getItem('auth-storage');
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { token?: string } };
        if (parsed.state?.token) return parsed.state.token;
      }
    } catch {
      // ignore parse errors
    }
  }
  return null;
}

/**
 * Fetch from the external API
 * Automatically includes Authorization header if token is available
 */
export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const apiUrl = getApiUrl();
  const url = path.startsWith('/') ? `${apiUrl}${path}` : `${apiUrl}/${path}`;

  const token = resolveAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

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

export type SearchPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type SearchProductsResult = {
  data: Product[];
  pagination: SearchPagination;
};

const emptySearch = (pageSize: number): SearchProductsResult => ({
  data: [],
  pagination: { page: 1, pageSize, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
});

/**
 * Search products by query string.
 * Pass AbortSignal to cancel in-flight navbar typing requests.
 */
export async function searchProducts(
  query: string,
  page: number = 1,
  pageSize: number = 20,
  signal?: AbortSignal
): Promise<SearchProductsResult> {
  const q = query.trim();
  if (!q) return emptySearch(pageSize);

  try {
    const res = await apiFetch(
      `/products/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`,
      { signal }
    );
    if (!res.ok) {
      throw new Error('Failed to search products');
    }
    const result = await res.json();
    if (result.data && result.pagination) {
      return result as SearchProductsResult;
    }
    const data = Array.isArray(result) ? result : [];
    return {
      data,
      pagination: {
        page: 1,
        pageSize,
        total: data.length,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    console.error('Error searching products:', error);
    return emptySearch(pageSize);
  }
}
