import { create } from 'zustand';
import type { Message, ToolResult, Artifact } from '@mark/shared';

interface ToolCallStatus {
  toolCallId: string;
  toolName: string;
  params: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: ToolResult;
  error?: string;
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
}

interface ChatState {
  // Messages by session ID
  messages: Map<string, Message[]>;

  // Streaming state
  streamingSessionId: string | null;
  streamingContent: string;
  isStreaming: boolean;
  isThinking: boolean; // True between message.start and first token

  // Tool calls state
  toolCalls: Map<string, ToolCallStatus>;

  // File artifacts by session ID (for file.created events)
  files: Map<string, Artifact[]>;

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
  setThinking: (isThinking: boolean) => void;

  // Actions - Tool calls
  startToolCall: (toolCallId: string, toolName: string, params: any) => void;
  updateToolCall: (toolCallId: string, updates: Partial<ToolCallStatus>) => void;
  updateToolCallProgress: (toolCallId: string, current: number, total: number, message?: string) => void;
  completeToolCall: (toolCallId: string, result: ToolResult) => void;
  clearToolCalls: () => void;

  // Actions - Files
  addFileArtifact: (sessionId: string, artifact: Artifact) => void;
  clearFiles: (sessionId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  messages: new Map(),
  streamingSessionId: null,
  streamingContent: '',
  isStreaming: false,
  isThinking: false,
  toolCalls: new Map(),
  files: new Map(),

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

  // Start streaming (enters "thinking" state until first token)
  startStreaming: (sessionId: string) => {
    set({
      streamingSessionId: sessionId,
      streamingContent: '',
      isStreaming: true,
      isThinking: true, // Thinking until first token arrives
    });
  },

  // Append content to streaming message
  appendStreamingContent: (content: string) => {
    set((state) => ({
      streamingContent: state.streamingContent + content,
      isThinking: false, // First token arrived, no longer thinking
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
      isThinking: false,
    });
  },

  // Stop streaming
  stopStreaming: () => {
    set({
      streamingSessionId: null,
      streamingContent: '',
      isStreaming: false,
      isThinking: false,
    });
  },

  // Set thinking state (used for multi-step tool execution)
  setThinking: (isThinking: boolean) => {
    set({ isThinking });
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

  // Update tool call progress
  updateToolCallProgress: (toolCallId: string, current: number, total: number, message?: string) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(toolCallId);
      if (existing) {
        newToolCalls.set(toolCallId, {
          ...existing,
          progress: { current, total, message },
        });
      }
      return { toolCalls: newToolCalls };
    });
  },

  // Complete a tool call
  completeToolCall: (toolCallId: string, result: ToolResult) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(toolCallId);
      if (existing) {
        newToolCalls.set(toolCallId, {
          ...existing,
          status: result.success ? 'completed' : 'failed',
          result: result.success ? result : undefined,
          error: result.success ? undefined : result.error,
        });
      }
      return { toolCalls: newToolCalls };
    });
  },

  // Clear all tool calls
  clearToolCalls: () => {
    set({ toolCalls: new Map() });
  },

  // Add a file artifact
  addFileArtifact: (sessionId: string, artifact: Artifact) => {
    set((state) => {
      const newFiles = new Map(state.files);
      const sessionFiles = newFiles.get(sessionId) || [];
      newFiles.set(sessionId, [...sessionFiles, artifact]);
      return { files: newFiles };
    });
  },

  // Clear file artifacts for a session
  clearFiles: (sessionId: string) => {
    set((state) => {
      const newFiles = new Map(state.files);
      newFiles.delete(sessionId);
      return { files: newFiles };
    });
  },
}));
