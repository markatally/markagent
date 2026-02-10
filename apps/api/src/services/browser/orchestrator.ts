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

type WebSearchNavigationOutcome = {
  ok: boolean;
  displayUrl: string;
  loadedUrl?: string;
  title?: string;
  mode: 'direct' | 'reader' | 'fallback';
  errors: string[];
};

const HUMAN_VERIFICATION_TEXT_MARKERS = [
  'please verify you are a human',
  'access to this page has been denied because we believe you are using automation tools',
  'powered by perimeterx',
  'challenge by cloudflare',
  'cf-challenge',
  'captcha',
  'enable javascript and cookies',
];

function shouldDropQueryParam(name: string): boolean {
  return TRACKING_QUERY_PARAM_PATTERNS.some((pattern) => pattern.test(name));
}

export function normalizeWebSearchUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
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
      // Reader fallback often bypasses anti-bot walls enough to return text-rendered content.
      if (!parsed.hostname.endsWith('r.jina.ai')) {
        pushAttempt(`https://r.jina.ai/${parsed.toString()}`, 'reader');
      }
    }
  } catch {
    // ignore malformed URL and keep direct attempt only
  }

  return attempts;
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

type MinimalBrowserPage = {
  goto: (
    url: string,
    options: { waitUntil: 'domcontentloaded'; timeout: number }
  ) => Promise<unknown>;
  title: () => Promise<string>;
  url: () => string;
  content: () => Promise<string>;
  setContent: (
    html: string,
    options: { waitUntil: 'domcontentloaded'; timeout: number }
  ) => Promise<void>;
};

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

  return HUMAN_VERIFICATION_TEXT_MARKERS.some((marker) => combined.includes(marker));
}

async function navigateWebSearchEntryWithFallback(
  page: MinimalBrowserPage,
  entry: WebSearchEntry
): Promise<WebSearchNavigationOutcome> {
  const attempts = buildWebSearchNavigationAttempts(entry.url);
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      await page.goto(attempt.target, {
        waitUntil: 'domcontentloaded',
        timeout: attempt.reason === 'direct' ? 15000 : 12000,
      });
      await new Promise((resolve) => setTimeout(resolve, 900));
      const pageTitle = await page.title().catch(() => undefined);
      const loadedUrl = page.url();
      const html = await page.content().catch(() => undefined);
      if (isHumanVerificationWall(pageTitle, loadedUrl, html)) {
        errors.push(`${attempt.reason}:human-verification-wall`);
        continue;
      }
      return {
        ok: true,
        displayUrl: entry.normalizedUrl,
        loadedUrl,
        title: pageTitle,
        mode: attempt.reason,
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Navigation failed';
      errors.push(`${attempt.reason}:${message}`);
    }
  }

  try {
    const html = buildBlockedPageFallbackHtml(entry, errors);
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      ok: true,
      displayUrl: entry.normalizedUrl,
      loadedUrl: page.url(),
      title: `Snapshot fallback: ${entry.title ?? entry.normalizedUrl}`,
      mode: 'fallback',
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fallback page render failed';
    errors.push(`fallback:${message}`);
    return {
      ok: false,
      displayUrl: entry.normalizedUrl,
      mode: 'fallback',
      errors,
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
                    ? `Visited ${navigation.displayUrl} via reader fallback`
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
                params: { url: entry.url },
                success: navigation.ok,
                output: outputByMode,
                error: navigationError,
                mode: navigation.mode,
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
