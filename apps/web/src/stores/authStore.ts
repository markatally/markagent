import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@manus/shared';
import { apiClient, setTokens, clearTokens, getAccessToken } from '../lib/api';

interface AuthState {
  // State
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  setUser: (user: User | null) => void;
  clearError: () => void;
  initialize: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // Login action
      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const response = await apiClient.auth.login(email, password);

          set({
            user: response.user,
            accessToken: response.accessToken,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error: any) {
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false,
            isLoading: false,
            error: error.message || 'Login failed',
          });
          throw error;
        }
      },

      // Register action
      register: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const response = await apiClient.auth.register(email, password);

          set({
            user: response.user,
            accessToken: response.accessToken,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error: any) {
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false,
            isLoading: false,
            error: error.message || 'Registration failed',
          });
          throw error;
        }
      },

      // Logout action
      logout: () => {
        apiClient.auth.logout();
        clearTokens();

        set({
          user: null,
          accessToken: null,
          isAuthenticated: false,
          error: null,
        });
      },

      // Refresh token action
      refreshToken: async () => {
        try {
          const token = getAccessToken();
          if (!token) {
            throw new Error('No refresh token available');
          }

          const response = await apiClient.auth.refresh(token);

          set({
            accessToken: response.accessToken,
          });
        } catch (error: any) {
          // Refresh failed - logout user
          get().logout();
          throw error;
        }
      },

      // Set user action
      setUser: (user: User | null) => {
        set({
          user,
          isAuthenticated: !!user,
        });
      },

      // Clear error action
      clearError: () => {
        set({ error: null });
      },

      // Initialize - restore from localStorage
      initialize: () => {
        const token = getAccessToken();
        if (token) {
          set({
            accessToken: token,
            isAuthenticated: true,
          });
          // Note: user data will be fetched when needed from API
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        // Only persist user and tokens (not loading/error states)
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Initialize auth state on app load
if (typeof window !== 'undefined') {
  useAuthStore.getState().initialize();
}
