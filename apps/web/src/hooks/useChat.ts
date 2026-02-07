import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useChatStore } from '../stores/chatStore';

/**
 * Fetch messages for a session
 */
export function useSessionMessages(sessionId: string | undefined) {
  const setMessages = useChatStore((state) => state.setMessages);
  const startToolCall = useChatStore((state) => state.startToolCall);
  const updateToolCall = useChatStore((state) => state.updateToolCall);
  const addReasoningStep = useChatStore((state) => state.addReasoningStep);
  const clearReasoningSteps = useChatStore((state) => state.clearReasoningSteps);

  return useQuery({
    queryKey: ['sessions', sessionId, 'messages'],
    queryFn: async () => {
      if (!sessionId) throw new Error('Session ID is required');
      const session = await apiClient.sessions.get(sessionId);

      // Update chat store with messages
      setMessages(sessionId, session.messages || []);

      // Hydrate persisted tool calls into the store (for refresh/load)
      const existingToolCalls = useChatStore.getState().toolCalls;
      for (const toolCall of (session as any).toolCalls || []) {
        const toolCallId = toolCall.toolCallId || toolCall.id;
        const toolName = toolCall.toolName || toolCall.name;
        if (!toolCallId || !toolName) continue;

        const params = toolCall.parameters || toolCall.params || {};
        const status = toolCall.status;
        const result = toolCall.result;
        const messageId = toolCall.messageId || toolCall.message_id;

        if (!existingToolCalls.has(toolCallId)) {
          startToolCall(sessionId, toolCallId, toolName, params);
        }

        updateToolCall(toolCallId, {
          sessionId,
          messageId,
          toolName,
          params,
          status,
          result: result?.success ? result : undefined,
          error: result?.success === false ? result.error : undefined,
        });
      }

      // Hydrate reasoning steps from message metadata
      // Use a message-specific key format: `msg-{messageId}`
      for (const message of session.messages || []) {
        if (message.role === 'assistant' && message.metadata?.reasoningSteps) {
          const reasoningSteps = message.metadata.reasoningSteps as Array<{
            stepId: string;
            label: string;
            startedAt: number;
            completedAt: number;
            durationMs: number;
            message?: string;
            details?: { queries?: string[]; sources?: string[]; toolName?: string };
            thinkingContent?: string;
          }>;

          // Clear any existing reasoning steps for this message
          const messageKey = `msg-${message.id}`;
          clearReasoningSteps(messageKey);

          // Add each reasoning step
          for (const step of reasoningSteps) {
            addReasoningStep(messageKey, {
              stepId: step.stepId,
              label: step.label,
              status: 'completed',
              startedAt: step.startedAt,
              completedAt: step.completedAt,
              durationMs: step.durationMs,
              message: step.message,
              thinkingContent: step.thinkingContent,
              details: step.details,
            });
          }
        }
      }

      return session.messages || [];
    },
    enabled: !!sessionId,
    staleTime: 30000, // 30 seconds - SSE provides real-time updates, no need for aggressive polling
  });
}
