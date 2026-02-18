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
import type { Artifact } from '@mark/shared';
import { isHiddenArtifactName } from '../../lib/artifactFilters';

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
  const toolCalls = useChatStore((state) => state.toolCalls);
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

  const getArtifactsForMessage = useCallback(
    (messageId: string): Artifact[] => {
      const artifacts: Artifact[] = [];
      const dedupe = new Set<string>();

      for (const call of toolCalls.values()) {
        if (call.sessionId !== sessionId || call.messageId !== messageId) continue;
        const callArtifacts = Array.isArray(call.result?.artifacts) ? call.result.artifacts : [];
        for (const artifact of callArtifacts) {
          if (!artifact?.name) continue;
          if (isHiddenArtifactName(artifact.name)) continue;
          const key = `${artifact.fileId || ''}:${artifact.name}`;
          if (dedupe.has(key)) continue;
          dedupe.add(key);
          artifacts.push({
            type: artifact.type || 'file',
            name: artifact.name,
            content: '',
            mimeType: artifact.mimeType,
            fileId: artifact.fileId,
            size: artifact.size,
          });
        }
      }

      return artifacts;
    },
    [toolCalls, sessionId]
  );

  const lastUserMessageId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].id;
    }
    return null;
  })();

  const handleUserMessageClick = useCallback(
    (userMessageId: string) => {
      const assistantMessageId = findNextAssistantMessageId(userMessageId);

      // Current ongoing prompt (last user message with no assistant yet): click = return to live view
      if (!assistantMessageId && userMessageId === lastUserMessageId) {
        setSelectedMessageId(null);
        setInspectorOpen(true);
        return;
      }

      if (!assistantMessageId) return;

      if (selectedMessageId === assistantMessageId) {
        // Toggle off if already selected
        setSelectedMessageId(null);
      } else {
        setSelectedMessageId(assistantMessageId);
        setInspectorOpen(true);
      }
    },
    [selectedMessageId, setSelectedMessageId, setInspectorOpen, findNextAssistantMessageId, lastUserMessageId]
  );

  // Check if a user message is currently selected (its assistant response is selected), or is the live ongoing prompt
  const isUserMessageSelected = useCallback(
    (userMessageId: string) => {
      const assistantMessageId = findNextAssistantMessageId(userMessageId);
      if (assistantMessageId) return assistantMessageId === selectedMessageId;
      // Last user message with no assistant yet: "selected" when we're in live view (no message selected)
      return userMessageId === lastUserMessageId && selectedMessageId === null;
    },
    [selectedMessageId, findNextAssistantMessageId, lastUserMessageId]
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
      <div className="mx-auto flex w-full max-w-[var(--chat-content-max-width,1400px)] flex-col gap-4 px-4 py-8 md:px-6">
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
      <div className="mx-auto flex w-full max-w-[var(--chat-content-max-width,1400px)] flex-col gap-6 px-4 pb-4 pt-8 md:px-6">
        {messages.map((message) => {
          if (message.role !== 'user') {
            if (!message.content) return null;
            const artifacts = getArtifactsForMessage(message.id);
            return (
              <div key={message.id} className="space-y-3">
                <ContentBlock content={message.content} />
                {artifacts.length > 0 ? (
                  <div className="space-y-3">
                    {artifacts.map((artifact, index) => (
                      <ArtifactCard
                        key={`${message.id}-${artifact.fileId || artifact.name}-${index}`}
                        artifact={artifact}
                        sessionId={sessionId}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }

          if (!message.content) return null;

          const isClickable =
            userMessageHasAssistant(message.id) ||
            (message.id === lastUserMessageId && (isStreamingThisSession || isThinkingThisSession));
          const messageNode = (
            <div
              key={message.id}
              onClick={() => handleUserMessageClick(message.id)}
              className={cn(
                'relative w-fit max-w-[80%] self-end rounded-2xl transition-all duration-150',
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
              <TooltipContent>
                {message.id === lastUserMessageId && !userMessageHasAssistant(message.id)
                  ? 'Click to view live progress'
                  : 'Click to inspect'}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {showStreamingContent ? (
          <ContentBlock content={streamingContent} isStreaming={true} />
        ) : null}

        {isStreamingThisSession && isThinkingThisSession && !showStreamingContent ? (
          <div className="text-muted-foreground">
            <ThinkingIndicator />
          </div>
        ) : null}

      </div>
    </TooltipProvider>
  );
}
