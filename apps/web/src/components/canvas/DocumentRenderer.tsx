import { useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { useSessionMessages } from '../../hooks/useChat';
import { useChatStore } from '../../stores/chatStore';
import { Skeleton } from '../ui/skeleton';
import { ApiError } from '../../lib/api';
import { PromptEcho } from './PromptEcho';
import { ContentBlock } from './ContentBlock';
import { ArtifactCard } from './ArtifactCard';
import { ThinkingIndicator } from '../chat/ThinkingIndicator';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

interface DocumentRendererProps {
  sessionId: string;
}

export function DocumentRenderer({ sessionId }: DocumentRendererProps) {
  const { data: apiMessages, isLoading, error } = useSessionMessages(sessionId);
  const localMessages = useChatStore((state) => state.messages.get(sessionId) || []);
  const streamingContent = useChatStore((state) => state.streamingContent);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const isThinking = useChatStore((state) => state.isThinking);
  const streamingSessionId = useChatStore((state) => state.streamingSessionId);
  const files = useChatStore((state) => state.files.get(sessionId) || []);
  const selectedMessageId = useChatStore((state) => state.selectedMessageId);
  const setSelectedMessageId = useChatStore((state) => state.setSelectedMessageId);
  const setInspectorOpen = useChatStore((state) => state.setInspectorOpen);

  // Compute messages array early so it can be used in useCallback hooks
  const messages = (() => {
    const apiMessageIds = new Set((apiMessages || []).map((m) => m.id));
    const optimisticMessages = localMessages.filter(
      (m) => m.id.startsWith('temp-') && !apiMessageIds.has(m.id)
    );
    return [...(apiMessages || []), ...optimisticMessages];
  })();

  // Find the next assistant message ID after a user message
  const findNextAssistantMessageId = useCallback(
    (userMessageId: string) => {
      const currentIndex = messages.findIndex((m) => m.id === userMessageId);
      if (currentIndex === -1 || currentIndex >= messages.length - 1) {
        return null;
      }

      // Find the next assistant message
      for (let i = currentIndex + 1; i < messages.length; i++) {
        if (messages[i].role === 'assistant') {
          return messages[i].id;
        }
      }
      return null;
    },
    [messages]
  );

  // Check if a user message has a corresponding assistant response
  const userMessageHasAssistant = useCallback(
    (userMessageId: string) => !!findNextAssistantMessageId(userMessageId),
    [findNextAssistantMessageId]
  );

  const handleUserMessageClick = useCallback(
    (userMessageId: string) => {
      const assistantMessageId = findNextAssistantMessageId(userMessageId);
      if (!assistantMessageId) return;

      if (selectedMessageId === assistantMessageId) {
        // Toggle off if already selected
        setSelectedMessageId(null);
      } else {
        setSelectedMessageId(assistantMessageId);
        setInspectorOpen(true);
      }
    },
    [selectedMessageId, setSelectedMessageId, setInspectorOpen, findNextAssistantMessageId]
  );

  // Check if a user message is currently selected (its assistant response is selected)
  const isUserMessageSelected = useCallback(
    (userMessageId: string) => {
      const assistantMessageId = findNextAssistantMessageId(userMessageId);
      return assistantMessageId === selectedMessageId;
    },
    [selectedMessageId, findNextAssistantMessageId]
  );

  const errorType = error instanceof ApiError ? {
    is404: error.status === 404,
    isUnauthorized: error.status === 401,
    message: error.message,
  } : {
    is404: false,
    isUnauthorized: false,
    message: error instanceof Error ? error.message : 'Unknown error',
  };

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-5/6" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="mb-4 flex justify-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold mb-2">
            {errorType.is404 ? 'Session Not Found' : 'Failed to Load Messages'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {errorType.message}
          </p>
        </div>
      </div>
    );
  }

  const isStreamingThisSession = isStreaming && streamingSessionId === sessionId;
  const isThinkingThisSession = isThinking && streamingSessionId === sessionId;

  const hasMessages = messages && messages.length > 0;
  const showStreamingContent = isStreamingThisSession && !!streamingContent;

  if (!hasMessages && !isThinkingThisSession && !showStreamingContent) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">No messages yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Start a conversation by sending a message below
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-8 pb-4">
        {messages.map((message) => {
          if (message.role !== 'user') {
            return message.content ? (
              <ContentBlock key={message.id} content={message.content} />
            ) : null;
          }

          if (!message.content) return null;

          const isClickable = userMessageHasAssistant(message.id);
          const messageNode = (
            <div
              key={message.id}
              onClick={() => handleUserMessageClick(message.id)}
              className={cn(
                'relative rounded-xl transition-all duration-150',
                isClickable &&
                  'cursor-pointer hover:shadow-[0_2px_16px_rgba(0,0,0,0.10)] dark:hover:shadow-[0_2px_16px_rgba(0,0,0,0.24)]',
                isUserMessageSelected(message.id) &&
                  'shadow-[0_2px_20px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_20px_rgba(0,0,0,0.28)] border-l-2 border-primary/40'
              )}
            >
              <PromptEcho content={message.content} />
            </div>
          );

          if (!isClickable) {
            return messageNode;
          }

          return (
            <Tooltip key={message.id}>
              <TooltipTrigger asChild>{messageNode}</TooltipTrigger>
              <TooltipContent>Click to inspect</TooltipContent>
            </Tooltip>
          );
        })}

        {files.length > 0 ? (
          <div className="space-y-3">
            {files.map((artifact) => (
              <ArtifactCard
                key={`${artifact.name}-${artifact.fileId || artifact.content}`}
                artifact={artifact}
                sessionId={sessionId}
              />
            ))}
          </div>
        ) : null}

        {showStreamingContent ? (
          <div
            className={cn(
              'rounded-lg transition-all duration-150',
              !selectedMessageId && 'ring-2 ring-primary/30 bg-muted/30'
            )}
          >
            <ContentBlock content={streamingContent} isStreaming={true} />
          </div>
        ) : null}

        {isThinkingThisSession && !showStreamingContent ? (
          <div className="text-muted-foreground">
            <ThinkingIndicator />
          </div>
        ) : null}

      </div>
    </TooltipProvider>
  );
}
