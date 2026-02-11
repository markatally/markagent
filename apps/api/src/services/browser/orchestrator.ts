/**
 * Browser Orchestrator
 * Wraps tool execution with SSE event emission for browser tools (browser.launched, browser.navigated, browser.action).
 */

import type { ToolContext } from '../tools/types';
import type { ToolExecutor } from '../tools/executor';
import type { ToolResult } from '../tools/types';
import { getBrowserManager } from './manager';

type StreamEmitter = (event: { type: string; sessionId: string; data?: any }) => Promise<void>;

const BROWSER_TOOL_PREFIX = 'browser_';

function isBrowserTool(toolName: string): boolean {
  return toolName.startsWith(BROWSER_TOOL_PREFIX);
}

const TRACKING_QUERY_PARAM_PATTERNS = [
  /^utm_/i,
  /^ga_/i,
  /^gaa_/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^mc_eid$/i,
  /^mc_cid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^igshid$/i,
  /^mkt_tok$/i,
];

type WebSearchEntry = {
  url: string;
  normalizedUrl: string;
  title?: string;
  snippet?: string;
};

export type WebSearchNavigationAttempt = {
  target: string;
  reason: 'direct' | 'reader';
};

export type WebFetchFailureClass =
  | 'none'
  | 'http_4xx'
  | 'http_5xx'
  | 'rate_limited'
  | 'challenge_wall'
  | 'timeout'
  | 'dns'
  | 'tls'
  | 'network'
  | 'unknown';

export type WebSearchAttemptDiagnostic = {
  target: string;
  reason: 'direct' | 'reader';
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  success: boolean;
  statusCode?: number;
  loadedUrl?: string;
  title?: string;
  failureClass: WebFetchFailureClass;
  message?: string;
};

export type DomainNavigationPolicy = {
  name: string;
  navTimeoutMs: number;
  settleDelayMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
  challengeBackoffMs: number;
  rateLimitBackoffMs: number;
};

type WebSearchNavigationOutcome = {
  ok: boolean;
  displayUrl: string;
  loadedUrl?: string;
  title?: string;
  mode: 'direct' | 'reader' | 'fallback';
  errors: string[];
  diagnostics: {
    attempts: WebSearchAttemptDiagnostic[];
    finalFailureClass: WebFetchFailureClass;
    policyName: string;
    hostname?: string;
  };
};

const HUMAN_VERIFICATION_TEXT_MARKERS = [
  'please verify you are a human',
  'access to this page has been denied because we believe you are using automation tools',
  'powered by perimeterx',
  'challenge by cloudflare',
  'cf-challenge',
  'captcha',
  'enable javascript and cookies',
  'enable javascript and cookies to continue',
  '403 forbidden',
  '401 unauthorized',
  'request forbidden',
  'access denied',
  'please enable javascript',
  'unusual traffic from your computer network',
  'temporarily blocked',
];

const DEFAULT_DOMAIN_POLICY: DomainNavigationPolicy = {
  name: 'default',
  navTimeoutMs: 15000,
  settleDelayMs: 900,
  maxAttempts: 2,
  baseBackoffMs: 180,
  challengeBackoffMs: 120,
  rateLimitBackoffMs: 360,
};

const DOMAIN_POLICY_RULES: Array<{
  name: string;
  matches: (hostname: string) => boolean;
  overrides: Partial<DomainNavigationPolicy>;
}> = [
  {
    name: 'wsj',
    matches: (hostname) => hostname.endsWith('wsj.com'),
    overrides: { navTimeoutMs: 18000, settleDelayMs: 1200, maxAttempts: 2, rateLimitBackoffMs: 700 },
  },
  {
    name: 'cnbc',
    matches: (hostname) => hostname.endsWith('cnbc.com'),
    overrides: { navTimeoutMs: 17000, settleDelayMs: 1100, maxAttempts: 2, rateLimitBackoffMs: 650 },
  },
  {
    name: 'mediapost',
    matches: (hostname) => hostname.endsWith('mediapost.com'),
    overrides: { navTimeoutMs: 16000, settleDelayMs: 1000, maxAttempts: 2 },
  },
  {
    name: 'reuters',
    matches: (hostname) => hostname.endsWith('reuters.com'),
    overrides: { navTimeoutMs: 16000, settleDelayMs: 900, maxAttempts: 2 },
  },
];

type DomainAttemptMemory = {
  success: number;
  failure: number;
  lastFailureClass?: WebFetchFailureClass;
};

const DOMAIN_ATTEMPT_MEMORY = new Map<string, DomainAttemptMemory>();

function shouldDropQueryParam(name: string): boolean {
  return TRACKING_QUERY_PARAM_PATTERNS.some((pattern) => pattern.test(name));
}

export function normalizeWebSearchUrl(rawUrl: string): string {
  try {
    const parsedInput = new URL(rawUrl);
    const unwrapped = unwrapProxyLikeUrl(parsedInput.toString());
    const parsed = new URL(unwrapped);
    const keys = Array.from(parsed.searchParams.keys());
    for (const key of keys) {
      if (shouldDropQueryParam(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function buildWebSearchNavigationAttempts(rawUrl: string): WebSearchNavigationAttempt[] {
  const normalizedUrl = normalizeWebSearchUrl(rawUrl);
  const attempts: WebSearchNavigationAttempt[] = [];
  const seen = new Set<string>();

  const pushAttempt = (target: string, reason: 'direct' | 'reader') => {
    const normalizedTarget = target.trim();
    if (!normalizedTarget || seen.has(normalizedTarget)) return;
    seen.add(normalizedTarget);
    attempts.push({ target: normalizedTarget, reason });
  };

  pushAttempt(normalizedUrl, 'direct');

  try {
    const parsed = new URL(normalizedUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      // No public proxies. Keep first-party attempts only.
      // Hostname aliases can unblock site routing edge cases.
      if (parsed.hostname.startsWith('www.')) {
        const withoutWww = new URL(parsed.toString());
        withoutWww.hostname = parsed.hostname.replace(/^www\./, '');
        pushAttempt(withoutWww.toString(), 'direct');
      } else if (!parsed.hostname.startsWith('m.')) {
        const withWww = new URL(parsed.toString());
        withWww.hostname = `www.${parsed.hostname}`;
        pushAttempt(withWww.toString(), 'direct');
      }
    }
  } catch {
    // ignore malformed URL and keep direct attempt only
  }

  // Adaptive ordering: prefer targets with stronger recent success history.
  attempts.sort((a, b) => getAttemptScore(b.target) - getAttemptScore(a.target));

  return attempts;
}

function getAttemptScore(target: string): number {
  const host = extractHostname(target);
  if (!host) return 0;
  const mem = DOMAIN_ATTEMPT_MEMORY.get(host);
  if (!mem) return 0;
  return mem.success * 2 - mem.failure;
}

function recordAttemptOutcome(target: string, success: boolean, failureClass?: WebFetchFailureClass): void {
  const host = extractHostname(target);
  if (!host) return;
  const current = DOMAIN_ATTEMPT_MEMORY.get(host) ?? { success: 0, failure: 0 };
  if (success) {
    current.success += 1;
  } else {
    current.failure += 1;
    current.lastFailureClass = failureClass;
  }
  DOMAIN_ATTEMPT_MEMORY.set(host, current);
}

function extractHostname(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return undefined;
  }
}

export function resolveDomainNavigationPolicy(rawUrl: string): DomainNavigationPolicy & { hostname?: string } {
  const normalized = normalizeWebSearchUrl(rawUrl);
  const hostname = extractHostname(normalized);
  if (!hostname) {
    return { ...DEFAULT_DOMAIN_POLICY };
  }
  const rule = DOMAIN_POLICY_RULES.find((item) => item.matches(hostname));
  if (!rule) {
    return { ...DEFAULT_DOMAIN_POLICY, hostname };
  }
  return {
    ...DEFAULT_DOMAIN_POLICY,
    ...rule.overrides,
    name: rule.name,
    hostname,
  };
}

function unwrapProxyLikeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    // Legacy wrapper format: https://r.jina.ai/https://example.com/path
    if (parsed.hostname.endsWith('r.jina.ai')) {
      const trimmedPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      if (!trimmedPath.startsWith('http://') && !trimmedPath.startsWith('https://')) {
        return rawUrl;
      }
      const source = new URL(trimmedPath);
      for (const [key, value] of parsed.searchParams.entries()) {
        if (!source.searchParams.has(key)) {
          source.searchParams.append(key, value);
        }
      }
      return source.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function buildBlockedPageFallbackHtml(entry: WebSearchEntry, errors: string[]): string {
  const escapedTitle = (entry.title ?? entry.normalizedUrl)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const escapedUrl = entry.normalizedUrl
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const escapedSnippet = (entry.snippet ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const escapedErrors = errors
    .slice(0, 4)
    .map((item) =>
      item
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
    );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Snapshot fallback</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f4f6fb;
      color: #101623;
      padding: 32px;
    }
    .card {
      max-width: 980px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #d7deec;
      border-radius: 12px;
      box-shadow: 0 8px 20px rgba(16, 22, 35, 0.08);
      padding: 22px;
    }
    h1 { margin: 0 0 8px 0; font-size: 20px; }
    p { margin: 8px 0; line-height: 1.5; }
    code {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 6px;
      background: #eef2fb;
      font-size: 12px;
    }
    ul { margin: 8px 0 0 18px; padding: 0; }
    li { margin: 6px 0; }
  </style>
</head>
<body>
  <article class="card">
    <h1>Snapshot fallback: source page blocked</h1>
    <p><strong>Title:</strong> ${escapedTitle}</p>
    <p><strong>Source URL:</strong> <code>${escapedUrl}</code></p>
    ${
      escapedSnippet
        ? `<p><strong>Search snippet:</strong> ${escapedSnippet}</p>`
        : '<p><strong>Search snippet:</strong> Not available in provider response.</p>'
    }
    ${
      escapedErrors.length
        ? `<p><strong>Navigation errors:</strong></p><ul>${escapedErrors
            .map((err) => `<li><code>${err}</code></li>`)
            .join('')}</ul>`
        : ''
    }
  </article>
</body>
</html>`;
}

type GotoResponse = { status: () => number } | null;

type MinimalBrowserPage = {
  goto: (
    url: string,
    options: { waitUntil: 'domcontentloaded'; timeout: number }
  ) => Promise<GotoResponse>;
  title: () => Promise<string>;
  url: () => string;
  content: () => Promise<string>;
  setContent: (
    html: string,
    options: { waitUntil: 'domcontentloaded'; timeout: number }
  ) => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function classifyNavigationFailure(input: {
  statusCode?: number;
  title?: string;
  loadedUrl?: string;
  html?: string;
  errorMessage?: string;
}): WebFetchFailureClass {
  const statusCode = input.statusCode;
  if (statusCode != null) {
    if (statusCode === 429 || statusCode === 408) return 'rate_limited';
    if (statusCode >= 500) return 'http_5xx';
    if (statusCode >= 400) return 'http_4xx';
  }

  if (isHumanVerificationWall(input.title, input.loadedUrl, input.html)) {
    return 'challenge_wall';
  }

  const message = (input.errorMessage ?? '').toLowerCase();
  if (!message) return 'unknown';
  if (message.includes('timed out') || message.includes('timeout') || message.includes('etimedout')) {
    return 'timeout';
  }
  if (message.includes('enotfound') || message.includes('dns') || message.includes('name not resolved')) {
    return 'dns';
  }
  if (message.includes('certificate') || message.includes('ssl') || message.includes('tls')) {
    return 'tls';
  }
  if (
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('network') ||
    message.includes('socket hang up')
  ) {
    return 'network';
  }
  return 'unknown';
}

function computeRetryBackoffMs(failureClass: WebFetchFailureClass, attemptIndex: number): number {
  return computeRetryBackoffMsWithPolicy(failureClass, attemptIndex, DEFAULT_DOMAIN_POLICY);
}

function computeRetryBackoffMsWithPolicy(
  failureClass: WebFetchFailureClass,
  attemptIndex: number,
  policy: DomainNavigationPolicy
): number {
  const multiplier = Math.max(1, attemptIndex + 1);
  if (failureClass === 'rate_limited') return policy.rateLimitBackoffMs * multiplier;
  if (failureClass === 'http_5xx' || failureClass === 'network' || failureClass === 'timeout') {
    return policy.baseBackoffMs * multiplier;
  }
  if (failureClass === 'challenge_wall') return policy.challengeBackoffMs * multiplier;
  return 0;
}

export function isHumanVerificationWall(
  title?: string,
  loadedUrl?: string,
  html?: string
): boolean {
  const titleLower = (title ?? '').toLowerCase();
  const urlLower = (loadedUrl ?? '').toLowerCase();
  const htmlLower = (html ?? '').toLowerCase();
  const combined = `${titleLower}\n${urlLower}\n${htmlLower}`;

  if (urlLower.includes('cf-challenge') || urlLower.includes('/captcha') || urlLower.includes('perimeterx')) {
    return true;
  }

  if (/\b403\s+forbidden\b/.test(combined) || /\b401\s+unauthorized\b/.test(combined)) {
    return true;
  }

  return HUMAN_VERIFICATION_TEXT_MARKERS.some((marker) => combined.includes(marker));
}

export async function navigateWebSearchEntryWithFallback(
  page: MinimalBrowserPage,
  entry: WebSearchEntry
): Promise<WebSearchNavigationOutcome> {
  const policy = resolveDomainNavigationPolicy(entry.url);
  const attempts = buildWebSearchNavigationAttempts(entry.url).slice(0, policy.maxAttempts);
  const errors: string[] = [];
  const attemptDiagnostics: WebSearchAttemptDiagnostic[] = [];
  let finalFailureClass: WebFetchFailureClass = 'unknown';

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const attempt = attempts[attemptIndex];
    const startedAt = Date.now();
    try {
      const response = await page.goto(attempt.target, {
        waitUntil: 'domcontentloaded',
        timeout: policy.navTimeoutMs,
      });
      if (response) {
        const status = response.status();
        if (status >= 400) {
          const failureClass = classifyNavigationFailure({ statusCode: status });
          finalFailureClass = failureClass;
          errors.push(`${attempt.reason}:${failureClass}:http-${status}`);
          attemptDiagnostics.push({
            target: attempt.target,
            reason: attempt.reason,
            startedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            success: false,
            statusCode: status,
            failureClass,
            message: `HTTP ${status}`,
          });
          recordAttemptOutcome(attempt.target, false, failureClass);
          if (attemptIndex < attempts.length - 1) {
            const backoffMs = computeRetryBackoffMsWithPolicy(failureClass, attemptIndex, policy);
            if (backoffMs > 0) await sleep(backoffMs);
          }
          continue;
        }
      }
      await sleep(policy.settleDelayMs);
      const pageTitle = await page.title().catch(() => undefined);
      const loadedUrl = page.url();
      const html = await page.content().catch(() => undefined);
      if (isHumanVerificationWall(pageTitle, loadedUrl, html)) {
        const failureClass: WebFetchFailureClass = 'challenge_wall';
        finalFailureClass = failureClass;
        errors.push(`${attempt.reason}:${failureClass}`);
        attemptDiagnostics.push({
          target: attempt.target,
          reason: attempt.reason,
          startedAt,
          finishedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: false,
          loadedUrl,
          title: pageTitle,
          failureClass,
          message: 'Human verification wall detected',
        });
        recordAttemptOutcome(attempt.target, false, failureClass);
        if (attemptIndex < attempts.length - 1) {
          const backoffMs = computeRetryBackoffMsWithPolicy(failureClass, attemptIndex, policy);
          if (backoffMs > 0) await sleep(backoffMs);
        }
        continue;
      }
      recordAttemptOutcome(attempt.target, true);
      attemptDiagnostics.push({
        target: attempt.target,
        reason: attempt.reason,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        success: true,
        loadedUrl,
        title: pageTitle,
        failureClass: 'none',
      });
      return {
        ok: true,
        displayUrl: entry.normalizedUrl,
        loadedUrl,
        title: pageTitle,
        mode: attempt.reason,
        errors,
        diagnostics: {
          attempts: attemptDiagnostics,
          finalFailureClass: 'none',
          policyName: policy.name,
          hostname: policy.hostname,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Navigation failed';
      const failureClass = classifyNavigationFailure({ errorMessage: message });
      finalFailureClass = failureClass;
      errors.push(`${attempt.reason}:${failureClass}:${message}`);
      attemptDiagnostics.push({
        target: attempt.target,
        reason: attempt.reason,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        success: false,
        failureClass,
        message,
      });
      recordAttemptOutcome(attempt.target, false, failureClass);
      if (attemptIndex < attempts.length - 1) {
        const backoffMs = computeRetryBackoffMsWithPolicy(failureClass, attemptIndex, policy);
        if (backoffMs > 0) await sleep(backoffMs);
      }
    }
  }

  try {
    const html = buildBlockedPageFallbackHtml(entry, errors);
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 });
    await sleep(200);
    return {
      ok: true,
      displayUrl: entry.normalizedUrl,
      loadedUrl: page.url(),
      title: `Snapshot fallback: ${entry.title ?? entry.normalizedUrl}`,
      mode: 'fallback',
      errors,
      diagnostics: {
        attempts: attemptDiagnostics,
        finalFailureClass,
        policyName: policy.name,
        hostname: policy.hostname,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fallback page render failed';
    errors.push(`fallback:${message}`);
    return {
      ok: false,
      displayUrl: entry.normalizedUrl,
      mode: 'fallback',
      errors,
      diagnostics: {
        attempts: attemptDiagnostics,
        finalFailureClass:
          finalFailureClass === 'unknown'
            ? classifyNavigationFailure({ errorMessage: message })
            : finalFailureClass,
        policyName: policy.name,
        hostname: policy.hostname,
      },
    };
  }
}

export function extractWebSearchEntries(result: ToolResult): WebSearchEntry[] {
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const searchArtifact = artifacts.find(
    (artifact) => artifact?.name === 'search-results.json' && typeof artifact?.content === 'string'
  );
  if (!searchArtifact || typeof searchArtifact.content !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(searchArtifact.content) as {
      results?: Array<{ url?: string; title?: string; content?: string }>;
    };
    const rows = Array.isArray(parsed.results) ? parsed.results : [];
    const seen = new Set<string>();
    const entries: WebSearchEntry[] = [];

    for (const row of rows) {
      const rawUrl = row?.url?.trim();
      if (!rawUrl) continue;
      const normalizedUrl = normalizeWebSearchUrl(rawUrl);
      if (seen.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);
      entries.push({
        url: rawUrl,
        normalizedUrl,
        title: typeof row?.title === 'string' ? row.title : undefined,
        snippet: typeof row?.content === 'string' ? row.content : undefined,
      });
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Create a tool executor that emits SSE events for browser tools.
 */
export function createBrowserObservableExecutor(
  baseExecutor: ToolExecutor,
  emit: StreamEmitter,
  sessionId: string
): ToolExecutor {
  let browserLaunchedEmitted = false;

  return {
    async execute(toolName: string, params: Record<string, any>, options?: { onProgress?: any }) {
      const manager = getBrowserManager();
      const shouldTrackBrowser = isBrowserTool(toolName) || toolName === 'web_search';
      if (!shouldTrackBrowser || !manager.isEnabled()) {
        return baseExecutor.execute(toolName, params, options);
      }

      const hadSession = manager.getSession(sessionId) != null;
      if (!hadSession && manager.canCreateSession()) {
        await manager.getPage(sessionId);
        if (!browserLaunchedEmitted) {
          browserLaunchedEmitted = true;
          await emit({
            type: 'browser.launched',
            sessionId,
            data: { message: 'Browser session started' },
          });
        }
      }

      const result: ToolResult = await baseExecutor.execute(toolName, params, options);

      if (toolName === 'web_search' && result.success) {
        const session = manager.getSession(sessionId);
        if (session?.page) {
          const entries = extractWebSearchEntries(result);
          for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            const navigation = await navigateWebSearchEntryWithFallback(session.page, entry);
            const navTitle = navigation.title;
            manager.setCurrentUrl(sessionId, navigation.displayUrl, navTitle);
            await emit({
              type: 'browser.navigated',
              sessionId,
              data: {
                url: navigation.displayUrl,
                title: navTitle,
              },
            });

            const outputByMode =
              !navigation.ok
                ? `Failed to load ${navigation.displayUrl}`
                : navigation.mode === 'direct'
                  ? `Visited ${navigation.displayUrl} from web search`
                : navigation.mode === 'reader'
                    ? `Visited ${navigation.displayUrl} via fallback`
                    : `Captured fallback snapshot for blocked page ${navigation.displayUrl}`;
            const navigationError =
              navigation.ok
                ? undefined
                : navigation.errors.length > 0
                  ? navigation.errors[navigation.errors.length - 1]
                  : 'Navigation failed';

            await emit({
              type: 'browser.action',
              sessionId,
              data: {
                action: 'browser_navigate',
                // Use normalized URL for stability (many sites include expiring tracking query params).
                // Keep the original in the payload for debugging.
                params: { url: entry.normalizedUrl },
                success: navigation.ok,
                output: outputByMode,
                error: navigationError,
                mode: navigation.mode,
                failureClass: navigation.diagnostics.finalFailureClass,
                diagnostics: navigation.diagnostics,
                originalUrl: entry.url,
                normalizedUrl: entry.normalizedUrl,
                loadedUrl: navigation.loadedUrl,
              },
            });

            if (!navigation.ok) continue;

            try {
              const buf = await session.page.screenshot({
                type: 'jpeg',
                quality: 60,
                timeout: 5000,
              });
              const base64 = Buffer.isBuffer(buf) ? buf.toString('base64') : (buf as string);
              await emit({
                type: 'browser.screenshot',
                sessionId,
                data: { screenshot: base64, actionIndex: index, mode: navigation.mode },
              });
            } catch (_) {
              /* non-fatal; omit screenshot */
            }
          }
        }
        return result;
      }

      if (toolName === 'browser_navigate' && result.success) {
        const info = manager.getSessionInfo(sessionId);
        await emit({
          type: 'browser.navigated',
          sessionId,
          data: {
            url: info?.currentUrl ?? params.url,
            title: info?.currentTitle,
          },
        });
      }

      await emit({
        type: 'browser.action',
        sessionId,
        data: {
          action: toolName,
          params,
          success: result.success,
          output: result.output?.slice(0, 500),
          error: result.error,
        },
      });

      const session = manager.getSession(sessionId);
      if (session?.page && result.success) {
        try {
          const buf = await session.page.screenshot({
            type: 'jpeg',
            quality: 60,
            timeout: 5000,
          });
          const base64 = Buffer.isBuffer(buf) ? buf.toString('base64') : (buf as string);
          await emit({
            type: 'browser.screenshot',
            sessionId,
            data: { screenshot: base64 },
          });
        } catch (_) {
          /* non-fatal; omit screenshot */
        }
      }

      return result;
    },
  } as ToolExecutor;
}

export interface BrowserOrchestratorParams {
  sessionId: string;
  toolExecutor: ToolExecutor;
  sseStream: { writeSSE: (payload: { data: string }) => Promise<void> };
}

/**
 * Wrap the given tool executor with browser event emission and return the wrapped executor.
 * Does not create/destroy browser sessions; that is done by tools and BrowserManager idle timeout.
 */
export function wrapExecutorWithBrowserEvents(
  params: BrowserOrchestratorParams
): ToolExecutor {
  const { sessionId, toolExecutor, sseStream } = params;

  const emit: StreamEmitter = async (event) => {
    await sseStream.writeSSE({
      data: JSON.stringify({
        type: event.type,
        sessionId: event.sessionId,
        timestamp: Date.now(),
        data: event.data ?? {},
      }),
    });
  };

  return createBrowserObservableExecutor(toolExecutor, emit, sessionId);
}
