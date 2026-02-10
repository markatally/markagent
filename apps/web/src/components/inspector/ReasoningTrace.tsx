import { useChatStore } from '../../stores/chatStore';
import { ThinkingIndicator } from '../chat/ThinkingIndicator';
import { ReasoningTimeline } from '../chat/ReasoningTimeline';

interface ReasoningTraceProps {
  sessionId: string;
  selectedMessageId?: string | null;
}

export function ReasoningTrace({ sessionId, selectedMessageId }: ReasoningTraceProps) {
  const isStreaming = useChatStore((state) => state.isStreaming);
  const streamingSessionId = useChatStore((state) => state.streamingSessionId);
  const messages = useChatStore((state) => state.messages.get(sessionId) || []);
  const reasoningMap = useChatStore((state) => state.reasoningSteps);
  const isActive = isStreaming && streamingSessionId === sessionId;

  const selectedMessageKey = selectedMessageId ? `msg-${selectedMessageId}` : null;
  const latestAssistantMessageWithTrace = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && (reasoningMap.get(`msg-${message.id}`)?.length ?? 0) > 0);
  const fallbackMessageKey = latestAssistantMessageWithTrace ? `msg-${latestAssistantMessageWithTrace.id}` : null;
  const sessionReasoningSteps = reasoningMap.get(sessionId) || [];
  const reasoningKey = selectedMessageKey
    ? selectedMessageKey
    : sessionReasoningSteps.length > 0
      ? sessionId
      : fallbackMessageKey ?? sessionId;
  const reasoningSteps = reasoningMap.get(reasoningKey) || [];

  if (reasoningSteps.length === 0) {
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        {isActive ? (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <ThinkingIndicator />
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            No reasoning trace yet.
          </div>
        )}
      </div>
    );
  }

  return <ReasoningTimeline sessionId={reasoningKey} alwaysExpanded />;
}
