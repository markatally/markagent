import { create } from 'zustand';
import type {
  Message,
  ToolResult,
  Artifact,
  TableIR,
  TableIRSchema,
  ExecutionMode,
  InspectorTab,
} from '@mark/shared';
import type {
  AgentStep,
  AgentStepTimelineState,
  BrowseActivity,
  PptPipelineStep,
  PptStep,
  PptStepStatus,
  BrowserSessionState,
  BrowserAction,
} from '../types';

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

type SandboxStatus = 'idle' | 'provisioning' | 'ready' | 'running' | 'teardown';

interface TerminalLine {
  id: string;
  stream: 'stdout' | 'stderr' | 'command';
  content: string;
  timestamp: number;
}

interface ExecutionStepUI {
  stepId: string;
  label: string;
  status: 'planned' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  toolName?: string;
  message?: string;
}

interface SandboxFileEntry {
  path: string;
  size?: number;
  mimeType?: string;
  createdAt?: number;
  updatedAt?: number;
}

interface PptPipelineState {
  steps: PptPipelineStep[];
  currentStep?: PptStep;
  browseActivity: BrowseActivity[];
  /** Set when API sends browser.unavailable (e.g. browser disabled); show key pages from search only */
  browserUnavailable?: boolean;
}

const SIDEBAR_OPEN_STORAGE_KEY = 'sidebar-open';
const EXECUTION_MODE_STORAGE_KEY = 'execution-mode';
const COMPUTER_STATE_PREFIX = 'mark-agent-computer-';

const getInitialSidebarOpen = () => {
  if (typeof localStorage === 'undefined') return true;
  const stored = localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
  if (stored === null) return true;
  return stored === 'true';
};

const getInitialExecutionMode = (): ExecutionMode => {
  if (typeof localStorage === 'undefined') return 'direct';
  const stored = localStorage.getItem(EXECUTION_MODE_STORAGE_KEY);
  return stored === 'sandbox' ? 'sandbox' : 'direct';
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
  inspectorTab: InspectorTab;
  sidebarOpen: boolean;
  selectedMessageId: string | null;

  // Execution visualization state
  executionMode: ExecutionMode;
  sandboxStatus: SandboxStatus;
  terminalLines: Map<string, TerminalLine[]>;
  executionSteps: Map<string, ExecutionStepUI[]>;
  sandboxFiles: Map<string, SandboxFileEntry[]>;

  // PPT pipeline state
  pptPipeline: Map<string, PptPipelineState>;
  isPptTask: Map<string, boolean>;

  // Browser session state (Computer mode - real browser viewport)
  browserSession: Map<string, BrowserSessionState>;
  // Unified agent step timeline (Computer mode replay/inspection)
  agentSteps: Map<string, AgentStepTimelineState>;

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
  /** Atomic upsert used when hydrating persisted tool calls on page load/refresh. */
  upsertToolCall: (toolCall: ToolCallStatus) => void;
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
  setFileArtifacts: (sessionId: string, artifacts: Artifact[]) => void;
  clearFiles: (sessionId: string) => void;

  // Actions - Table blocks
  startTableBlock: (tableId: string, schema: TableIRSchema, caption?: string) => void;
  completeTableBlock: (tableId: string, table: TableIR) => void;
  getTableState: (tableId: string) => StreamingTableState | CompletedTableState | null;
  clearTables: () => void;

  // Actions - Inspector
  setInspectorOpen: (open: boolean) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setSidebarOpen: (open: boolean) => void;
  setSelectedMessageId: (messageId: string | null) => void;

  // Actions - Execution visualization
  setExecutionMode: (mode: ExecutionMode) => void;
  setSandboxStatus: (status: SandboxStatus) => void;
  addTerminalLine: (sessionId: string, line: TerminalLine) => void;
  addExecutionStep: (sessionId: string, step: ExecutionStepUI) => void;
  updateExecutionStep: (
    sessionId: string,
    stepId: string,
    updates: Partial<ExecutionStepUI>
  ) => void;
  addSandboxFile: (sessionId: string, file: SandboxFileEntry) => void;
  clearExecutionState: (sessionId: string) => void;

  // Actions - PPT pipeline
  startPptPipeline: (sessionId: string, steps: PptPipelineStep[]) => void;
  updatePptStep: (sessionId: string, step: PptStep, status: PptStepStatus) => void;
  addBrowseActivity: (sessionId: string, activity: BrowseActivity) => void;
  setVisitScreenshot: (sessionId: string, visitIndex: number, screenshotDataUrl: string) => void;
  setPptBrowserUnavailable: (sessionId: string) => void;
  clearPptPipeline: (sessionId: string) => void;

  // Actions - Browser session
  setBrowserLaunched: (sessionId: string) => void;
  setBrowserNavigated: (sessionId: string, url: string, title?: string) => void;
  addBrowserAction: (sessionId: string, action: BrowserAction) => void;
  setBrowserActionScreenshot: (sessionId: string, screenshotDataUrl: string, actionIndex?: number) => void;
  setBrowserClosed: (sessionId: string) => void;
  setBrowserActionIndex: (sessionId: string, index: number) => void;
  clearBrowserSession: (sessionId: string) => void;
  appendAgentStep: (sessionId: string, step: Omit<AgentStep, 'stepIndex'> & { stepIndex?: number }) => void;
  updateAgentStepAt: (sessionId: string, stepIndex: number, updates: Partial<AgentStep>) => void;
  updateAgentStepSnapshotAt: (
    sessionId: string,
    stepIndex: number,
    updates: Partial<NonNullable<AgentStep['snapshot']>>
  ) => void;
  setAgentStepIndex: (sessionId: string, index: number) => void;
  clearAgentSteps: (sessionId: string) => void;
  loadComputerStateFromStorage: (sessionId: string) => void;
}

function persistComputerState(get: () => ChatState, sessionId: string) {
  try {
    if (typeof localStorage === 'undefined') return;
    const state = get();
    const data = {
      browserSession: state.browserSession.get(sessionId) ?? null,
      pptPipeline: state.pptPipeline.get(sessionId) ?? null,
      isPptTask: state.isPptTask.get(sessionId) ?? false,
      agentSteps: state.agentSteps.get(sessionId) ?? null,
    };
    localStorage.setItem(COMPUTER_STATE_PREFIX + sessionId, JSON.stringify(data));
  } catch (_) {
    /* ignore quota / parse */
  }
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
  executionMode: getInitialExecutionMode(),
  sandboxStatus: 'idle',
  terminalLines: new Map(),
  executionSteps: new Map(),
  sandboxFiles: new Map(),
  pptPipeline: new Map(),
  isPptTask: new Map(),
  browserSession: new Map(),
  agentSteps: new Map(),

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

  // Upsert a tool call (used for persisted hydration and safe refresh behavior)
  upsertToolCall: (toolCall: ToolCallStatus) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(toolCall.toolCallId);
      newToolCalls.set(
        toolCall.toolCallId,
        existing ? { ...existing, ...toolCall } : toolCall
      );
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
          status: 'completed' as const,
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

  // Set file artifacts for a session (e.g. when hydrating from API on page load)
  setFileArtifacts: (sessionId: string, artifacts: Artifact[]) => {
    set((state) => {
      const newFiles = new Map(state.files);
      newFiles.set(sessionId, artifacts);
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

  setInspectorTab: (tab: InspectorTab) => {
    set({ inspectorTab: tab });
  },

  setSidebarOpen: (open: boolean) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open));
      }
    } catch (_) {
      /* ignore */
    }
    set({ sidebarOpen: open });
  },

  setSelectedMessageId: (messageId: string | null) => {
    set({ selectedMessageId: messageId });
  },

  setExecutionMode: (mode: ExecutionMode) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, mode);
      }
    } catch (_) {
      /* ignore */
    }
    set({ executionMode: mode });
  },

  setSandboxStatus: (status: SandboxStatus) => {
    set({ sandboxStatus: status });
  },

  addTerminalLine: (sessionId: string, line: TerminalLine) => {
    set((state) => {
      const terminalLines = new Map(state.terminalLines);
      const sessionLines = terminalLines.get(sessionId) || [];
      terminalLines.set(sessionId, [...sessionLines, line]);
      return { terminalLines };
    });
  },

  addExecutionStep: (sessionId: string, step: ExecutionStepUI) => {
    set((state) => {
      const executionSteps = new Map(state.executionSteps);
      const sessionSteps = executionSteps.get(sessionId) || [];
      executionSteps.set(sessionId, [...sessionSteps, step]);
      return { executionSteps };
    });
  },

  updateExecutionStep: (sessionId: string, stepId: string, updates: Partial<ExecutionStepUI>) => {
    set((state) => {
      const executionSteps = new Map(state.executionSteps);
      const sessionSteps = executionSteps.get(sessionId) || [];
      executionSteps.set(
        sessionId,
        sessionSteps.map((step) => (step.stepId === stepId ? { ...step, ...updates } : step))
      );
      return { executionSteps };
    });
  },

  addSandboxFile: (sessionId: string, file: SandboxFileEntry) => {
    set((state) => {
      const sandboxFiles = new Map(state.sandboxFiles);
      const sessionFiles = sandboxFiles.get(sessionId) || [];
      sandboxFiles.set(sessionId, [...sessionFiles, file]);
      return { sandboxFiles };
    });
  },

  clearExecutionState: (sessionId: string) => {
    set((state) => {
      const terminalLines = new Map(state.terminalLines);
      const executionSteps = new Map(state.executionSteps);
      const sandboxFiles = new Map(state.sandboxFiles);
      terminalLines.delete(sessionId);
      executionSteps.delete(sessionId);
      sandboxFiles.delete(sessionId);
      return { terminalLines, executionSteps, sandboxFiles };
    });
  },

  startPptPipeline: (sessionId: string, steps: PptPipelineStep[]) => {
    set((state) => {
      const pptPipeline = new Map(state.pptPipeline);
      const isPptTask = new Map(state.isPptTask);
      pptPipeline.set(sessionId, {
        steps,
        currentStep: steps.find((step) => step.status === 'running')?.id,
        browseActivity: [],
      });
      isPptTask.set(sessionId, true);
      return { pptPipeline, isPptTask };
    });
    persistComputerState(get, sessionId);
  },

  updatePptStep: (sessionId: string, step: PptStep, status: PptStepStatus) => {
    set((state) => {
      const pptPipeline = new Map(state.pptPipeline);
      const pipeline = pptPipeline.get(sessionId);
      if (!pipeline) return { pptPipeline };
      const updatedSteps = pipeline.steps.map((item) =>
        item.id === step ? { ...item, status } : item
      );
      pptPipeline.set(sessionId, {
        ...pipeline,
        steps: updatedSteps,
        currentStep: status === 'running' ? step : pipeline.currentStep,
      });
      return { pptPipeline };
    });
    persistComputerState(get, sessionId);
  },

  addBrowseActivity: (sessionId: string, activity: BrowseActivity) => {
    set((state) => {
      const pptPipeline = new Map(state.pptPipeline);
      const pipeline = pptPipeline.get(sessionId);
      if (!pipeline) return { pptPipeline };
      pptPipeline.set(sessionId, {
        ...pipeline,
        browseActivity: [...pipeline.browseActivity, activity],
      });
      return { pptPipeline };
    });
    persistComputerState(get, sessionId);
  },

  setVisitScreenshot: (sessionId: string, visitIndex: number, screenshotDataUrl: string) => {
    set((state) => {
      const pptPipeline = new Map(state.pptPipeline);
      const pipeline = pptPipeline.get(sessionId);
      if (!pipeline) return { pptPipeline };
      const activity = pipeline.browseActivity;
      let visitCount = 0;
      const next = activity.map((a) => {
        if (a.action !== 'visit') return a;
        if (visitCount === visitIndex) {
          visitCount++;
          return { ...a, screenshotDataUrl };
        }
        visitCount++;
        return a;
      });
      pptPipeline.set(sessionId, { ...pipeline, browseActivity: next });
      return { pptPipeline };
    });
    persistComputerState(get, sessionId);
  },

  setPptBrowserUnavailable: (sessionId: string) => {
    set((state) => {
      const pptPipeline = new Map(state.pptPipeline);
      const pipeline = pptPipeline.get(sessionId);
      if (!pipeline) return { pptPipeline };
      pptPipeline.set(sessionId, { ...pipeline, browserUnavailable: true });
      return { pptPipeline };
    });
    persistComputerState(get, sessionId);
  },

  clearPptPipeline: (sessionId: string) => {
    set((state) => {
      const pptPipeline = new Map(state.pptPipeline);
      const isPptTask = new Map(state.isPptTask);
      pptPipeline.delete(sessionId);
      isPptTask.delete(sessionId);
      return { pptPipeline, isPptTask };
    });
    persistComputerState(get, sessionId);
  },

  setBrowserLaunched: (sessionId: string) => {
    set((state) => {
      const browserSession = new Map(state.browserSession);
      browserSession.set(sessionId, {
        active: true,
        currentUrl: '',
        currentTitle: '',
        status: 'active',
        actions: [],
        currentActionIndex: 0,
      });
      return { browserSession };
    });
    persistComputerState(get, sessionId);
  },

  setBrowserNavigated: (sessionId: string, url: string, title?: string) => {
    set((state) => {
      const browserSession = new Map(state.browserSession);
      const existing = browserSession.get(sessionId) ?? {
        active: true,
        currentUrl: '',
        currentTitle: '',
        status: 'active' as const,
        actions: [],
        currentActionIndex: 0,
      };
      browserSession.set(sessionId, {
        ...existing,
        currentUrl: url,
        currentTitle: title ?? existing.currentTitle,
      });
      return { browserSession };
    });
    persistComputerState(get, sessionId);
  },

  addBrowserAction: (sessionId: string, action: BrowserAction) => {
    set((state) => {
      const browserSession = new Map(state.browserSession);
      const existing = browserSession.get(sessionId) ?? {
        active: true,
        currentUrl: '',
        currentTitle: '',
        status: 'active' as const,
        actions: [],
        currentActionIndex: 0,
      };
      const actions = [...existing.actions, action];
      browserSession.set(sessionId, {
        ...existing,
        actions,
        currentActionIndex: actions.length - 1,
      });
      return { browserSession };
    });
    persistComputerState(get, sessionId);
  },

  /** Attach screenshot to an action. When actionIndex is omitted, uses last action (backend must emit browser.action before browser.screenshot). */
  setBrowserActionScreenshot: (sessionId: string, screenshotDataUrl: string, actionIndex?: number) => {
    set((state) => {
      const browserSession = new Map(state.browserSession);
      const existing = browserSession.get(sessionId);
      if (!existing || existing.actions.length === 0) return state;
      const actions = [...existing.actions];
      const idx =
        typeof actionIndex === 'number' && actionIndex >= 0 && actionIndex < actions.length
          ? actionIndex
          : actions.length - 1;
      actions[idx] = { ...actions[idx], screenshotDataUrl };
      browserSession.set(sessionId, { ...existing, actions });
      return { browserSession };
    });
    persistComputerState(get, sessionId);
  },

  setBrowserClosed: (sessionId: string) => {
    set((state) => {
      const browserSession = new Map(state.browserSession);
      const existing = browserSession.get(sessionId);
      if (existing) {
        browserSession.set(sessionId, { ...existing, active: false, status: 'closed' });
      }
      return { browserSession };
    });
    persistComputerState(get, sessionId);
  },

  setBrowserActionIndex: (sessionId: string, index: number) => {
    set((state) => {
      const browserSession = new Map(state.browserSession);
      const existing = browserSession.get(sessionId);
      if (!existing) return state;
      const clamped = Math.max(0, Math.min(index, existing.actions.length - 1));
      browserSession.set(sessionId, { ...existing, currentActionIndex: clamped });
      return { browserSession };
    });
  },

  appendAgentStep: (sessionId: string, step: Omit<AgentStep, 'stepIndex'> & { stepIndex?: number }) => {
    set((state) => {
      const agentSteps = new Map(state.agentSteps);
      const existing = agentSteps.get(sessionId) ?? { steps: [], currentStepIndex: 0 };
      const stepIndex =
        typeof step.stepIndex === 'number' && step.stepIndex >= 0
          ? step.stepIndex
          : existing.steps.length;
      const nextStep: AgentStep = { ...step, stepIndex };
      const steps = [...existing.steps];

      if (stepIndex < steps.length) {
        steps[stepIndex] = { ...steps[stepIndex], ...nextStep };
      } else {
        steps.push(nextStep);
      }

      agentSteps.set(sessionId, {
        steps,
        currentStepIndex: Math.max(0, steps.length - 1),
      });
      return { agentSteps };
    });
    persistComputerState(get, sessionId);
  },

  updateAgentStepAt: (sessionId: string, stepIndex: number, updates: Partial<AgentStep>) => {
    set((state) => {
      const agentSteps = new Map(state.agentSteps);
      const existing = agentSteps.get(sessionId);
      if (!existing || stepIndex < 0 || stepIndex >= existing.steps.length) return state;
      const steps = [...existing.steps];
      steps[stepIndex] = { ...steps[stepIndex], ...updates, stepIndex };
      agentSteps.set(sessionId, { ...existing, steps });
      return { agentSteps };
    });
    persistComputerState(get, sessionId);
  },

  updateAgentStepSnapshotAt: (
    sessionId: string,
    stepIndex: number,
    updates: Partial<NonNullable<AgentStep['snapshot']>>
  ) => {
    set((state) => {
      const agentSteps = new Map(state.agentSteps);
      const existing = agentSteps.get(sessionId);
      if (!existing || stepIndex < 0 || stepIndex >= existing.steps.length) return state;
      const steps = [...existing.steps];
      const target = steps[stepIndex];
      const prevSnapshot = target.snapshot ?? {
        stepIndex,
        timestamp: Date.now(),
      };
      steps[stepIndex] = {
        ...target,
        snapshot: { ...prevSnapshot, ...updates, stepIndex },
      };
      agentSteps.set(sessionId, { ...existing, steps });
      return { agentSteps };
    });
    persistComputerState(get, sessionId);
  },

  setAgentStepIndex: (sessionId: string, index: number) => {
    set((state) => {
      const agentSteps = new Map(state.agentSteps);
      const existing = agentSteps.get(sessionId);
      if (!existing) return state;
      const clamped = Math.max(0, Math.min(index, Math.max(0, existing.steps.length - 1)));
      agentSteps.set(sessionId, { ...existing, currentStepIndex: clamped });
      return { agentSteps };
    });
    persistComputerState(get, sessionId);
  },

  clearAgentSteps: (sessionId: string) => {
    set((state) => {
      const agentSteps = new Map(state.agentSteps);
      agentSteps.delete(sessionId);
      return { agentSteps };
    });
    persistComputerState(get, sessionId);
  },

  clearBrowserSession: (sessionId: string) => {
    set((state) => {
      const browserSession = new Map(state.browserSession);
      browserSession.delete(sessionId);
      return { browserSession };
    });
    persistComputerState(get, sessionId);
  },

  loadComputerStateFromStorage: (sessionId: string) => {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(COMPUTER_STATE_PREFIX + sessionId);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        browserSession?: BrowserSessionState | null;
        pptPipeline?: PptPipelineState | null;
        isPptTask?: boolean;
        agentSteps?: AgentStepTimelineState | null;
      };
      set((state) => {
        const next: Partial<ChatState> = {};
        if (data.browserSession != null) {
          const browserSession = new Map(state.browserSession);
          browserSession.set(sessionId, data.browserSession);
          next.browserSession = browserSession;
        }
        if (data.pptPipeline != null) {
          const pptPipeline = new Map(state.pptPipeline);
          pptPipeline.set(sessionId, data.pptPipeline);
          next.pptPipeline = pptPipeline;
        }
        if (data.isPptTask != null) {
          const isPptTask = new Map(state.isPptTask);
          isPptTask.set(sessionId, data.isPptTask);
          next.isPptTask = isPptTask;
        }
        if (data.agentSteps != null) {
          const agentSteps = new Map(state.agentSteps);
          agentSteps.set(sessionId, data.agentSteps);
          next.agentSteps = agentSteps;
        }
        return next;
      });
    } catch (_) {
      /* ignore */
    }
  },
}));
