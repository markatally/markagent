import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../authStore';
import * as apiClient from '../../lib/api';

// Mock the API client
vi.mock('../../lib/api', () => ({
  apiClient: {
    auth: {
      login: vi.fn(),
      register: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(),
    },
  },
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  getAccessToken: vi.fn(),
}));

// Helper to create mock user matching User type
const createMockUser = (id: string, email: string) => ({
  id,
  email,
  createdAt: new Date('2024-01-01'),
});

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should successfully login and update state', async () => {
      const mockUser = createMockUser('1', 'test@example.com');
      const mockResponse = {
        user: mockUser,
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      vi.mocked(apiClient.apiClient.auth.login).mockResolvedValue(mockResponse);

      const { login } = useAuthStore.getState();
      await login('test@example.com', 'password123');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.accessToken).toBe('access-token');
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should handle login failure', async () => {
      const error = new Error('Invalid credentials');
      vi.mocked(apiClient.apiClient.auth.login).mockRejectedValue(error);

      const { login } = useAuthStore.getState();

      try {
        await login('test@example.com', 'wrong-password');
      } catch (e) {
        // Expected to throw
      }

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Invalid credentials');
    });

    it('should set loading state during login', async () => {
      const mockResponse = {
        user: createMockUser('1', 'test@example.com'),
        accessToken: 'token',
        refreshToken: 'refresh',
      };

      let resolveLogin: any;
      vi.mocked(apiClient.apiClient.auth.login).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLogin = () => resolve(mockResponse);
          })
      );

      const { login } = useAuthStore.getState();
      const loginPromise = login('test@example.com', 'password');

      // Loading should be true immediately
      expect(useAuthStore.getState().isLoading).toBe(true);

      resolveLogin();
      await loginPromise;
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('register', () => {
    it('should successfully register and update state', async () => {
      const mockUser = createMockUser('1', 'new@example.com');
      const mockResponse = {
        user: mockUser,
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      vi.mocked(apiClient.apiClient.auth.register).mockResolvedValue(mockResponse);

      const { register } = useAuthStore.getState();
      await register('new@example.com', 'password123');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
    });

    it('should handle registration failure with duplicate email', async () => {
      const error = new Error('Email already exists');
      vi.mocked(apiClient.apiClient.auth.register).mockRejectedValue(error);

      const { register } = useAuthStore.getState();

      try {
        await register('existing@example.com', 'password');
      } catch (e) {
        // Expected to throw
      }

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.error).toBe('Email already exists');
    });
  });

  describe('logout', () => {
    it('should clear authentication state', () => {
      // Set up authenticated state
      useAuthStore.setState({
        user: createMockUser('1', 'test@example.com'),
        accessToken: 'token',
        isAuthenticated: true,
      });

      const { logout } = useAuthStore.getState();
      logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(apiClient.clearTokens).toHaveBeenCalled();
      expect(apiClient.apiClient.auth.logout).toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    it('should refresh access token successfully', async () => {
      const mockResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      vi.mocked(apiClient.getAccessToken).mockReturnValue('old-access-token');
      vi.mocked(apiClient.apiClient.auth.refresh).mockResolvedValue(mockResponse);

      useAuthStore.setState({
        isAuthenticated: true,
      });

      const { refreshToken } = useAuthStore.getState();
      await refreshToken();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('new-access-token');
    });

    it('should logout if refresh fails', async () => {
      const error = new Error('Invalid refresh token');
      vi.mocked(apiClient.getAccessToken).mockReturnValue('invalid-token');
      vi.mocked(apiClient.apiClient.auth.refresh).mockRejectedValue(error);

      useAuthStore.setState({
        user: createMockUser('1', 'test@example.com'),
        isAuthenticated: true,
      });

      const { refreshToken } = useAuthStore.getState();

      try {
        await refreshToken();
      } catch (e) {
        // Expected to throw
      }

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(apiClient.clearTokens).toHaveBeenCalled();
    });

    it('should not refresh if no access token exists', async () => {
      vi.mocked(apiClient.getAccessToken).mockReturnValue(null);

      useAuthStore.setState({
        isAuthenticated: false,
      });

      const { refreshToken } = useAuthStore.getState();

      try {
        await refreshToken();
      } catch (e) {
        // Expected to throw
      }

      expect(apiClient.apiClient.auth.refresh).not.toHaveBeenCalled();
    });
  });

  describe('setUser', () => {
    it('should set user and authentication state', () => {
      const mockUser = createMockUser('1', 'test@example.com');

      const { setUser } = useAuthStore.getState();
      setUser(mockUser);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
    });

    it('should clear authentication when user is null', () => {
      useAuthStore.setState({
        user: createMockUser('1', 'test@example.com'),
        isAuthenticated: true,
      });

      const { setUser } = useAuthStore.getState();
      setUser(null);

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('clearError', () => {
    it('should clear error state', () => {
      useAuthStore.setState({ error: 'Some error' });

      const { clearError } = useAuthStore.getState();
      clearError();

      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  describe('initialize', () => {
    it('should restore authentication from token', () => {
      vi.mocked(apiClient.getAccessToken).mockReturnValue('existing-token');

      const { initialize } = useAuthStore.getState();
      initialize();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('existing-token');
      expect(state.isAuthenticated).toBe(true);
    });

    it('should not set authentication if no token exists', () => {
      vi.mocked(apiClient.getAccessToken).mockReturnValue(null);

      const { initialize } = useAuthStore.getState();
      initialize();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });
});
