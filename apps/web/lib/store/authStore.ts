import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
          isAuthenticated: !!token 
        });
        // Also update localStorage for backward compatibility
        if (typeof window !== 'undefined') {
          if (token) {
            localStorage.setItem('token', token);
          } else {
            localStorage.removeItem('token');
          }
        }
      },
      
      clearAuth: () => {
        set({ 
          token: null,
          isAuthenticated: false 
        });
        if (typeof window !== 'undefined') {
          localStorage.removeItem('token');
        }
      },
      
      checkAuth: () => {
        // Sync with localStorage (useful for cross-tab updates)
        if (typeof window !== 'undefined') {
          const token = localStorage.getItem('token');
          const currentToken = get().token;
          // Only update if different to avoid unnecessary re-renders
          if (token !== currentToken) {
            set({ 
              token,
              isAuthenticated: !!token 
            });
          }
        }
      },
    }),
    {
      name: 'auth-storage',
      // Ensure we only persist token, not isAuthenticated (it's derived)
      partialize: (state) => ({ token: state.token }),
      // On rehydrate, set isAuthenticated based on token
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = !!state.token;
        }
      },
    }
  )
);

