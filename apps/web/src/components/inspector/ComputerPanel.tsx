import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { BrowserViewport } from './BrowserViewport';
import { BrowserToolbar, getBrowserActionLabel } from './BrowserToolbar';
import { TimelineScrubber } from './TimelineScrubber';

interface ComputerPanelProps {
  sessionId: string;
}

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ANSI_COLOR_CLASS: Record<string, string> = {
  '30': 'text-neutral-400',
  '31': 'text-red-400',
  '32': 'text-emerald-400',
  '33': 'text-amber-400',
  '34': 'text-sky-400',
  '35': 'text-fuchsia-400',
  '36': 'text-cyan-400',
  '37': 'text-neutral-200',
  '90': 'text-neutral-500',
};

const parseAnsiSegments = (input: string): Array<{ text: string; className?: string }> => {
  const segments: Array<{ text: string; className?: string }> = [];
  const ansiRegex = /\u001b\[([\d;]+)m/g;
  let lastIndex = 0;
  let currentClass: string | undefined;
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(input)) !== null) {
    const text = input.slice(lastIndex, match.index);
    if (text) {
      segments.push({ text, className: currentClass });
    }
    const codes = match[1].split(';');
    if (codes.includes('0')) {
      currentClass = undefined;
    } else {
      const colorCode = codes.find((code) => ANSI_COLOR_CLASS[code]);
      if (colorCode) {
        currentClass = ANSI_COLOR_CLASS[colorCode];
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  const remaining = input.slice(lastIndex);
  if (remaining) {
    segments.push({ text: remaining, className: currentClass });
  }

  return segments;
};

const getNearestTimelineScreenshot = (
  steps: Array<{ snapshot?: { screenshot?: string | null } }>,
  currentIndex: number
): string | null => {
  if (!steps.length || currentIndex < 0 || currentIndex >= steps.length) return null;
  const current = steps[currentIndex]?.snapshot?.screenshot;
  if (current) return current;

  for (let offset = 1; offset < steps.length; offset++) {
    const prev = steps[currentIndex - offset]?.snapshot?.screenshot;
    if (prev) return prev;
    const next = steps[currentIndex + offset]?.snapshot?.screenshot;
    if (next) return next;
  }
  return null;
};

const getLatestBrowserActionScreenshot = (
  actions: Array<{ screenshotDataUrl?: string | null }>
): string | null => {
  for (let i = actions.length - 1; i >= 0; i--) {
    const shot = actions[i]?.screenshotDataUrl;
    if (shot) return shot;
  }
  return null;
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
        /^mkt_tok$/i.test(key)
      ) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

export function ComputerPanel({ sessionId }: ComputerPanelProps) {
  const isStreaming = useChatStore((state) => state.isStreaming);
  const streamingSessionId = useChatStore((state) => state.streamingSessionId);
  const terminalLines = useChatStore((state) => state.terminalLines.get(sessionId) || []);
  const executionSteps = useChatStore((state) => state.executionSteps.get(sessionId) || []);
  const sandboxFiles = useChatStore((state) => state.sandboxFiles.get(sessionId) || []);
  const sandboxStatus = useChatStore((state) => state.sandboxStatus);
  const pptPipeline = useChatStore((state) => state.pptPipeline.get(sessionId));
  const isPptTask = useChatStore((state) => state.isPptTask.get(sessionId));
  const fileArtifacts = useChatStore((state) => state.files.get(sessionId) || []);
  const browserSession = useChatStore((state) => state.browserSession.get(sessionId));
  const setBrowserActionIndex = useChatStore((state) => state.setBrowserActionIndex);
  const agentTimeline = useChatStore((state) => state.agentSteps.get(sessionId));
  const setAgentStepIndex = useChatStore((state) => state.setAgentStepIndex);
  const isSessionStreaming = isStreaming && streamingSessionId === sessionId;

  const [followOutput, setFollowOutput] = useState(true);
  const [selectedVisitIndex, setSelectedVisitIndex] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!followOutput) return;
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLines, followOutput]);

  const handleTerminalScroll = () => {
    const el = terminalRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollowOutput(atBottom);
  };

  const orderedSteps = useMemo(() => {
    return [...executionSteps].sort((a, b) => {
      const aTime = a.startedAt || 0;
      const bTime = b.startedAt || 0;
      return aTime - bTime;
    });
  }, [executionSteps]);

  const currentStepEntry = useMemo(() => {
    if (!pptPipeline?.steps?.length) return null;
    const running = pptPipeline.steps.find((step) => step.status === 'running');
    if (running) return running;
    return [...pptPipeline.steps].reverse().find((step) => step.status === 'completed') || pptPipeline.steps[0];
  }, [pptPipeline]);

  const currentPipelineStep = currentStepEntry?.id || 'research';
  const currentStepStatus = currentStepEntry?.status || 'pending';

  const activityLabel = useMemo(() => {
    if (currentPipelineStep === 'finalizing' && currentStepStatus === 'completed') {
      return 'Output ready';
    }
    switch (currentPipelineStep) {
      case 'browsing':
        return 'Agent is using Search';
      case 'reading':
        return 'Agent is reading sources';
      case 'synthesizing':
        return 'Agent is synthesizing notes';
      case 'generating':
        return 'Agent is generating slides';
      case 'finalizing':
        return 'Agent is finalizing output';
      case 'research':
      default:
        return 'Agent is planning research';
    }
  }, [currentPipelineStep, currentStepStatus]);

  const browseActivity = pptPipeline?.browseActivity || [];
  const lastActivity = browseActivity[browseActivity.length - 1];
  const browseResults = browseActivity.filter((activity) => activity.action === 'visit');
  const searchQueries = browseActivity.filter((activity) => activity.action === 'search');
  const pptFiles = fileArtifacts.filter(
    (artifact) =>
      artifact.name?.toLowerCase().endsWith('.pptx') ||
      artifact.mimeType?.includes('presentation')
  );

  const isBrowserMode = browserSession?.active ?? false;
  const browserActions = browserSession?.actions ?? [];
  const browserCurrentIndex = browserSession?.currentActionIndex ?? 0;
  const isAtLatestAction = browserActions.length === 0 || browserCurrentIndex >= browserActions.length - 1;
  const selectedBrowserAction = browserActions[browserCurrentIndex];
  const displayUrlRaw = selectedBrowserAction?.url ?? browserSession?.currentUrl ?? '';
  const displayUrl = displayUrlRaw ? normalizeUrl(displayUrlRaw) : displayUrlRaw;
  const displayTitle = isAtLatestAction ? browserSession?.currentTitle : undefined;
  const lastBrowserAction = browserActions[browserCurrentIndex];
  const actionLabel = lastBrowserAction
    ? getBrowserActionLabel(`browser_${lastBrowserAction.type}`)
    : 'Browsing';
  const agentSteps = agentTimeline?.steps ?? [];
  const agentCurrentIndex = Math.max(
    0,
    Math.min(agentTimeline?.currentStepIndex ?? Math.max(0, agentSteps.length - 1), Math.max(0, agentSteps.length - 1))
  );
  const selectedAgentStep = agentSteps[agentCurrentIndex];
  const selectedSnapshotUrl = selectedAgentStep?.snapshot?.screenshot ?? null;
  const selectedStepUrlRaw = selectedAgentStep?.snapshot?.url ?? displayUrl;
  const selectedStepUrl = selectedStepUrlRaw ? normalizeUrl(selectedStepUrlRaw) : selectedStepUrlRaw;
  const selectedStepTitle = selectedAgentStep?.snapshot?.metadata?.actionDescription;
  const isAtLatestAgentStep = agentSteps.length === 0 || agentCurrentIndex >= agentSteps.length - 1;

  const hasAgentTimeline = agentSteps.length > 0;
  const hasReplayTimeline = hasAgentTimeline || browserActions.length > 0;

  if (hasReplayTimeline && !(isPptTask && pptPipeline)) {
    const replayIndex = hasAgentTimeline ? agentCurrentIndex : browserCurrentIndex;
    const replayTotal = hasAgentTimeline ? agentSteps.length : browserActions.length;
    const replayLive =
      isSessionStreaming && isBrowserMode && (hasAgentTimeline ? isAtLatestAgentStep : isAtLatestAction);
    const replaySnapshot = hasAgentTimeline
      ? selectedSnapshotUrl ??
        getNearestTimelineScreenshot(agentSteps, agentCurrentIndex) ??
        getLatestBrowserActionScreenshot(browserActions)
      : browserActions[browserCurrentIndex]?.screenshotDataUrl ??
        getLatestBrowserActionScreenshot(browserActions);
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <section className="flex min-h-0 flex-1 flex-col rounded-xl border bg-muted/10">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="text-sm font-medium text-foreground">Computer</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  replayLive ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'
                )}
              />
              {replayLive ? 'Live' : 'Completed'}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
            <BrowserToolbar
              status={browserSession?.status ?? (isBrowserMode ? 'active' : 'closed')}
              currentUrl={selectedStepUrl}
              currentTitle={selectedStepTitle ?? displayTitle ?? browserSession?.currentTitle}
              actionLabel={selectedStepTitle ?? actionLabel}
              isLive={replayLive}
              showLiveIndicator={false}
            />
            <BrowserViewport
              sessionId={sessionId}
              enabled={isBrowserMode}
              snapshotUrl={replaySnapshot}
              showLive={replayLive}
              fillHeight
              minHeight={0}
              className="flex-1 min-h-0"
            />
            <TimelineScrubber
              currentIndex={replayIndex}
              totalSteps={replayTotal}
              isLive={replayLive}
              onPrevious={() =>
                hasAgentTimeline
                  ? setAgentStepIndex(sessionId, replayIndex - 1)
                  : setBrowserActionIndex(sessionId, replayIndex - 1)
              }
              onNext={() =>
                hasAgentTimeline
                  ? setAgentStepIndex(sessionId, replayIndex + 1)
                  : setBrowserActionIndex(sessionId, replayIndex + 1)
              }
              onJumpToLive={() =>
                hasAgentTimeline
                  ? setAgentStepIndex(sessionId, Math.max(0, replayTotal - 1))
                  : setBrowserActionIndex(sessionId, Math.max(0, replayTotal - 1))
              }
              onSeek={(index) =>
                hasAgentTimeline
                  ? setAgentStepIndex(sessionId, index)
                  : setBrowserActionIndex(sessionId, index)
              }
              showLiveIndicator={false}
              showBackForwardLabels
              stepLabel="Step"
            />
            {!replaySnapshot && (
              <div
                data-testid="computer-viewport-placeholder"
                className="rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground"
              >
                Snapshot unavailable for this step. Agent execution continued without blocking.
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (isPptTask && pptPipeline) {
    const stepIndex = Math.max(
      0,
      pptPipeline.steps.findIndex((step) => step.id === currentPipelineStep)
    );
    const isLive = isSessionStreaming && currentStepStatus === 'running';

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <section className="flex min-h-0 flex-1 flex-col rounded-xl border bg-muted/10">
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
            <div className="text-sm font-medium text-foreground">Computer</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-full', isLive ? 'bg-red-500 animate-pulse' : 'bg-emerald-500')} />
              {isLive ? 'Live' : 'Completed'}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
            <div className="text-xs text-muted-foreground">{activityLabel}</div>

            {(() => {
              const hasTimeline = agentSteps.length > 0;
              const hasBrowser = isBrowserMode || browserActions.length > 0 || hasTimeline;
              const searchModeUrl =
                lastActivity?.url ??
                (lastActivity?.query ? `Search: ${lastActivity.query}` : undefined) ??
                (searchQueries[searchQueries.length - 1]?.query
                  ? `Search: ${searchQueries[searchQueries.length - 1].query}`
                  : '');
              const visitOnlyMode = !hasBrowser && browseResults.length > 0;
              const clampedVisitIndex = visitOnlyMode
                ? Math.max(0, Math.min(selectedVisitIndex, browseResults.length - 1))
                : 0;
              const selectedVisit = visitOnlyMode ? browseResults[clampedVisitIndex] : null;
              const visitViewportUrlRaw = selectedVisit?.url;
              const visitViewportUrl = visitViewportUrlRaw ? normalizeUrl(visitViewportUrlRaw) : visitViewportUrlRaw;
              const visitViewportTitle = selectedVisit?.title;
              const visitScreenshotUrl = selectedVisit?.screenshotDataUrl ?? null;
              const viewportUrl = hasTimeline ? selectedStepUrl : displayUrl;
              const viewportTitle = hasTimeline
                ? selectedStepTitle ?? displayTitle ?? browserSession?.currentTitle
                : displayTitle ?? browserSession?.currentTitle;
              const viewportSnapshot = hasTimeline
                ? selectedSnapshotUrl ??
                  getNearestTimelineScreenshot(agentSteps, agentCurrentIndex) ??
                  (browserActions[browserCurrentIndex]?.screenshotDataUrl ??
                    getLatestBrowserActionScreenshot(browserActions) ??
                    null)
                : browserActions[browserCurrentIndex]?.screenshotDataUrl ?? null;
              const timelineIndex = hasTimeline ? agentCurrentIndex : browserCurrentIndex;
              const timelineTotal = hasTimeline ? agentSteps.length : browserActions.length;
              const timelineIsLive = isSessionStreaming && (hasTimeline ? isAtLatestAgentStep : isAtLatestAction);
              return (
                <>
                  <BrowserToolbar
                    status={browserSession?.status ?? (browserActions.length > 0 ? 'closed' : 'active')}
                    currentUrl={
                      hasBrowser ? viewportUrl : visitOnlyMode && visitViewportUrl ? visitViewportUrl : searchModeUrl
                    }
                    currentTitle={
                      hasBrowser ? viewportTitle : visitViewportTitle
                    }
                    actionLabel={selectedStepTitle ?? actionLabel}
                    isLive={timelineIsLive}
                    showLiveIndicator={false}
                    displayLabel={hasBrowser ? undefined : activityLabel}
                  />
                  {hasBrowser ? (
                    <>
                      <BrowserViewport
                        sessionId={sessionId}
                        enabled={isBrowserMode}
                        snapshotUrl={viewportSnapshot}
                        showLive={isLive && timelineIsLive}
                        fillHeight
                        minHeight={0}
                        className="flex-1 min-h-0"
                      />
                      {timelineTotal > 0 && (
                        <TimelineScrubber
                          currentIndex={timelineIndex}
                          totalSteps={timelineTotal}
                          isLive={timelineIsLive}
                          onPrevious={() =>
                            hasTimeline
                              ? setAgentStepIndex(sessionId, timelineIndex - 1)
                              : setBrowserActionIndex(sessionId, timelineIndex - 1)
                          }
                          onNext={() =>
                            hasTimeline
                              ? setAgentStepIndex(sessionId, timelineIndex + 1)
                              : setBrowserActionIndex(sessionId, timelineIndex + 1)
                          }
                          onJumpToLive={() =>
                            hasTimeline
                              ? setAgentStepIndex(sessionId, Math.max(0, timelineTotal - 1))
                              : setBrowserActionIndex(sessionId, Math.max(0, timelineTotal - 1))
                          }
                          onSeek={(index) =>
                            hasTimeline
                              ? setAgentStepIndex(sessionId, index)
                              : setBrowserActionIndex(sessionId, index)
                          }
                          showLiveIndicator={false}
                          showBackForwardLabels
                          stepLabel="Step"
                        />
                      )}
                      {!viewportSnapshot && (
                        <div
                          data-testid="computer-viewport-placeholder"
                          className="rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground"
                        >
                          Snapshot unavailable for this step. Agent execution continued without blocking.
                        </div>
                      )}
                    </>
                  ) : browseResults.length > 0 ? (
                    <>
                      {visitScreenshotUrl ? (
                        <BrowserViewport
                          sessionId={sessionId}
                          enabled={false}
                          snapshotUrl={visitScreenshotUrl}
                          showLive={false}
                          fillHeight
                          minHeight={0}
                          className="flex-1 min-h-0"
                        />
                      ) : (
                        <div
                          data-testid="computer-viewport-placeholder"
                          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center"
                          style={{ aspectRatio: 16 / 9 }}
                        >
                          {visitViewportUrl ? (
                            <>
                              <p className="text-sm font-medium text-foreground truncate max-w-full">
                                {visitViewportTitle ?? visitViewportUrl}
                              </p>
                              <a
                                href={visitViewportUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary underline underline-offset-2"
                              >
                                Open in new tab
                              </a>
                              {pptPipeline?.browserUnavailable && (
                                <p className="text-xs text-muted-foreground">
                                  Screenshots require browser.
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-sm font-medium text-muted-foreground">
                              Select a page below to view.
                            </p>
                          )}
                        </div>
                      )}
                      <TimelineScrubber
                        currentIndex={clampedVisitIndex}
                        totalSteps={browseResults.length}
                        isLive={false}
                        onPrevious={() => setSelectedVisitIndex((i) => Math.max(0, i - 1))}
                        onNext={() =>
                          setSelectedVisitIndex((i) => Math.min(browseResults.length - 1, i + 1))
                        }
                        onJumpToLive={() => setSelectedVisitIndex(Math.max(0, browseResults.length - 1))}
                        onSeek={(index) => setSelectedVisitIndex(index)}
                        showBackForwardLabels
                        stepLabel="Page"
                      />
                      <div
                        data-testid="computer-key-pages-list"
                        className="flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-4"
                      >
                        {pptPipeline?.browserUnavailable && !visitScreenshotUrl && (
                          <p className="text-xs text-muted-foreground">
                            Browser not available; showing key pages from search only.
                          </p>
                        )}
                        <p className="text-sm font-medium text-muted-foreground">Key pages from search</p>
                        <ul className="min-w-0 list-none space-y-1.5 overflow-y-auto text-xs">
                          {browseResults.map((visit, idx) => (
                            <li
                              key={`${visit.url}-${idx}`}
                              className={cn(
                                'flex flex-col gap-0.5 rounded px-2 py-1 -mx-2',
                                idx === clampedVisitIndex && 'bg-muted/40'
                              )}
                            >
                              <a
                                href={visit.url ? normalizeUrl(visit.url) : visit.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
                                title={visit.url}
                              >
                                {visit.title ?? visit.url}
                              </a>
                              <span className="truncate text-muted-foreground" title={visit.url}>
                                {visit.url}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  ) : (
                    <div
                      data-testid="computer-viewport-placeholder"
                      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center"
                      style={{ aspectRatio: 16 / 9 }}
                    >
                      <p className="text-sm font-medium text-muted-foreground">
                        No visual steps yet
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {currentPipelineStep === 'browsing' && browseResults.length === 0
                          ? 'Collecting search results…'
                          : currentPipelineStep === 'reading'
                          ? 'Reading sources…'
                          : 'Snapshots will appear as the agent performs browser or search steps.'}
                      </p>
                      {searchModeUrl && (
                        <p className="text-xs text-muted-foreground truncate max-w-full">
                          {searchModeUrl}
                        </p>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            <div className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
              <div>
                Step {stepIndex + 1} of {pptPipeline.steps.length}:{' '}
                {pptPipeline.steps[stepIndex]?.label}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    currentStepStatus === 'running' && 'bg-emerald-500',
                    currentStepStatus === 'completed' && 'bg-emerald-500',
                    currentStepStatus === 'pending' && 'bg-muted-foreground/50'
                  )}
                />
                {currentStepStatus === 'completed' ? 'Completed' : currentStepStatus === 'running' ? 'Active' : 'Pending'}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (orderedSteps.length === 0 && terminalLines.length === 0 && sandboxFiles.length === 0) {
    return (
      <div className="space-y-4">
        <section className="rounded-xl border bg-muted/10">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="text-sm font-medium text-foreground">Computer</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Completed
            </div>
          </div>
          <div className="space-y-3 px-4 pb-4">
            <BrowserToolbar
              status="closed"
              currentUrl=""
              actionLabel="Idle"
              isLive={false}
              displayLabel="Output ready"
            />
            <BrowserViewport sessionId={sessionId} enabled={false} showLive={false} />
            <div
              data-testid="computer-viewport-placeholder"
              className="rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground"
            >
              No page snapshots yet. Computer playback will appear automatically when tools view pages.
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-muted/10">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="text-sm font-medium text-foreground">Step Timeline</div>
          <div className="text-xs text-muted-foreground">Sandbox: {sandboxStatus}</div>
        </div>
        <div className="space-y-3 px-4 pb-4">
          {orderedSteps.length === 0 ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              No execution steps yet.
            </div>
          ) : (
            orderedSteps.map((step) => (
              <div key={step.stepId} className="flex items-start gap-3">
                <div
                  className={cn(
                    'mt-1 h-2.5 w-2.5 rounded-full',
                    step.status === 'planned' && 'bg-muted-foreground/40',
                    step.status === 'running' && 'bg-blue-500',
                    step.status === 'completed' && 'bg-emerald-500',
                    step.status === 'failed' && 'bg-red-500'
                  )}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {step.label || step.toolName || 'Execution step'}
                  </div>
                  {step.message ? (
                    <div className="text-xs text-muted-foreground">{step.message}</div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-muted/10">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="text-sm font-medium text-foreground">Terminal Output</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (terminalRef.current) {
                terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
              }
              setFollowOutput(true);
            }}
          >
            Jump to live
          </Button>
        </div>
        <div
          ref={terminalRef}
          onScroll={handleTerminalScroll}
          className="max-h-64 overflow-y-auto border-t bg-black px-4 py-3 font-mono text-xs text-white"
        >
          {terminalLines.length === 0 ? (
            <div className="text-muted-foreground">No terminal output yet.</div>
          ) : (
            terminalLines.map((line) => (
              <div key={line.id} className="whitespace-pre-wrap">
                {parseAnsiSegments(line.stream === 'command' ? `$ ${line.content}` : line.content).map(
                  (segment, index) => (
                    <span key={`${line.id}-${index}`} className={segment.className}>
                      {segment.text}
                    </span>
                  )
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-muted/10">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="text-sm font-medium text-foreground">Files</div>
          <div className="text-xs text-muted-foreground">{sandboxFiles.length} items</div>
        </div>
        <div className="space-y-2 px-4 pb-4">
          {sandboxFiles.length === 0 ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              No files tracked yet.
            </div>
          ) : (
            sandboxFiles.map((file, index) => (
              <div key={`${file.path}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0 truncate">{file.path}</div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
