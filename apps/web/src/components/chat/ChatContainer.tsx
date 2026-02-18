import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DocumentCanvas } from '../canvas/DocumentCanvas';
import { ChatInput } from './ChatInput';
import { apiClient, type SSEEvent, ApiError } from '../../lib/api';
import { createSSEConnection } from '../../lib/sse';
import { useChatStore } from '../../stores/chatStore';
import { useSession } from '../../hooks/useSessions';
import { useChatLayout } from '../../hooks/useChatLayout';
import { useToast } from '../../hooks/use-toast';
import { isHiddenArtifactName } from '../../lib/artifactFilters';
import {
  getBrowserActionStepByIndex,
  getVisitStepByIndex,
} from './snapshotMapping';

interface ChatContainerProps {
  sessionId: string;
  onOpenSkills?: () => void;
}

function buildPipelineStageSnapshot(
  label: string,
  status: 'running' | 'completed' | 'failed'
): string {
  const bg =
    status === 'completed' ? '#0F766E' : status === 'failed' ? '#7F1D1D' : '#1D4ED8';
  const badge =
    status === 'completed' ? '#10B981' : status === 'failed' ? '#EF4444' : '#60A5FA';
  const statusText =
    status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'In Progress';
  const safeLabel = label.replace(/[<>&"]/g, '');
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}" />
      <stop offset="100%" stop-color="#0B1220" />
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)" />
  <rect x="76" y="84" rx="24" ry="24" width="1128" height="552" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" stroke-width="2" />
  <rect x="110" y="124" rx="14" ry="14" width="220" height="48" fill="${badge}" />
  <text x="220" y="156" font-size="24" text-anchor="middle" fill="#ffffff" font-family="Calibri, Arial, sans-serif" font-weight="700">${statusText}</text>
  <text x="110" y="270" font-size="54" fill="#ffffff" font-family="Cambria, Georgia, serif" font-weight="700">${safeLabel}</text>
  <text x="110" y="336" font-size="30" fill="#D6E6FA" font-family="Calibri, Arial, sans-serif">PPT Workflow Stage Snapshot</text>
  <text x="110" y="592" font-size="22" fill="#C9D7E8" font-family="Calibri, Arial, sans-serif">Computer Mode timeline now tracks full presentation generation flow.</text>
</svg>
  `.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const PPT_PIPELINE_STAGE_ORDER = [
  'research',
  'browsing',
  'reading',
  'synthesizing',
  'generating',
  'finalizing',
] as const;
const TERMINAL_STREAM_EVENT_TYPES = new Set(['message.complete', 'session.end', 'error']);

export function ChatContainer({ sessionId, onOpenSkills }: ChatContainerProps) {
  const location = useLocation();
  const [isSending, setIsSending] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Ensure chat layout width is applied so ChatInput and DocumentRenderer share the same max-width
  useChatLayout();
  const abortControllerRef = useRef<AbortController | null>(null);
  const activePostStreamRef = useRef(false);
  const streamReconnectCleanupRef = useRef<(() => void) | null>(null);
  const initialMessageHandledRef = useRef(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const pipelineStageStepIndexRef = useRef<Map<string, number>>(new Map());

  // Verify session exists before allowing any operations
  const { data: session, isLoading: isSessionLoading, error: sessionError } = useSession(sessionId);
  const isSessionValid = !!session && !sessionError;
  const initialMessage = (location.state as { initialMessage?: string } | null)?.initialMessage;

  const addMessage = useChatStore((state) => state.addMessage);
  const startStreaming = useChatStore((state) => state.startStreaming);
  const appendStreamingContent = useChatStore((state) => state.appendStreamingContent);
  const stopStreaming = useChatStore((state) => state.stopStreaming);
  const setThinking = useChatStore((state) => state.setThinking);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const streamingSessionId = useChatStore((state) => state.streamingSessionId);
  const startToolCall = useChatStore((state) => state.startToolCall);
  const completeToolCall = useChatStore((state) => state.completeToolCall);
  const messages = useChatStore((state) => state.messages.get(sessionId) || []);
  const streamingContent = useChatStore((state) => state.streamingContent);
  const isThinking = useChatStore((state) => state.isThinking);
  const startTableBlock = useChatStore((state) => state.startTableBlock);
  const completeTableBlock = useChatStore((state) => state.completeTableBlock);
  const clearTables = useChatStore((state) => state.clearTables);
  const clearToolCalls = useChatStore((state) => state.clearToolCalls);
  const clearPptPipeline = useChatStore((state) => state.clearPptPipeline);
  const applyReasoningEvent = useChatStore((state) => state.applyReasoningEvent);
  const finalizeReasoningTrace = useChatStore((state) => state.finalizeReasoningTrace);
  const clearReasoningSteps = useChatStore((state) => state.clearReasoningSteps);
  const setInspectorTab = useChatStore((state) => state.setInspectorTab);
  const setInspectorOpen = useChatStore((state) => state.setInspectorOpen);
  const setSelectedMessageId = useChatStore((state) => state.setSelectedMessageId);
  const associateToolCallsWithMessage = useChatStore((state) => state.associateToolCallsWithMessage);
  const addFileArtifact = useChatStore((state) => state.addFileArtifact);
  const setSandboxStatus = useChatStore((state) => state.setSandboxStatus);
  const addTerminalLine = useChatStore((state) => state.addTerminalLine);
  const addExecutionStep = useChatStore((state) => state.addExecutionStep);
  const updateExecutionStep = useChatStore((state) => state.updateExecutionStep);
  const addSandboxFile = useChatStore((state) => state.addSandboxFile);
  const startPptPipeline = useChatStore((state) => state.startPptPipeline);
  const updatePptStep = useChatStore((state) => state.updatePptStep);
  const addBrowseActivity = useChatStore((state) => state.addBrowseActivity);
  const setVisitScreenshot = useChatStore((state) => state.setVisitScreenshot);
  const setPptBrowserUnavailable = useChatStore((state) => state.setPptBrowserUnavailable);
  const setBrowserLaunched = useChatStore((state) => state.setBrowserLaunched);
  const setBrowserNavigated = useChatStore((state) => state.setBrowserNavigated);
  const addBrowserAction = useChatStore((state) => state.addBrowserAction);
  const setBrowserActionScreenshot = useChatStore((state) => state.setBrowserActionScreenshot);
  const setBrowserClosed = useChatStore((state) => state.setBrowserClosed);
  const clearBrowserSession = useChatStore((state) => state.clearBrowserSession);
  const appendAgentStep = useChatStore((state) => state.appendAgentStep);
  const updateAgentStepAt = useChatStore((state) => state.updateAgentStepAt);
  const updateAgentStepSnapshotAt = useChatStore((state) => state.updateAgentStepSnapshotAt);
  const setAgentRunStartIndex = useChatStore((state) => state.setAgentRunStartIndex);
  const associateAgentStepsWithMessage = useChatStore((state) => state.associateAgentStepsWithMessage);
  const clearFiles = useChatStore((state) => state.clearFiles);
  const loadComputerStateFromStorage = useChatStore((state) => state.loadComputerStateFromStorage);
  const loadRuntimeStateFromStorage = useChatStore((state) => state.loadRuntimeStateFromStorage);
  const resetForSession = useChatStore((state) => state.resetForSession);

  // Comprehensive session-switch cleanup: abort stale streams, reset all session-scoped state,
  // rehydrate Computer tab from localStorage for the new session, and reset refs.
  useEffect(() => {
    // Stop streaming if it belongs to a DIFFERENT session
    const state = useChatStore.getState();
    if (state.isStreaming && state.streamingSessionId && state.streamingSessionId !== sessionId) {
      abortControllerRef.current?.abort();
      stopStreaming();
    }

    // Full session-scoped state reset
    resetForSession(sessionId);

    // Rehydrate Computer tab from localStorage for the NEW session
    loadComputerStateFromStorage(sessionId);
    loadRuntimeStateFromStorage(sessionId);

    // Force refetch messages for the session we're switching TO.
    // Without this, stale cached data (staleTime: 30s) may be missing messages
    // that were persisted while we were viewing another session (e.g. if we switched
    // away mid-stream and message.complete never fired to invalidate the cache).
    queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });

    // Reset refs
    initialMessageHandledRef.current = false;
    pipelineStageStepIndexRef.current.clear();
  }, [sessionId]);

  useEffect(() => {
    return () => {
      streamReconnectCleanupRef.current?.();
      streamReconnectCleanupRef.current = null;
      abortControllerRef.current?.abort();
    };
  }, [sessionId]);

  // Scroll to bottom helper
  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  };

  // Auto-scroll when messages or streaming content changes
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingContent, isThinking]);

  const handleSSEEvent = (event: SSEEvent) => {
    if (event.sessionId && event.sessionId !== sessionId) {
      return;
    }

    const normalizeUrl = (raw: string | undefined | null) => {
      if (!raw) return raw ?? '';
      try {
        const parsed = new URL(raw);
        const keys = Array.from(parsed.searchParams.keys());
        for (const key of keys) {
          if (
            /^utm_/i.test(key) ||
            /^ga_/i.test(key) ||
            /^gaa_/i.test(key) ||
            /^gclid$/i.test(key) ||
            /^fbclid$/i.test(key) ||
            /^mc_eid$/i.test(key) ||
            /^mc_cid$/i.test(key) ||
            /^ref$/i.test(key) ||
            /^ref_src$/i.test(key) ||
            /^igshid$/i.test(key) ||
            /^mkt_tok$/i.test(key)
          ) {
            parsed.searchParams.delete(key);
          }
        }
        return parsed.toString();
      } catch {
        return raw;
      }
    };

    const openComputerInspector = () => {
      setInspectorTab('computer');
      setInspectorOpen(true);
    };

    const appendWebSearchResultSteps = (toolData: any) => {
      const hasBrowserActions =
        (useChatStore.getState().browserSession.get(sessionId)?.actions?.length ?? 0) > 0;
      if (hasBrowserActions) return;

      const artifacts = Array.isArray(toolData?.artifacts) ? toolData.artifacts : [];
      const searchArtifact = artifacts.find(
        (artifact: any) =>
          artifact?.name === 'search-results.json' && typeof artifact?.content === 'string'
      );
      if (!searchArtifact) return;

      try {
        const parsed = JSON.parse(searchArtifact.content) as {
          query?: string;
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        const results = Array.isArray(parsed.results) ? parsed.results : [];
        for (const result of results) {
          if (!result?.url) continue;
          appendAgentStep(sessionId, {
            type: 'browse',
            output: result.title || result.url,
            snapshot: {
              stepIndex: 0,
              timestamp: Date.now(),
              url: result.url,
              metadata: {
                actionDescription: 'Visit page',
                domSummary: result.content,
              },
            },
          });
        }
      } catch {
        // Ignore malformed artifact content and continue.
      }
    };

    switch (event.type) {
      case 'message.start':
        {
          const state = useChatStore.getState();
          const isAlreadyStreamingCurrentSession =
            state.isStreaming && state.streamingSessionId === sessionId;
          if (!isAlreadyStreamingCurrentSession) {
            startStreaming(sessionId);
          }
          // Always reset live run boundary on every new turn so Computer timeline
          // and message-scoped associations start from this turn only.
          setAgentRunStartIndex(sessionId);
          // Always clear reasoning steps on a new agent turn so the UI starts
          // fresh with "Step 1" rather than showing stale steps from the prior turn.
          clearReasoningSteps(sessionId);
        }
        pipelineStageStepIndexRef.current.clear();
        break;

      case 'message.delta':
        if (event.data?.content) {
          appendStreamingContent(event.data.content);
        }
        break;

      case 'message.complete':
        if (event.data?.assistantMessageId && typeof event.data?.content === 'string') {
          const content = event.data.content.trim();
          if (content) {
            const currentMessages = useChatStore.getState().messages.get(sessionId) || [];
            const alreadyPresent = currentMessages.some(
              (message) => message.id === event.data.assistantMessageId
            );
            if (!alreadyPresent) {
              addMessage(sessionId, {
                id: event.data.assistantMessageId,
                sessionId,
                role: 'assistant',
                content,
                createdAt: new Date(),
              } as any);
            }
          }
        }
        if (event.data?.assistantMessageId) {
          associateToolCallsWithMessage(sessionId, event.data.assistantMessageId);
          associateAgentStepsWithMessage(sessionId, event.data.assistantMessageId);
        }
        finalizeReasoningTrace(sessionId, typeof event.timestamp === 'number' ? event.timestamp : Date.now());
        setThinking(false);
        stopStreaming();
        // Refetch messages to ensure we have the latest
        queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });
        break;

      case 'thinking.start':
        // Set thinking state to show indicator between tool execution steps
        setThinking(true);
        break;

      case 'thinking.complete':
        // Explicitly clear thinking state when backend signals completion.
        setThinking(false);
        break;

      case 'tool.start':
        if (event.data) {
          if (event.data.toolName === 'web_search') {
            openComputerInspector();
            appendAgentStep(sessionId, {
              type: 'search',
              output: event.data.params?.query || event.data.parameters?.query || 'Web search',
              snapshot: {
                stepIndex: 0,
                timestamp: Date.now(),
                metadata: {
                  actionDescription: `Search: ${
                    event.data.params?.query || event.data.parameters?.query || ''
                  }`.trim(),
                },
              },
            });
          }
          // Turn off thinking indicator since tool card provides visual feedback
          setThinking(false);
          startToolCall(
            sessionId,
            event.data.toolCallId,
            event.data.toolName,
            event.data.params || event.data.parameters
          );
        }
        break;

      case 'tool.complete':
        if (event.data) {
          const visibleArtifacts = Array.isArray(event.data.artifacts)
            ? event.data.artifacts.filter(
                (artifact: any) => !isHiddenArtifactName(artifact?.name)
              )
            : [];

          if (visibleArtifacts.length > 0) {
            for (const artifact of visibleArtifacts) {
              if (!artifact?.name) continue;
              addFileArtifact(sessionId, {
                type: artifact.type || 'file',
                name: artifact.name,
                content: '',
                mimeType: artifact.mimeType,
                fileId: artifact.fileId,
                size: artifact.size,
              });
            }
          }

          if (event.data.toolName === 'web_search') {
            openComputerInspector();
            appendWebSearchResultSteps(event.data);
          }
          if (event.data.toolName === 'ppt_generator') {
            const previews = Array.isArray(event.data.previewSnapshots)
              ? (event.data.previewSnapshots as unknown[]).filter(
                  (item): item is string => typeof item === 'string' && item.startsWith('data:image/')
                )
              : [];

            if (previews.length > 0) {
              const lastPreview = previews[previews.length - 1];
              const stageCount = PPT_PIPELINE_STAGE_ORDER.length;
              for (let i = 0; i < stageCount; i++) {
                const stageId = PPT_PIPELINE_STAGE_ORDER[i];
                const stepIndex = pipelineStageStepIndexRef.current.get(stageId);
                if (typeof stepIndex !== 'number') continue;
                const previewIndex =
                  previews.length === 1
                    ? 0
                    : Math.round((i * (previews.length - 1)) / (stageCount - 1));
                const screenshot = previews[previewIndex] || lastPreview;
                if (!screenshot) continue;
                updateAgentStepSnapshotAt(sessionId, stepIndex, { screenshot });
              }
            }
          }
          const toolResult: import('@mark/shared').ToolResult = {
            success: true,
            output: event.data.result || '',
            duration: event.data.duration || 0,
            artifacts: visibleArtifacts,
            previewSnapshots: Array.isArray(event.data.previewSnapshots)
              ? event.data.previewSnapshots
              : undefined,
          };
          completeToolCall(sessionId, event.data.toolCallId, toolResult);
        }
        break;

      case 'tool.error':
        if (event.data) {
          if (event.data.toolName === 'ppt_generator') {
            updatePptStep(sessionId, 'generating', 'failed');
            const stageStepIndex = pipelineStageStepIndexRef.current.get('generating');
            if (typeof stageStepIndex === 'number') {
              updateAgentStepAt(sessionId, stageStepIndex, {
                output: 'Generating files failed',
              });
              updateAgentStepSnapshotAt(sessionId, stageStepIndex, {
                timestamp: Date.now(),
                screenshot: buildPipelineStageSnapshot('Generating files', 'failed'),
                metadata: {
                  actionDescription: 'PPT stage: Generating files (failed)',
                },
              });
            }
          }
          const toolResult: import('@mark/shared').ToolResult = {
            success: false,
            output: '',
            error: event.data.error || 'Unknown error',
            duration: event.data.duration || 0,
          };
          completeToolCall(sessionId, event.data.toolCallId, toolResult);
        }
        break;

      case 'reasoning.step':
        if (event.data) {
          const timestamp =
            typeof event.timestamp === 'number' ? event.timestamp : Date.now();
          const currentSteps = useChatStore.getState().reasoningSteps.get(sessionId) || [];
          const knownStep = currentSteps.find((step) => step.stepId === event.data.stepId);
          const fallbackStepIndex =
            knownStep?.stepIndex ??
            (Math.max(0, ...currentSteps.map((step) => step.stepIndex ?? 0)) + 1);
          const lifecycle =
            event.data.lifecycle ??
            (event.data.status === 'running' ? 'STARTED' : 'FINISHED');
          applyReasoningEvent(sessionId, {
            eventId:
              event.data.eventId ??
              `${event.data.stepId}:${event.data.eventSeq ?? 0}:${timestamp}`,
            traceId: event.data.traceId ?? sessionId,
            stepId: event.data.stepId,
            stepIndex: Number(event.data.stepIndex ?? fallbackStepIndex),
            eventSeq: Number(event.data.eventSeq ?? 0),
            lifecycle,
            timestamp,
            label: event.data.label,
            message: event.data.message,
            thinkingContent: event.data.thinkingContent,
            details: event.data.details,
            finalStatus: event.data.finalStatus,
          });
        }
        break;

      case 'ppt.pipeline.start':
        if (event.data?.steps) {
          startPptPipeline(sessionId, event.data.steps);
          appendAgentStep(sessionId, {
            type: 'tool',
            output: 'PPT pipeline started',
            snapshot: {
              stepIndex: 0,
              timestamp: Date.now(),
              metadata: {
                actionDescription: 'Pipeline initialization',
              },
            },
          });
          setInspectorTab('computer');
          setInspectorOpen(true);
        }
        break;

      case 'ppt.pipeline.step':
        if (event.data?.step && event.data?.status) {
          updatePptStep(sessionId, event.data.step, event.data.status);
          const stepKey = String(event.data.step);
          const label = String(event.data.label || event.data.step);
          const status = event.data.status as 'pending' | 'running' | 'completed' | 'failed';

          if (status === 'running' && !pipelineStageStepIndexRef.current.has(stepKey)) {
            const nextStepIndex =
              useChatStore.getState().agentSteps.get(sessionId)?.steps.length ?? 0;
            pipelineStageStepIndexRef.current.set(stepKey, nextStepIndex);
            appendAgentStep(sessionId, {
              type: 'tool',
              output: `${label} started`,
              snapshot: {
                stepIndex: 0,
                timestamp: Date.now(),
                screenshot: buildPipelineStageSnapshot(label, 'running'),
                metadata: {
                  actionDescription: `PPT stage: ${label} (running)`,
                },
              },
            });
          }

          if (status === 'completed') {
            const stageStepIndex = pipelineStageStepIndexRef.current.get(stepKey);
            if (typeof stageStepIndex === 'number') {
              updateAgentStepAt(sessionId, stageStepIndex, {
                output: `${label} completed`,
              });
              updateAgentStepSnapshotAt(sessionId, stageStepIndex, {
                timestamp: Date.now(),
                screenshot: buildPipelineStageSnapshot(label, 'completed'),
                metadata: {
                  actionDescription: `PPT stage: ${label} (completed)`,
                },
              });
            } else {
              appendAgentStep(sessionId, {
                type: 'tool',
                output: `${label} completed`,
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now(),
                  screenshot: buildPipelineStageSnapshot(label, 'completed'),
                  metadata: {
                    actionDescription: `PPT stage: ${label} (completed)`,
                  },
                },
              });
            }
          }

          if (status === 'failed') {
            const stageStepIndex = pipelineStageStepIndexRef.current.get(stepKey);
            if (typeof stageStepIndex === 'number') {
              updateAgentStepAt(sessionId, stageStepIndex, {
                output: `${label} failed`,
              });
              updateAgentStepSnapshotAt(sessionId, stageStepIndex, {
                timestamp: Date.now(),
                screenshot: buildPipelineStageSnapshot(label, 'failed'),
                metadata: {
                  actionDescription: `PPT stage: ${label} (failed)`,
                },
              });
            } else {
              appendAgentStep(sessionId, {
                type: 'tool',
                output: `${label} failed`,
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now(),
                  screenshot: buildPipelineStageSnapshot(label, 'failed'),
                  metadata: {
                    actionDescription: `PPT stage: ${label} (failed)`,
                  },
                },
              });
            }
          }
        }
        break;

      case 'browse.activity':
        if (event.data?.action) {
          addBrowseActivity(sessionId, {
            ...event.data,
            ...(event.data?.url ? { url: normalizeUrl(event.data.url) } : {}),
          });
          const action = event.data.action as 'search' | 'visit' | 'read';
          appendAgentStep(sessionId, {
            type: action === 'search' ? 'search' : 'browse',
            output:
              action === 'search'
                ? event.data.query || 'Search'
                : event.data.title || event.data.url || action,
            snapshot: {
              stepIndex: 0,
              timestamp:
                typeof event.data.timestamp === 'number' ? event.data.timestamp : Date.now(),
              url: normalizeUrl(event.data.url),
              metadata: {
                actionDescription:
                  action === 'search'
                    ? `Search: ${event.data.query || ''}`.trim()
                    : action === 'visit'
                      ? 'Visit page'
                      : 'Read page',
              },
            },
          });
        }
        break;

      case 'browse.screenshot':
        if (event.data?.screenshot != null && typeof event.data.visitIndex === 'number') {
          const dataUrl = `data:image/jpeg;base64,${event.data.screenshot}`;
          setVisitScreenshot(sessionId, event.data.visitIndex, dataUrl);
          const timeline = useChatStore.getState().agentSteps.get(sessionId);
          const runStartIndex = useChatStore.getState().agentRunStartIndex.get(sessionId);
          if (timeline?.steps?.length) {
            const visitStep = getVisitStepByIndex(
              timeline.steps,
              event.data.visitIndex,
              runStartIndex
            );
            if (visitStep) {
              updateAgentStepSnapshotAt(sessionId, visitStep.stepIndex, {
                screenshot: dataUrl,
              });
            }
          }
        }
        break;

      case 'browser.launched':
        setBrowserLaunched(sessionId);
        setInspectorTab('computer');
        setInspectorOpen(true);
        break;

      case 'browser.navigated':
        if (event.data?.url != null) {
          setBrowserNavigated(sessionId, event.data.url, event.data.title);
        }
        break;

      case 'browser.action':
        if (event.data?.action) {
          const actionName = event.data.action as string;
          const actionType = actionName.replace('browser_', '') as
            | 'navigate'
            | 'click'
            | 'type'
            | 'scroll'
            | 'wait'
            | 'extract'
            | 'screenshot';
          const actionUrl = normalizeUrl(
            event.data.loadedUrl ||
              event.data.normalizedUrl ||
              event.data.params?.url ||
              useChatStore.getState().browserSession.get(sessionId)?.currentUrl
          );
          addBrowserAction(sessionId, {
            id: `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: actionType,
            url: actionUrl,
            selector: event.data.params?.selector,
            text: event.data.params?.text,
            timestamp: Date.now(),
          });
          appendAgentStep(sessionId, {
            type: 'browse',
            output: event.data.output || event.data.error || actionName,
            snapshot: {
              stepIndex: 0,
              timestamp: Date.now(),
              url: actionUrl,
              metadata: {
                actionDescription: `Browser action: ${actionType}`,
                domSummary: event.data.output,
              },
            },
          });
        }
        break;

      case 'browser.screenshot':
        if (event.data?.screenshot) {
          const actionIndex =
            typeof event.data.actionIndex === 'number' ? event.data.actionIndex : undefined;
          const dataUrl = `data:image/jpeg;base64,${event.data.screenshot}`;
          const runStartIndex = useChatStore.getState().agentRunStartIndex.get(sessionId);
          setBrowserActionScreenshot(
            sessionId,
            dataUrl,
            actionIndex
          );
          if (typeof actionIndex === 'number') {
            const timeline = useChatStore.getState().agentSteps.get(sessionId);
            if (timeline?.steps?.length) {
              const target = getBrowserActionStepByIndex(
                timeline.steps,
                actionIndex,
                runStartIndex
              );
              if (target) {
                updateAgentStepSnapshotAt(sessionId, target.stepIndex, { screenshot: dataUrl });
              }
            }
          } else {
            const timeline = useChatStore.getState().agentSteps.get(sessionId);
            if (timeline && timeline.steps.length > 0) {
              const target = getBrowserActionStepByIndex(
                timeline.steps,
                undefined,
                runStartIndex
              );
              if (target) {
                updateAgentStepSnapshotAt(sessionId, target.stepIndex, {
                  screenshot: dataUrl,
                });
              }
            }
          }
        }
        break;

      case 'browser.unavailable':
        setPptBrowserUnavailable(sessionId);
        break;

      case 'browser.closed':
        setBrowserClosed(sessionId);
        appendAgentStep(sessionId, {
          type: 'finalize',
          output: 'Browser session closed',
          snapshot: {
            stepIndex: 0,
            timestamp: Date.now(),
            metadata: {
              actionDescription: 'Browser closed',
            },
          },
        });
        break;

      case 'inspector.focus':
        if (event.data?.tab) {
          setInspectorTab(event.data.tab);
          setInspectorOpen(true);
        }
        break;

      case 'sandbox.provisioning':
        setSandboxStatus('provisioning');
        break;

      case 'sandbox.ready':
        setSandboxStatus('ready');
        break;

      case 'sandbox.teardown':
        setSandboxStatus('teardown');
        break;

      case 'terminal.command':
      case 'terminal.stdout':
      case 'terminal.stderr': {
        const streamType =
          event.type === 'terminal.command'
            ? 'command'
            : event.type === 'terminal.stderr'
              ? 'stderr'
              : 'stdout';
        const content = event.data?.line || event.data?.content || event.data?.command || '';
        if (content) {
          addTerminalLine(sessionId, {
            id: `${event.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            stream: streamType,
            content,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'execution.step.start':
        if (event.data?.stepId) {
          setSandboxStatus('running');
          addExecutionStep(sessionId, {
            stepId: event.data.stepId,
            label: event.data.label || event.data.description || 'Execution step',
            status: 'running',
            startedAt: Date.now(),
            toolName: event.data.toolName,
            message: event.data.message,
          });
        }
        break;

      case 'execution.step.update':
        if (event.data?.stepId) {
          updateExecutionStep(sessionId, event.data.stepId, {
            label: event.data.label,
            message: event.data.message,
          });
        }
        break;

      case 'execution.step.end':
        if (event.data?.stepId) {
          updateExecutionStep(sessionId, event.data.stepId, {
            status: event.data.success === false ? 'failed' : 'completed',
            completedAt: Date.now(),
            message: event.data.message,
          });
        }
        break;

      case 'fs.file.created':
      case 'fs.file.modified':
        if (event.data?.path) {
          addSandboxFile(sessionId, {
            path: event.data.path,
            size: event.data.size,
            mimeType: event.data.mimeType,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
        break;

      case 'table.start':
        // Table block started - schema is known, data is streaming
        if (event.data?.tableId && event.data?.schema) {
          startTableBlock(event.data.tableId, event.data.schema, event.data.caption);
        }
        break;

      case 'table.complete':
        // Table block completed - full Table IR data is available
        if (event.data?.tableId && event.data?.table) {
          completeTableBlock(event.data.tableId, event.data.table);
        }
        break;

      case 'file.created':
        if (event.data?.fileId && event.data?.filename) {
          const artifact: import('@mark/shared').Artifact = {
            fileId: event.data.fileId,
            name: event.data.filename,
            type: event.data.type || 'file',
            mimeType: event.data.mimeType,
            size: event.data.size,
            content: '',
          };
          addFileArtifact(sessionId, artifact);
        }
        break;

      case 'error':
        console.error('Stream error:', event.data);
        clearPptPipeline(sessionId);
        clearBrowserSession(sessionId);
        setThinking(false);
        stopStreaming();
        toast({
          title: 'Stream error',
          description: event.data?.message || 'Unknown error',
          variant: 'destructive',
        });
        break;

      case 'session.end':
        finalizeReasoningTrace(
          sessionId,
          typeof event.timestamp === 'number' ? event.timestamp : Date.now()
        );
        setThinking(false);
        stopStreaming();
        queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });
        break;
    }
  };

  useEffect(() => {
    const shouldReconnectViaSse =
      isStreaming &&
      streamingSessionId === sessionId &&
      !activePostStreamRef.current;

    if (!shouldReconnectViaSse) {
      streamReconnectCleanupRef.current?.();
      streamReconnectCleanupRef.current = null;
      return;
    }

    const cleanup = createSSEConnection(apiClient.chat.getStreamUrl(sessionId), {
      reconnect: true,
      maxReconnectAttempts: 8,
      onEvent: (event) => {
        const sseEvent = event as unknown as SSEEvent;
        handleSSEEvent(sseEvent);
        if (TERMINAL_STREAM_EVENT_TYPES.has(sseEvent.type)) {
          streamReconnectCleanupRef.current?.();
          streamReconnectCleanupRef.current = null;
        }
      },
      onError: (error) => {
        console.error('Reconnect SSE error:', error);
      },
    });

    streamReconnectCleanupRef.current = cleanup;
    return () => {
      cleanup();
      if (streamReconnectCleanupRef.current === cleanup) {
        streamReconnectCleanupRef.current = null;
      }
    };
  }, [isStreaming, streamingSessionId, sessionId]);

  const handleSendMessage = async (
    content: string,
    options?: { initializeRunUi?: boolean }
  ) => {
    // Guard: Do not allow sending if session is invalid
    if (!isSessionValid) {
      toast({
        title: 'Session not found',
        description: 'This session does not exist or has been deleted. Please create a new session or select an existing one from the sidebar.',
        variant: 'destructive',
      });
      return;
    }

    if (options?.initializeRunUi) {
      // New chat start only: mount inspector + live trace/timeline at submit time (T=0).
      setInspectorTab('computer');
      setInspectorOpen(true);
      startStreaming(sessionId);
      setAgentRunStartIndex(sessionId);
      clearReasoningSteps(sessionId);
      pipelineStageStepIndexRef.current.clear();
    }

    setIsSending(true);
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const sendStartedAt = Date.now();

    const recoverCompletedAssistantFromServer = async (): Promise<boolean> => {
      try {
        const sessionData = await apiClient.sessions.get(sessionId);
        const orderedMessages = Array.isArray(sessionData.messages) ? sessionData.messages : [];

        // Recover only if we can identify the user message for this send attempt.
        let sentUserIndex = -1;
        for (let i = orderedMessages.length - 1; i >= 0; i -= 1) {
          const candidate = orderedMessages[i];
          if (candidate?.role !== 'user') continue;
          const createdAtMs = new Date(candidate.createdAt as any).getTime();
          if (!Number.isFinite(createdAtMs)) continue;
          if (createdAtMs < sendStartedAt - 10_000) continue;
          if ((candidate.content || '').trim() !== content.trim()) continue;
          sentUserIndex = i;
          break;
        }

        if (sentUserIndex < 0) return false;

        let recoveredAssistant: (typeof orderedMessages)[number] | undefined = undefined;
        for (let i = sentUserIndex + 1; i < orderedMessages.length; i += 1) {
          if (orderedMessages[i]?.role === 'assistant') {
            recoveredAssistant = orderedMessages[i];
            break;
          }
        }

        if (!recoveredAssistant) return false;

        const localMessages = useChatStore.getState().messages.get(sessionId) || [];
        if (!localMessages.some((message) => message.id === recoveredAssistant?.id)) {
          addMessage(sessionId, recoveredAssistant as any);
        }

        associateToolCallsWithMessage(sessionId, recoveredAssistant.id);
        associateAgentStepsWithMessage(sessionId, recoveredAssistant.id);
        stopStreaming();
        queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });
        return true;
      } catch {
        return false;
      }
    };

    try {
      // Add optimistic user message
      const tempUserMessage = {
        id: `temp-${Date.now()}`,
        sessionId,
        role: 'user' as const,
        content,
        createdAt: new Date(),
      };

      addMessage(sessionId, tempUserMessage as any);

      // Scroll to bottom immediately after adding user message
      setTimeout(() => {
        scrollToBottom();
      }, 0);

      // Re-enable input immediately after user message is added
      // User can see their message and the thinking indicator while we stream
      setIsSending(false);

      // PPT pipeline is started by the server via ppt.pipeline.start event, not speculatively.
      // Single request SSE flow: backend persists user message and streams assistant events.
      activePostStreamRef.current = true;
      for await (const event of apiClient.chat.sendAndStream(
        sessionId,
        content,
        abortControllerRef.current.signal
      )) {
        handleSSEEvent(event as SSEEvent);
        if (TERMINAL_STREAM_EVENT_TYPES.has((event as SSEEvent).type)) {
          break;
        }
      }

      // Fallback cleanup: if stream ended without terminal event (e.g. message.complete/session.end),
      // ensure UI does not remain stuck in streaming/thinking state.
      const streamState = useChatStore.getState();
      if (streamState.isStreaming && streamState.streamingSessionId === sessionId) {
        stopStreaming();
        queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        stopStreaming();
        setIsSending(false);
        return;
      }
      if (await recoverCompletedAssistantFromServer()) {
        setIsSending(false);
        return;
      }
      stopStreaming();
      setIsSending(false);
      toast({
        title: 'Failed to send message',
        description: error.message || 'Could not send message',
        variant: 'destructive',
      });
    } finally {
      activePostStreamRef.current = false;
    }
  };

  useEffect(() => {
    if (!initialMessage || initialMessageHandledRef.current) return;
    if (isSessionLoading || !isSessionValid) return;
    if (isStreaming || isSending) return;

    initialMessageHandledRef.current = true;
    handleSendMessage(initialMessage, { initializeRunUi: true });
    navigate(location.pathname, { replace: true, state: null });
  }, [
    initialMessage,
    isSessionLoading,
    isSessionValid,
    isStreaming,
    isSending,
    navigate,
    location.pathname,
  ]);

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
    stopStreaming();
    setIsSending(false);
  };

  // Redirect to chat list if session doesn't exist or failed to load
  if (sessionError || (!isSessionLoading && !session)) {
    const error = sessionError as Error;
    const is404 = error instanceof ApiError && error.status === 404;

    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="mb-4 flex justify-center">
            <svg className="mx-auto h-12 w-12 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0m-6 0v6m0-6v6m6 0a3 3 0 01-6 0V4a3 3 0 016 0v2a3 3 0 016 0v2a3 3 0 01-6 0zm-9-3v6h-9" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">
            {is404 ? 'Session Not Found' : 'Unable to Load Session'}
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            {is404
              ? 'The session you are looking for does not exist or has been deleted.'
              : 'There was an error loading the session.'}
          </p>
          <button
            onClick={() => navigate('/chat')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7l7-7" />
            </svg>
            Go to Sessions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden dark:bg-[#212121]">
      <DocumentCanvas sessionId={sessionId} scrollContainerRef={scrollContainerRef} />

      {/* Input always at the bottom */}
      <ChatInput
        onSend={handleSendMessage}
        disabled={isSending || (!isSessionValid && !isSessionLoading)}
        sendDisabled={isStreaming && streamingSessionId === sessionId}
        onStop={handleStopStreaming}
        onOpenSkills={onOpenSkills}
      />

    </div>
  );
}
