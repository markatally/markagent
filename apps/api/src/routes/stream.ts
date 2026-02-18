import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { prisma } from '../services/prisma';
import { requireAuth, AuthContext } from '../middleware/auth';
import { getLLMClient, LLMMessage, ExtendedLLMMessage } from '../services/llm';
import { getTokenCounter } from '../services/tokens';
import { getConfig } from '../services/config';
import { getToolRegistry, getToolExecutor, type ToolContext } from '../services/tools';
import { getSkillProcessor } from '../services/skills/processor';
import { getDynamicSkillRegistry } from '../services/skills/dynamic-registry';
import { getTaskManager, PptPipelineController } from '../services/tasks';
import { processAgentOutput } from '../services/table';
import path from 'path';
import { getExternalSkillLoader } from '../services/external-skills/loader';
import { getSandboxManager, SandboxOrchestrator } from '../services/sandbox';
import { getBrowserManager, wrapExecutorWithBrowserEvents } from '../services/browser';
import { answerVideoQueryFromTranscript } from '../services/transcript-qa';
import type { ExecutionMode, InspectorTab } from '@mark/shared';
import { decodeVideoSnapshotProgress } from '../services/tools/video_snapshot_progress';

/** Prisma P2003 = foreign key constraint violated (e.g. session deleted during stream) */
function isPrismaForeignKeyError(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2003';
}

// LangGraph imports (optional - for graph-based agent execution)
import {
  createAgentRouter,
  createDefaultSkillRegistry,
  type AgentState,
  type ResearchState,
} from '../services/langgraph';

const stream = new Hono<AuthContext>();
const externalSkillLoader = getExternalSkillLoader();

// All stream routes require authentication
stream.use('*', requireAuth);

/**
 * Agent configuration limits
 */
const AGENT_CONFIG = {
  maxToolSteps: 10,      // Maximum tool execution steps per turn
  maxExecutionTime: 5 * 60 * 1000, // 5 minutes max execution time
  maxVideoExecutionTime: 12 * 60 * 1000, // 12 minutes for video/transcript-heavy turns
  idleTimeout: 30 * 1000, // 30 seconds idle timeout (frontend)
} as const;

/**
 * SSE Event Types (from SPEC.md lines 1147-1199)
 */
type StreamEventType =
  | 'message.start'
  | 'message.delta'
  | 'message.complete'
  | 'reasoning.step'
  | 'thinking.start'
  | 'thinking.delta'
  | 'thinking.complete'
  | 'tool.start'
  | 'tool.progress'
  | 'tool.complete'
  | 'tool.error'
  | 'inspector.focus'
  | 'sandbox.provisioning'
  | 'sandbox.ready'
  | 'sandbox.teardown'
  | 'sandbox.fallback'
  | 'execution.step.start'
  | 'execution.step.update'
  | 'execution.step.end'
  | 'terminal.command'
  | 'terminal.stdout'
  | 'terminal.stderr'
  | 'fs.file.created'
  | 'fs.file.modified'
  | 'fs.tree.snapshot'
  | 'error'
  | 'session.end'
  | 'file.created'
  | 'agent.step_limit';

interface StreamEvent {
  type: StreamEventType;
  sessionId: string;
  timestamp: number;
  data: any;
}

type PersistedComputerStep = {
  stepIndex: number;
  type: 'browse' | 'search' | 'tool' | 'finalize';
  output?: string;
  snapshot?: {
    stepIndex: number;
    timestamp: number;
    url?: string;
    screenshot?: string;
    metadata?: {
      actionDescription?: string;
      domSummary?: string;
    };
  };
};

function normalizeComputerUrl(raw: string | undefined | null): string {
  if (!raw) return '';
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

class ComputerTimelineCollector {
  private steps: PersistedComputerStep[] = [];
  private browserActionStepIndices: number[] = [];
  private visitStepIndices: number[] = [];

  private appendStep(
    step: Omit<PersistedComputerStep, 'stepIndex' | 'snapshot'> & {
      snapshot?: Omit<NonNullable<PersistedComputerStep['snapshot']>, 'stepIndex'>;
    }
  ) {
    const stepIndex = this.steps.length;
    this.steps.push({
      ...step,
      stepIndex,
      snapshot: step.snapshot ? { ...step.snapshot, stepIndex } : undefined,
    });
    return stepIndex;
  }

  captureSsePayload(rawPayload: unknown) {
    if (typeof rawPayload !== 'string') return;
    let parsed: { type?: string; timestamp?: number; data?: any } | null = null;
    try {
      parsed = JSON.parse(rawPayload) as StreamEvent;
    } catch {
      return;
    }
    if (!parsed || typeof parsed.type !== 'string') return;
    const event = parsed;
    const data = event.data ?? {};
    const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now();

    if (event.type === 'browse.activity') {
      const action = data?.action as 'search' | 'visit' | 'read' | undefined;
      if (!action) return;
      const stepIndex = this.appendStep({
        type: action === 'search' ? 'search' : 'browse',
        output:
          action === 'search'
            ? data?.query || 'Search'
            : data?.title || data?.url || action,
        snapshot: {
          timestamp: typeof data?.timestamp === 'number' ? data.timestamp : timestamp,
          url: normalizeComputerUrl(data?.url),
          metadata: {
            actionDescription:
              action === 'search'
                ? `Search: ${data?.query || ''}`.trim()
                : action === 'visit'
                  ? 'Visit page'
                  : 'Read page',
          },
        },
      });
      if (action === 'visit') this.visitStepIndices.push(stepIndex);
      return;
    }

    if (event.type === 'browse.screenshot') {
      const visitIndex =
        typeof data?.visitIndex === 'number' && data.visitIndex >= 0
          ? data.visitIndex
          : -1;
      const targetStepIndex = this.visitStepIndices[visitIndex];
      const screenshot = typeof data?.screenshot === 'string' ? data.screenshot : '';
      if (targetStepIndex == null || !screenshot) return;
      const target = this.steps[targetStepIndex];
      if (!target) return;
      target.snapshot = {
        ...(target.snapshot ?? { stepIndex: targetStepIndex, timestamp }),
        screenshot: `data:image/jpeg;base64,${screenshot}`,
        stepIndex: targetStepIndex,
      };
      return;
    }

    if (event.type === 'browser.action') {
      const actionName = typeof data?.action === 'string' ? data.action : '';
      if (!actionName) return;
      const actionType = actionName.replace('browser_', '');
      const url = normalizeComputerUrl(
        data?.loadedUrl || data?.normalizedUrl || data?.params?.url
      );
      const stepIndex = this.appendStep({
        type: 'browse',
        output: data?.output || data?.error || actionName,
        snapshot: {
          timestamp,
          url,
          metadata: {
            actionDescription: `Browser action: ${actionType}`,
            domSummary: data?.output,
          },
        },
      });
      this.browserActionStepIndices.push(stepIndex);
      return;
    }

    if (event.type === 'browser.screenshot') {
      const screenshot = typeof data?.screenshot === 'string' ? data.screenshot : '';
      if (!screenshot || this.browserActionStepIndices.length === 0) return;
      const actionIndex =
        typeof data?.actionIndex === 'number' && data.actionIndex >= 0
          ? data.actionIndex
          : this.browserActionStepIndices.length - 1;
      const resolvedActionIndex = Math.min(
        actionIndex,
        this.browserActionStepIndices.length - 1
      );
      const targetStepIndex = this.browserActionStepIndices[resolvedActionIndex];
      const target = this.steps[targetStepIndex];
      if (!target) return;
      target.snapshot = {
        ...(target.snapshot ?? { stepIndex: targetStepIndex, timestamp }),
        screenshot: `data:image/jpeg;base64,${screenshot}`,
        stepIndex: targetStepIndex,
      };
      return;
    }

    if (event.type === 'browser.closed') {
      this.appendStep({
        type: 'finalize',
        output: 'Browser session closed',
        snapshot: {
          timestamp,
          metadata: { actionDescription: 'Browser closed' },
        },
      });
      return;
    }

    if (event.type === 'tool.complete') {
      const toolName = typeof data?.toolName === 'string' ? data.toolName : '';
      if (toolName !== 'web_search') return;
      // Match frontend behavior: when browser actions exist, avoid synthetic search-result cards.
      if (this.browserActionStepIndices.length > 0) return;

      const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
      const searchArtifact = artifacts.find(
        (artifact: any) => artifact?.name === 'search-results.json'
      );
      if (!searchArtifact || searchArtifact.content == null) return;

      try {
        const raw =
          typeof searchArtifact.content === 'string'
            ? searchArtifact.content
            : JSON.stringify(searchArtifact.content);
        const parsed = JSON.parse(raw) as {
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        const results = Array.isArray(parsed.results) ? parsed.results : [];
        for (const result of results) {
          const url = normalizeComputerUrl(result?.url);
          if (!url) continue;
          this.appendStep({
            type: 'browse',
            output: result?.title || url,
            snapshot: {
              timestamp,
              url,
              metadata: {
                actionDescription: 'Visit page',
                ...(result?.content ? { domSummary: result.content } : {}),
              },
            },
          });
        }
      } catch {
        // Ignore malformed artifact payloads.
      }
    }
  }

  getSteps(): PersistedComputerStep[] {
    return this.steps;
  }
}

function createTimelineCapturingStream(
  baseStream: { writeSSE: (payload: { data: string }) => Promise<void> },
  collector: ComputerTimelineCollector
) {
  return {
    ...baseStream,
    writeSSE: async (payload: { data: string }) => {
      collector.captureSsePayload(payload?.data);
      await baseStream.writeSSE(payload);
    },
  };
}

const inferFocusTab = (
  goal: { requiresPPT?: boolean; requiresSearch?: boolean } | null,
  executionMode: ExecutionMode
): { tab: InspectorTab; reason: string } => {
  if (executionMode === 'sandbox') {
    return { tab: 'computer', reason: 'Sandbox execution enabled' };
  }
  if (goal?.requiresPPT) {
    return { tab: 'computer', reason: 'Presentation generation uses Computer view' };
  }
  if (goal?.requiresSearch) {
    return { tab: 'computer', reason: 'Search workflows are tracked in Computer view' };
  }
  return { tab: 'reasoning', reason: 'Default reasoning trace' };
};

function sanitizeModelFacingContent(content: string): string {
  if (!content) return '';

  let sanitized = content;

  // Remove explicit chain-of-thought tags if model emits them.
  sanitized = sanitized.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  sanitized = sanitized.replace(/^[\s\S]*?<\/think>/i, '');
  sanitized = sanitized.replace(/<\/?think\b[^>]*>/gi, '');

  return sanitized.trim();
}

function looksLikeOffTopicCodeReplyForVideoTask(content: string): boolean {
  const text = content.toLowerCase();
  const codeSignals = [
    'python',
    'input.txt',
    'with open(',
    'print(line',
    'file not found',
    'def ',
    '```python',
  ];
  const videoSignals = [
    'video',
    'transcript',
    'subtitle',
    'summary',
    'summarize',
    'bilibili',
    'timestamp',
  ];

  const codeSignalCount = codeSignals.reduce(
    (count, signal) => (text.includes(signal) ? count + 1 : count),
    0
  );
  const hasVideoSignal = videoSignals.some((signal) => text.includes(signal));

  return codeSignalCount >= 2 && !hasVideoSignal;
}

function isVideoSummaryIntentText(text: string): boolean {
  return /\b(?:summar(?:y|ize|ise|ized|ised|ization|isation)|recap|overview)\b|总结|分析|概述|复盘|解读|梳理/i.test(
    text
  );
}

function isVideoContentIntentText(text: string): boolean {
  return (
    isVideoSummaryIntentText(text) ||
    /视频|video|transcript|字幕|内容|讲了什么|有没有提到|细节|详细|展开|上面总结|more detailed|in detail|elaborate/i.test(
      text
    )
  );
}

function isTranscriptSegmentFollowupText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  const hasSegmentCue =
    /(前面|后面|前半|后半|上半|下半|前\d+\s*\/\s*\d+|后\d+\s*\/\s*\d+|前[一二两三四五六七八九十\d]+分之[一二两三四五六七八九十\d]+|后[一二两三四五六七八九十\d]+分之[一二两三四五六七八九十\d]+)/i.test(
      text
    ) ||
    /\b(first|last)\s+(half|third|quarter|\d+\s*\/\s*\d+)\b/.test(normalized);
  if (!hasSegmentCue) return false;
  return /讲了啥|讲了什么|说了什么|内容|重点|总结|概述|提到|what.*(cover|talk|say)|covered|talks about/i.test(
    normalized
  );
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

async function inferTranscriptFollowupIntentWithLlm(params: {
  llm: any;
  query: string;
  sessionHasTranscriptContext: boolean;
}): Promise<boolean> {
  const { llm, query, sessionHasTranscriptContext } = params;
  if (!llm?.streamChat) return false;
  const trimmed = String(query || '').trim();
  if (!trimmed) return false;

  const system = [
    'You classify whether a user follow-up should be answered from existing video transcript context.',
    'Return JSON only: {"useTranscriptContext": true|false}.',
    'Be language-agnostic. Consider all languages.',
    'If the user asks what a video/section/part/half/timestamp says, return true.',
    'If unrelated to transcript content, return false.',
  ].join('\n');

  const user = [
    `User query: ${trimmed}`,
    `Session has prior transcript context: ${sessionHasTranscriptContext ? 'yes' : 'no'}`,
    'Output JSON now.',
  ].join('\n');

  let raw = '';
  try {
    for await (const chunk of llm.streamChat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])) {
      if (chunk.type === 'content' && chunk.content) raw += chunk.content;
    }
    const json = extractFirstJsonObject(raw);
    if (!json) return false;
    const parsed = JSON.parse(json) as { useTranscriptContext?: unknown };
    return Boolean(parsed?.useTranscriptContext === true);
  } catch {
    return false;
  }
}

function isLikelyVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('/video/') ||
    lower.includes('youtube.com/watch') ||
    lower.includes('youtu.be/') ||
    lower.includes('vimeo.com/') ||
    lower.includes('bilibili.com/video/')
  );
}

function extractFirstVideoUrlFromText(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s)]+/gi) || [];
  const candidate = urls.find((url) => isLikelyVideoUrl(url));
  return candidate || null;
}

async function loadLatestTranscriptToolMessageForSession(
  sessionId: string,
  requestedVideoUrl?: string
): Promise<{ toolMessage: ExtendedLLMMessage } | null> {
  const calls = await prisma.toolCall.findMany({
    where: {
      sessionId,
      toolName: 'video_transcript',
      status: 'completed',
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      parameters: true,
      result: true,
    },
  });

  for (const call of calls) {
    const params = (call.parameters || {}) as Record<string, unknown>;
    const paramUrl = typeof params?.url === 'string' ? params.url : '';
    if (requestedVideoUrl && paramUrl && paramUrl !== requestedVideoUrl) {
      continue;
    }

    let resultObj: Record<string, unknown> | null = null;
    if (call.result && typeof call.result === 'object') {
      resultObj = call.result as Record<string, unknown>;
    } else if (typeof call.result === 'string') {
      try {
        resultObj = JSON.parse(call.result) as Record<string, unknown>;
      } catch {
        resultObj = null;
      }
    }
    if (!resultObj) continue;

    const output = typeof resultObj.output === 'string' ? resultObj.output : '';
    if (!output.includes('--- Transcript ---')) continue;

    const payload = JSON.stringify({
      success: true,
      output,
      error: null,
      artifacts: Array.isArray(resultObj.artifacts) ? resultObj.artifacts : [],
      previewSnapshots: undefined,
    });

    return {
      toolMessage: {
        role: 'tool',
        content: payload,
        tool_call_id: `historical-video-transcript-${call.id}`,
      },
    };
  }

  return null;
}

function findLastVideoDurationSeconds(messages: ExtendedLLMMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'tool' || !msg.content) continue;
    try {
      const parsed = JSON.parse(String(msg.content));
      const artifacts = Array.isArray(parsed?.artifacts) ? parsed.artifacts : [];
      for (const artifact of artifacts) {
        if (artifact?.name !== 'video-probe.json' || typeof artifact?.content !== 'string') continue;
        const probe = JSON.parse(artifact.content);
        const duration = Number(probe?.duration);
        if (Number.isFinite(duration) && duration > 0) return duration;
      }
    } catch {
      // ignore malformed tool messages
    }
  }
  return null;
}

function normalizeVideoUrl(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return raw;
  }
}

function computeDynamicTurnTimeoutMs(
  isVideoHeavyTurn: boolean,
  durationSeconds: number | null
): number {
  if (!isVideoHeavyTurn) return AGENT_CONFIG.maxExecutionTime;
  if (!durationSeconds) return AGENT_CONFIG.maxVideoExecutionTime;
  // Dynamic scaling with media length.
  return Math.max(
    AGENT_CONFIG.maxVideoExecutionTime,
    Math.round((durationSeconds * 2 + 8 * 60) * 1000)
  );
}

/**
 * Process a single agent turn with continuation loop support
 *
 * This implements the correct tool-calling flow:
 * 1. LLM generates response (with or without tool calls)
 * 2. If tool calls: execute tools, add results to history, RECALL LLM
 * 3. If no tool calls: final answer, save and return
 *
 * When PPT pipeline is enabled, callers pass activeStream (PptPipelineController.wrapStream(sseStream))
 * so that tool.complete and other events are seen by the pipeline and can trigger navigateToResults.
 */

/**
 * Extract the transcript text from the most recent video_transcript tool result in message history.
 */
function findLastTranscriptToolResult(messages: ExtendedLLMMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'tool' || !msg.content) continue;
    try {
      const parsed = JSON.parse(String(msg.content));
      if (parsed.success && typeof parsed.output === 'string' && parsed.output.includes('--- Transcript ---')) {
        const marker = '--- Transcript ---';
        const idx = parsed.output.indexOf(marker);
        return idx >= 0 ? parsed.output.slice(idx + marker.length).trim() : null;
      }
    } catch { /* skip non-JSON tool results */ }
  }
  return null;
}

export async function processAgentTurn(
  sessionId: string,
  messages: ExtendedLLMMessage[],
  tools: any,
  toolContext: ToolContext,
  taskManager: any,
  prisma: any,
  llmClient: any,
  toolExecutor: any,
  sseStream: any,
  startTime: number,
  maxSteps: number = AGENT_CONFIG.maxToolSteps
): Promise<{
  content: string;
  finishReason: string;
  stepsTaken: number;
  reasoningSteps: typeof completedReasoningSteps;
}> {
  let currentMessages = [...messages];
  let steps = 0;
  let finalContent = '';
  let toolResultsThisTurn = 0;
  let videoTranscriptSucceeded = findLastTranscriptToolResult(currentMessages) != null;
  let videoTranscriptAttempted = videoTranscriptSucceeded;
  let videoProbeSucceeded = findLastVideoDurationSeconds(currentMessages) != null;
  let videoProbeAttempted = videoProbeSucceeded;
  const queryFromTask = String(taskManager.getTaskState?.(sessionId)?.goal?.description || '');

  const reasoningTimers = new Map<string, number>();
  const reasoningEventSeq = new Map<string, number>();
  const reasoningStepIndex = new Map<string, number>();
  const queuedReasoningEvents: Array<{
    stepId: string;
    label: string;
    status: 'running' | 'completed';
    message?: string;
    details?: { queries?: string[]; sources?: string[]; toolName?: string };
    thinkingContent?: string;
    finalStatus?: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  }> = [];
  let activeReasoningStepId: string | null = null;
  let nextReasoningStepIndex = 1;
  let lastReasoningTimestamp = 0;
  const reasoningTraceId = `reasoning-trace-${sessionId}-${Date.now()}`;
  const searchToolNames = new Set(['web_search', 'paper_search']);
  const videoToolNames = new Set(['video_download', 'video_probe', 'video_transcript']);
  const videoToolLabels: Record<string, string> = {
    video_probe: 'Probing video',
    video_download: 'Downloading video',
    video_transcript: 'Extracting transcript',
  };
  let reasoningStepCounter = 0;
  let pendingThinkingStepId: string | null = null;
  let generatingStepId: string | null = null;
  let planningStepId: string | null = null;
  let videoToolReminderAttempts = 0;

  const maybeAnswerFromTranscriptContext = async (): Promise<boolean> => {
    const transcriptText = findLastTranscriptToolResult(currentMessages);
    if (!transcriptText) return false;

    const shouldUseTranscriptQa =
      isVideoContentIntentText(queryFromTask) ||
      isTranscriptSegmentFollowupText(queryFromTask) ||
      Boolean(taskManager.getTaskState?.(sessionId)?.goal?.requiresTranscript) ||
      Boolean(taskManager.getTaskState?.(sessionId)?.goal?.videoUrl);
    if (!shouldUseTranscriptQa) return false;

    try {
      const transcriptQa = await answerVideoQueryFromTranscript({
        llm: llmClient,
        userQuery: queryFromTask,
        transcriptText,
      });
      const content = sanitizeModelFacingContent(String(transcriptQa.content || ''));
      if (!content) return false;
      finalContent = content;
      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'message.delta',
          sessionId,
          timestamp: Date.now(),
          data: { content: finalContent, step: steps + 1 },
        }),
      });
      return true;
    } catch {
      return false;
    }
  };

  // Collector array for completed reasoning steps to persist in message metadata
  const completedReasoningSteps: Array<{
    stepId: string;
    stepIndex: number;
    traceId: string;
    label: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    finalStatus: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
    message?: string;
    details?: { queries?: string[]; sources?: string[]; toolName?: string };
    thinkingContent?: string;
  }> = [];

  const emitReasoningStep = async ({
    stepId,
    label,
    status,
    message,
    details,
    thinkingContent,
    finalStatus,
  }: {
    stepId: string;
    label: string;
    status: 'running' | 'completed';
    message?: string;
    details?: { queries?: string[]; sources?: string[]; toolName?: string };
    thinkingContent?: string;
    finalStatus?: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  }) => {
    if (status === 'completed' && !reasoningTimers.has(stepId)) {
      await emitReasoningStep({
        stepId,
        label,
        status: 'running',
        message: message || 'Step started.',
        details,
        thinkingContent,
      });
    }

    if (activeReasoningStepId && activeReasoningStepId !== stepId) {
      queuedReasoningEvents.push({
        stepId,
        label,
        status,
        message,
        details,
        thinkingContent,
        finalStatus,
      });
      return;
    }

    if (!reasoningStepIndex.has(stepId)) {
      reasoningStepIndex.set(stepId, nextReasoningStepIndex++);
    }
    const stepIndex = reasoningStepIndex.get(stepId)!;

    const eventSeq = (reasoningEventSeq.get(stepId) || 0) + 1;
    reasoningEventSeq.set(stepId, eventSeq);

    const now = Math.max(Date.now(), lastReasoningTimestamp + 1);
    lastReasoningTimestamp = now;
    const lifecycle: 'STARTED' | 'UPDATED' | 'FINISHED' =
      status === 'running' ? (eventSeq === 1 ? 'STARTED' : 'UPDATED') : 'FINISHED';

    if (status === 'running') {
      activeReasoningStepId = stepId;
      reasoningTimers.set(stepId, now);
    }
    const startedAt = reasoningTimers.get(stepId);
    const durationMs = status === 'completed' && startedAt ? now - startedAt : undefined;

    // Collect completed steps for persistence
    if (status === 'completed' && startedAt && durationMs !== undefined) {
      completedReasoningSteps.push({
        stepId,
        stepIndex,
        traceId: reasoningTraceId,
        label,
        startedAt,
        completedAt: now,
        durationMs,
        finalStatus: finalStatus ?? 'SUCCEEDED',
        message,
        details,
        thinkingContent,
      });
      activeReasoningStepId = null;
    }

    await sseStream.writeSSE({
      data: JSON.stringify({
        type: 'reasoning.step',
        sessionId,
        timestamp: now,
        data: {
          eventId: `${reasoningTraceId}:${stepId}:${eventSeq}`,
          traceId: reasoningTraceId,
          stepId,
          stepIndex,
          eventSeq,
          lifecycle,
          label,
          status,
          finalStatus: status === 'completed' ? finalStatus ?? 'SUCCEEDED' : undefined,
          message,
          durationMs,
          details,
          thinkingContent,
        },
      }),
    });

    if (!activeReasoningStepId && queuedReasoningEvents.length > 0) {
      const queued = queuedReasoningEvents.shift()!;
      await emitReasoningStep(queued);
    }
  };

  // Emit initial step (will be relabeled based on whether tools are used)
  planningStepId = `planning-${Date.now()}-${reasoningStepCounter++}`;
  await emitReasoningStep({
    stepId: planningStepId,
    label: 'Analyzing',
    status: 'running',
    message: 'Processing query...',
  });

  const initialGoal = taskManager.getTaskState?.(sessionId)?.goal;
  const isVideoHeavyTurn = Boolean(
    initialGoal &&
      (initialGoal.requiresTranscript || initialGoal.requiresVideoDownload || initialGoal.requiresVideoProbe)
  );
  // === CONTINUATION LOOP ===
  while (steps < maxSteps) {
    if (await maybeAnswerFromTranscriptContext()) {
      if (generatingStepId) {
        await emitReasoningStep({
          stepId: generatingStepId,
          label: 'Generating response',
          status: 'completed',
          message: 'Response ready.',
        });
        generatingStepId = null;
      }
      return {
        content: finalContent,
        finishReason: 'stop',
        stepsTaken: steps,
        reasoningSteps: completedReasoningSteps,
      };
    }

    const observedVideoDurationSeconds = findLastVideoDurationSeconds(currentMessages);
    const turnTimeoutMs = computeDynamicTurnTimeoutMs(isVideoHeavyTurn, observedVideoDurationSeconds);
    // Check execution timeout
    const elapsed = Date.now() - startTime;
    if (elapsed > turnTimeoutMs) {
      const timeoutMessage = isVideoHeavyTurn
        ? 'The video analysis took too long and timed out before completion. Please retry; I will prioritize transcript extraction and summary generation first.'
        : 'The request took too long and timed out before completion. Please retry.';

      if (generatingStepId) {
        await emitReasoningStep({
          stepId: generatingStepId,
          label: 'Generating response',
          status: 'completed',
          message: 'Execution timed out.',
          finalStatus: 'FAILED',
        });
        generatingStepId = null;
      }

      return {
        content: timeoutMessage,
        finishReason: 'timeout',
        stepsTaken: steps,
        reasoningSteps: completedReasoningSteps,
      };
    }

    let hasToolCalls = false;
    const toolCallsCollected: Array<{ id: string; name: string; arguments: string }> = [];
    let stepContent = '';
    let thinkingContentEmitted = false;

    // === Step 1: Stream from LLM ===
    for await (const chunk of llmClient.streamChat(currentMessages, tools)) {
      if (chunk.type === 'content' && chunk.content) {
        stepContent += chunk.content;

        // Update planning step to "Generating response" when first token arrives
        if (planningStepId) {
          await emitReasoningStep({
            stepId: planningStepId,
            label: 'Generating response',
            status: 'running',
            message: 'Streaming response...',
          });
          generatingStepId = planningStepId;
          planningStepId = null;
        }
        if (pendingThinkingStepId) {
          await emitReasoningStep({
            stepId: pendingThinkingStepId,
            label: 'Thinking',
            status: 'completed',
            message: 'Thought through results.',
          });
          pendingThinkingStepId = null;
          
          // Start generating step after thinking
          if (!generatingStepId) {
            generatingStepId = `generating-${steps + 1}-${reasoningStepCounter++}`;
            await emitReasoningStep({
              stepId: generatingStepId,
              label: 'Generating response',
              status: 'running',
              message: 'Drafting response...',
            });
          }
        }

        // Intentionally do not stream draft content immediately.
        // If this pass later switches to tool calls, draft text can be unrelated/noisy.
        // We only emit user-facing content once we know this pass is a final answer.
      }
      else if (chunk.type === 'tool_call' && chunk.toolCall) {
        hasToolCalls = true;
        toolCallsCollected.push(chunk.toolCall);

        if (!thinkingContentEmitted && stepContent.trim().length > 0) {
          thinkingContentEmitted = true;
          await emitReasoningStep({
            stepId: `reasoning-${steps + 1}-${reasoningStepCounter++}`,
            label: 'Reasoning',
            status: 'completed',
            message: 'Drafted approach before tools.',
            thinkingContent: sanitizeModelFacingContent(stepContent.trim()),
          });
        }

        // Complete analyzing/planning or thinking when tool calls begin
        if (planningStepId) {
          await emitReasoningStep({
            stepId: planningStepId,
            label: 'Analyzing',
            status: 'completed',
            message: 'Analysis complete, calling tools.',
          });
          planningStepId = null;
        }
        if (pendingThinkingStepId) {
          await emitReasoningStep({
            stepId: pendingThinkingStepId,
            label: 'Thinking',
            status: 'completed',
            message: 'Thought through results.',
          });
          pendingThinkingStepId = null;
        }
        if (generatingStepId) {
          await emitReasoningStep({
            stepId: generatingStepId,
            label: 'Generating response',
            status: 'completed',
            message: 'Switching to tools...',
          });
          generatingStepId = null;
        }
      }
      else if (chunk.type === 'done') {
        // No more chunks
      }
    }

    // === Step 2: Process based on what LLM returned ===
    if (!hasToolCalls) {
      const taskState = taskManager.getTaskState?.(sessionId);
      const taskGoal = taskState?.goal;
      const requiresVideoProcessing = Boolean(
        taskGoal?.videoUrl &&
          (taskGoal.requiresVideoProbe || taskGoal.requiresVideoDownload || taskGoal.requiresTranscript)
      );
      const requiresTranscriptForTask = Boolean(taskGoal?.requiresTranscript);

      if (
        requiresVideoProcessing &&
        requiresTranscriptForTask &&
        !videoTranscriptSucceeded &&
        !videoTranscriptAttempted &&
        videoToolReminderAttempts < 2
      ) {
        videoToolReminderAttempts += 1;

        currentMessages.push({
          role: 'assistant',
          content: stepContent || null,
        });
        currentMessages.push({
          role: 'system',
          content: [
            `This request is a video-processing task for URL: ${taskGoal?.videoUrl || '(unknown)'}.`,
            'Run the relevant video tools first (video_probe and video_transcript; use video_download only when needed).',
            'Then answer using the extracted transcript/tool evidence.',
          ].join(' '),
        });

        await emitReasoningStep({
          stepId: `video-routing-${steps + 1}-${reasoningStepCounter++}`,
          label: 'Analyzing',
          status: 'running',
          message: 'Retrying with required video tools before final response.',
        });

        steps += 1;
        continue;
      }

      if (
        requiresVideoProcessing &&
        requiresTranscriptForTask &&
        !videoTranscriptSucceeded
      ) {
        finalContent = videoTranscriptAttempted
          ? 'I could not complete the video summary because transcript extraction did not return usable transcript content. Please retry and I will re-run transcript extraction before summarizing.'
          : 'I could not complete the video summary because required video tools were not executed. Please retry; I will run video_probe and video_transcript for the provided video URL before summarizing.';

        if (generatingStepId) {
          await emitReasoningStep({
            stepId: generatingStepId,
            label: 'Generating response',
            status: 'completed',
            message: 'Video tool routing failed.',
            finalStatus: 'FAILED',
          });
          generatingStepId = null;
        }

        return {
          content: finalContent,
          finishReason: 'stop',
          stepsTaken: steps,
          reasoningSteps: completedReasoningSteps,
        };
      }

      // No tool calls = final answer
      // Process any structured table JSON blocks into rendered markdown
      finalContent = processAgentOutput(sanitizeModelFacingContent(stepContent));
      if (
        requiresVideoProcessing &&
        looksLikeOffTopicCodeReplyForVideoTask(finalContent)
      ) {
        finalContent =
          'I extracted context for a video task, but the drafted response was not aligned with video summarization. ' +
          'Please retry and I will summarize the video from the transcript content only.';
      }

      const taskGoalForGuard = taskManager.getTaskState?.(sessionId)?.goal;
      const userQueryForGuard = String(taskGoalForGuard?.description || '');
      const transcriptToolResult = findLastTranscriptToolResult(currentMessages);
      const hasTranscriptContext = transcriptToolResult != null;
      const transcriptIntentByRules =
        isVideoContentIntentText(userQueryForGuard) ||
        isTranscriptSegmentFollowupText(userQueryForGuard) ||
        Boolean(taskGoalForGuard?.requiresTranscript || taskGoalForGuard?.videoUrl);
      const transcriptIntentByLlm =
        hasTranscriptContext && !transcriptIntentByRules
          ? await inferTranscriptFollowupIntentWithLlm({
              llm: llmClient,
              query: userQueryForGuard,
              sessionHasTranscriptContext: true,
            })
          : false;
      const shouldUseTranscriptQa = Boolean(
        hasTranscriptContext && (transcriptIntentByRules || transcriptIntentByLlm)
      );

      if (shouldUseTranscriptQa) {
        try {
          const transcriptQa = await answerVideoQueryFromTranscript({
            llm: llmClient,
            userQuery: userQueryForGuard,
            transcriptText: transcriptToolResult!,
          });
          if (transcriptQa.content) {
            finalContent = transcriptQa.content;
          }
        } catch {
          // Keep natural model output if semantic transcript QA fails unexpectedly.
        }
      }

      const isVideoSummaryForGuard = Boolean(
        taskGoalForGuard?.videoUrl && isVideoSummaryIntentText(userQueryForGuard)
      );
      if (isVideoSummaryForGuard && !videoTranscriptSucceeded && finalContent.length > 100) {
        finalContent =
          'I could not obtain transcript evidence for this video yet. Please retry and I will analyze once transcript extraction completes.';
      }

      if (finalContent) {
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'message.delta',
            sessionId,
            timestamp: Date.now(),
            data: { content: finalContent, step: steps + 1 },
          }),
        });
      }

      if (generatingStepId) {
        await emitReasoningStep({
          stepId: generatingStepId,
          label: 'Generating response',
          status: 'completed',
          message: 'Response ready.',
        });
        generatingStepId = null;
      }

      return {
        content: finalContent,
        finishReason: 'stop',
        stepsTaken: steps,
        reasoningSteps: completedReasoningSteps,
      };
    }

    // === Step 3: Has tool calls - execute them and continue ===
    // Add assistant message with tool_calls to history
    currentMessages.push({
      role: 'assistant',
      content: stepContent || null,
      tool_calls: toolCallsCollected.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Execute each tool
    for (const toolCall of toolCallsCollected) {
      let params: Record<string, any> = {};
      try {
        params = JSON.parse(toolCall.arguments || '{}');
      } catch {
        // Keep empty params if JSON parsing fails
      }
      const taskStateForTool = taskManager.getTaskState?.(sessionId);
      const taskGoalForTool = taskStateForTool?.goal;
      const targetVideoUrl = normalizeVideoUrl(
        typeof taskGoalForTool?.videoUrl === 'string' ? taskGoalForTool.videoUrl : ''
      );
      const toolVideoUrl = normalizeVideoUrl(typeof params.url === 'string' ? params.url : '');
      const sameVideoScope = !targetVideoUrl || !toolVideoUrl || targetVideoUrl === toolVideoUrl;

      if (toolCall.name === 'video_probe') {
        videoProbeAttempted = true;
      }
      if (toolCall.name === 'video_transcript') {
        videoTranscriptAttempted = true;
      }

      // Video download should only run when explicitly requested by the user intent.
      if (toolCall.name === 'video_download' && !taskGoalForTool?.requiresVideoDownload) {
        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: videoToolLabels[toolCall.name] || 'Executing tool',
          status: 'running',
          message: `Running ${toolCall.name}...`,
          details: {
            toolName: toolCall.name,
          },
        });
        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: videoToolLabels[toolCall.name] || 'Executing tool',
          status: 'completed',
          message: 'Skipped unnecessary video download.',
          finalStatus: 'CANCELED',
          details: {
            toolName: toolCall.name,
          },
        });
        currentMessages.push({
          role: 'tool',
          content: JSON.stringify({
            success: false,
            error:
              'video_download skipped because user did not request downloading. Use video_probe/video_transcript instead.',
          }),
          tool_call_id: toolCall.id,
        });
        continue;
      }

      if (toolCall.name === 'video_probe' && sameVideoScope && videoProbeSucceeded) {
        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: videoToolLabels[toolCall.name] || 'Executing tool',
          status: 'running',
          message: `Running ${toolCall.name}...`,
          details: {
            toolName: toolCall.name,
          },
        });
        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: videoToolLabels[toolCall.name] || 'Executing tool',
          status: 'completed',
          message: 'Skipped duplicate video probe for the same URL.',
          finalStatus: 'CANCELED',
          details: {
            toolName: toolCall.name,
          },
        });
        continue;
      }

      if (toolCall.name === 'video_transcript' && sameVideoScope && videoTranscriptSucceeded) {
        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: videoToolLabels[toolCall.name] || 'Executing tool',
          status: 'running',
          message: `Running ${toolCall.name}...`,
          details: {
            toolName: toolCall.name,
          },
        });
        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: videoToolLabels[toolCall.name] || 'Executing tool',
          status: 'completed',
          message: 'Skipped duplicate transcript extraction for the same URL.',
          finalStatus: 'CANCELED',
          details: {
            toolName: toolCall.name,
          },
        });
        continue;
      }
      if (
        toolCall.name === 'video_transcript' &&
        taskStateForTool?.goal?.requiresTranscript &&
        params.includeTimestamps === false
      ) {
        params.includeTimestamps = true;
      }
      if (toolCall.name === 'video_transcript' && !params.durationSeconds) {
        const durationSeconds = findLastVideoDurationSeconds(currentMessages);
        if (durationSeconds) {
          params.durationSeconds = durationSeconds;
        }
      }
      let videoSnapshotActionIndex = 0;
      let videoSnapshotBrowserLaunched = false;
      const isSearch = searchToolNames.has(toolCall.name);
      const queries = Array.isArray((params as any).queries)
        ? (params as any).queries
        : (params as any).query
          ? [(params as any).query]
          : undefined;

      await emitReasoningStep({
        stepId: `tool-${toolCall.id}`,
        label: isSearch ? 'Searching' : videoToolLabels[toolCall.name] || 'Executing tool',
        status: 'running',
        message: isSearch
          ? `Executing ${queries?.length || 1} search quer${queries?.length === 1 ? 'y' : 'ies'}...`
          : `Running ${toolCall.name}...`,
        details: {
          queries,
          toolName: toolCall.name,
        },
      });

      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'tool.start',
          sessionId,
          timestamp: Date.now(),
          data: {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            params,
            step: steps + 1,
          },
        }),
      });

      if (toolCall.name === 'web_search') {
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'inspector.focus',
            sessionId,
            timestamp: Date.now(),
            data: {
              tab: 'computer',
              reason: 'Web search is tracked in Computer view',
            },
          }),
        });
      }

      // Check if tool call should be allowed
      const toolCheck = taskManager.getToolCallDecision(
        sessionId,
        toolCall.name,
        params
      );

      if (!toolCheck.allowed) {
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'tool.error',
            sessionId,
            timestamp: Date.now(),
            data: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              error: toolCheck.reason || 'Tool call not allowed',
              step: steps + 1,
            },
          }),
        });

        // Add error result to history so LLM knows
        currentMessages.push({
          role: 'tool',
          content: JSON.stringify({ success: false, error: toolCheck.reason }),
          tool_call_id: toolCall.id,
        });

        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: searchToolNames.has(toolCall.name) ? 'Searching' : videoToolLabels[toolCall.name] || 'Executing tool',
          status: 'completed',
          message: toolCheck.reason || 'Tool call not allowed.',
          finalStatus: 'CANCELED',
          details: {
            toolName: toolCall.name,
          },
        });

        continue;
      }

      // Execute the tool
      try {
        const result = await toolExecutor.execute(toolCall.name, params, {
          onProgress: async (current: number, total: number, message?: string) => {
            let progressMessage = message;
            if (videoToolNames.has(toolCall.name)) {
              const snapshot = decodeVideoSnapshotProgress(message);
              if (snapshot) {
                const videoUrl =
                  snapshot.sourceUrl ||
                  (typeof params.url === 'string' ? params.url : '');
                const atSeconds = Math.max(0, Math.floor(snapshot.atSeconds));
                const hrs = Math.floor(atSeconds / 3600);
                const mins = Math.floor((atSeconds % 3600) / 60);
                const secs = atSeconds % 60;
                const displayTime =
                  hrs > 0
                    ? `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
                    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

                if (!videoSnapshotBrowserLaunched) {
                  videoSnapshotBrowserLaunched = true;
                  await sseStream.writeSSE({
                    data: JSON.stringify({
                      type: 'browser.launched',
                      sessionId,
                      timestamp: Date.now(),
                      data: { message: 'Video snapshot session started' },
                    }),
                  });
                  if (videoUrl) {
                    await sseStream.writeSSE({
                      data: JSON.stringify({
                        type: 'browser.navigated',
                        sessionId,
                        timestamp: Date.now(),
                        data: { url: videoUrl, title: 'Video timeline snapshots' },
                      }),
                    });
                  }
                }

                await sseStream.writeSSE({
                  data: JSON.stringify({
                    type: 'browser.action',
                    sessionId,
                    timestamp: Date.now(),
                    data: {
                      action: 'browser_screenshot',
                      output: `Video snapshot at ${displayTime}`,
                      params: videoUrl ? { url: videoUrl } : {},
                    },
                  }),
                });

                await sseStream.writeSSE({
                  data: JSON.stringify({
                    type: 'browser.screenshot',
                    sessionId,
                    timestamp: Date.now(),
                    data: {
                      screenshot: snapshot.screenshotBase64,
                      actionIndex: videoSnapshotActionIndex,
                    },
                  }),
                });

                videoSnapshotActionIndex += 1;
                progressMessage = `Captured video snapshot ${snapshot.index + 1}/${snapshot.total} at ${displayTime}`;
              }
            }

            await sseStream.writeSSE({
              data: JSON.stringify({
                type: 'tool.progress',
                sessionId,
                timestamp: Date.now(),
                data: {
                  toolCallId: toolCall.id,
                  toolName: toolCall.name,
                  current,
                  total,
                  message: progressMessage,
                  step: steps + 1,
                },
              }),
            });
          },
        });

        // Record tool call
        taskManager.recordToolCall(sessionId, toolCall.name, params, result, result.success);

        // Save to database
        await prisma.toolCall.create({
          data: {
            sessionId,
            toolName: toolCall.name,
            parameters: params,
            result: result,
            status: result.success ? 'completed' : 'failed',
            durationMs: result.duration,
          },
        });

        // Emit file.created event for artifacts
        if (result.success && result.artifacts && result.artifacts.length > 0) {
          for (const artifact of result.artifacts) {
            if (artifact.fileId) {
              await sseStream.writeSSE({
                data: JSON.stringify({
                  type: 'file.created',
                  sessionId,
                  timestamp: Date.now(),
                  data: {
                    fileId: artifact.fileId,
                    filename: artifact.name,
                    mimeType: artifact.mimeType,
                    size: artifact.size,
                    type: artifact.type,
                  },
                }),
              });
            }
          }
        }

        // CRITICAL: Add tool result to history for next LLM call
        const toolResultContent = JSON.stringify({
          success: result.success,
          output: result.output,
          error: result.error,
          artifacts: result.artifacts,
          previewSnapshots: result.previewSnapshots,
        });

        currentMessages.push({
          role: 'tool',
          content: toolResultContent,
          tool_call_id: toolCall.id,
        });
        toolResultsThisTurn += 1;
        if (toolCall.name === 'video_transcript' && result.success) {
          videoTranscriptSucceeded = true;
        }
        if (toolCall.name === 'video_probe' && result.success) {
          videoProbeSucceeded = true;
        }

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: result.success ? 'tool.complete' : 'tool.error',
            sessionId,
            timestamp: Date.now(),
            data: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              result: result.output,
              success: result.success,
              error: result.error,
              duration: result.duration,
              artifacts: result.artifacts,
              previewSnapshots: result.previewSnapshots,
              step: steps + 1,
            },
          }),
        });

        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: searchToolNames.has(toolCall.name) ? 'Searching' : videoToolLabels[toolCall.name] || 'Executing tool',
          status: 'completed',
          message: result.success ? undefined : 'Failed.',
          finalStatus: result.success ? 'SUCCEEDED' : 'FAILED',
          details: {
            toolName: toolCall.name,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Tool execution failed';

        taskManager.recordToolCall(sessionId, toolCall.name, params, undefined, false);

        // Add error to history
        currentMessages.push({
          role: 'tool',
          content: JSON.stringify({ success: false, error: errorMsg }),
          tool_call_id: toolCall.id,
        });

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'tool.error',
            sessionId,
            timestamp: Date.now(),
            data: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              error: errorMsg,
              step: steps + 1,
            },
          }),
        });

        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: searchToolNames.has(toolCall.name) ? 'Searching' : videoToolLabels[toolCall.name] || 'Executing tool',
          status: 'completed',
          message: errorMsg,
          finalStatus: 'FAILED',
          details: {
            toolName: toolCall.name,
          },
        });
      }
    }

    steps++;
    // Keep non-final draft content out of user-facing accumulated output.

    // Emit thinking.start before next LLM call so frontend shows progress
    // This prevents the UI from appearing "stuck" between tool execution steps
    const toolCount = toolCallsCollected.length;
    const searchCount = toolCallsCollected.filter((toolCall) =>
      searchToolNames.has(toolCall.name)
    ).length;
    const thinkingMessage = searchCount > 0
      ? `Reviewing ${searchCount} search result${searchCount === 1 ? '' : 's'}...`
      : `Reviewing ${toolCount || 1} tool result${toolCount === 1 ? '' : 's'}...`;

    pendingThinkingStepId = `thinking-${steps + 1}-${reasoningStepCounter++}`;
    await emitReasoningStep({
      stepId: pendingThinkingStepId,
      label: 'Thinking',
      status: 'running',
      message: thinkingMessage,
    });

    await sseStream.writeSSE({
      data: JSON.stringify({
        type: 'thinking.start',
        sessionId,
        timestamp: Date.now(),
        data: {
          step: steps + 1,
          message: 'Processing results...',
        },
      }),
    });
  }

  // === Hit step limit ===
  await sseStream.writeSSE({
    data: JSON.stringify({
      type: 'agent.step_limit',
      sessionId,
      timestamp: Date.now(),
      data: {
        reason: `Exceeded maximum tool steps (${maxSteps})`,
        stepsTaken: steps,
      },
    }),
  });

  return {
    content: finalContent,
    finishReason: 'max_steps',
    stepsTaken: steps,
    reasoningSteps: completedReasoningSteps,
  };
}

/**
 * GET /api/sessions/:sessionId/stream
 * SSE endpoint for real-time chat streaming
 */
stream.get('/sessions/:sessionId/stream', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Verify session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  // Get the latest user message to respond to.
  // Some legacy clients open /stream before their message write is visible.
  let latestUserMessage = await prisma.message.findFirst({
    where: {
      sessionId,
      role: 'user',
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!latestUserMessage) {
    for (let attempt = 0; attempt < 5 && !latestUserMessage; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      latestUserMessage = await prisma.message.findFirst({
        where: {
          sessionId,
          role: 'user',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    }
  }

  if (!latestUserMessage) {
    // Gracefully close without HTTP error to avoid false "SSE failed" toasts.
    return streamSSE(c, async (sseStream) => {
      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'message.complete',
          sessionId,
          timestamp: Date.now(),
          data: {
            userMessageId: null,
            assistantMessageId: null,
            finishReason: 'no_message',
          },
        }),
      });
    });
  }

  // Check if there's already an assistant response for this message
  const existingResponse = await prisma.message.findFirst({
    where: {
      sessionId,
      role: 'assistant',
      createdAt: {
        gt: latestUserMessage.createdAt,
      },
    },
  });

  if (existingResponse) {
    // Graceful replay: if another stream already produced the assistant message,
    // return it via SSE instead of a 400 so clients can finalize cleanly.
    return streamSSE(c, async (sseStream) => {
      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'message.start',
          sessionId,
          timestamp: Date.now(),
          data: { userMessageId: latestUserMessage.id },
        }),
      });

      if (existingResponse.content) {
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'message.delta',
            sessionId,
            timestamp: Date.now(),
            data: { content: existingResponse.content },
          }),
        });
      }

      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'message.complete',
          sessionId,
          timestamp: Date.now(),
          data: {
            userMessageId: latestUserMessage.id,
            assistantMessageId: existingResponse.id,
            content: existingResponse.content,
            finishReason:
              typeof (existingResponse.metadata as any)?.finishReason === 'string'
                ? (existingResponse.metadata as any).finishReason
                : 'stop',
          },
        }),
      });
    });
  }

  // Get conversation history
  const config = getConfig();
  const allMessages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: config.session.maxHistoryMessages,
  });

  // Convert to LLM message format
  const llmMessages: LLMMessage[] = allMessages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  // === USER SKILL FILTERING (GET stream endpoint) ===
  const registryGet = getDynamicSkillRegistry();
  const traceIdGet = `trace-get-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const userEnabledSkillsGet = await registryGet.getEnabledSkillsForUser(user.userId, traceIdGet);
  
  // DEBUG: Log enabled skills for this request
  console.log(`[SKILL_DEBUG] GET /stream - User ${user.userId} has ${userEnabledSkillsGet.length} enabled skills:`, 
    userEnabledSkillsGet.map(s => s.name).join(', ') || 'NONE');

  // Build system prompt with enabled skill capabilities
  let systemPromptContentGet = 'You are a helpful AI assistant. Be concise and helpful.';
  
  if (userEnabledSkillsGet.length > 0) {
    const skillDescriptionsGet = userEnabledSkillsGet
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n');
    
    systemPromptContentGet += `

## CRITICAL: Your Available Skills

The user has enabled ONLY these skills:

${skillDescriptionsGet}

IMPORTANT RULES:
1. When the user asks "what can you do", "what skills do you have", or similar questions, list the enabled skills above first, then optionally describe built-in capability categories without exposing internal implementation details.
2. Do NOT mention internal tools (like file_reader, file_writer, bash_executor, web_search, paper_search, ppt_generator, etc.) unless the user explicitly asks for tool names.
3. Do NOT make up or invent capabilities beyond the enabled skills listed above.
4. Do NOT list generic AI capabilities like "programming", "data analysis", "writing", etc. unless they are explicitly in the enabled skills list.
5. The skills list controls specialized/domain skill claims. You may still use enabled built-in tools to complete concrete user tasks when appropriate.`;
  } else {
    systemPromptContentGet += `

## CRITICAL: No Skills Enabled

The user has not enabled any skills.

IMPORTANT RULES:
1. When the user asks "what can you do" or similar, explain that you are a general AI assistant but no specialized skills are currently enabled.
2. Suggest they enable skills in the Skills settings (gear icon) to unlock specialized capabilities.
3. Do NOT mention internal tool names unless the user explicitly asks for tool names.
4. Do NOT make up capabilities; only claim tasks you can handle with available built-in tools.`;
  }

  systemPromptContentGet += `

DEPENDENCY RECOVERY RULES:
1. If a tool returns a structured error with code YTDLP_NOT_FOUND, read the installCommands array and use bash_executor to install yt-dlp, then retry the tool once.
2. If a tool returns FORMAT_UNAVAILABLE, retry with lower quality (720p → 480p) or switch to mkv container.
3. If a tool returns NETWORK_ERROR, verify the URL and suggest cookiesFromBrowser for auth-gated sites.
4. Never give up after a single tool failure — always attempt at least one recovery step before reporting failure to the user.
5. Report each recovery step to the user (e.g., "Installing yt-dlp...", "Retrying at 720p...").`;

  // Always use fresh system prompt with current skill list (skills may change mid-conversation)
  const sysIdx = llmMessages.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    // REPLACE existing system prompt entirely with fresh skill-enhanced one
    llmMessages[sysIdx].content = systemPromptContentGet;
  } else {
    llmMessages.unshift({
      role: 'system',
      content: systemPromptContentGet,
    });
  }

  // Truncate to fit context window
  const tokenCounter = getTokenCounter();
  const truncatedMessages = tokenCounter.truncateToFit(
    llmMessages,
    config.session.contextWindowTokens
  );

  // Set up tool context
  const workspaceDir = session.workspacePath || path.join(process.env.WORKSPACE_ROOT || '/tmp/mark-workspaces', sessionId);
  const toolContext: ToolContext = {
    sessionId,
    userId: user.userId,
    workspaceDir,
  };

  // Initialize or get TaskManager
  const taskManager = getTaskManager();

  // Get tool registry and convert to OpenAI format
  const toolRegistry = getToolRegistry(toolContext);
  const tools = config.tools.enabled.length > 0 ? toolRegistry.toOpenAIFunctions(config.tools.enabled) : undefined;

  // Always initialize fresh task per user message (one task per request-response cycle)
  taskManager.clearTask(sessionId);
  const taskState = taskManager.initializeTask(sessionId, user.userId, latestUserMessage.content);
  const executionMode: ExecutionMode = 'direct';

  return streamSSE(c, async (sseStream) => {
    const llmClient = getLLMClient();
    const baseToolExecutor = getToolExecutor(toolContext);
    const startTime = Date.now();
    const pipelineEnabled = config.execution?.pptPipeline?.enabled !== false;
    const pipelineController =
      pipelineEnabled && taskState?.goal?.requiresPPT
        ? new PptPipelineController(sessionId, sseStream.writeSSE.bind(sseStream))
        : null;
    const activeStream = pipelineController ? pipelineController.wrapStream(sseStream) : sseStream;
    const computerTimelineCollector = new ComputerTimelineCollector();
    const streamWithCapture = createTimelineCapturingStream(activeStream, computerTimelineCollector);
    const toolExecutor =
      getBrowserManager().isEnabled() && streamWithCapture
        ? wrapExecutorWithBrowserEvents({ sessionId, toolExecutor: baseToolExecutor, sseStream: streamWithCapture })
        : baseToolExecutor;

    try {
      // Send message.start event
      await streamWithCapture.writeSSE({
        data: JSON.stringify({
          type: 'message.start',
          sessionId,
          timestamp: Date.now(),
          data: { messageId: null },
        }),
      });

      const focus = inferFocusTab(taskState?.goal || null, executionMode);
      await streamWithCapture.writeSSE({
        data: JSON.stringify({
          type: 'inspector.focus',
          sessionId,
          timestamp: Date.now(),
          data: focus,
        }),
      });

      // Build messages with task context
      const taskContext = taskManager.getSystemPromptContext(sessionId);
      const baseMessages: ExtendedLLMMessage[] = truncatedMessages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

      // Add task context to existing system prompt (preserve skill info that was added earlier)
      const systemIndex = baseMessages.findIndex((m) => m.role === 'system');
      
      if (systemIndex >= 0 && taskContext) {
        // Append task context to existing system prompt (which already has skill info)
        baseMessages[systemIndex].content += `\n\n${taskContext}`;
      } else if (systemIndex < 0) {
        // No system prompt exists - use the skill-enhanced one we built earlier
        baseMessages.unshift({
          role: 'system',
          content: systemPromptContentGet + (taskContext ? `\n\n${taskContext}` : ''),
        });
      }

      const latestContent = String(latestUserMessage.content || '');
      const requestedVideoUrl = extractFirstVideoUrlFromText(latestContent) || undefined;
      const transcriptFollowupIntentByRules =
        isVideoContentIntentText(latestContent) || isTranscriptSegmentFollowupText(latestContent);
      const transcriptFollowupIntent =
        transcriptFollowupIntentByRules ||
        (await inferTranscriptFollowupIntentWithLlm({
          llm: llmClient,
          query: latestContent,
          sessionHasTranscriptContext: true,
        }));
      if (transcriptFollowupIntent) {
        const historicalTranscript = await loadLatestTranscriptToolMessageForSession(
          sessionId,
          requestedVideoUrl
        );
        if (historicalTranscript) {
          const hasTranscriptToolContext = baseMessages.some(
            (msg) =>
              msg.role === 'tool' &&
              typeof msg.content === 'string' &&
              msg.content.includes('--- Transcript ---')
          );
          if (!hasTranscriptToolContext) {
            baseMessages.push(historicalTranscript.toolMessage);
          }
        }
      }

      // Process agent turn with continuation loop
      let result: any;
      if (executionMode === 'sandbox') {
        const sandboxManager = getSandboxManager();
        if (!sandboxManager.isEnabled()) {
          await streamWithCapture.writeSSE({
            data: JSON.stringify({
              type: 'sandbox.fallback',
              sessionId,
              timestamp: Date.now(),
              data: { reason: 'Sandbox is disabled' },
            }),
          });
          result = await processAgentTurn(
            sessionId,
            baseMessages,
            tools,
            toolContext,
            taskManager,
            prisma,
            llmClient,
            toolExecutor,
            streamWithCapture,
            startTime
          );
        } else {
          try {
            const orchestrator = new SandboxOrchestrator(sandboxManager);
            result = await orchestrator.execute({
              sessionId,
              messages: baseMessages,
              tools,
              toolContext,
              taskManager,
              prisma,
              llmClient,
              startTime,
              toolExecutor,
              sseStream: streamWithCapture,
              processAgentTurn,
            });
          } catch (error: any) {
            await streamWithCapture.writeSSE({
              data: JSON.stringify({
                type: 'sandbox.fallback',
                sessionId,
                timestamp: Date.now(),
                data: { reason: error?.message || 'Sandbox execution failed' },
              }),
            });
            result = await processAgentTurn(
              sessionId,
              baseMessages,
              tools,
              toolContext,
              taskManager,
              prisma,
              llmClient,
              toolExecutor,
              streamWithCapture,
              startTime
            );
          }
        }
      } else {
        result = await processAgentTurn(
          sessionId,
          baseMessages,
          tools,
          toolContext,
          taskManager,
          prisma,
          llmClient,
          toolExecutor,
          streamWithCapture,
          startTime
        );
      }

      // Save final assistant message to database
      let assistantMessage: { id: string } | null = null;
      try {
        const persistedComputerTimeline = computerTimelineCollector.getSteps();
        assistantMessage = await prisma.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: result.content,
            metadata: {
              finishReason: result.finishReason,
              model: llmClient.getModel(),
              stepsTaken: result.stepsTaken,
              reasoningSteps: result.reasoningSteps,
              ...(persistedComputerTimeline.length > 0
                ? { computerTimelineSteps: persistedComputerTimeline }
                : {}),
            },
          },
        });

        await prisma.toolCall.updateMany({
          where: { sessionId, messageId: null },
          data: { messageId: assistantMessage.id },
        });

        await prisma.session.update({
          where: { id: sessionId },
          data: { lastActiveAt: new Date() },
        });
      } catch (persistError) {
        if (isPrismaForeignKeyError(persistError)) {
          console.warn('Session no longer exists, skipping assistant message persistence (GET /stream)');
        } else {
          throw persistError;
        }
      }

      // Signal stream completion to frontend so it can finalize UI state.
      await streamWithCapture.writeSSE({
        data: JSON.stringify({
          type: 'message.complete',
          sessionId,
          timestamp: Date.now(),
          data: {
            userMessageId: latestUserMessage.id,
            assistantMessageId: assistantMessage?.id ?? null,
            content: result.content,
            finishReason: result.finishReason,
          },
        }),
      });
    } catch (error) {
      console.error('Stream error:', error);

      // Send error event
      await streamWithCapture.writeSSE({
        data: JSON.stringify({
          type: 'error',
          sessionId,
          timestamp: Date.now(),
          data: {
            code: 'LLM_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        }),
      });
    }
  });
});

/**
 * POST /api/sessions/:sessionId/chat
 * Send a message and get streaming response
 * Combines message creation with streaming response
 */
stream.post('/sessions/:sessionId/chat', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  
  // DEBUG: Confirm handler is executing
  console.log(`\n${'='.repeat(60)}\n[SKILL_DEBUG] POST /chat HANDLER CALLED\n${'='.repeat(60)}`);

  // Parse request body
  let content: string;
  let executionMode: ExecutionMode = 'direct';
  try {
    const body = await c.req.json();
    content = body.content;
    if (body.execution_mode === 'sandbox') {
      executionMode = 'sandbox';
    }
    if (!content || typeof content !== 'string') {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Content is required',
          },
        },
        400
      );
    }
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_JSON',
          message: 'Invalid JSON in request body',
        },
      },
      400
    );
  }

  // Verify session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  if (session.status !== 'active') {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_ACTIVE',
          message: 'Session is not active',
        },
      },
      400
    );
  }

  await externalSkillLoader.getSkillSnapshot(sessionId);

  // Create user message
  const userMessage = await prisma.message.create({
    data: {
      sessionId,
      role: 'user',
      content,
    },
  });

  // Get conversation history
  const config = getConfig();
  const allMessages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: config.session.maxHistoryMessages,
  });

  // Convert to LLM message format
  const llmMessages: LLMMessage[] = allMessages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  // === USER SKILL FILTERING ===
  // Load user's enabled external skills (CRITICAL: Use registry method, do NOT query DB directly)
  const registry = getDynamicSkillRegistry();
  const traceId = `trace-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const userEnabledSkills = await registry.getEnabledSkillsForUser(user.userId, traceId);
  
  // DEBUG: Log enabled skills for this request
  console.log(`[SKILL_DEBUG] POST /chat - User ${user.userId} has ${userEnabledSkills.length} enabled skills:`, 
    userEnabledSkills.map(s => s.name).join(', ') || 'NONE');

  // Guardrail: If no skills enabled, agent operates in LLM-only mode
  if (userEnabledSkills.length === 0) {
    console.info({
      event: 'no_skills_enabled',
      userId: user.userId,
      sessionId,
      traceId,
      message: 'User has no enabled skills - operating in LLM-only mode',
    });
  }

  // Check for skill invocation (slash command)
  const skillProcessor = getSkillProcessor();
  const skillInvocation = skillProcessor.parseCommand(content);
  let skillTools: string[] | undefined;

  if (skillInvocation) {
    // Verify user has access to this skill (if it's an external skill)
    const requestedSkillName = skillInvocation.skillName.toLowerCase();
    const hasAccess = userEnabledSkills.some(
      (skill) =>
        skill.name.toLowerCase() === requestedSkillName ||
        skill.aliases.some((alias) => alias.toLowerCase() === requestedSkillName)
    );

    // If external skill and user doesn't have access, block execution
    if (!hasAccess && skillInvocation.skill.isExternal) {
      throw new Error(
        `Access denied: Skill '${skillInvocation.skillName}' is not enabled for your account. Please enable it in Skills settings.`
      );
    }

    // Format prompts using skill templates
    const formatted = skillProcessor.formatPrompts(skillInvocation);

    // Replace system prompt with skill's system prompt
    const existingSystemIndex = llmMessages.findIndex((m) => m.role === 'system');
    if (existingSystemIndex >= 0) {
      llmMessages[existingSystemIndex].content = formatted.systemPrompt;
    } else {
      llmMessages.unshift({
        role: 'system',
        content: formatted.systemPrompt,
      });
    }

    // Update the last user message with the formatted user prompt
    const lastUserIndex = llmMessages.findLastIndex((m) => m.role === 'user');
    if (lastUserIndex >= 0) {
      llmMessages[lastUserIndex].content = formatted.userPrompt;
    }

    // Restrict tools to skill's required tools
    skillTools = formatted.requiredTools;
  }
  
  // Build system prompt with enabled skill capabilities (always build for fallback)
  let systemPromptContent = 'You are a helpful AI assistant. Be concise and helpful.';
  
  // Add skill info to systemPromptContent (always, for fallback use)
  if (userEnabledSkills.length > 0) {
    const skillDescriptions = userEnabledSkills
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n');
    
    systemPromptContent += `

## CRITICAL: Your Available Skills

The user has enabled ONLY these skills:

${skillDescriptions}

IMPORTANT RULES:
1. When the user asks "what can you do", "what skills do you have", or similar questions, list the enabled skills above first, then optionally describe built-in capability categories without exposing internal implementation details.
2. Do NOT mention internal tools (like file_reader, file_writer, bash_executor, web_search, paper_search, ppt_generator, etc.) unless the user explicitly asks for tool names.
3. Do NOT make up or invent capabilities beyond the enabled skills listed above.
4. Do NOT list generic AI capabilities like "programming", "data analysis", "writing", etc. unless they are explicitly in the enabled skills list.
5. The skills list controls specialized/domain skill claims. You may still use enabled built-in tools to complete concrete user tasks when appropriate.`;
  } else {
    systemPromptContent += `

## CRITICAL: No Skills Enabled

The user has not enabled any skills.

IMPORTANT RULES:
1. When the user asks "what can you do" or similar, explain that you are a general AI assistant but no specialized skills are currently enabled.
2. Suggest they enable skills in the Skills settings (gear icon) to unlock specialized capabilities.
3. Do NOT mention internal tool names unless the user explicitly asks for tool names.
4. Do NOT make up capabilities; only claim tasks you can handle with available built-in tools.`;
  }

  systemPromptContent += `

DEPENDENCY RECOVERY RULES:
1. If a tool returns a structured error with code YTDLP_NOT_FOUND, read the installCommands array and use bash_executor to install yt-dlp, then retry the tool once.
2. If a tool returns FORMAT_UNAVAILABLE, retry with lower quality (720p → 480p) or switch to mkv container.
3. If a tool returns NETWORK_ERROR, verify the URL and suggest cookiesFromBrowser for auth-gated sites.
4. Never give up after a single tool failure — always attempt at least one recovery step before reporting failure to the user.
5. Report each recovery step to the user (e.g., "Installing yt-dlp...", "Retrying at 720p...").`;
  
  // Only add to llmMessages if not using a skill invocation (skill invocation sets its own prompt)
  if (!skillInvocation) {
    // Always use fresh system prompt with current skill list (skills may change mid-conversation)
    const systemIndex = llmMessages.findIndex((m) => m.role === 'system');
    if (systemIndex >= 0) {
      // REPLACE existing system prompt entirely with fresh skill-enhanced one
      llmMessages[systemIndex].content = systemPromptContent;
      console.log(`[SKILL_DEBUG] REPLACED system prompt at index ${systemIndex}`);
    } else {
      llmMessages.unshift({
        role: 'system',
        content: systemPromptContent,
      });
      console.log(`[SKILL_DEBUG] ADDED new system prompt`);
    }
    // Log first 500 chars of system prompt
    console.log(`[SKILL_DEBUG] System prompt (first 500 chars):\n${systemPromptContent.substring(0, 500)}...`);
  }

  // Truncate to fit context window
  const tokenCounter = getTokenCounter();
  const truncatedMessages = tokenCounter.truncateToFit(
    llmMessages,
    config.session.contextWindowTokens
  );

  // Set up tool context
  const workspaceDir = session.workspacePath || path.join(process.env.WORKSPACE_ROOT || '/tmp/mark-workspaces', sessionId);
  const toolContext: ToolContext = {
    sessionId,
    userId: user.userId,
    workspaceDir,
  };

  // Get tool registry and convert to OpenAI format
  // If skill invocation, use skill's required tools; otherwise use configured tools
  const toolRegistry = getToolRegistry(toolContext);
  const enabledTools = skillTools || config.tools.enabled;
  const tools = enabledTools.length > 0 ? toolRegistry.toOpenAIFunctions(enabledTools) : undefined;

  // Always initialize fresh task per user message (one task per request-response cycle)
  const taskManager = getTaskManager();
  taskManager.clearTask(sessionId);
  const taskState = taskManager.initializeTask(sessionId, user.userId, content);

  return streamSSE(c, async (sseStream) => {
    const llmClient = getLLMClient();
    const baseToolExecutor = getToolExecutor(toolContext);
    const startTime = Date.now();
    const pipelineEnabled = config.execution?.pptPipeline?.enabled !== false;
    const pipelineController =
      pipelineEnabled && taskState?.goal?.requiresPPT
        ? new PptPipelineController(sessionId, sseStream.writeSSE.bind(sseStream))
        : null;
    const activeStream = pipelineController ? pipelineController.wrapStream(sseStream) : sseStream;
    const computerTimelineCollector = new ComputerTimelineCollector();
    const streamWithCapture = createTimelineCapturingStream(activeStream, computerTimelineCollector);
    const toolExecutor =
      getBrowserManager().isEnabled() && streamWithCapture
        ? wrapExecutorWithBrowserEvents({ sessionId, toolExecutor: baseToolExecutor, sseStream: streamWithCapture })
        : baseToolExecutor;

    try {
      // Send message.start event with user message ID
      await streamWithCapture.writeSSE({
        data: JSON.stringify({
          type: 'message.start',
          sessionId,
          timestamp: Date.now(),
          data: { userMessageId: userMessage.id },
        }),
      });

      const focus = inferFocusTab(taskState?.goal || null, executionMode);
      await streamWithCapture.writeSSE({
        data: JSON.stringify({
          type: 'inspector.focus',
          sessionId,
          timestamp: Date.now(),
          data: focus,
        }),
      });

      // Build messages with task context
      const taskContext = taskManager.getSystemPromptContext(sessionId);
      const baseMessages: ExtendedLLMMessage[] = truncatedMessages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

      // Add task context to existing system prompt (preserve skill info that was added earlier)
      const systemIndexChat = baseMessages.findIndex((m) => m.role === 'system');
      
      if (systemIndexChat >= 0 && taskContext) {
        // Append task context to existing system prompt (which already has skill info)
        baseMessages[systemIndexChat].content += `\n\n${taskContext}`;
      } else if (systemIndexChat < 0) {
        // No system prompt exists - use the skill-enhanced one we built earlier
        baseMessages.unshift({
          role: 'system',
          content: systemPromptContent + (taskContext ? `\n\n${taskContext}` : ''),
        });
      }

      const requestedVideoUrl = extractFirstVideoUrlFromText(content) || undefined;
      const transcriptFollowupIntentByRules =
        isVideoContentIntentText(content) || isTranscriptSegmentFollowupText(content);
      const transcriptFollowupIntent =
        transcriptFollowupIntentByRules ||
        (await inferTranscriptFollowupIntentWithLlm({
          llm: llmClient,
          query: content,
          sessionHasTranscriptContext: true,
        }));
      if (transcriptFollowupIntent) {
        const historicalTranscript = await loadLatestTranscriptToolMessageForSession(
          sessionId,
          requestedVideoUrl
        );
        if (historicalTranscript) {
          const hasTranscriptToolContext = baseMessages.some(
            (msg) =>
              msg.role === 'tool' &&
              typeof msg.content === 'string' &&
              msg.content.includes('--- Transcript ---')
          );
          if (!hasTranscriptToolContext) {
            baseMessages.push(historicalTranscript.toolMessage);
          }
        }
      }

      // DEBUG: Log all messages being sent to LLM
      console.log(`[SKILL_DEBUG] Messages being sent to LLM (${baseMessages.length} total):`);
      baseMessages.forEach((m, i) => {
        const preview = m.content.substring(0, 200).replace(/\n/g, '\\n');
        console.log(`  [${i}] ${m.role}: ${preview}...`);
      });

      // Process agent turn with continuation loop
      const result = await processAgentTurn(
        sessionId,
        baseMessages,
        tools,
        toolContext,
        taskManager,
        prisma,
        llmClient,
        toolExecutor,
        streamWithCapture,
        startTime
      );

      // Save final assistant message to database
      let assistantMessage: { id: string } | null = null;
      try {
        const persistedComputerTimeline = computerTimelineCollector.getSteps();
        assistantMessage = await prisma.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: result.content,
            metadata: {
              finishReason: result.finishReason,
              model: llmClient.getModel(),
              stepsTaken: result.stepsTaken,
              reasoningSteps: result.reasoningSteps,
              ...(persistedComputerTimeline.length > 0
                ? { computerTimelineSteps: persistedComputerTimeline }
                : {}),
            },
          },
        });

        await prisma.toolCall.updateMany({
          where: { sessionId, messageId: null },
          data: { messageId: assistantMessage.id },
        });

        await prisma.session.update({
          where: { id: sessionId },
          data: { lastActiveAt: new Date() },
        });
      } catch (persistError) {
        if (isPrismaForeignKeyError(persistError)) {
          console.warn('Session no longer exists, skipping assistant message persistence (POST /chat)');
        } else {
          throw persistError;
        }
      }

      // Send message.complete event (assistantMessageId null if persistence skipped)
      await streamWithCapture.writeSSE({
        data: JSON.stringify({
          type: 'message.complete',
          sessionId,
          timestamp: Date.now(),
          data: {
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage?.id ?? null,
            content: result.content,
            finishReason: result.finishReason,
          },
        }),
      });
    } catch (error) {
      console.error('Stream error:', error);

      // Send error event
      await streamWithCapture.writeSSE({
        data: JSON.stringify({
          type: 'error',
          sessionId,
          timestamp: Date.now(),
          data: {
            code: 'LLM_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        }),
      });
    }
  });
});

/**
 * POST /api/sessions/:sessionId/agent
 * 
 * NEW: Graph-based agent execution using LangGraph orchestration.
 * This endpoint provides deterministic, scenario-based execution with:
 * - Explicit DAG-based workflow
 * - Evidence-backed claims with citations
 * - Validation gates and hard constraints
 * 
 * Currently supports scenarios: research, ppt, summary, general_chat
 * 
 * BACKWARD COMPATIBLE: This is a NEW endpoint that runs alongside
 * the existing /chat endpoint. Use /chat for standard LLM interactions,
 * use /agent for structured, graph-based tasks.
 */
stream.post('/sessions/:sessionId/agent', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Parse request body
  let content: string;
  let forceScenario: string | undefined;
  
  try {
    const body = await c.req.json();
    content = body.content;
    forceScenario = body.scenario; // Optional: force a specific scenario
    
    if (!content || typeof content !== 'string') {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Content is required',
          },
        },
        400
      );
    }
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_JSON',
          message: 'Invalid JSON in request body',
        },
      },
      400
    );
  }

  // Verify session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  if (session.status !== 'active') {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_ACTIVE',
          message: 'Session is not active',
        },
      },
      400
    );
  }

  await externalSkillLoader.getSkillSnapshot(sessionId);

  // Create user message
  const userMessage = await prisma.message.create({
    data: {
      sessionId,
      role: 'user',
      content,
    },
  });

  // Set up context
  const workspaceDir = session.workspacePath || path.join(process.env.WORKSPACE_ROOT || '/tmp/mark-workspaces', sessionId);
  const toolContext: ToolContext = {
    sessionId,
    userId: user.userId,
    workspaceDir,
  };

  // Get dependencies for LangGraph
  const toolRegistry = getToolRegistry(toolContext);
  const llmClient = getLLMClient();
  const skillRegistry = createDefaultSkillRegistry();

  // Create agent router
  const agentRouter = createAgentRouter(skillRegistry, toolRegistry, llmClient);

  return streamSSE(c, async (sseStream) => {
    const startTime = Date.now();

    try {
      // Send agent.start event
      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'agent.start',
          sessionId,
          timestamp: Date.now(),
          data: {
            userMessageId: userMessage.id,
            mode: 'langgraph',
          },
        }),
      });

      // Run the agent graph
      const result = await agentRouter.run(sessionId, user.userId, content);

      // Stream execution path as events
      for (const nodeId of result.executionPath) {
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'agent.node',
            sessionId,
            timestamp: Date.now(),
            data: {
              nodeId,
              status: 'completed',
            },
          }),
        });
      }

      // Handle success/failure
      if (result.success) {
        // Extract final content based on scenario
        let finalContent = '';
        const finalState = result.finalState;
        
        if ('finalReport' in finalState && finalState.finalReport) {
          // Research scenario - format report
          const report = (finalState as ResearchState).finalReport;
          finalContent = formatResearchReport(report);
        } else if (finalState.finalOutput) {
          // Generic output
          finalContent = typeof finalState.finalOutput === 'string' 
            ? finalState.finalOutput 
            : JSON.stringify(finalState.finalOutput, null, 2);
        } else {
          finalContent = 'Agent completed successfully but produced no output.';
        }
        
        // Process any structured table JSON blocks into rendered markdown
        finalContent = processAgentOutput(finalContent);

        // Save assistant message
        let assistantMessage: { id: string } | null = null;
        try {
          assistantMessage = await prisma.message.create({
            data: {
              sessionId,
              role: 'assistant',
              content: finalContent,
              metadata: {
                source: 'langgraph',
                scenario: finalState.parsedIntent?.scenario,
                executionPath: result.executionPath,
                duration: result.totalDuration,
                reasoningSteps: [],
              },
            },
          });

          await prisma.toolCall.updateMany({
            where: { sessionId, messageId: null },
            data: { messageId: assistantMessage.id },
          });
        } catch (persistError) {
          if (isPrismaForeignKeyError(persistError)) {
            console.warn('Session no longer exists, skipping assistant message persistence (POST /agent success)');
          } else {
            throw persistError;
          }
        }

        // Send completion events
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'message.delta',
            sessionId,
            timestamp: Date.now(),
            data: { content: finalContent },
          }),
        });

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'message.complete',
            sessionId,
            timestamp: Date.now(),
            data: {
              userMessageId: userMessage.id,
              assistantMessageId: assistantMessage?.id ?? null,
              content: finalContent,
              scenario: finalState.parsedIntent?.scenario,
              finishReason: 'stop',
            },
          }),
        });

      } else {
        // Handle failure
        const errors = result.finalState.errors || [];
        const errorMessages = errors.map(e => e.message).join('; ');
        
        // Save error response
        try {
          await prisma.message.create({
            data: {
              sessionId,
              role: 'assistant',
              content: `Agent execution failed: ${errorMessages}`,
              metadata: {
                source: 'langgraph',
                status: 'failed',
                errors: errors.map(e => ({ code: e.code, message: e.message })),
                executionPath: result.executionPath,
              },
            },
          });
        } catch (persistError) {
          if (isPrismaForeignKeyError(persistError)) {
            console.warn('Session no longer exists, skipping assistant message persistence (POST /agent failure)');
          } else {
            throw persistError;
          }
        }

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'agent.error',
            sessionId,
            timestamp: Date.now(),
            data: {
              code: 'AGENT_FAILED',
              message: errorMessages,
              errors: errors,
              executionPath: result.executionPath,
            },
          }),
        });
      }

      // Update session lastActiveAt
      try {
        await prisma.session.update({
          where: { id: sessionId },
          data: { lastActiveAt: new Date() },
        });
      } catch (persistError) {
        if (isPrismaForeignKeyError(persistError)) {
          console.warn('Session no longer exists, skipping session lastActiveAt update');
        } else {
          throw persistError;
        }
      }

    } catch (error) {
      console.error('Agent error:', error);

      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          sessionId,
          timestamp: Date.now(),
          data: {
            code: 'AGENT_ERROR',
            message: error instanceof Error ? error.message : 'Unknown agent error',
          },
        }),
      });
    }
  });
});

/**
 * Format research report for display
 */
function formatResearchReport(report: any): string {
  if (!report) return 'No report generated.';
  
  let content = `# ${report.title || 'Research Report'}\n\n`;
  
  if (report.abstract) {
    content += `## Abstract\n\n${report.abstract}\n\n`;
  }
  
  if (report.sections && Array.isArray(report.sections)) {
    for (const section of report.sections) {
      content += `## ${section.heading}\n\n${section.content}\n\n`;
      
      if (section.citations && section.citations.length > 0) {
        content += `*Sources: ${section.citations.join(', ')}*\n\n`;
      }
    }
  }
  
  if (report.bibliography && Array.isArray(report.bibliography)) {
    content += `## References\n\n`;
    for (const ref of report.bibliography) {
      content += `- ${ref.citation || ref.paperId}\n`;
    }
  }
  
  return content;
}

export { stream as streamRoutes };
