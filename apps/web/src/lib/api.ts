import type { User, Session, Message } from '@mark/shared';
import { useAuthStore } from '../stores/authStore';

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

// When tokens are cleared, also update the Zustand store
function syncTokenStateToStore(token: string | null, refresh: string | null) {
  accessToken = token;
  refreshToken = refresh;
  if (token) {
    localStorage.setItem('accessToken', token);
    localStorage.setItem('refreshToken', refresh || '');
    useAuthStore.getState().setIsAuthenticated(true);
  } else {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    useAuthStore.getState().setIsAuthenticated(false);
    useAuthStore.getState().setUser(null);
  }
}

export function setTokens(access: string, refresh: string) {
  syncTokenStateToStore(access, refresh);
}

export function clearTokens() {
  syncTokenStateToStore(null, null);
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

  /**
   * Get Google OAuth authorization URL
   * Redirects user to Google's consent page
   */
  getGoogleAuthUrl(redirectUri?: string): string {
    const params = new URLSearchParams();
    if (redirectUri) {
      params.append('redirect_uri', redirectUri);
    }
    return `${API_BASE_URL}/auth/google/authorize?${params.toString()}`;
  },

  /**
   * Handle Google OAuth callback
   * Called when user returns from Google's consent page
   */
  async handleGoogleCallback(code: string, state: string): Promise<{
    user: User;
    accessToken: string;
    refreshToken: string;
  }> {
    const response = await apiFetch<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>('/auth/google/callback', {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    });

    setTokens(response.accessToken, response.refreshToken);
    return response;
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

// SSE Event from backend
export interface SSEEvent {
  type: string;
  sessionId: string;
  timestamp: number;
  data: any;
}

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
   * Send a message and stream the response
   * Returns an async generator that yields SSE events
   */
  async *sendAndStream(
    sessionId: string,
    content: string
  ): AsyncGenerator<SSEEvent, void, unknown> {
    const token = getAccessToken();
    const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorData.message || errorMessage;
      } catch {
        // Response is not JSON
      }
      throw new ApiError(errorMessage, response.status);
    }

    if (!response.body) {
      throw new ApiError('No response body', 500);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6); // Remove 'data: ' prefix
            if (jsonStr.trim()) {
              try {
                const event: SSEEvent = JSON.parse(jsonStr);
                yield event;
              } catch (e) {
                console.error('Failed to parse SSE event:', e, jsonStr);
              }
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.startsWith('data: ')) {
        const jsonStr = buffer.slice(6);
        if (jsonStr.trim()) {
          try {
            const event: SSEEvent = JSON.parse(jsonStr);
            yield event;
          } catch (e) {
            console.error('Failed to parse final SSE event:', e, jsonStr);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};

// Files API
export interface FileInfo {
  id: string;
  filename: string;
  filepath: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

export const filesApi = {
  /**
   * Upload a file to a session
   */
  async upload(sessionId: string, file: File): Promise<FileInfo> {
    const formData = new FormData();
    formData.append('file', file);

    const token = getAccessToken();
    const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/files`, {
      method: 'POST',
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        error.error?.message || 'Upload failed',
        response.status,
        error.error?.code
      );
    }

    return response.json();
  },

  /**
   * List files in a session
   */
  async list(sessionId: string): Promise<{ files: FileInfo[] }> {
    return apiFetch<{ files: FileInfo[] }>(`/sessions/${sessionId}/files`);
  },

  /**
   * Download a file
   */
  async download(sessionId: string, fileId: string): Promise<Blob> {
    const token = getAccessToken();
    const response = await fetch(
      `${API_BASE_URL}/sessions/${sessionId}/files/${fileId}/download`,
      {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      }
    );

    if (!response.ok) {
      throw new ApiError('Download failed', response.status);
    }

    return response.blob();
  },

  /**
   * Delete a file
   */
  async delete(sessionId: string, fileId: string): Promise<void> {
    return apiFetch<void>(`/sessions/${sessionId}/files/${fileId}`, {
      method: 'DELETE',
    });
  },
};

// Skills API
export interface Skill {
  name: string;
  description: string;
  aliases: string[];
  category: string;
  requiredTools: string[];
  parameters: Array<{
    name: string;
    description: string;
    required: boolean;
    type: string;
  }>;
}

export interface SkillsResponse {
  skills: Skill[];
  categories: Array<{ name: string; skills: string[] }>;
  total: number;
}

export const skillsApi = {
  /**
   * List all available skills
   */
  async list(): Promise<SkillsResponse> {
    return apiFetch<SkillsResponse>('/skills');
  },

  /**
   * Get details for a specific skill
   */
  async get(name: string): Promise<Skill & {
    systemPrompt: string;
    userPromptTemplate: string;
    help: string;
  }> {
    return apiFetch<Skill & {
      systemPrompt: string;
      userPromptTemplate: string;
      help: string;
    }>(`/skills/${name}`);
  },
};

// Export unified API client
export const apiClient = {
  auth: authApi,
  sessions: sessionsApi,
  messages: messagesApi,
  chat: chatApi,
  files: filesApi,
  skills: skillsApi,
};
