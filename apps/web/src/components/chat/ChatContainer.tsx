import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DocumentCanvas } from '../canvas/DocumentCanvas';
import { ChatInput } from './ChatInput';
import { apiClient, type SSEEvent, ApiError } from '../../lib/api';
import { useChatStore } from '../../stores/chatStore';
import { useSession } from '../../hooks/useSessions';
import { useToast } from '../../hooks/use-toast';

interface ChatContainerProps {
  sessionId: string;
  onOpenSkills?: () => void;
}

export function ChatContainer({ sessionId, onOpenSkills }: ChatContainerProps) {
  const location = useLocation();
  const [isSending, setIsSending] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const initialMessageHandledRef = useRef(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

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
  const addReasoningStep = useChatStore((state) => state.addReasoningStep);
  const updateReasoningStep = useChatStore((state) => state.updateReasoningStep);
  const completeReasoningStep = useChatStore((state) => state.completeReasoningStep);
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
  const executionMode = useChatStore((state) => state.executionMode);
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
  const updateAgentStepSnapshotAt = useChatStore((state) => state.updateAgentStepSnapshotAt);
  const clearAgentSteps = useChatStore((state) => state.clearAgentSteps);
  const clearFiles = useChatStore((state) => state.clearFiles);
  const loadComputerStateFromStorage = useChatStore((state) => state.loadComputerStateFromStorage);

  // Clear tool calls, tables, file artifacts, and message selection when session changes.
  // Rehydrate Computer tab state (browser/PPT) from localStorage so it survives refresh.
  useEffect(() => {
    clearToolCalls();
    clearTables();
    clearFiles(sessionId);
    setSelectedMessageId(null);
    loadComputerStateFromStorage(sessionId);
  }, [sessionId, clearToolCalls, clearTables, clearFiles, setSelectedMessageId, loadComputerStateFromStorage]);

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
        startStreaming(sessionId);
        clearReasoningSteps(sessionId);
        clearBrowserSession(sessionId);
        clearAgentSteps(sessionId);
        break;

      case 'message.delta':
        if (event.data?.content) {
          appendStreamingContent(event.data.content);
        }
        break;

      case 'message.complete':
        if (event.data?.assistantMessageId) {
          associateToolCallsWithMessage(sessionId, event.data.assistantMessageId);
        }
        stopStreaming();
        // Refetch messages to ensure we have the latest
        queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });
        break;

      case 'thinking.start':
        // Set thinking state to show indicator between tool execution steps
        setThinking(true);
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
          if (event.data.toolName === 'web_search') {
            openComputerInspector();
            appendWebSearchResultSteps(event.data);
          }
          const toolResult: import('@mark/shared').ToolResult = {
            success: true,
            output: event.data.result || '',
            duration: event.data.duration || 0,
            artifacts: event.data.artifacts,
          };
          completeToolCall(event.data.toolCallId, toolResult);
          completeReasoningStep(sessionId, `tool-${event.data.toolCallId}`, Date.now());
        }
        break;

      case 'tool.error':
        if (event.data) {
          const toolResult: import('@mark/shared').ToolResult = {
            success: false,
            output: '',
            error: event.data.error || 'Unknown error',
            duration: event.data.duration || 0,
          };
          completeToolCall(event.data.toolCallId, toolResult);
          completeReasoningStep(sessionId, `tool-${event.data.toolCallId}`, Date.now());
        }
        break;

      case 'reasoning.step':
        if (event.data) {
          const existingSteps = useChatStore.getState().reasoningSteps.get(sessionId) || [];
          const alreadyTracked = existingSteps.some((s) => s.stepId === event.data.stepId);
          const thinkingContent = event.data.thinkingContent;

          if (event.data.status === 'running') {
            if (!alreadyTracked) {
              addReasoningStep(sessionId, {
                stepId: event.data.stepId,
                label: event.data.label,
                status: 'running',
                startedAt: Date.now(),
                message: event.data.message,
                thinkingContent,
                details: event.data.details,
              });
            } else {
              updateReasoningStep(sessionId, event.data.stepId, {
                label: event.data.label,
                status: 'running',
                message: event.data.message,
                ...(thinkingContent ? { thinkingContent } : {}),
                details: event.data.details,
              });
            }
          }

          if (event.data.status === 'completed') {
            if (!alreadyTracked) {
              addReasoningStep(sessionId, {
                stepId: event.data.stepId,
                label: event.data.label,
                status: 'completed',
                startedAt: Date.now(),
                completedAt: Date.now(),
                durationMs: event.data.durationMs,
                message: event.data.message,
                thinkingContent,
                details: event.data.details,
              });
            } else {
              updateReasoningStep(sessionId, event.data.stepId, {
                label: event.data.label,
                status: 'completed',
                completedAt: Date.now(),
                durationMs: event.data.durationMs,
                message: event.data.message,
                ...(thinkingContent ? { thinkingContent } : {}),
                details: event.data.details,
              });
            }
          }
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
          if (timeline?.steps?.length) {
            const visitSteps = timeline.steps.filter(
              (step) =>
                step.type === 'browse' &&
                (step.snapshot?.metadata?.actionDescription === 'Visit page' ||
                  step.snapshot?.metadata?.actionDescription === 'Read page')
            );
            const visitStep = visitSteps[event.data.visitIndex];
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
          setBrowserActionScreenshot(
            sessionId,
            dataUrl,
            actionIndex
          );
          if (typeof actionIndex === 'number') {
            const timeline = useChatStore.getState().agentSteps.get(sessionId);
            if (timeline?.steps?.length) {
              const browserSteps = timeline.steps.filter(
                (step) =>
                  step.type === 'browse' &&
                  step.snapshot?.metadata?.actionDescription?.startsWith('Browser action:')
              );
              const target = browserSteps[actionIndex];
              if (target) {
                updateAgentStepSnapshotAt(sessionId, target.stepIndex, { screenshot: dataUrl });
              }
            }
          } else {
            const timeline = useChatStore.getState().agentSteps.get(sessionId);
            if (timeline && timeline.steps.length > 0) {
              updateAgentStepSnapshotAt(sessionId, timeline.steps.length - 1, {
                screenshot: dataUrl,
              });
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
        stopStreaming();
        toast({
          title: 'Stream error',
          description: event.data?.message || 'Unknown error',
          variant: 'destructive',
        });
        break;
    }
  };

  const handleSendMessage = async (content: string) => {
    // Guard: Do not allow sending if session is invalid
    if (!isSessionValid) {
      toast({
        title: 'Session not found',
        description: 'This session does not exist or has been deleted. Please create a new session or select an existing one from the sidebar.',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

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

      const lowerContent = content.toLowerCase();
      const looksLikePpt = ['ppt', 'presentation', 'powerpoint', 'slides'].some(
        (keyword) => lowerContent.includes(keyword)
      );
      if (looksLikePpt) {
        startPptPipeline(sessionId, [
          { id: 'research', label: 'Research', status: 'pending' },
          { id: 'browsing', label: 'Browsing', status: 'pending' },
          { id: 'reading', label: 'Reading', status: 'pending' },
          { id: 'synthesizing', label: 'Synthesizing', status: 'pending' },
          { id: 'generating', label: 'Generating files', status: 'pending' },
          { id: 'finalizing', label: 'Finalizing', status: 'pending' },
        ]);
        setInspectorTab('computer');
        setInspectorOpen(true);
      }

      // Stream response from backend
      for await (const event of apiClient.chat.sendAndStream(
        sessionId,
        content,
        abortControllerRef.current.signal,
        { executionMode }
      )) {
        handleSSEEvent(event);
      }

      // Note: message.complete handler already invalidates queries, no need to duplicate here
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        stopStreaming();
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
    }
  };

  useEffect(() => {
    if (!initialMessage || initialMessageHandledRef.current) return;
    if (isSessionLoading || !isSessionValid) return;
    if (isStreaming || isSending) return;

    initialMessageHandledRef.current = true;
    handleSendMessage(initialMessage);
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
    <div className="flex flex-1 flex-col overflow-hidden">
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
