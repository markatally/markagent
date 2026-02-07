import { create } from 'zustand';
import type { Message, ToolResult, Artifact, TableIR, TableIRSchema } from '@mark/shared';

interface ToolCallStatus {
  sessionId: string;
  messageId?: string;
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

interface ReasoningStep {
  stepId: string;
  label: string;
  status: 'running' | 'completed';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  message?: string;
  thinkingContent?: string;
  details?: {
    queries?: string[];
    sources?: string[];
    toolName?: string;
  };
}

/**
 * Streaming table state - represents a table that is still being streamed.
 * Contains schema (known upfront) but may not have complete data.
 */
interface StreamingTableState {
  tableId: string;
  schema: TableIRSchema;
  caption?: string;
  isStreaming: true;
}

/**
 * Completed table state - represents a fully streamed table.
 */
interface CompletedTableState {
  tableId: string;
  table: TableIR;
  isStreaming: false;
}

const SIDEBAR_OPEN_STORAGE_KEY = 'sidebar-open';

const getInitialSidebarOpen = () => {
  const stored = localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
  if (stored === null) return true;
  return stored === 'true';
};

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

  // Reasoning steps by session ID
  reasoningSteps: Map<string, ReasoningStep[]>;

  // File artifacts by session ID (for file.created events)
  files: Map<string, Artifact[]>;

  // Table blocks state (by tableId)
  // Streaming tables have schema but incomplete data
  streamingTables: Map<string, StreamingTableState>;
  // Completed tables have full TableIR data
  completedTables: Map<string, CompletedTableState>;

  // Inspector UI state
  inspectorOpen: boolean;
  inspectorTab: 'reasoning' | 'tools' | 'sources';
  sidebarOpen: boolean;
  selectedMessageId: string | null;

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
  startToolCall: (sessionId: string, toolCallId: string, toolName: string, params: any) => void;
  updateToolCall: (toolCallId: string, updates: Partial<ToolCallStatus>) => void;
  updateToolCallProgress: (toolCallId: string, current: number, total: number, message?: string) => void;
  completeToolCall: (toolCallId: string, result: ToolResult) => void;
  associateToolCallsWithMessage: (sessionId: string, messageId: string) => void;
  clearToolCalls: (sessionId?: string) => void;

  // Actions - Reasoning steps
  addReasoningStep: (sessionId: string, step: ReasoningStep) => void;
  updateReasoningStep: (sessionId: string, stepId: string, updates: Partial<ReasoningStep>) => void;
  completeReasoningStep: (sessionId: string, stepId: string, completedAt: number) => void;
  clearReasoningSteps: (sessionId?: string) => void;

  // Actions - Files
  addFileArtifact: (sessionId: string, artifact: Artifact) => void;
  clearFiles: (sessionId: string) => void;

  // Actions - Table blocks
  startTableBlock: (tableId: string, schema: TableIRSchema, caption?: string) => void;
  completeTableBlock: (tableId: string, table: TableIR) => void;
  getTableState: (tableId: string) => StreamingTableState | CompletedTableState | null;
  clearTables: () => void;

  // Actions - Inspector
  setInspectorOpen: (open: boolean) => void;
  setInspectorTab: (tab: 'reasoning' | 'tools' | 'sources') => void;
  setSidebarOpen: (open: boolean) => void;
  setSelectedMessageId: (messageId: string | null) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  messages: new Map(),
  streamingSessionId: null,
  streamingContent: '',
  isStreaming: false,
  isThinking: false,
  toolCalls: new Map(),
  reasoningSteps: new Map(),
  files: new Map(),
  streamingTables: new Map(),
  completedTables: new Map(),
  inspectorOpen: false,
  inspectorTab: 'tools',
  sidebarOpen: getInitialSidebarOpen(),
  selectedMessageId: null,

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
      selectedMessageId: null, // Clear message selection so inspector shows live data
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
  startToolCall: (sessionId: string, toolCallId: string, toolName: string, params: any) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      newToolCalls.set(toolCallId, {
        sessionId,
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

  // Associate tool calls with a completed assistant message
  associateToolCallsWithMessage: (sessionId: string, messageId: string) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      for (const [toolCallId, toolCall] of newToolCalls.entries()) {
        if (toolCall.sessionId === sessionId && !toolCall.messageId) {
          newToolCalls.set(toolCallId, { ...toolCall, messageId });
        }
      }
      return { toolCalls: newToolCalls };
    });
  },

  // Clear all tool calls
  clearToolCalls: (sessionId?: string) => {
    if (!sessionId) {
      set({ toolCalls: new Map() });
      return;
    }

    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      for (const [toolCallId, toolCall] of newToolCalls.entries()) {
        if (toolCall.sessionId === sessionId) {
          newToolCalls.delete(toolCallId);
        }
      }
      return { toolCalls: newToolCalls };
    });
  },

  // Add a reasoning step
  addReasoningStep: (sessionId: string, step: ReasoningStep) => {
    set((state) => {
      const newReasoningSteps = new Map(state.reasoningSteps);
      const stepsForSession = newReasoningSteps.get(sessionId) || [];
      newReasoningSteps.set(sessionId, [...stepsForSession, step]);
      return { reasoningSteps: newReasoningSteps };
    });
  },

  // Update a reasoning step
  updateReasoningStep: (sessionId: string, stepId: string, updates: Partial<ReasoningStep>) => {
    set((state) => {
      const newReasoningSteps = new Map(state.reasoningSteps);
      const stepsForSession = newReasoningSteps.get(sessionId) || [];
      const updatedSteps = stepsForSession.map((step) =>
        step.stepId === stepId ? { ...step, ...updates } : step
      );
      newReasoningSteps.set(sessionId, updatedSteps);
      return { reasoningSteps: newReasoningSteps };
    });
  },

  // Complete a reasoning step
  completeReasoningStep: (sessionId: string, stepId: string, completedAt: number) => {
    set((state) => {
      const newReasoningSteps = new Map(state.reasoningSteps);
      const stepsForSession = newReasoningSteps.get(sessionId) || [];
      const updatedSteps = stepsForSession.map((step) => {
        if (step.stepId !== stepId) return step;
        const durationMs = completedAt - step.startedAt;
        return {
          ...step,
          status: 'completed',
          completedAt,
          durationMs,
        };
      });
      newReasoningSteps.set(sessionId, updatedSteps);
      return { reasoningSteps: newReasoningSteps };
    });
  },

  // Clear reasoning steps
  clearReasoningSteps: (sessionId?: string) => {
    if (!sessionId) {
      set({ reasoningSteps: new Map() });
      return;
    }

    set((state) => {
      const newReasoningSteps = new Map(state.reasoningSteps);
      newReasoningSteps.delete(sessionId);
      return { reasoningSteps: newReasoningSteps };
    });
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

  // Start a table block (table.start event)
  startTableBlock: (tableId: string, schema: TableIRSchema, caption?: string) => {
    set((state) => {
      const newStreamingTables = new Map(state.streamingTables);
      newStreamingTables.set(tableId, {
        tableId,
        schema,
        caption,
        isStreaming: true,
      });
      return { streamingTables: newStreamingTables };
    });
  },

  // Complete a table block (table.complete event)
  completeTableBlock: (tableId: string, table: TableIR) => {
    set((state) => {
      // Remove from streaming tables
      const newStreamingTables = new Map(state.streamingTables);
      newStreamingTables.delete(tableId);

      // Add to completed tables
      const newCompletedTables = new Map(state.completedTables);
      newCompletedTables.set(tableId, {
        tableId,
        table,
        isStreaming: false,
      });

      return {
        streamingTables: newStreamingTables,
        completedTables: newCompletedTables,
      };
    });
  },

  // Get table state by ID (for rendering)
  getTableState: (tableId: string) => {
    const state = get();
    return (
      state.completedTables.get(tableId) ||
      state.streamingTables.get(tableId) ||
      null
    );
  },

  // Clear all tables (on stream end or session change)
  clearTables: () => {
    set({
      streamingTables: new Map(),
      completedTables: new Map(),
    });
  },

  setInspectorOpen: (open: boolean) => {
    set({ inspectorOpen: open });
  },

  setInspectorTab: (tab: 'reasoning' | 'tools' | 'sources') => {
    set({ inspectorTab: tab });
  },

  setSidebarOpen: (open: boolean) => {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open));
    set({ sidebarOpen: open });
  },

  setSelectedMessageId: (messageId: string | null) => {
    set({ selectedMessageId: messageId });
  },
}));
