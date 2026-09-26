import { useAuthStore } from "./store/authStore";

export function getApiUrl(): string {
  const browserValue =
    process.env.NEXT_PUBLIC_GO_API_URL || process.env.NEXT_PUBLIC_API_URL;

  if (typeof window !== "undefined") {
    return browserValue || "http://localhost:8080/api/v1";
  }

  return process.env.GO_API_URL || browserValue || "http://localhost:8080/api/v1";
}

export async function apiFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const apiUrl = getApiUrl();
  const url = path.startsWith("/") ? `${apiUrl}${path}` : `${apiUrl}/${path}`;

  let token: string | null = null;
  if (typeof window !== "undefined") {
    const authStore = useAuthStore.getState();
    token = authStore.token || localStorage.getItem("token");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });
}
