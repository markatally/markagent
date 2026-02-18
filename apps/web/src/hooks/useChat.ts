import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import type { AgentStep } from '../types';

type PersistedToolCall = {
  toolName?: string;
  name?: string;
  parameters?: Record<string, unknown>;
  params?: Record<string, unknown>;
  result?: {
    output?: unknown;
    artifacts?: Array<{ name?: string; content?: unknown }>;
  };
  createdAt?: string | number | Date;
  messageId?: string;
  message_id?: string;
};

type PersistedComputerStep = {
  stepIndex?: number;
  messageId?: string;
  type?: AgentStep['type'];
  output?: string;
  snapshot?: {
    stepIndex?: number;
    timestamp?: number;
    url?: string;
    screenshot?: string;
    metadata?: {
      actionDescription?: string;
      domSummary?: string;
    };
  };
};

function normalizeUrl(raw: string): string {
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
        /^mkt_tok$/i.test(key) ||
        /^__cf_chl_/i.test(key)
      ) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)]+/g) || [];
  return matches.map((url) => normalizeUrl(url.replace(/[),.]+$/, '')));
}

export function extractPersistedAgentStepsFromMessages(
  messages: Array<{ id: string; role: string; metadata?: Record<string, unknown> | null }>
): AgentStep[] {
  const steps: AgentStep[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const maybeSteps = (message.metadata as any)?.computerTimelineSteps;
    if (!Array.isArray(maybeSteps)) continue;

    for (const rawStep of maybeSteps as PersistedComputerStep[]) {
      if (!rawStep || typeof rawStep !== 'object') continue;
      const type = rawStep.type;
      if (type !== 'browse' && type !== 'search' && type !== 'tool' && type !== 'finalize') continue;
      const snapshot = rawStep.snapshot && typeof rawStep.snapshot === 'object'
        ? {
            stepIndex: steps.length,
            timestamp:
              typeof rawStep.snapshot.timestamp === 'number' && Number.isFinite(rawStep.snapshot.timestamp)
                ? rawStep.snapshot.timestamp
                : Date.now(),
            url: rawStep.snapshot.url,
            screenshot: rawStep.snapshot.screenshot,
            metadata: rawStep.snapshot.metadata,
          }
        : undefined;
      steps.push({
        stepIndex: steps.length,
        messageId: rawStep.messageId ?? message.id,
        type,
        output: rawStep.output,
        snapshot,
      });
    }
  }

  return steps;
}

export function reconstructAgentStepsFromToolCalls(toolCalls: PersistedToolCall[]): AgentStep[] {
  const persistedToolCalls = [...toolCalls].sort((a, b) => {
    const aT = new Date(a?.createdAt ?? 0).getTime();
    const bT = new Date(b?.createdAt ?? 0).getTime();
    return aT - bT;
  });

  const reconstructedSteps: AgentStep[] = [];
  let stepIndex = 0;
  let fallbackTimestamp = Date.now();

  for (const toolCall of persistedToolCalls) {
    const toolName = toolCall?.toolName || toolCall?.name;
    const params = toolCall?.parameters || toolCall?.params || {};
    const result = toolCall?.result;
    const outputText = typeof result?.output === 'string' ? result.output : '';
    const timestamp = Number.isFinite(new Date(toolCall?.createdAt ?? 0).getTime())
      ? new Date(toolCall?.createdAt ?? 0).getTime()
      : ++fallbackTimestamp;

    if (toolName === 'web_search') {
      const query = params?.query || params?.q || 'Web search';
      const messageId = toolCall?.messageId || toolCall?.message_id;
      reconstructedSteps.push({
        stepIndex,
        messageId: typeof messageId === 'string' ? messageId : undefined,
        type: 'search',
        output: String(query),
        snapshot: {
          stepIndex,
          timestamp,
          metadata: {
            actionDescription: `Search: ${String(query)}`,
          },
        },
      });
      stepIndex++;
    }

    const urls = new Set<string>();
    const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
    const searchArtifact = artifacts.find((artifact: any) => artifact?.name === 'search-results.json');

    let parsedResults: Array<{ title?: string; url?: string; content?: string }> = [];
    if (searchArtifact?.content != null) {
      try {
        const raw =
          typeof searchArtifact.content === 'string'
            ? searchArtifact.content
            : JSON.stringify(searchArtifact.content);
        const parsed = JSON.parse(raw) as { results?: Array<any> };
        parsedResults = Array.isArray(parsed?.results) ? parsed.results : [];
        for (const r of parsedResults) {
          if (r?.url) urls.add(normalizeUrl(String(r.url)));
        }
      } catch {
        // Ignore malformed artifact payloads.
      }
    }

    extractUrls(outputText).forEach((u) => urls.add(u));

    if (urls.size > 0) {
      for (const url of urls) {
        const match = parsedResults.find((r) => normalizeUrl(String(r?.url ?? '')) === url);
        const title = match?.title || url;
        const summary = match?.content;
        const messageId = toolCall?.messageId || toolCall?.message_id;
        reconstructedSteps.push({
          stepIndex,
          messageId: typeof messageId === 'string' ? messageId : undefined,
          type: 'browse',
          output: title,
          snapshot: {
            stepIndex,
            timestamp,
            url,
            metadata: {
              actionDescription: 'Visit page',
              ...(summary ? { domSummary: summary } : {}),
            },
          },
        });
        stepIndex++;
      }
    }
  }

  return reconstructedSteps;
}

/**
 * Fetch messages for a session
 */
export function useSessionMessages(sessionId: string | undefined) {
  const setMessages = useChatStore((state) => state.setMessages);
  const setFileArtifacts = useChatStore((state) => state.setFileArtifacts);
  const upsertToolCall = useChatStore((state) => state.upsertToolCall);
  const appendAgentStep = useChatStore((state) => state.appendAgentStep);
  const clearAgentSteps = useChatStore((state) => state.clearAgentSteps);
  const updateAgentStepAt = useChatStore((state) => state.updateAgentStepAt);
  const updateAgentStepSnapshotAt = useChatStore((state) => state.updateAgentStepSnapshotAt);
  const loadComputerStateFromStorage = useChatStore((state) => state.loadComputerStateFromStorage);
  const addReasoningStep = useChatStore((state) => state.addReasoningStep);
  const clearReasoningSteps = useChatStore((state) => state.clearReasoningSteps);
  const startStreaming = useChatStore((state) => state.startStreaming);

  return useQuery({
    queryKey: ['sessions', sessionId, 'messages'],
    queryFn: async () => {
      if (!sessionId) throw new Error('Session ID is required');

      // Refresh-order guard:
      // Load session-scoped persisted Computer timeline before API hydration so we never
      // clobber richer local snapshot history with reconstructed fallback.
      const currentTimeline = useChatStore.getState().agentSteps.get(sessionId);
      if ((currentTimeline?.steps?.length ?? 0) === 0) {
        loadComputerStateFromStorage(sessionId);
      }

      const session = await apiClient.sessions.get(sessionId);

      // Update chat store with messages (ensure each message has current sessionId for file lookups)
      const messages = (session.messages || []).map((m) => ({ ...m, sessionId }));
      setMessages(sessionId, messages);
      const persistedAgentSteps = extractPersistedAgentStepsFromMessages(messages as any);

      // Hydrate persisted tool calls into the store (for refresh/load).
      // Prefer atomic upsert so we don't depend on call ordering across effects/refetches.
      const normalizeStatus = (status: any, result: any) => {
        if (status === 'pending' || status === 'running' || status === 'completed' || status === 'failed') {
          return status;
        }
        // Fallback for legacy/unknown DB values
        if (result?.success === false) return 'failed';
        return 'completed';
      };
      const toEpochMs = (value: unknown): number | undefined => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
          const parsed = new Date(value).getTime();
          if (Number.isFinite(parsed)) return parsed;
        }
        return undefined;
      };

      const persistedToolCallsById = new Map<string, any>();
      // Newer API shape: session.toolCalls (flat list)
      for (const toolCall of (session as any).toolCalls || []) {
        const id = toolCall?.toolCallId || toolCall?.id;
        if (id) persistedToolCallsById.set(id, toolCall);
      }
      // Also support hydrating from session.messages[].toolCalls (in case root toolCalls isn't present)
      for (const message of (session.messages || []) as any[]) {
        for (const toolCall of message?.toolCalls || []) {
          const id = toolCall?.toolCallId || toolCall?.id;
          if (!id) continue;
          // Ensure messageId is present for message-scoped filtering in Inspector
          persistedToolCallsById.set(id, { ...toolCall, messageId: toolCall.messageId ?? message.id });
        }
      }

      for (const toolCall of persistedToolCallsById.values()) {
        const toolCallId = toolCall?.toolCallId || toolCall?.id;
        const toolName = toolCall?.toolName || toolCall?.name;
        if (!toolCallId || !toolName) continue;

        const params = toolCall?.parameters || toolCall?.params || {};
        const result = toolCall?.result;
        const status = normalizeStatus(toolCall?.status, result);
        const messageId = toolCall?.messageId || toolCall?.message_id;
        const startedAt = toEpochMs(toolCall?.startedAt ?? toolCall?.started_at);
        const completedAt = toEpochMs(toolCall?.completedAt ?? toolCall?.completed_at);

        upsertToolCall({
          sessionId,
          messageId,
          toolCallId,
          toolName,
          params,
          status,
          startedAt,
          completedAt,
          result: result?.success ? result : undefined,
          error: result?.success === false ? result?.error : undefined,
        });
      }

      // Hydrate "Computer" replay timeline from persisted tool calls.
      // Only bootstrap when timeline is empty; never clobber an existing rich local timeline.
      // Existing timelines can include screenshots captured from browser events that DB fallback cannot recover.
      try {
        const persistedToolCalls = Array.from(persistedToolCallsById.values()).filter(
          (tc) => (tc?.sessionId ?? sessionId) === sessionId
        );
        const reconstructedSteps = reconstructAgentStepsFromToolCalls(persistedToolCalls);

        const existingTimeline = useChatStore.getState().agentSteps.get(sessionId);
        const existingSteps = existingTimeline?.steps ?? [];
        if (existingSteps.length === 0) {
          clearAgentSteps(sessionId);
          // Deduplicate steps by (type, output, snapshot.url) signature before populating
          const dedupSignature = (step: AgentStep) =>
            [step.type, step.output ?? '', step.snapshot?.url ?? ''].join('|');
          const seen = new Set<string>();
          const sourceSteps = persistedAgentSteps.length > 0 ? persistedAgentSteps : reconstructedSteps;
          for (const step of sourceSteps) {
            const sig = dedupSignature(step);
            if (seen.has(sig)) continue;
            seen.add(sig);
            appendAgentStep(sessionId, step);
          }
        } else if (persistedAgentSteps.length > 0 || reconstructedSteps.length > 0) {
          // Backfill missing screenshots from persisted timeline without replacing existing local state.
          if (persistedAgentSteps.length > 0) {
            const screenshotBySignature = new Map<string, string>();
            const signatureForStep = (step: AgentStep) =>
              [
                step.type,
                step.output ?? '',
                step.snapshot?.url ?? '',
                step.snapshot?.metadata?.actionDescription ?? '',
              ].join('|');

            for (const persisted of persistedAgentSteps) {
              const shot = persisted.snapshot?.screenshot;
              if (!shot) continue;
              const signature = signatureForStep(persisted);
              if (!screenshotBySignature.has(signature)) {
                screenshotBySignature.set(signature, shot);
              }
            }

            existingSteps.forEach((existingStep, index) => {
              if (existingStep.snapshot?.screenshot) return;
              const signature = signatureForStep(existingStep);
              const recovered = screenshotBySignature.get(signature);
              if (!recovered) return;
              updateAgentStepSnapshotAt(sessionId, index, { screenshot: recovered });
            });
          }

          // Reconcile messageId on existing steps using reconstructed signatures.
          // This keeps historical scoping stable and repairs prior mis-associations
          // without replacing snapshots.
          const signatureForStep = (step: AgentStep) =>
            [
              step.type,
              step.output ?? '',
              step.snapshot?.url ?? '',
              step.snapshot?.metadata?.actionDescription ?? '',
            ].join('|');

          const messageIdsBySignature = new Map<string, string[]>();
          for (const reconstructed of reconstructedSteps) {
            if (!reconstructed.messageId) continue;
            const signature = signatureForStep(reconstructed);
            const existing = messageIdsBySignature.get(signature) ?? [];
            existing.push(reconstructed.messageId);
            messageIdsBySignature.set(signature, existing);
          }

          const signatureCursor = new Map<string, number>();
          existingSteps.forEach((existingStep, index) => {
            if (existingStep.messageId) return;
            const signature = signatureForStep(existingStep);
            const candidates = messageIdsBySignature.get(signature);
            if (!candidates || candidates.length === 0) return;

            const cursor = signatureCursor.get(signature) ?? 0;
            const safeCursor = Math.min(cursor, candidates.length - 1);
            signatureCursor.set(signature, cursor + 1);

            const inferredMessageId = candidates[safeCursor];
            if (!inferredMessageId) return;

            updateAgentStepAt(sessionId, index, { messageId: inferredMessageId });
          });
        }
      } catch {
        // Best-effort only; never block message loading.
      }

      // Hydrate reasoning steps from message metadata
      // Use a message-specific key format: `msg-{messageId}`
      for (const message of messages) {
        if (message.role === 'assistant' && (message.metadata as any)?.reasoningSteps) {
          const reasoningSteps = (message.metadata as any).reasoningSteps as Array<{
            stepId: string;
            stepIndex?: number;
            traceId?: string;
            label: string;
            startedAt: number;
            completedAt: number;
            durationMs: number;
            finalStatus?: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
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
              stepIndex: step.stepIndex,
              traceId: step.traceId,
              label: step.label,
              status:
                step.finalStatus === 'FAILED'
                  ? 'failed'
                  : step.finalStatus === 'CANCELED'
                    ? 'canceled'
                    : 'completed',
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

      // Hydrate file artifacts from API (for refresh/load - files persist in DB)
      try {
        const { files } = await apiClient.files.list(sessionId);
        const artifacts = files.map((f) => ({
          type: 'file' as const,
          name: f.filename,
          fileId: f.id,
          size: f.sizeBytes,
          mimeType: f.mimeType,
          content: '',
        }));
        setFileArtifacts(sessionId, artifacts);
      } catch {
        // Ignore - session may have no files or list may fail
      }

      // If the backend indicates an agent turn is still running, resume streaming state
      // so the UI shows a "reconnecting" indicator and SSE auto-reconnect can pick up.
      if ((session as any).taskRunning) {
        const state = useChatStore.getState();
        if (!(state.isStreaming && state.streamingSessionId === sessionId)) {
          startStreaming(sessionId);
        }
      }

      return messages;
    },
    enabled: !!sessionId,
    staleTime: 30000, // 30 seconds - SSE provides real-time updates, no need for aggressive polling
  });
}
