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

/**
 * Read a JSON response body as `T`.
 *
 * `Response.json()` resolves to `unknown`, which is accurate — nothing
 * validates the bytes on the wire — but it makes every call site an error.
 * This centralises the assertion so each caller states the shape it
 * expects in one place, instead of sprinkling `any` through the handlers.
 *
 * It is an assertion, not validation: a backend that changes a field name
 * will still compile. Use it for shapes we control; parse defensively
 * where the response is genuinely variable.
 */
export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
 * apiFetch plus a typed JSON parse, for the common case where a non-2xx
 * response should throw rather than be inspected.
 */
export async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with ${response.status}`);
  }
  return readJson<T>(response);
}

/** The error envelope the Go backend returns on a 4xx/5xx. */
export type ApiError = {
  error?: string;
  reason?: string;
  message?: string;
};

/**
 * Pull a human-readable message out of a failed response, falling back to
 * a generic one. Never throws: it is called on paths that are already
 * handling an error.
 */
export async function readApiError(
  response: Response,
  fallback = 'Something went wrong. Please try again.',
): Promise<string> {
  try {
    const body = await readJson<ApiError>(response);
    return body.reason || body.message || body.error || fallback;
  } catch {
    return fallback;
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
    // Deliberately loose: this endpoint has returned both a paginated
    // envelope and a bare array across backend versions.
    const result = await readJson<Partial<SearchProductsResult> | Product[]>(res);
    if (!Array.isArray(result) && result.data && result.pagination) {
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
