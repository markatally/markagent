import { create } from 'zustand';
import type { Message } from '@manus/shared';

interface ToolCallStatus {
  toolCallId: string;
  toolName: string;
  params: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

interface ChatState {
  // Messages by session ID
  messages: Map<string, Message[]>;

  // Streaming state
  streamingSessionId: string | null;
  streamingContent: string;
  isStreaming: boolean;

  // Tool calls state
  toolCalls: Map<string, ToolCallStatus>;

  // Actions - Messages
  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  clearMessages: (sessionId: string) => void;

  // Actions - Streaming
  startStreaming: (sessionId: string) => void;
  appendStreamingContent: (content: string) => void;
  finalizeStreamingMessage: (messageId: string, message: Message) => void;
  stopStreaming: () => void;

  // Actions - Tool calls
  startToolCall: (toolCallId: string, toolName: string, params: any) => void;
  updateToolCall: (toolCallId: string, updates: Partial<ToolCallStatus>) => void;
  completeToolCall: (toolCallId: string, result: string, success: boolean) => void;
  clearToolCalls: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  messages: new Map(),
  streamingSessionId: null,
  streamingContent: '',
  isStreaming: false,
  toolCalls: new Map(),

  // Set messages for a session
  setMessages: (sessionId: string, messages: Message[]) => {
    set((state) => {
      const newMessages = new Map(state.messages);
      newMessages.set(sessionId, messages);
      return { messages: newMessages };
    });
  },

  // Add a message to a session
  addMessage: (sessionId: string, message: Message) => {
    set((state) => {
      const newMessages = new Map(state.messages);
      const sessionMessages = newMessages.get(sessionId) || [];
      newMessages.set(sessionId, [...sessionMessages, message]);
      return { messages: newMessages };
    });
  },

  // Update a message
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => {
    set((state) => {
      const newMessages = new Map(state.messages);
      const sessionMessages = newMessages.get(sessionId) || [];
      const updatedMessages = sessionMessages.map((msg) =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      );
      newMessages.set(sessionId, updatedMessages);
      return { messages: newMessages };
    });
  },

  // Clear messages for a session
  clearMessages: (sessionId: string) => {
    set((state) => {
      const newMessages = new Map(state.messages);
      newMessages.delete(sessionId);
      return { messages: newMessages };
    });
  },

  // Start streaming
  startStreaming: (sessionId: string) => {
    set({
      streamingSessionId: sessionId,
      streamingContent: '',
      isStreaming: true,
    });
  },

  // Append content to streaming message
  appendStreamingContent: (content: string) => {
    set((state) => ({
      streamingContent: state.streamingContent + content,
    }));
  },

  // Finalize streaming message
  finalizeStreamingMessage: (messageId: string, message: Message) => {
    const { streamingSessionId } = get();

    if (streamingSessionId) {
      get().addMessage(streamingSessionId, message);
    }

    set({
      streamingSessionId: null,
      streamingContent: '',
      isStreaming: false,
    });
  },

  // Stop streaming
  stopStreaming: () => {
    set({
      streamingSessionId: null,
      streamingContent: '',
      isStreaming: false,
    });
  },

  // Start a tool call
  startToolCall: (toolCallId: string, toolName: string, params: any) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      newToolCalls.set(toolCallId, {
        toolCallId,
        toolName,
        params,
        status: 'running',
      });
      return { toolCalls: newToolCalls };
    });
  },

  // Update a tool call
  updateToolCall: (toolCallId: string, updates: Partial<ToolCallStatus>) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(toolCallId);
      if (existing) {
        newToolCalls.set(toolCallId, { ...existing, ...updates });
      }
      return { toolCalls: newToolCalls };
    });
  },

  // Complete a tool call
  completeToolCall: (toolCallId: string, result: string, success: boolean) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(toolCallId);
      if (existing) {
        newToolCalls.set(toolCallId, {
          ...existing,
          status: success ? 'completed' : 'failed',
          result: success ? result : undefined,
          error: success ? undefined : result,
        });
      }
      return { toolCalls: newToolCalls };
    });
  },

  // Clear all tool calls
  clearToolCalls: () => {
    set({ toolCalls: new Map() });
  },
}));
