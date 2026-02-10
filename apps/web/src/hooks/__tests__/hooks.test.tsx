/**
 * Hooks Tests
 * 
 * Tests for React hooks - useAuth, useChat, useSessions, useSSE
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the API client
vi.mock('../../lib/api', () => ({
  apiClient: {
    sessions: {
      list: vi.fn().mockResolvedValue({ sessions: [] }),
      get: vi.fn().mockResolvedValue({ messages: [] }),
      create: vi.fn().mockResolvedValue({ id: 'new-session' }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    messages: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock auth store
vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn(() => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    setUser: vi.fn(),
  })),
}));

// Mock chat store
  vi.mock('../../stores/chatStore', () => {
    const chatState = {
      messages: [],
      toolCalls: new Map(),
      setMessages: vi.fn(),
      addMessage: vi.fn(),
      updateMessage: vi.fn(),
      startToolCall: vi.fn(),
      upsertToolCall: vi.fn(),
      updateToolCall: vi.fn(),
    };

  const useChatStore = vi.fn((selector?: (state: typeof chatState) => any) =>
    selector ? selector(chatState) : chatState
  );
  useChatStore.getState = () => chatState;

  return { useChatStore };
});

describe('Hooks', () => {
  let queryClient: QueryClient;
  
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
  
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  describe('useAuth', () => {
    it('should return auth state', async () => {
      const { useAuth } = await import('../../hooks/useAuth');
      
      const { result } = renderHook(() => useAuth());
      
      expect(result.current).toHaveProperty('user');
      expect(result.current).toHaveProperty('isAuthenticated');
      expect(result.current).toHaveProperty('login');
      expect(result.current).toHaveProperty('logout');
    });
  });

  describe('useSessions', () => {
    it('should fetch sessions list', async () => {
      const { useSessions } = await import('../../hooks/useSessions');
      
      const { result } = renderHook(() => useSessions(), { wrapper });
      
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('should create new session', async () => {
      const { useCreateSession } = await import('../../hooks/useSessions');
      
      const { result } = renderHook(() => useCreateSession(), { wrapper });
      
      expect(result.current.mutate).toBeDefined();
    });
  });

  describe('useChat', () => {
    it('should fetch session messages', async () => {
      const { useSessionMessages } = await import('../../hooks/useChat');
      
      const { result } = renderHook(() => useSessionMessages('session-1'), { wrapper });
      
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });
  });

  describe('useKeyboardShortcuts', () => {
    it('should register keyboard shortcuts', async () => {
      const handler = vi.fn();
      const { useKeyboardShortcuts } = await import('../../hooks/useKeyboardShortcuts');
      
      renderHook(() => 
        useKeyboardShortcuts([
          { key: 'k', ctrlKey: true, handler },
        ])
      );
      
      // Simulate keyboard event
      const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
      window.dispatchEvent(event);
      
      expect(handler).toHaveBeenCalled();
    });
  });
});
