import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      },

      clearAuth: () => {
        set({
          token: null,
          isAuthenticated: false,
        });
      },

      checkAuth: () => {
        // Sync with AsyncStorage
        AsyncStorage.getItem('auth-storage').then((stored) => {
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              const token = parsed.state?.token;
              const currentToken = get().token;
              if (token !== currentToken) {
                set({
                  token,
                  isAuthenticated: !!token,
                });
              }
            } catch (e) {
              console.error('Error parsing auth storage:', e);
            }
          }
        });
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = !!state.token;
        }
      },
    }
  )
);

