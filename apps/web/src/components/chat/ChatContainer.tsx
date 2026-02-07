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
  const startToolCall = useChatStore((state) => state.startToolCall);
  const completeToolCall = useChatStore((state) => state.completeToolCall);
  const messages = useChatStore((state) => state.messages.get(sessionId) || []);
  const streamingContent = useChatStore((state) => state.streamingContent);
  const isThinking = useChatStore((state) => state.isThinking);
  const startTableBlock = useChatStore((state) => state.startTableBlock);
  const completeTableBlock = useChatStore((state) => state.completeTableBlock);
  const clearTables = useChatStore((state) => state.clearTables);
  const clearToolCalls = useChatStore((state) => state.clearToolCalls);
  const addReasoningStep = useChatStore((state) => state.addReasoningStep);
  const updateReasoningStep = useChatStore((state) => state.updateReasoningStep);
  const completeReasoningStep = useChatStore((state) => state.completeReasoningStep);
  const clearReasoningSteps = useChatStore((state) => state.clearReasoningSteps);
  const setInspectorTab = useChatStore((state) => state.setInspectorTab);
  const setSelectedMessageId = useChatStore((state) => state.setSelectedMessageId);
  const associateToolCallsWithMessage = useChatStore((state) => state.associateToolCallsWithMessage);

  // Clear tool calls, tables, and message selection when session changes
  useEffect(() => {
    clearToolCalls();
    clearTables();
    setSelectedMessageId(null);
  }, [sessionId, clearToolCalls, clearTables, setSelectedMessageId]);

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
    switch (event.type) {
      case 'message.start':
        startStreaming(sessionId);
        clearReasoningSteps(sessionId);
        setInspectorTab('reasoning');
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

      case 'error':
        console.error('Stream error:', event.data);
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

      // Stream response from backend
      for await (const event of apiClient.chat.sendAndStream(
        sessionId,
        content,
        abortControllerRef.current.signal
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
        sendDisabled={isStreaming}
        onStop={handleStopStreaming}
        onOpenSkills={onOpenSkills}
      />

    </div>
  );
}
