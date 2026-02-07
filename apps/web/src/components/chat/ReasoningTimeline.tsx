import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { cn } from '../../lib/utils';
import { StatusIcon } from '../ui/status-icon';

interface ReasoningTimelineProps {
  sessionId: string;
  alwaysExpanded?: boolean;
}

function formatDuration(ms?: number) {
  if (!ms || ms <= 0) return '0.00s';
  return `${(ms / 1000).toFixed(2)}s`;
}

export function ReasoningTimeline({ sessionId, alwaysExpanded = false }: ReasoningTimelineProps) {
  const reasoningSteps = useChatStore((state) => state.reasoningSteps.get(sessionId) || []);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const streamingSessionId = useChatStore((state) => state.streamingSessionId);
  const [isExpanded, setIsExpanded] = useState(alwaysExpanded);
  const [tick, setTick] = useState(0);

  const isActive = isStreaming && streamingSessionId === sessionId && reasoningSteps.some((step) => step.status === 'running');

  useEffect(() => {
    if (isActive) {
      setIsExpanded(true);
    }
  }, [isActive]);

  useEffect(() => {
    if (alwaysExpanded) {
      setIsExpanded(true);
    }
  }, [alwaysExpanded]);

  // Live tick for real-time duration updates (centisecond precision) while streaming
  const rafRef = useRef<number>(0);
  const tickUpdate = useCallback(() => {
    setTick((t) => t + 1);
    rafRef.current = requestAnimationFrame(tickUpdate);
  }, []);

  useEffect(() => {
    if (!isActive) return;

    rafRef.current = requestAnimationFrame(tickUpdate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isActive, tickUpdate]);

  const totalDuration = useMemo(() => {
    if (reasoningSteps.length === 0) return 0;
    const start = Math.min(...reasoningSteps.map((step) => step.startedAt));
    const end = Math.max(
      ...reasoningSteps.map((step) => step.completedAt || Date.now())
    );
    return end - start;
  }, [reasoningSteps, tick]);

  if (reasoningSteps.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border bg-muted/10">
      {alwaysExpanded ? (
        <div className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span>Reasoning Trace</span>
            <span className="text-xs text-muted-foreground">({formatDuration(totalDuration)})</span>
          </div>
          {isActive ? (
            <div className="flex items-center gap-2 text-xs text-blue-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>In progress</span>
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span>Reasoning Trace</span>
            <span className="text-xs text-muted-foreground">({formatDuration(totalDuration)})</span>
          </div>
          {isActive ? (
            <div className="flex items-center gap-2 text-xs text-blue-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>In progress</span>
            </div>
          ) : null}
        </button>
      )}

      {isExpanded ? (
        <div className="space-y-3 px-4 pb-4">
          {reasoningSteps.map((step, index) => {
            const isCompleted = step.status === 'completed';
            const duration = isCompleted
              ? (step.durationMs || (step.completedAt || 0) - step.startedAt)
              : Date.now() - step.startedAt;
            const isLast = index === reasoningSteps.length - 1;

            return (
              <div key={step.stepId} className="relative flex gap-3">
                <div className="flex flex-col items-center">
                  <StatusIcon status={isCompleted ? 'completed' : 'running'} size="md" />
                  {!isLast && <div className="mt-1 h-full w-px bg-border" />}
                </div>

                <div className="flex-1 pb-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-foreground">{step.label}</div>
                    <div className="text-xs text-muted-foreground">{formatDuration(duration)}</div>
                  </div>
                  {step.message ? (
                    <div className="text-xs text-muted-foreground">{step.message}</div>
                  ) : null}
                  {step.details?.queries && step.details.queries.length > 0 ? (
                    <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                      {step.details.queries.map((query) => (
                        <li key={query}>{query}</li>
                      ))}
                    </ul>
                  ) : null}
                  {step.details?.toolName ? (
                    <div className="mt-1 text-xs text-muted-foreground">Tool: {step.details.toolName}</div>
                  ) : null}
                  {step.thinkingContent ? (
                    <details className="mt-2 rounded-lg border border-border bg-muted/10 px-3 py-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        {isCompleted ? 'Thoughts' : 'Thoughts (streaming)'}
                      </summary>
                      <div className="mt-2 prose prose-sm max-w-none text-muted-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {step.thinkingContent}
                        </ReactMarkdown>
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
