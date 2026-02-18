import { useEffect, useMemo, useState } from 'react';
import { Bug, ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ToolResult } from '@mark/shared';
import { cn } from '../../lib/utils';
import { useChatStore } from '../../stores/chatStore';
import { ThinkingIndicator } from '../chat/ThinkingIndicator';
import { SourceFavicon } from './SourceFavicon';

interface ReasoningTraceProps {
  sessionId: string;
  selectedMessageId?: string | null;
}

interface ToolCallStatus {
  sessionId: string;
  messageId?: string;
  toolCallId: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  params: any;
  result?: ToolResult;
  error?: string;
}

interface ReasoningStepEntry {
  stepId: string;
  stepIndex?: number;
  label: string;
  status: 'running' | 'completed' | 'failed' | 'canceled';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  message?: string;
  thinkingContent?: string;
}

interface SourceEntry {
  url: string;
  title: string;
  domain: string;
  publishedAt?: string;
}

type StepStatus = 'running' | 'completed' | 'failed';
type TimelineStepType = 'reasoning' | 'tool' | 'response';
type TraceMode = 'user' | 'debug';

interface TimelineStep {
  id: string;
  type: TimelineStepType;
  title: string;
  status: StepStatus;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  message?: string;
  thinkingContent?: string;
  toolCalls: ToolCallStatus[];
  queries: string[];
  sources: SourceEntry[];
}

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Web Search',
  paper_search: 'Paper Search',
  ppt_generator: 'Presentation',
  file_reader: 'File Reader',
  file_writer: 'File Writer',
  bash_executor: 'Shell Command',
  video_probe: 'Video Probe',
  video_download: 'Video Download',
  video_transcript: 'Video Transcript',
  video_analysis: 'Video Analysis',
};

const DURATION_THROTTLE_MS = 10;
const TRACE_MODE_STORAGE_KEY = 'inspector-reasoning-trace-mode';
const REDUNDANT_SEARCH_BLOCK_REASON = 'Search already completed for this query.';

function getEpochNowMs(): number {
  if (
    typeof performance !== 'undefined' &&
    Number.isFinite(performance.timeOrigin) &&
    Number.isFinite(performance.now())
  ) {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

function formatDuration(ms?: number) {
  if (!ms || ms <= 0) return '0.00s';
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatToolName(toolName: string) {
  return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)]+/g) || [];
  return matches.map((url) => url.replace(/[),.\]}'"]+$/, ''));
}

function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function normalizePublishedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function formatPublishedAt(isoDate?: string): string | null {
  if (!isoDate) return null;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function collectToolSources(toolCalls: ToolCallStatus[]): SourceEntry[] {
  const sources = new Map<string, SourceEntry>();
  const addSource = (url: string, title?: string, publishedAt?: string) => {
    const cleanUrl = url.replace(/[),.\]}'"]+$/, '');
    if (!cleanUrl) return;

    const existing = sources.get(cleanUrl);
    if (existing) {
      if (title && (existing.title === existing.url || existing.title === cleanUrl)) {
        existing.title = title;
      }
      if (publishedAt && !existing.publishedAt) {
        existing.publishedAt = publishedAt;
      }
      return;
    }

    sources.set(cleanUrl, {
      url: cleanUrl,
      title: title || cleanUrl,
      domain: getDomain(cleanUrl),
      publishedAt,
    });
  };

  for (const toolCall of toolCalls) {
    if (toolCall.result?.output) {
      extractUrls(toolCall.result.output).forEach((url) => addSource(url));
    }

    for (const artifact of toolCall.result?.artifacts || []) {
      if (artifact?.name === 'search-results.json') {
        try {
          const rawContent =
            typeof artifact.content === 'string'
              ? artifact.content
              : JSON.stringify(artifact.content);
          const parsed = JSON.parse(rawContent) as {
            results?: Array<{
              url?: string;
              title?: string;
              publishedAt?: string;
              published_at?: string;
              publishTime?: string;
              date?: string;
              timestamp?: string;
            }>;
          };
          for (const result of parsed.results || []) {
            if (!result?.url) continue;
            const publishedAt = normalizePublishedAt(
              result.publishedAt ??
                result.published_at ??
                result.publishTime ??
                result.date ??
                result.timestamp
            );
            addSource(result.url, result.title, publishedAt);
          }
        } catch {
          // Ignore malformed artifact payload and continue with generic extraction.
        }
        continue;
      }

      if (typeof artifact.content === 'string') {
        extractUrls(artifact.content).forEach((url) => addSource(url));
      }
    }
  }

  return Array.from(sources.values());
}

function getToolQueries(toolCall: ToolCallStatus): string[] {
  const queries: string[] = [];
  const params = toolCall.params ?? {};

  if (typeof params.query === 'string') queries.push(params.query);
  if (typeof params.q === 'string') queries.push(params.q);
  if (Array.isArray(params.queries)) {
    for (const entry of params.queries) {
      if (typeof entry === 'string') queries.push(entry);
    }
  }

  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}

function getToolCallSignature(toolCall: ToolCallStatus): string {
  return [
    toolCall.messageId ?? '',
    toolCall.toolName,
    stableStringify(toolCall.params ?? {}),
    toolCall.result?.output ?? '',
    toolCall.error ?? '',
  ].join('|');
}

function isRedundantSearchBlock(toolCall: ToolCallStatus): boolean {
  const isSearchTool = toolCall.toolName === 'web_search' || toolCall.toolName === 'paper_search';
  if (!isSearchTool) return false;

  const combinedText = [toolCall.error, toolCall.result?.error, toolCall.result?.output]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');

  return combinedText.includes(REDUNDANT_SEARCH_BLOCK_REASON);
}

function getToolCallDedupSignature(toolCall: ToolCallStatus): string {
  // Collapse repeated blocked search retries into a single trace entry.
  if (isRedundantSearchBlock(toolCall)) {
    return `redundant-search-block|${toolCall.toolName}`;
  }

  return getToolCallSignature(toolCall);
}

function normalizeStepType(label: string): TimelineStepType {
  const normalized = label.toLowerCase();
  if (normalized.includes('searching') || normalized.includes('tool')) return 'tool';
  if (normalized.includes('generating response')) return 'response';
  return 'reasoning';
}

function titleForStepType(type: TimelineStepType): string {
  if (type === 'tool') return 'Tool Step';
  if (type === 'response') return 'Generate Answer';
  return 'Reasoning';
}

function mergeStatuses(a: StepStatus, b: StepStatus): StepStatus {
  if (a === 'running' || b === 'running') return 'running';
  if (a === 'failed' || b === 'failed') return 'failed';
  return 'completed';
}

function minDefined(a?: number, b?: number): number | undefined {
  if (typeof a !== 'number') return b;
  if (typeof b !== 'number') return a;
  return Math.min(a, b);
}

function maxDefined(a?: number, b?: number): number | undefined {
  if (typeof a !== 'number') return b;
  if (typeof b !== 'number') return a;
  return Math.max(a, b);
}

function extractToolCallIdFromStepId(stepId: string): string | null {
  if (!stepId.startsWith('tool-')) return null;
  const toolCallId = stepId.slice('tool-'.length);
  return toolCallId || null;
}

function getToolStepStatus(toolCalls: ToolCallStatus[], fallback: StepStatus = 'completed'): StepStatus {
  if (toolCalls.length === 0) return fallback;
  if (toolCalls.some((call) => call.status === 'running')) return 'running';
  if (toolCalls.some((call) => call.status === 'failed')) return 'failed';
  return 'completed';
}

function createReasoningTimelineStep(step: ReasoningStepEntry, type: TimelineStepType): TimelineStep {
  const mappedStatus: StepStatus =
    step.status === 'running' ? 'running' : step.status === 'failed' ? 'failed' : 'completed';
  return {
    id: step.stepId,
    type,
    title: titleForStepType(type),
    status: mappedStatus,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    durationMs: step.durationMs,
    message: step.message,
    thinkingContent: step.thinkingContent,
    toolCalls: [],
    queries: [],
    sources: [],
  };
}

function createToolTimelineStep(
  step: ReasoningStepEntry | undefined,
  toolCalls: ToolCallStatus[],
  fallbackId: string
): TimelineStep {
  const minToolStartedAt = toolCalls.reduce<number | undefined>((minTs, call) => {
    if (typeof call.startedAt !== 'number') return minTs;
    if (typeof minTs !== 'number') return call.startedAt;
    return Math.min(minTs, call.startedAt);
  }, undefined);
  const maxToolCompletedAt = toolCalls.reduce<number | undefined>((maxTs, call) => {
    if (typeof call.completedAt !== 'number') return maxTs;
    if (typeof maxTs !== 'number') return call.completedAt;
    return Math.max(maxTs, call.completedAt);
  }, undefined);
  const queries = Array.from(
    new Set(toolCalls.flatMap((toolCall) => getToolQueries(toolCall)).filter(Boolean))
  );
  const sources = collectToolSources(toolCalls);
  const fallbackDuration =
    toolCalls.reduce((total, call) => total + (typeof call.result?.duration === 'number' ? call.result.duration : 0), 0) ||
    undefined;

  const statusFromReasoningStep: StepStatus | undefined = step
    ? step.status === 'running'
      ? 'running'
      : step.status === 'failed'
        ? 'failed'
        : 'completed'
    : undefined;

  return {
    id: step?.stepId ?? fallbackId,
    type: 'tool',
    title: titleForStepType('tool'),
    // If a reasoning step exists, it is the source-of-truth for lifecycle.
    // Tool call status is only used for orphan tool rows without reasoning-step context.
    status: statusFromReasoningStep ?? getToolStepStatus(toolCalls, 'completed'),
    startedAt: step?.startedAt ?? minToolStartedAt,
    completedAt: step?.completedAt ?? maxToolCompletedAt,
    durationMs:
      step?.durationMs ??
      (typeof minToolStartedAt === 'number' && typeof maxToolCompletedAt === 'number'
        ? Math.max(0, maxToolCompletedAt - minToolStartedAt)
        : fallbackDuration),
    message: step?.message,
    thinkingContent: step?.thinkingContent,
    toolCalls,
    queries,
    sources,
  };
}

function mergeAdjacentTimelineSteps(steps: TimelineStep[]): TimelineStep[] {
  const merged: TimelineStep[] = [];

  for (const step of steps) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(step);
      continue;
    }

    const mergeable = step.type === previous.type && step.type !== 'tool';
    if (!mergeable) {
      merged.push(step);
      continue;
    }

    const startedAt = minDefined(previous.startedAt, step.startedAt);
    const completedAt = maxDefined(previous.completedAt, step.completedAt);
    const mergedThinking = [previous.thinkingContent, step.thinkingContent]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join('\n\n')
      .trim();

    merged[merged.length - 1] = {
      ...previous,
      id: `${previous.id}::${step.id}`,
      status: mergeStatuses(previous.status, step.status),
      startedAt,
      completedAt,
      durationMs:
        typeof startedAt === 'number' && typeof completedAt === 'number'
          ? completedAt - startedAt
          : step.durationMs ?? previous.durationMs,
      message: step.message || previous.message,
      thinkingContent: mergedThinking || undefined,
    };
  }

  return merged;
}

function getTimelineToolSignature(step: TimelineStep): string | null {
  if (step.type !== 'tool') return null;
  const signatures = step.toolCalls
    .map((toolCall) => getToolCallDedupSignature(toolCall))
    .filter(Boolean)
    .sort();
  if (signatures.length === 0) return null;
  return signatures.join('||');
}

function dedupeTimelineToolSteps(steps: TimelineStep[]): TimelineStep[] {
  const seenSignatures = new Set<string>();
  const deduped: TimelineStep[] = [];

  for (const step of steps) {
    const signature = getTimelineToolSignature(step);
    if (!signature) {
      deduped.push(step);
      continue;
    }
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    deduped.push(step);
  }

  return deduped;
}

function enforceLinearRunningInvariant(steps: TimelineStep[]): TimelineStep[] {
  const runningIndices = steps
    .map((step, index) => (step.status === 'running' ? index : -1))
    .filter((index) => index >= 0);

  if (runningIndices.length <= 1) return steps;
  const keepRunningIndex = runningIndices[runningIndices.length - 1];

  return steps.map((step, index) => {
    if (step.status !== 'running' || index === keepRunningIndex) return step;
    const next = steps[index + 1];
    const completedAt =
      next?.startedAt ?? next?.completedAt ?? (typeof step.startedAt === 'number' ? step.startedAt : Date.now());
    return {
      ...step,
      status: 'completed',
      completedAt,
      durationMs:
        typeof step.startedAt === 'number'
          ? Math.max(0, completedAt - step.startedAt)
          : step.durationMs,
    };
  });
}

function getStepDuration(step: TimelineStep, nowMs: number): string | null {
  if (step.status === 'running') {
    if (typeof step.startedAt === 'number') {
      return formatDuration(Math.max(0, nowMs - step.startedAt));
    }
    return null;
  }

  if (typeof step.durationMs === 'number') return formatDuration(step.durationMs);
  if (typeof step.startedAt === 'number' && typeof step.completedAt === 'number') {
    return formatDuration(step.completedAt - step.startedAt);
  }

  return null;
}

function getSelectedAssistantMessage(messages: Message[], selectedMessageId?: string | null): Message | null {
  if (selectedMessageId) {
    const selected = messages.find(
      (message) => message.id === selectedMessageId && message.role === 'assistant'
    );
    if (selected) return selected;
  }

  return [...messages].reverse().find((message) => message.role === 'assistant') || null;
}

function StepMarker({ status }: { status: StepStatus }) {
  if (status === 'running') {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-50/80 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40">
      <span
        className={cn(
          'inline-block h-2.5 w-2.5 rounded-full',
          status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground/40'
        )}
      />
    </span>
  );
}

const SEARCH_TOOLS = new Set(['web_search', 'paper_search']);

function getToolCategory(toolName: string): 'search' | 'video' | 'file' | 'shell' | 'other' {
  if (SEARCH_TOOLS.has(toolName)) return 'search';
  if (toolName.startsWith('video_')) return 'video';
  if (toolName === 'file_reader' || toolName === 'file_writer') return 'file';
  if (toolName === 'bash_executor') return 'shell';
  return 'other';
}

function getParamSummary(toolCall: ToolCallStatus): Array<{ label: string; value: string }> {
  const params = toolCall.params ?? {};
  const entries: Array<{ label: string; value: string }> = [];
  const category = getToolCategory(toolCall.toolName);

  if (category === 'video') {
    if (params.url) entries.push({ label: 'URL', value: String(params.url) });
    if (params.format) entries.push({ label: 'Format', value: String(params.format) });
    if (params.container) entries.push({ label: 'Container', value: String(params.container) });
    if (params.quality) entries.push({ label: 'Quality', value: String(params.quality) });
    if (params.language) entries.push({ label: 'Language', value: String(params.language) });
    if (params.filename) entries.push({ label: 'Filename', value: String(params.filename) });
    if (params.includeFormats != null) entries.push({ label: 'Include Formats', value: String(params.includeFormats) });
    if (params.includeTimestamps != null) entries.push({ label: 'Timestamps', value: String(params.includeTimestamps) });
  } else if (category === 'file') {
    if (params.path) entries.push({ label: 'Path', value: String(params.path) });
    if (params.filename) entries.push({ label: 'Filename', value: String(params.filename) });
    if (params.encoding) entries.push({ label: 'Encoding', value: String(params.encoding) });
  } else if (category === 'shell') {
    if (params.command) entries.push({ label: 'Command', value: String(params.command) });
    if (params.workingDirectory) entries.push({ label: 'Working Dir', value: String(params.workingDirectory) });
  } else if (category === 'other') {
    // PPT generator and others: show first few meaningful params
    for (const [key, val] of Object.entries(params)) {
      if (val != null && typeof val !== 'object') {
        entries.push({ label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), value: String(val) });
      }
      if (entries.length >= 4) break;
    }
  }

  return entries;
}

function getResultSummary(toolCall: ToolCallStatus): string | null {
  if (toolCall.status === 'running') return null;
  if (toolCall.error) return `Error: ${toolCall.error}`;
  const output = toolCall.result?.output;
  if (!output) return null;
  // Truncate long output for summary display
  if (output.length > 500) return output.slice(0, 500) + '...';
  return output;
}

function ToolStepContent({ step, mode }: { step: TimelineStep; mode: TraceMode }) {
  const [queriesExpanded, setQueriesExpanded] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [paramsExpanded, setParamsExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);

  const toolNames = new Set(step.toolCalls.map((c) => c.toolName));
  const isSearchStep = step.toolCalls.length > 0 && [...toolNames].every((name) => SEARCH_TOOLS.has(name));

  // Search tools: show queries + sources (original behavior)
  if (isSearchStep) {
    return (
      <div className="space-y-2">
        {step.queries.length > 0 ? (
          <div className="space-y-1">
            <button
              type="button"
              className="flex w-full items-center justify-between py-1 text-left transition-colors hover:text-foreground"
              onClick={() => setQueriesExpanded((prev) => !prev)}
              aria-expanded={queriesExpanded}
              aria-controls={`${step.id}-queries`}
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {step.queries.length === 1 ? 'Query' : `Queries (${step.queries.length})`}
              </span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform',
                  queriesExpanded && 'rotate-180'
                )}
              />
            </button>
            {queriesExpanded ? (
              <div id={`${step.id}-queries`} className="space-y-1 border-l border-border/50 pl-2">
                {step.queries.map((query) => (
                  <div key={query} className="py-0.5 text-xs text-foreground">
                    {query}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-1.5" data-testid="reasoning-tool-sources">
          <button
            type="button"
            className="flex w-full items-center justify-between py-1 text-left transition-colors hover:text-foreground"
            onClick={() => setSourcesExpanded((prev) => !prev)}
            aria-expanded={sourcesExpanded}
            aria-controls={`${step.id}-sources`}
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Sources ({step.sources.length})
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                sourcesExpanded && 'rotate-180'
              )}
            />
          </button>
          {sourcesExpanded ? (
            <div id={`${step.id}-sources`} className="border-l border-border/50 pl-2">
              {step.sources.length === 0 ? (
                <div className="text-xs text-muted-foreground">No sources detected.</div>
              ) : (
                <div className="space-y-1.5">
                  {step.sources.map((source) => {
                    const published = formatPublishedAt(source.publishedAt);
                    return (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 py-1 transition-colors hover:opacity-90"
                      >
                        <SourceFavicon url={source.url} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-foreground">
                            {source.title}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">{source.domain}</div>
                        </div>
                        {published ? (
                          <div className="shrink-0 text-[10px] text-muted-foreground">{published}</div>
                        ) : null}
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {mode === 'debug' && step.toolCalls.length > 0 ? (
          <details className="mt-2 border-t border-border/50 pt-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              Debug Details
            </summary>
            <div className="mt-2 space-y-2.5">
              {step.toolCalls.map((toolCall) => (
                <div key={toolCall.toolCallId} className="space-y-1.5 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-foreground">{formatToolName(toolCall.toolName)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {typeof toolCall.result?.duration === 'number'
                        ? `Latency ${formatDuration(toolCall.result.duration)}`
                        : toolCall.status}
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] font-medium text-muted-foreground">Request Params</div>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/25 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
                    {JSON.stringify(toolCall.params ?? {}, null, 2)}
                  </pre>
                  <div className="mt-2 text-[11px] font-medium text-muted-foreground">Raw Output</div>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/25 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
                    {toolCall.result?.output || toolCall.error || 'No output.'}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  // Non-search tools: show Parameters + Result Output
  const allParamSummaries = step.toolCalls.map((tc) => ({ toolCall: tc, params: getParamSummary(tc) }));
  const allResults = step.toolCalls.map((tc) => ({ toolCall: tc, summary: getResultSummary(tc) }));
  const hasParams = allParamSummaries.some((p) => p.params.length > 0);
  const hasResult = allResults.some((r) => r.summary !== null);

  return (
    <div className="space-y-2">
      {/* Parameters section */}
      {hasParams ? (
        <div className="space-y-1">
          <button
            type="button"
            className="flex w-full items-center justify-between py-1 text-left transition-colors hover:text-foreground"
            onClick={() => setParamsExpanded((prev) => !prev)}
            aria-expanded={paramsExpanded}
            aria-controls={`${step.id}-params`}
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Parameters
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                paramsExpanded && 'rotate-180'
              )}
            />
          </button>
          {paramsExpanded ? (
            <div id={`${step.id}-params`} className="border-l border-border/50 pl-2">
              {allParamSummaries.map(({ toolCall, params }) =>
                params.length > 0 ? (
                  <div key={toolCall.toolCallId} className="space-y-1 py-1">
                    {step.toolCalls.length > 1 ? (
                      <div className="text-[11px] font-medium text-foreground">{formatToolName(toolCall.toolName)}</div>
                    ) : null}
                    {params.map(({ label, value }) => (
                      <div key={label} className="flex items-start gap-2 text-xs">
                        <span className="shrink-0 text-muted-foreground">{label}:</span>
                        <span className="min-w-0 break-all text-foreground">{value}</span>
                      </div>
                    ))}
                  </div>
                ) : null
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Result section */}
      {hasResult ? (
        <div className="space-y-1">
          <button
            type="button"
            className="flex w-full items-center justify-between py-1 text-left transition-colors hover:text-foreground"
            onClick={() => setResultExpanded((prev) => !prev)}
            aria-expanded={resultExpanded}
            aria-controls={`${step.id}-result`}
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Result
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                resultExpanded && 'rotate-180'
              )}
            />
          </button>
          {resultExpanded ? (
            <div id={`${step.id}-result`} className="border-l border-border/50 pl-2">
              {allResults.map(({ toolCall, summary }) =>
                summary ? (
                  <div key={toolCall.toolCallId} className="py-1">
                    {step.toolCalls.length > 1 ? (
                      <div className="mb-1 text-[11px] font-medium text-foreground">{formatToolName(toolCall.toolName)}</div>
                    ) : null}
                    <pre className={cn(
                      'max-h-48 overflow-auto rounded bg-muted/25 p-2 text-[11px] whitespace-pre-wrap break-all',
                      toolCall.error ? 'text-destructive' : 'text-muted-foreground'
                    )}>
                      {summary}
                    </pre>
                  </div>
                ) : null
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Sources section - only show if there are actual sources */}
      {step.sources.length > 0 ? (
        <div className="space-y-1.5" data-testid="reasoning-tool-sources">
          <button
            type="button"
            className="flex w-full items-center justify-between py-1 text-left transition-colors hover:text-foreground"
            onClick={() => setSourcesExpanded((prev) => !prev)}
            aria-expanded={sourcesExpanded}
            aria-controls={`${step.id}-sources`}
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Sources ({step.sources.length})
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                sourcesExpanded && 'rotate-180'
              )}
            />
          </button>
          {sourcesExpanded ? (
            <div id={`${step.id}-sources`} className="border-l border-border/50 pl-2">
              <div className="space-y-1.5">
                {step.sources.map((source) => {
                  const published = formatPublishedAt(source.publishedAt);
                  return (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 py-1 transition-colors hover:opacity-90"
                    >
                      <SourceFavicon url={source.url} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-foreground">
                          {source.title}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{source.domain}</div>
                      </div>
                      {published ? (
                        <div className="shrink-0 text-[10px] text-muted-foreground">{published}</div>
                      ) : null}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </a>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Debug details - always available in debug mode */}
      {mode === 'debug' && step.toolCalls.length > 0 ? (
        <details className="mt-2 border-t border-border/50 pt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Debug Details
          </summary>
          <div className="mt-2 space-y-2.5">
            {step.toolCalls.map((toolCall) => (
              <div key={toolCall.toolCallId} className="space-y-1.5 py-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-foreground">{formatToolName(toolCall.toolName)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {typeof toolCall.result?.duration === 'number'
                      ? `Latency ${formatDuration(toolCall.result.duration)}`
                      : toolCall.status}
                  </div>
                </div>
                <div className="mt-2 text-[11px] font-medium text-muted-foreground">Request Params</div>
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/25 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
                  {JSON.stringify(toolCall.params ?? {}, null, 2)}
                </pre>
                <div className="mt-2 text-[11px] font-medium text-muted-foreground">Raw Output</div>
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/25 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
                  {toolCall.result?.output || toolCall.error || 'No output.'}
                </pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function ReasoningTrace({ sessionId, selectedMessageId }: ReasoningTraceProps) {
  const isStreaming = useChatStore((state) => state.isStreaming);
  const streamingSessionId = useChatStore((state) => state.streamingSessionId);
  const messages = useChatStore((state) => state.messages.get(sessionId) || []);
  const reasoningMap = useChatStore((state) => state.reasoningSteps);
  const toolCallsMap = useChatStore((state) => state.toolCalls);
  const isActive = isStreaming && streamingSessionId === sessionId;

  const [traceMode, setTraceMode] = useState<TraceMode>(() => {
    if (typeof window === 'undefined') return 'user';
    return window.localStorage.getItem(TRACE_MODE_STORAGE_KEY) === 'debug' ? 'debug' : 'user';
  });
  const [expandedToolSteps, setExpandedToolSteps] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TRACE_MODE_STORAGE_KEY, traceMode);
  }, [traceMode]);

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
  const reasoningSteps = ((reasoningMap.get(reasoningKey) || []) as ReasoningStepEntry[])
    .slice()
    .sort((a, b) => {
      const aIndex = a.stepIndex ?? Number.MAX_SAFE_INTEGER;
      const bIndex = b.stepIndex ?? Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.startedAt - b.startedAt;
    });

  const toolCalls = useMemo(
    () =>
      (Array.from(toolCallsMap.values()).filter((call) => {
        if (call.sessionId !== sessionId) return false;
        if (call.status === 'pending') return false;
        if (selectedMessageId) return call.messageId === selectedMessageId;
        return true;
      }) as ToolCallStatus[]),
    [toolCallsMap, sessionId, selectedMessageId]
  );

  const timelineSteps = useMemo(() => {
    const toolCallsById = new Map(toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall]));
    const toolCallOrder = new Map(toolCalls.map((toolCall, index) => [toolCall.toolCallId, index]));
    const consumedToolCallIds = new Set<string>();
    const consumedToolCallSignatures = new Set<string>();
    const rawSteps: TimelineStep[] = [];

    for (const step of reasoningSteps) {
      const type = normalizeStepType(step.label);

      if (type === 'tool') {
        const toolCallId = extractToolCallIdFromStepId(step.stepId);
        let matchedToolCalls = toolCallId
          ? ([toolCallsById.get(toolCallId)].filter(Boolean) as ToolCallStatus[])
          : [];

        // Fallback: when stepId doesn't resolve, attach the next unconsumed tool call
        // so we don't render an empty tool step plus a duplicated orphan tool step later.
        if (matchedToolCalls.length === 0) {
          const fallbackToolCall = toolCalls.find((candidate) => !consumedToolCallIds.has(candidate.toolCallId));
          if (fallbackToolCall) {
            matchedToolCalls = [fallbackToolCall];
          }
        }

        if (matchedToolCalls.length > 1) {
          matchedToolCalls = [...matchedToolCalls].sort((a, b) => {
            const aOrder = toolCallOrder.get(a.toolCallId) ?? Number.MAX_SAFE_INTEGER;
            const bOrder = toolCallOrder.get(b.toolCallId) ?? Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
          });
        }

        for (const toolCall of matchedToolCalls) {
          consumedToolCallIds.add(toolCall.toolCallId);
          consumedToolCallSignatures.add(getToolCallSignature(toolCall));
        }
        rawSteps.push(createToolTimelineStep(step, matchedToolCalls, step.stepId));
        continue;
      }

      rawSteps.push(createReasoningTimelineStep(step, type));
    }

    const seenOrphanSignatures = new Set<string>();
    for (const toolCall of toolCalls) {
      if (consumedToolCallIds.has(toolCall.toolCallId)) continue;
      const orphanSignature = getToolCallSignature(toolCall);
      if (consumedToolCallSignatures.has(orphanSignature)) continue;
      if (seenOrphanSignatures.has(orphanSignature)) continue;
      seenOrphanSignatures.add(orphanSignature);
      rawSteps.push(createToolTimelineStep(undefined, [toolCall], `orphan-tool-${toolCall.toolCallId}`));
    }

    return enforceLinearRunningInvariant(
      dedupeTimelineToolSteps(mergeAdjacentTimelineSteps(rawSteps))
    );
  }, [reasoningSteps, toolCalls]);

  const hasRunningEntries = timelineSteps.some((step) => step.status === 'running');
  const [displayNowMs, setDisplayNowMs] = useState<number>(() => getEpochNowMs());

  useEffect(() => {
    if (!hasRunningEntries) {
      setDisplayNowMs(getEpochNowMs());
      return;
    }

    let rafId = 0;
    let lastCommittedAt = -Infinity;
    const tick = (rafTs: number) => {
      if (rafTs - lastCommittedAt >= DURATION_THROTTLE_MS) {
        lastCommittedAt = rafTs;
        setDisplayNowMs(getEpochNowMs());
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [hasRunningEntries]);

  const selectedAssistantMessage = useMemo(
    () => getSelectedAssistantMessage(messages, selectedMessageId),
    [messages, selectedMessageId]
  );

  if (timelineSteps.length === 0) {
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        {isActive ? <ThinkingIndicator /> : <div>No reasoning trace yet.</div>}
      </div>
    );
  }

  return (
    <div data-testid="reasoning-trace-timeline" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{timelineSteps.length} step{timelineSteps.length === 1 ? '' : 's'}</div>
        <div className="inline-flex items-center gap-1 text-xs">
          <button
            type="button"
            className={cn(
              'rounded px-2 py-1 transition-colors',
              traceMode === 'user'
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setTraceMode('user')}
          >
            User
          </button>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1 transition-colors',
              traceMode === 'debug'
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setTraceMode('debug')}
          >
            <Bug className="h-3 w-3" />
            Debug
          </button>
        </div>
      </div>

      {traceMode === 'debug' && selectedAssistantMessage?.metadata ? (
        <div className="border-t border-border/50 pt-2 text-xs text-muted-foreground" data-testid="reasoning-debug-summary">
          <span>Tokens: {selectedAssistantMessage.metadata.tokens ?? 'n/a'}</span>
          <span className="mx-2">•</span>
          <span>Model: {selectedAssistantMessage.metadata.model ?? 'n/a'}</span>
          <span className="mx-2">•</span>
          <span>
            Message Duration:{' '}
            {typeof selectedAssistantMessage.metadata.duration === 'number'
              ? formatDuration(selectedAssistantMessage.metadata.duration)
              : 'n/a'}
          </span>
        </div>
      ) : null}

      <div className="relative ml-2">
        {timelineSteps.length > 1 ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-[0.625rem] top-[0.625rem] bottom-[0.625rem] w-px bg-border/70"
          />
        ) : null}
        <ol className="space-y-4">
          {timelineSteps.map((step, index) => {
            const duration = getStepDuration(step, displayNowMs);
            const toolNameLabel =
              step.type === 'tool'
                ? Array.from(new Set(step.toolCalls.map((call) => formatToolName(call.toolName)))).join(', ')
                : '';
            const isToolStep = step.type === 'tool';
            const isToolExpanded = Boolean(expandedToolSteps[step.id]);
            const stepTitle = `Step ${index + 1}: ${step.title}`;

            return (
              <li key={step.id} className="relative pl-7">
                <span className="absolute left-0 top-0">
                  <StepMarker status={step.status} />
                </span>

                <div className="space-y-2">
                  {isToolStep ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
                      <button
                        type="button"
                        className="min-w-0 text-left"
                        onClick={() =>
                          setExpandedToolSteps((prev) => ({
                            ...prev,
                            [step.id]: !prev[step.id],
                          }))
                        }
                        aria-expanded={isToolExpanded}
                        aria-controls={`${step.id}-tool-content`}
                      >
                        <div className="text-sm font-semibold text-foreground">{stepTitle}</div>
                        {step.message ? (
                          <div className="text-xs text-muted-foreground">{step.message}</div>
                        ) : null}
                        {toolNameLabel ? (
                          <div className="text-xs text-muted-foreground">Tool: {toolNameLabel}</div>
                        ) : null}
                      </button>
                      <div className="w-20 shrink-0 text-right">
                        {duration ? <div className="text-[11px] text-muted-foreground">{duration}</div> : null}
                        <button
                          type="button"
                          className="mt-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() =>
                            setExpandedToolSteps((prev) => ({
                              ...prev,
                              [step.id]: !prev[step.id],
                            }))
                          }
                          aria-expanded={isToolExpanded}
                          aria-controls={`${step.id}-tool-content`}
                        >
                          {isToolExpanded ? 'Hide' : 'Details'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{stepTitle}</div>
                        {step.message ? (
                          <div className="text-xs text-muted-foreground">{step.message}</div>
                        ) : null}
                      </div>
                      <div className="w-20 shrink-0 text-right">
                        {duration ? <div className="text-[11px] text-muted-foreground">{duration}</div> : null}
                      </div>
                    </div>
                  )}

                  {isToolStep && isToolExpanded ? (
                    <div id={`${step.id}-tool-content`}>
                      <ToolStepContent step={step} mode={traceMode} />
                    </div>
                  ) : null}

                  {step.thinkingContent ? (
                    <details className="border-t border-border/50 pt-2">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                        {traceMode === 'debug' ? 'Internal Reasoning' : 'Thinking'}
                      </summary>
                      <div className="prose prose-sm mt-2 max-w-none min-w-0 overflow-x-hidden text-muted-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.thinkingContent}</ReactMarkdown>
                      </div>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
