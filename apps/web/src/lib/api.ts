import type { User, Session, Message } from '@manus/shared';

// API base URL (proxied through Vite dev server)
const API_BASE_URL = '/api';

// Custom error class for API errors
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Auth tokens management
let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export function getAccessToken(): string | null {
  if (!accessToken) {
    accessToken = localStorage.getItem('accessToken');
  }
  return accessToken;
}

export function getRefreshToken(): string | null {
  if (!refreshToken) {
    refreshToken = localStorage.getItem('refreshToken');
  }
  return refreshToken;
}

// Core fetch wrapper with auth and error handling
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  // Add authorization header if token exists
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized - try to refresh token
  if (response.status === 401 && endpoint !== '/auth/refresh') {
    const refreshTokenValue = getRefreshToken();
    if (refreshTokenValue) {
      try {
        // Attempt token refresh
        const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refreshTokenValue }),
        });

        if (refreshResponse.ok) {
          const { accessToken: newAccess, refreshToken: newRefresh } = await refreshResponse.json();
          setTokens(newAccess, newRefresh);

          // Retry original request with new token
          const retryHeaders: Record<string, string> = {
            ...headers,
            'Authorization': `Bearer ${newAccess}`,
          };
          const retryResponse = await fetch(url, {
            ...options,
            headers: retryHeaders,
          });

          if (!retryResponse.ok) {
            throw new ApiError(
              'Request failed after token refresh',
              retryResponse.status
            );
          }

          return retryResponse.json();
        } else {
          // Refresh failed - clear tokens and throw
          clearTokens();
          throw new ApiError('Session expired', 401, 'TOKEN_EXPIRED');
        }
      } catch (error) {
        clearTokens();
        throw error;
      }
    } else {
      throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED');
    }
  }

  // Handle other error responses
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errorCode = 'UNKNOWN_ERROR';

    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
      errorCode = errorData.code || errorCode;
    } catch {
      // Response is not JSON, use default message
    }

    throw new ApiError(errorMessage, response.status, errorCode);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// Auth API
export const authApi = {
  async register(email: string, password: string): Promise<{
    user: User;
    accessToken: string;
    refreshToken: string;
  }> {
    const response = await apiFetch<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    setTokens(response.accessToken, response.refreshToken);
    return response;
  },

  async login(email: string, password: string): Promise<{
    user: User;
    accessToken: string;
    refreshToken: string;
  }> {
    const response = await apiFetch<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    setTokens(response.accessToken, response.refreshToken);
    return response;
  },

  async refresh(token: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const response = await apiFetch<{
      accessToken: string;
      refreshToken: string;
    }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: token }),
    });

    setTokens(response.accessToken, response.refreshToken);
    return response;
  },

  logout() {
    clearTokens();
  },
};

// Sessions API
export const sessionsApi = {
  async list(): Promise<{ sessions: Session[] }> {
    return apiFetch<{ sessions: Session[] }>('/sessions');
  },

  async create(name?: string): Promise<Session> {
    return apiFetch<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async get(id: string): Promise<Session & { messages: Message[] }> {
    return apiFetch<Session & { messages: Message[] }>(`/sessions/${id}`);
  },

  async update(id: string, data: { name?: string }): Promise<Session> {
    return apiFetch<Session>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async delete(id: string): Promise<void> {
    return apiFetch<void>(`/sessions/${id}`, {
      method: 'DELETE',
    });
  },
};

// Messages API
export const messagesApi = {
  async list(sessionId: string): Promise<{ messages: Message[] }> {
    return apiFetch<{ messages: Message[] }>(`/sessions/${sessionId}/messages`);
  },

  async get(id: string): Promise<Message> {
    return apiFetch<Message>(`/messages/${id}`);
  },
};

// Chat API (streaming)
export const chatApi = {
  /**
   * Send a message and return the SSE stream URL
   * The actual streaming is handled by the SSEClient
   */
  getStreamUrl(sessionId: string): string {
    const token = getAccessToken();
    return `${API_BASE_URL}/sessions/${sessionId}/stream?token=${encodeURIComponent(token || '')}`;
  },

  /**
   * Send a message to start a chat stream
   * Returns immediately, actual response comes via SSE
   */
  async send(sessionId: string, content: string): Promise<void> {
    await apiFetch<void>(`/sessions/${sessionId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },
};

// Export unified API client
export const apiClient = {
  auth: authApi,
  sessions: sessionsApi,
  messages: messagesApi,
  chat: chatApi,
};
