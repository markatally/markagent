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
  startedAt?: number;
  completedAt?: number;
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
  traceId?: string;
  stepIndex?: number;
  label: string;
  status: 'running' | 'completed' | 'failed' | 'canceled';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  lastEventSeq?: number;
  message?: string;
  thinkingContent?: string;
  details?: {
    queries?: string[];
    sources?: string[];
    toolName?: string;
  };
}

interface ReasoningLateEvent {
  eventId: string;
  traceId: string;
  stepId: string;
  stepIndex: number;
  eventSeq: number;
  lifecycle: 'STARTED' | 'UPDATED' | 'FINISHED';
  reason: 'terminal_step' | 'invalid_sequence' | 'active_lock' | 'invalid_transition';
  timestamp: number;
}

interface ReasoningTraceEvent {
  eventId: string;
  traceId: string;
  stepId: string;
  stepIndex: number;
  eventSeq: number;
  lifecycle: 'STARTED' | 'UPDATED' | 'FINISHED';
  timestamp: number;
  label: string;
  message?: string;
  thinkingContent?: string;
  details?: {
    queries?: string[];
    sources?: string[];
    toolName?: string;
  };
  finalStatus?: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
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
const RUNTIME_STATE_PREFIX = 'mark-agent-runtime-';
const LEGACY_RECONSTRUCTED_SNAPSHOT_MARKER = 'Snapshot unavailable (reconstructed from history)';

function getToolCallStoreKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

function compareReasoningEvents(a: ReasoningTraceEvent, b: ReasoningTraceEvent): number {
  if (a.stepIndex !== b.stepIndex) return a.stepIndex - b.stepIndex;
  if (a.eventSeq !== b.eventSeq) return a.eventSeq - b.eventSeq;
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.eventId.localeCompare(b.eventId);
}

function isReasoningStepTerminal(status: ReasoningStep['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

function toUiReasoningStatus(finalStatus?: ReasoningTraceEvent['finalStatus']): ReasoningStep['status'] {
  if (finalStatus === 'FAILED') return 'failed';
  if (finalStatus === 'CANCELED') return 'canceled';
  return 'completed';
}

function isLegacyReconstructedSnapshotDataUrl(value: string): boolean {
  if (!value.startsWith('data:image/svg+xml')) return false;
  if (value.includes(encodeURIComponent(LEGACY_RECONSTRUCTED_SNAPSHOT_MARKER))) return true;
  if (value.includes(LEGACY_RECONSTRUCTED_SNAPSHOT_MARKER)) return true;
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return false;
  try {
    return decodeURIComponent(value.slice(commaIndex + 1)).includes(LEGACY_RECONSTRUCTED_SNAPSHOT_MARKER);
  } catch {
    return false;
  }
}

function normalizePersistedScreenshot(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Data URLs are safe to keep as-is.
  if (trimmed.startsWith('data:image/')) {
    // Old relogin reconstruction stored synthetic placeholders as screenshots.
    // Drop those so the UI falls back to real history screenshots or explicit placeholder text.
    if (isLegacyReconstructedSnapshotDataUrl(trimmed)) return undefined;
    return trimmed;
  }

  // Legacy bug: nested data URL prefix accidentally persisted.
  const nestedPrefixMatch = trimmed.match(
    /^data:image\/[a-zA-Z0-9+.-]+;base64,(data:image\/[a-zA-Z0-9+.-]+;base64,.*)$/
  );
  if (nestedPrefixMatch?.[1]) return nestedPrefixMatch[1];

  // Blob URLs do not survive reload; drop them instead of rendering a black frame.
  if (trimmed.startsWith('blob:')) return undefined;

  // Legacy snapshots were sometimes stored as raw base64 payloads.
  const compact = trimmed.replace(/\s+/g, '');
  if (compact.length >= 64 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    return `data:image/jpeg;base64,${compact}`;
  }

  return undefined;
}

function sanitizePersistedBrowserSession(session: BrowserSessionState): BrowserSessionState {
  const actions = Array.isArray(session.actions)
    ? session.actions.map((action) => ({
        ...action,
        screenshotDataUrl: normalizePersistedScreenshot(action.screenshotDataUrl),
      }))
    : [];

  const currentActionIndex =
    actions.length === 0
      ? 0
      : Math.max(0, Math.min(Number(session.currentActionIndex) || 0, actions.length - 1));

  const status =
    session.status === 'idle' ||
    session.status === 'launching' ||
    session.status === 'active' ||
    session.status === 'closed'
      ? session.status
      : session.active
        ? 'active'
        : 'closed';

  return {
    ...session,
    status,
    actions,
    currentActionIndex,
  };
}

function sanitizePersistedAgentSteps(state: AgentStepTimelineState): AgentStepTimelineState {
  const steps = Array.isArray(state.steps)
    ? state.steps.map((step, index) => ({
        ...step,
        stepIndex: typeof step.stepIndex === 'number' && step.stepIndex >= 0 ? step.stepIndex : index,
        snapshot: step.snapshot
          ? {
              ...step.snapshot,
              stepIndex:
                typeof step.snapshot.stepIndex === 'number' && step.snapshot.stepIndex >= 0
                  ? step.snapshot.stepIndex
                  : index,
              screenshot: normalizePersistedScreenshot(step.snapshot.screenshot),
            }
          : step.snapshot,
      }))
    : [];

  const currentStepIndex =
    steps.length === 0
      ? 0
      : Math.max(0, Math.min(Number(state.currentStepIndex) || 0, steps.length - 1));

  return {
    steps,
    currentStepIndex,
  };
}

function sanitizePersistedPipelineState(state: PptPipelineState): PptPipelineState {
  const browseActivity = Array.isArray(state.browseActivity)
    ? state.browseActivity.map((item) => ({
        ...item,
        screenshotDataUrl: normalizePersistedScreenshot(item.screenshotDataUrl),
      }))
    : [];
  return {
    ...state,
    browseActivity,
  };
}

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
  reasoningActiveStepId: Map<string, string | null>;
  reasoningLastStepIndex: Map<string, number>;
  reasoningSeenEventIds: Map<string, Set<string>>;
  reasoningPendingEvents: Map<string, ReasoningTraceEvent[]>;
  reasoningLateEventLog: Map<string, ReasoningLateEvent[]>;
  reasoningLastTimestamp: Map<string, number>;

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
  // Start index of the current in-flight run within agentSteps[sessionId].steps
  agentRunStartIndex: Map<string, number>;

  // Actions - Messages
  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  clearMessages: (sessionId: string) => void;

  // Actions - Session lifecycle
  resetForSession: (sessionId: string) => void;
  stopStreamingForSession: (sessionId: string) => void;

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
  updateToolCall: (sessionId: string, toolCallId: string, updates: Partial<ToolCallStatus>) => void;
  updateToolCallProgress: (
    sessionId: string,
    toolCallId: string,
    current: number,
    total: number,
    message?: string
  ) => void;
  completeToolCall: (sessionId: string, toolCallId: string, result: ToolResult) => void;
  associateToolCallsWithMessage: (sessionId: string, messageId: string) => void;
  clearToolCalls: (sessionId?: string) => void;

  // Actions - Reasoning steps
  addReasoningStep: (sessionId: string, step: ReasoningStep) => void;
  updateReasoningStep: (sessionId: string, stepId: string, updates: Partial<ReasoningStep>) => void;
  completeReasoningStep: (sessionId: string, stepId: string, completedAt: number) => void;
  applyReasoningEvent: (sessionId: string, event: ReasoningTraceEvent) => void;
  finalizeReasoningTrace: (sessionId: string, completedAt?: number) => void;
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
  setAgentRunStartIndex: (sessionId: string) => void;
  associateAgentStepsWithMessage: (sessionId: string, messageId: string) => void;
  clearAgentSteps: (sessionId: string) => void;
  loadComputerStateFromStorage: (sessionId: string) => void;
  loadRuntimeStateFromStorage: (sessionId: string) => void;
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

function persistRuntimeState(get: () => ChatState, sessionId: string) {
  try {
    if (typeof localStorage === 'undefined') return;
    const state = get();
    const data = {
      toolCalls: Array.from(state.toolCalls.values()).filter((call) => call.sessionId === sessionId),
      reasoningSteps: state.reasoningSteps.get(sessionId) ?? [],
      isStreaming: state.isStreaming && state.streamingSessionId === sessionId,
      streamingContent:
        state.isStreaming && state.streamingSessionId === sessionId ? state.streamingContent : '',
      isThinking: state.isStreaming && state.streamingSessionId === sessionId ? state.isThinking : false,
      updatedAt: Date.now(),
    };
    localStorage.setItem(RUNTIME_STATE_PREFIX + sessionId, JSON.stringify(data));
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
  reasoningActiveStepId: new Map(),
  reasoningLastStepIndex: new Map(),
  reasoningSeenEventIds: new Map(),
  reasoningPendingEvents: new Map(),
  reasoningLateEventLog: new Map(),
  reasoningLastTimestamp: new Map(),
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
  agentRunStartIndex: new Map(),

  // Comprehensive session-scoped state reset for session switches
  resetForSession: (sessionId: string) => {
    set((state) => {
      const toolCalls = new Map(state.toolCalls);
      for (const [toolCallId, toolCall] of toolCalls.entries()) {
        if (toolCall.sessionId === sessionId) {
          toolCalls.delete(toolCallId);
        }
      }

      const reasoningSteps = new Map(state.reasoningSteps);
      const reasoningActiveStepId = new Map(state.reasoningActiveStepId);
      const reasoningLastStepIndex = new Map(state.reasoningLastStepIndex);
      const reasoningSeenEventIds = new Map(state.reasoningSeenEventIds);
      const reasoningPendingEvents = new Map(state.reasoningPendingEvents);
      const reasoningLateEventLog = new Map(state.reasoningLateEventLog);
      const reasoningLastTimestamp = new Map(state.reasoningLastTimestamp);
      reasoningSteps.delete(sessionId);
      reasoningActiveStepId.delete(sessionId);
      reasoningLastStepIndex.delete(sessionId);
      reasoningSeenEventIds.delete(sessionId);
      reasoningPendingEvents.delete(sessionId);
      reasoningLateEventLog.delete(sessionId);
      reasoningLastTimestamp.delete(sessionId);

      const files = new Map(state.files);
      files.delete(sessionId);

      const pptPipeline = new Map(state.pptPipeline);
      pptPipeline.delete(sessionId);

      const isPptTask = new Map(state.isPptTask);
      isPptTask.delete(sessionId);

      const browserSession = new Map(state.browserSession);
      browserSession.delete(sessionId);

      const terminalLines = new Map(state.terminalLines);
      terminalLines.delete(sessionId);

      const executionSteps = new Map(state.executionSteps);
      executionSteps.delete(sessionId);

      const sandboxFiles = new Map(state.sandboxFiles);
      sandboxFiles.delete(sessionId);

      const agentSteps = new Map(state.agentSteps);
      agentSteps.delete(sessionId);

      const agentRunStartIndex = new Map(state.agentRunStartIndex);
      agentRunStartIndex.delete(sessionId);

      return {
        toolCalls,
        reasoningSteps,
        reasoningActiveStepId,
        reasoningLastStepIndex,
        reasoningSeenEventIds,
        reasoningPendingEvents,
        reasoningLateEventLog,
        reasoningLastTimestamp,
        files,
        streamingTables: new Map(),
        completedTables: new Map(),
        pptPipeline,
        isPptTask,
        browserSession,
        terminalLines,
        executionSteps,
        sandboxFiles,
        agentSteps,
        agentRunStartIndex,
        selectedMessageId: null,
      };
    });
  },

  // Only stop streaming if it belongs to the specified session
  stopStreamingForSession: (sessionId: string) => {
    const state = get();
    if (state.streamingSessionId === sessionId) {
      set({ streamingSessionId: null, streamingContent: '', isStreaming: false, isThinking: false });
    }
  },

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
    persistRuntimeState(get, sessionId);
  },

  // Append content to streaming message
  appendStreamingContent: (content: string) => {
    set((state) => ({
      streamingContent: state.streamingContent + content,
      isThinking: false, // First token arrived, no longer thinking
    }));
    const activeSessionId = get().streamingSessionId;
    if (activeSessionId) {
      persistRuntimeState(get, activeSessionId);
    }
  },

  // Finalize streaming message
  finalizeStreamingMessage: (_messageId: string, message: Message) => {
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
    if (streamingSessionId) {
      persistRuntimeState(get, streamingSessionId);
    }
  },

  // Stop streaming
  stopStreaming: () => {
    const activeSessionId = get().streamingSessionId;
    set({
      streamingSessionId: null,
      streamingContent: '',
      isStreaming: false,
      isThinking: false,
    });
    if (activeSessionId) {
      persistRuntimeState(get, activeSessionId);
    }
  },

  // Set thinking state (used for multi-step tool execution)
  setThinking: (isThinking: boolean) => {
    set({ isThinking });
    const activeSessionId = get().streamingSessionId;
    if (activeSessionId) {
      persistRuntimeState(get, activeSessionId);
    }
  },

  // Start a tool call
  startToolCall: (sessionId: string, toolCallId: string, toolName: string, params: any) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(getToolCallStoreKey(sessionId, toolCallId));
      newToolCalls.set(getToolCallStoreKey(sessionId, toolCallId), {
        ...existing,
        sessionId,
        messageId: existing?.messageId,
        toolCallId,
        toolName,
        params,
        status: 'running',
        startedAt: existing?.startedAt ?? Date.now(),
        completedAt: undefined,
        error: undefined,
      });
      return { toolCalls: newToolCalls };
    });
    persistRuntimeState(get, sessionId);
  },

  // Upsert a tool call (used for persisted hydration and safe refresh behavior)
  upsertToolCall: (toolCall: ToolCallStatus) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const storeKey = getToolCallStoreKey(toolCall.sessionId, toolCall.toolCallId);
      const existing = newToolCalls.get(storeKey);
      const mergedStartedAt =
        toolCall.startedAt ??
        existing?.startedAt ??
        (toolCall.status === 'running' ? Date.now() : undefined);
      const mergedCompletedAt =
        toolCall.completedAt ??
        existing?.completedAt ??
        (toolCall.status === 'completed' || toolCall.status === 'failed' ? Date.now() : undefined);
      newToolCalls.set(
        storeKey,
        existing
          ? { ...existing, ...toolCall, startedAt: mergedStartedAt, completedAt: mergedCompletedAt }
          : { ...toolCall, startedAt: mergedStartedAt, completedAt: mergedCompletedAt }
      );
      return { toolCalls: newToolCalls };
    });
    persistRuntimeState(get, toolCall.sessionId);
  },

  // Update a tool call
  updateToolCall: (sessionId: string, toolCallId: string, updates: Partial<ToolCallStatus>) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(getToolCallStoreKey(sessionId, toolCallId));
      if (existing) {
        const nextStatus = updates.status ?? existing.status;
        newToolCalls.set(getToolCallStoreKey(sessionId, toolCallId), {
          ...existing,
          ...updates,
          startedAt:
            updates.startedAt ??
            existing.startedAt ??
            (nextStatus === 'running' ? Date.now() : undefined),
          completedAt:
            updates.completedAt ??
            existing.completedAt ??
            (nextStatus === 'completed' || nextStatus === 'failed' ? Date.now() : undefined),
        });
      }
      return { toolCalls: newToolCalls };
    });
    persistRuntimeState(get, sessionId);
  },

  // Update tool call progress
  updateToolCallProgress: (
    sessionId: string,
    toolCallId: string,
    current: number,
    total: number,
    message?: string
  ) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(getToolCallStoreKey(sessionId, toolCallId));
      if (existing) {
        newToolCalls.set(getToolCallStoreKey(sessionId, toolCallId), {
          ...existing,
          progress: { current, total, message },
        });
      }
      return { toolCalls: newToolCalls };
    });
    persistRuntimeState(get, sessionId);
  },

  // Complete a tool call
  completeToolCall: (sessionId: string, toolCallId: string, result: ToolResult) => {
    set((state) => {
      const newToolCalls = new Map(state.toolCalls);
      const existing = newToolCalls.get(getToolCallStoreKey(sessionId, toolCallId));
      if (existing) {
        const now = Date.now();
        const startedAt =
          existing.startedAt ??
          (typeof result.duration === 'number' && result.duration >= 0 ? now - result.duration : now);
        newToolCalls.set(getToolCallStoreKey(sessionId, toolCallId), {
          ...existing,
          status: result.success ? 'completed' : 'failed',
          startedAt,
          completedAt: now,
          result: result.success ? result : undefined,
          error: result.success ? undefined : result.error,
        });
      }
      return { toolCalls: newToolCalls };
    });
    persistRuntimeState(get, sessionId);
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
    persistRuntimeState(get, sessionId);
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
    persistRuntimeState(get, sessionId);
  },

  // Add a reasoning step
  addReasoningStep: (sessionId: string, step: ReasoningStep) => {
    set((state) => {
      const newReasoningSteps = new Map(state.reasoningSteps);
      const stepsForSession = newReasoningSteps.get(sessionId) || [];
      newReasoningSteps.set(
        sessionId,
        [...stepsForSession, step].sort((a, b) => {
          const aIndex = a.stepIndex ?? Number.MAX_SAFE_INTEGER;
          const bIndex = b.stepIndex ?? Number.MAX_SAFE_INTEGER;
          if (aIndex !== bIndex) return aIndex - bIndex;
          return a.startedAt - b.startedAt;
        })
      );
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
      newReasoningSteps.set(
        sessionId,
        updatedSteps.sort((a, b) => {
          const aIndex = a.stepIndex ?? Number.MAX_SAFE_INTEGER;
          const bIndex = b.stepIndex ?? Number.MAX_SAFE_INTEGER;
          if (aIndex !== bIndex) return aIndex - bIndex;
          return a.startedAt - b.startedAt;
        })
      );
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
        if (isReasoningStepTerminal(step.status)) return step;
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

  applyReasoningEvent: (sessionId: string, event: ReasoningTraceEvent) => {
    set((state) => {
      const newReasoningSteps = new Map(state.reasoningSteps);
      const newActiveStepId = new Map(state.reasoningActiveStepId);
      const newLastStepIndex = new Map(state.reasoningLastStepIndex);
      const newSeenEventIds = new Map(state.reasoningSeenEventIds);
      const newPendingEvents = new Map(state.reasoningPendingEvents);
      const newLateEventLog = new Map(state.reasoningLateEventLog);
      const newLastTimestamp = new Map(state.reasoningLastTimestamp);

      const stepsForSession = [...(newReasoningSteps.get(sessionId) || [])];
      const seen = new Set(newSeenEventIds.get(sessionId) || []);
      if (seen.has(event.eventId)) {
        return state;
      }
      seen.add(event.eventId);
      newSeenEventIds.set(sessionId, seen);

      const pending = [...(newPendingEvents.get(sessionId) || []), event].sort(compareReasoningEvents);
      const lateEvents = [...(newLateEventLog.get(sessionId) || [])];
      let activeStepId = newActiveStepId.get(sessionId) || null;
      let lastTerminalStepIndex = newLastStepIndex.get(sessionId) || 0;
      let lastTimestamp = newLastTimestamp.get(sessionId) || 0;

      const appendLateEvent = (
        pendingEvent: ReasoningTraceEvent,
        reason: ReasoningLateEvent['reason']
      ) => {
        lateEvents.push({
          eventId: pendingEvent.eventId,
          traceId: pendingEvent.traceId,
          stepId: pendingEvent.stepId,
          stepIndex: pendingEvent.stepIndex,
          eventSeq: pendingEvent.eventSeq,
          lifecycle: pendingEvent.lifecycle,
          reason,
          timestamp: pendingEvent.timestamp,
        });
      };

      let madeProgress = true;
      while (madeProgress) {
        madeProgress = false;

        for (let i = 0; i < pending.length; i += 1) {
          const pendingEvent = pending[i];
          const stepIdx = stepsForSession.findIndex((step) => step.stepId === pendingEvent.stepId);
          const step = stepIdx >= 0 ? stepsForSession[stepIdx] : undefined;
          const expectedStepIndex = lastTerminalStepIndex + 1;

          if (step && isReasoningStepTerminal(step.status)) {
            appendLateEvent(pendingEvent, 'terminal_step');
            pending.splice(i, 1);
            madeProgress = true;
            break;
          }

          const lastEventSeq = step?.lastEventSeq ?? 0;
          if (pendingEvent.eventSeq <= lastEventSeq) {
            appendLateEvent(pendingEvent, 'invalid_sequence');
            pending.splice(i, 1);
            madeProgress = true;
            break;
          }

          if (activeStepId && pendingEvent.stepId !== activeStepId) {
            continue;
          }

          if (!activeStepId && pendingEvent.stepIndex !== expectedStepIndex) {
            if (pendingEvent.stepIndex < expectedStepIndex) {
              appendLateEvent(pendingEvent, 'invalid_sequence');
              pending.splice(i, 1);
              madeProgress = true;
              break;
            }
            continue;
          }

          if (!step && pendingEvent.lifecycle !== 'STARTED') {
            continue;
          }

          const monotonicTimestamp = Math.max(pendingEvent.timestamp, lastTimestamp + 1);
          lastTimestamp = monotonicTimestamp;

          if (pendingEvent.lifecycle === 'STARTED') {
            if (activeStepId && activeStepId !== pendingEvent.stepId) {
              appendLateEvent(pendingEvent, 'active_lock');
              pending.splice(i, 1);
              madeProgress = true;
              break;
            }

            if (!step) {
              stepsForSession.push({
                stepId: pendingEvent.stepId,
                traceId: pendingEvent.traceId,
                stepIndex: pendingEvent.stepIndex,
                label: pendingEvent.label,
                status: 'running',
                startedAt: monotonicTimestamp,
                message: pendingEvent.message,
                thinkingContent: pendingEvent.thinkingContent,
                details: pendingEvent.details,
                lastEventSeq: pendingEvent.eventSeq,
              });
            } else {
              step.label = pendingEvent.label;
              step.status = 'running';
              step.message = pendingEvent.message;
              step.thinkingContent = pendingEvent.thinkingContent ?? step.thinkingContent;
              step.details = pendingEvent.details ?? step.details;
              step.lastEventSeq = pendingEvent.eventSeq;
            }

            activeStepId = pendingEvent.stepId;
            pending.splice(i, 1);
            madeProgress = true;
            break;
          }

          if (pendingEvent.lifecycle === 'UPDATED') {
            if (!step || step.status !== 'running' || activeStepId !== pendingEvent.stepId) {
              appendLateEvent(pendingEvent, 'invalid_transition');
              pending.splice(i, 1);
              madeProgress = true;
              break;
            }

            step.label = pendingEvent.label;
            step.message = pendingEvent.message;
            step.thinkingContent = pendingEvent.thinkingContent ?? step.thinkingContent;
            step.details = pendingEvent.details ?? step.details;
            step.lastEventSeq = pendingEvent.eventSeq;
            pending.splice(i, 1);
            madeProgress = true;
            break;
          }

          if (pendingEvent.lifecycle === 'FINISHED') {
            if (!step || step.status !== 'running' || activeStepId !== pendingEvent.stepId) {
              appendLateEvent(pendingEvent, 'invalid_transition');
              pending.splice(i, 1);
              madeProgress = true;
              break;
            }

            const completedAt = Math.max(monotonicTimestamp, step.startedAt);
            step.label = pendingEvent.label;
            step.status = toUiReasoningStatus(pendingEvent.finalStatus);
            step.completedAt = completedAt;
            step.durationMs = completedAt - step.startedAt;
            step.message = pendingEvent.message;
            step.thinkingContent = pendingEvent.thinkingContent ?? step.thinkingContent;
            step.details = pendingEvent.details ?? step.details;
            step.lastEventSeq = pendingEvent.eventSeq;

            activeStepId = null;
            lastTerminalStepIndex = Math.max(lastTerminalStepIndex, pendingEvent.stepIndex);
            pending.splice(i, 1);
            madeProgress = true;
            break;
          }
        }
      }

      stepsForSession.sort((a, b) => {
        const aIndex = a.stepIndex ?? Number.MAX_SAFE_INTEGER;
        const bIndex = b.stepIndex ?? Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.startedAt - b.startedAt;
      });

      newReasoningSteps.set(sessionId, stepsForSession);
      newActiveStepId.set(sessionId, activeStepId);
      newLastStepIndex.set(sessionId, lastTerminalStepIndex);
      newPendingEvents.set(sessionId, pending);
      newLateEventLog.set(sessionId, lateEvents);
      newLastTimestamp.set(sessionId, lastTimestamp);

      return {
        reasoningSteps: newReasoningSteps,
        reasoningActiveStepId: newActiveStepId,
        reasoningLastStepIndex: newLastStepIndex,
        reasoningSeenEventIds: newSeenEventIds,
        reasoningPendingEvents: newPendingEvents,
        reasoningLateEventLog: newLateEventLog,
        reasoningLastTimestamp: newLastTimestamp,
      };
    });
    persistRuntimeState(get, sessionId);
  },

  finalizeReasoningTrace: (sessionId: string, completedAt?: number) => {
    set((state) => {
      const newReasoningSteps = new Map(state.reasoningSteps);
      const newActiveStepId = new Map(state.reasoningActiveStepId);
      const newPendingEvents = new Map(state.reasoningPendingEvents);
      const newLateEventLog = new Map(state.reasoningLateEventLog);
      const newLastTimestamp = new Map(state.reasoningLastTimestamp);
      const newLastStepIndex = new Map(state.reasoningLastStepIndex);

      const stepsForSession = [...(newReasoningSteps.get(sessionId) || [])];
      if (stepsForSession.length === 0 && !(newPendingEvents.get(sessionId)?.length)) {
        newActiveStepId.set(sessionId, null);
        return {
          reasoningActiveStepId: newActiveStepId,
        };
      }

      let lastTimestamp = newLastTimestamp.get(sessionId) || 0;
      const terminalAtBase = Math.max(completedAt ?? Date.now(), lastTimestamp + 1);
      let terminalAtCursor = terminalAtBase;

      for (const step of stepsForSession) {
        if (step.status !== 'running') continue;
        const doneAt = Math.max(step.startedAt, terminalAtCursor);
        step.status = 'completed';
        step.completedAt = doneAt;
        step.durationMs = doneAt - step.startedAt;
        terminalAtCursor += 1;
      }

      const pending = newPendingEvents.get(sessionId) || [];
      if (pending.length > 0) {
        const lateEvents = [...(newLateEventLog.get(sessionId) || [])];
        for (const pendingEvent of pending) {
          lateEvents.push({
            eventId: pendingEvent.eventId,
            traceId: pendingEvent.traceId,
            stepId: pendingEvent.stepId,
            stepIndex: pendingEvent.stepIndex,
            eventSeq: pendingEvent.eventSeq,
            lifecycle: pendingEvent.lifecycle,
            reason: 'invalid_transition',
            timestamp: pendingEvent.timestamp,
          });
        }
        newLateEventLog.set(sessionId, lateEvents);
      }

      stepsForSession.sort((a, b) => {
        const aIndex = a.stepIndex ?? Number.MAX_SAFE_INTEGER;
        const bIndex = b.stepIndex ?? Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.startedAt - b.startedAt;
      });

      const lastTerminal = stepsForSession
        .filter((step) => isReasoningStepTerminal(step.status))
        .reduce((max, step) => Math.max(max, step.stepIndex ?? 0), 0);

      newReasoningSteps.set(sessionId, stepsForSession);
      newActiveStepId.set(sessionId, null);
      newPendingEvents.set(sessionId, []);
      newLastTimestamp.set(sessionId, Math.max(lastTimestamp, terminalAtCursor - 1));
      newLastStepIndex.set(sessionId, lastTerminal);

      return {
        reasoningSteps: newReasoningSteps,
        reasoningActiveStepId: newActiveStepId,
        reasoningPendingEvents: newPendingEvents,
        reasoningLateEventLog: newLateEventLog,
        reasoningLastTimestamp: newLastTimestamp,
        reasoningLastStepIndex: newLastStepIndex,
      };
    });
    persistRuntimeState(get, sessionId);
  },

  // Clear reasoning steps
  clearReasoningSteps: (sessionId?: string) => {
    if (!sessionId) {
      set({
        reasoningSteps: new Map(),
        reasoningActiveStepId: new Map(),
        reasoningLastStepIndex: new Map(),
        reasoningSeenEventIds: new Map(),
        reasoningPendingEvents: new Map(),
        reasoningLateEventLog: new Map(),
        reasoningLastTimestamp: new Map(),
      });
      return;
    }

    set((state) => {
      const newReasoningSteps = new Map(state.reasoningSteps);
      const newActiveStepId = new Map(state.reasoningActiveStepId);
      const newLastStepIndex = new Map(state.reasoningLastStepIndex);
      const newSeenEventIds = new Map(state.reasoningSeenEventIds);
      const newPendingEvents = new Map(state.reasoningPendingEvents);
      const newLateEventLog = new Map(state.reasoningLateEventLog);
      const newLastTimestamp = new Map(state.reasoningLastTimestamp);
      newReasoningSteps.delete(sessionId);
      newActiveStepId.delete(sessionId);
      newLastStepIndex.delete(sessionId);
      newSeenEventIds.delete(sessionId);
      newPendingEvents.delete(sessionId);
      newLateEventLog.delete(sessionId);
      newLastTimestamp.delete(sessionId);
      return {
        reasoningSteps: newReasoningSteps,
        reasoningActiveStepId: newActiveStepId,
        reasoningLastStepIndex: newLastStepIndex,
        reasoningSeenEventIds: newSeenEventIds,
        reasoningPendingEvents: newPendingEvents,
        reasoningLateEventLog: newLateEventLog,
        reasoningLastTimestamp: newLastTimestamp,
      };
    });
    persistRuntimeState(get, sessionId);
  },

  // Add a file artifact
  addFileArtifact: (sessionId: string, artifact: Artifact) => {
    set((state) => {
      const newFiles = new Map(state.files);
      const sessionFiles = newFiles.get(sessionId) || [];
      const exists = sessionFiles.some((existing) => {
        if (artifact.fileId && existing.fileId) {
          return existing.fileId === artifact.fileId;
        }
        return (
          existing.name === artifact.name &&
          existing.mimeType === artifact.mimeType &&
          existing.size === artifact.size
        );
      });
      if (!exists) {
        newFiles.set(sessionId, [...sessionFiles, artifact]);
      }
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

      // Dedup guard: skip if the last step has the same (type, output, snapshot.url) signature
      if (existing.steps.length > 0 && (step.stepIndex === undefined || step.stepIndex >= existing.steps.length)) {
        const last = existing.steps[existing.steps.length - 1];
        if (
          last.type === step.type &&
          (last.output ?? '') === (step.output ?? '') &&
          (last.snapshot?.url ?? '') === (step.snapshot?.url ?? '')
        ) {
          return { agentSteps };
        }
      }

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

  setAgentRunStartIndex: (sessionId: string) => {
    set((state) => {
      const agentRunStartIndex = new Map(state.agentRunStartIndex);
      const stepCount = state.agentSteps.get(sessionId)?.steps.length ?? 0;
      agentRunStartIndex.set(sessionId, stepCount);
      return { agentRunStartIndex };
    });
  },

  associateAgentStepsWithMessage: (sessionId: string, messageId: string) => {
    set((state) => {
      const agentSteps = new Map(state.agentSteps);
      const agentRunStartIndex = new Map(state.agentRunStartIndex);
      const existing = agentSteps.get(sessionId);
      if (!existing || existing.steps.length === 0) return state;
      const runStartIndex = agentRunStartIndex.get(sessionId) ?? 0;
      const clampedStart = Math.max(0, Math.min(runStartIndex, existing.steps.length));
      const steps = existing.steps.map((step, index) =>
        index >= clampedStart && !step.messageId ? { ...step, messageId } : step
      );
      agentSteps.set(sessionId, { ...existing, steps });
      // Run start marker is consumed once the assistant message is persisted.
      agentRunStartIndex.delete(sessionId);
      return { agentSteps, agentRunStartIndex };
    });
    persistComputerState(get, sessionId);
  },

  clearAgentSteps: (sessionId: string) => {
    set((state) => {
      const agentSteps = new Map(state.agentSteps);
      const agentRunStartIndex = new Map(state.agentRunStartIndex);
      agentSteps.delete(sessionId);
      agentRunStartIndex.delete(sessionId);
      return { agentSteps, agentRunStartIndex };
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
          browserSession.set(sessionId, sanitizePersistedBrowserSession(data.browserSession));
          next.browserSession = browserSession;
        }
        if (data.pptPipeline != null) {
          const pptPipeline = new Map(state.pptPipeline);
          pptPipeline.set(sessionId, sanitizePersistedPipelineState(data.pptPipeline));
          next.pptPipeline = pptPipeline;
        }
        if (data.isPptTask != null) {
          const isPptTask = new Map(state.isPptTask);
          isPptTask.set(sessionId, data.isPptTask);
          next.isPptTask = isPptTask;
        }
        if (data.agentSteps != null) {
          const agentSteps = new Map(state.agentSteps);
          agentSteps.set(sessionId, sanitizePersistedAgentSteps(data.agentSteps));
          next.agentSteps = agentSteps;
        }
        return next;
      });
    } catch (_) {
      /* ignore */
    }
  },

  loadRuntimeStateFromStorage: (sessionId: string) => {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(RUNTIME_STATE_PREFIX + sessionId);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        toolCalls?: ToolCallStatus[];
        reasoningSteps?: ReasoningStep[];
        isStreaming?: boolean;
        streamingContent?: string;
        isThinking?: boolean;
      };

      set((state) => {
        const next: Partial<ChatState> = {};

        if (Array.isArray(data.toolCalls) && data.toolCalls.length > 0) {
          const toolCalls = new Map(state.toolCalls);
          for (const toolCall of data.toolCalls) {
            if (!toolCall?.toolCallId || toolCall.sessionId !== sessionId) continue;
            toolCalls.set(getToolCallStoreKey(sessionId, toolCall.toolCallId), toolCall);
          }
          next.toolCalls = toolCalls;
        }

        if (Array.isArray(data.reasoningSteps) && data.reasoningSteps.length > 0) {
          const reasoningSteps = new Map(state.reasoningSteps);
          reasoningSteps.set(sessionId, data.reasoningSteps);
          next.reasoningSteps = reasoningSteps;
        }

        if (data.isStreaming) {
          next.streamingSessionId = sessionId;
          next.isStreaming = true;
          next.streamingContent = typeof data.streamingContent === 'string' ? data.streamingContent : '';
          next.isThinking = Boolean(data.isThinking);
          next.selectedMessageId = null;
        }

        return next;
      });
    } catch (_) {
      /* ignore */
    }
  },
}));
