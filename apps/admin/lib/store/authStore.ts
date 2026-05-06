import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthStore {
  token: string | null;
  isAuthenticated: boolean;
  setToken: (token: string | null) => void;
  clearAuth: () => void;
  checkAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      token: null,
      isAuthenticated: false,
      setToken: (token) => {
        set({
          token,
          isAuthenticated: !!token,
        });
        if (typeof window !== "undefined") {
          if (token) {
            localStorage.setItem("token", token);
          } else {
            localStorage.removeItem("token");
          }
        }
      },
      clearAuth: () => {
        set({
          token: null,
          isAuthenticated: false,
        });
        if (typeof window !== "undefined") {
          localStorage.removeItem("token");
        }
      },
      checkAuth: () => {
        if (typeof window !== "undefined") {
          const token = localStorage.getItem("token");
          const currentToken = get().token;
          if (token !== currentToken) {
            set({
              token,
              isAuthenticated: !!token,
            });
          }
        }
      },
    }),
    {
      name: "admin-auth-storage",
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = !!state.token;
        }
      },
    }
  )
);
