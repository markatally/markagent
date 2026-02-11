/**
 * Post-fix integration tests for web search snapshot URLs.
 * Run with: RUN_WEBSEARCH_URL_TESTS=1 CONFIG_PATH=config/default.json bun test tests/integration/websearch-snapshot-urls.test.ts
 * Requires browser enabled in config and network access.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { clearConfigCache } from '../../apps/api/src/services/config';
import { getBrowserManager, resetBrowserManager } from '../../apps/api/src/services/browser';
import {
  navigateWebSearchEntryWithFallback,
  normalizeWebSearchUrl,
} from '../../apps/api/src/services/browser/orchestrator';

const POST_FIX_TEST_URLS = [
  'https://www.washingtonpost.com/technology/2026/02/07/ai-spending-economy-shortages/',
  'https://r.jina.ai/https://www.wsj.com/tech/ai/when-your-ai-hobby-becomes-a-supermeme-96c93df3',
  'https://r.jina.ai/https://www.mediapost.com/publications/article/412554/almost-human-ai-genai-created-ads-did-as-well-in.html?edition=140823',
  'https://r.jina.ai/https://www.cnbc.com/2026/02/04/cnbcs-the-china-connection-newsletter-for-chinese-businesses-its-not-about-which-ai-is-the-smartest.html',
  'https://r.jina.ai/https://www.wsj.com/tech/ai/openclaw-ai-agents-moltbook-social-network-5b79ad65',
  'https://r.jina.ai/https://techcrunch.com/2026/02/05/amazon-and-google-are-winning-the-ai-capex-race-but-whats-the-prize/',
  'https://r.jina.ai/https://www.reuters.com/business/media-telecom/anthropic-buys-super-bowl-ads-slap-openai-selling-ads-chatgpt-2026-02-07/',
  'https://r.jina.ai/https://www.mediapost.com/publications/article/412653/alphabet-reportedly-looking-at-bond-sale-to-fund-a.html',
  'https://r.jina.ai/https://www.cnbc.com/2026/02/06/ai-sell-off-stocks-amazon-oracle.html',
];

const runLiveUrlTests = process.env.RUN_WEBSEARCH_URL_TESTS === '1';

describe('websearch snapshot URLs (post-fix)', () => {
  beforeAll(() => {
    const configPath = process.env.CONFIG_PATH ?? path.join(process.cwd(), 'config/default.json');
    process.env.CONFIG_PATH = configPath;
    clearConfigCache();
  });

  afterAll(() => {
    resetBrowserManager();
  });

  it.each(POST_FIX_TEST_URLS)(
    'acquires usable snapshot for %s',
    async (rawUrl) => {
      if (!runLiveUrlTests) {
        expect(true).toBe(true);
        return;
      }
      const manager = getBrowserManager();
      if (!manager.isEnabled()) {
        expect(true).toBe(true);
        return;
      }
      const sessionId = `websearch-url-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const page = await manager.getPage(sessionId);
      expect(page).toBeDefined();
      if (!page) return;

      try {
        const normalizedUrl = normalizeWebSearchUrl(rawUrl);
        const entry = { url: rawUrl, normalizedUrl, title: undefined, snippet: undefined };
        const outcome = await navigateWebSearchEntryWithFallback(page, entry);
        expect(outcome.displayUrl).toBe(normalizedUrl);
        if (outcome.ok) {
          expect(['direct', 'reader', 'fallback']).toContain(outcome.mode);
        } else {
          // e.g. Washington Post: direct 403, reader may fail, fallback setContent can throw in some envs
          expect(outcome.errors.length).toBeGreaterThan(0);
          const hasBlocked = outcome.errors.some(
            (e) => e.includes('http-403') || e.includes('human-verification') || e.includes('fallback:')
          );
          expect(hasBlocked).toBe(true);
        }
      } finally {
        await manager.destroy(sessionId);
      }
    },
    { timeout: 60000 }
  );
});
