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
  const isActive = isStreaming && streamingSessionId === sessionId;

  // Determine which key to use for reasoning steps
  // If a message is selected, use message-specific key; otherwise use session key
  const reasoningKey = selectedMessageId ? `msg-${selectedMessageId}` : sessionId;
  const reasoningSteps = useChatStore((state) => state.reasoningSteps.get(reasoningKey) || []);

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
