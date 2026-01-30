// Re-export all shared types from @manus/shared
export * from '@manus/shared';

// Frontend-specific types

/**
 * Extended Message type with frontend-specific properties
 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  updatedAt: Date;
  isStreaming?: boolean;
  toolCalls?: ToolCallInfo[];
}

/**
 * Tool call information
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  params: Record<string, any>;
  result?: string;
  error?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

/**
 * Tool call status for real-time tracking
 */
export interface ToolCallStatus {
  toolCallId: string;
  toolName: string;
  params: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

/**
 * SSE Stream event types
 */
export type StreamEventType =
  | 'message.start'
  | 'message.delta'
  | 'message.complete'
  | 'tool.start'
  | 'tool.complete'
  | 'tool.error'
  | 'error';

/**
 * SSE Stream event
 */
export interface StreamEvent {
  type: StreamEventType;
  data: any;
}

/**
 * API Error response
 */
export interface ApiErrorResponse {
  message: string;
  code?: string;
  status: number;
}

/**
 * Session with messages
 */
export interface SessionWithMessages {
  id: string;
  userId: string;
  name?: string;
  status: 'active' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
}

/**
 * Auth response
 */
export interface AuthResponse {
  user: {
    id: string;
    email: string;
    createdAt: Date;
    updatedAt: Date;
  };
  accessToken: string;
  refreshToken: string;
}

/**
 * Sessions list response
 */
export interface SessionsResponse {
  sessions: Array<{
    id: string;
    userId: string;
    name?: string;
    status: 'active' | 'completed' | 'archived';
    createdAt: Date;
    updatedAt: Date;
    _count?: {
      messages: number;
    };
  }>;
}

/**
 * Messages list response
 */
export interface MessagesResponse {
  messages: ChatMessage[];
}

/**
 * Form validation error
 */
export interface FormError {
  field: string;
  message: string;
}
