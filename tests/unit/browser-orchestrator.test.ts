import { describe, it, expect } from 'bun:test';
import type { ToolResult } from '../../apps/api/src/services/tools/types';
import {
  normalizeWebSearchUrl,
  buildWebSearchNavigationAttempts,
  extractWebSearchEntries,
  isHumanVerificationWall,
} from '../../apps/api/src/services/browser/orchestrator';

describe('browser/orchestrator web-search snapshot helpers', () => {
  it('normalizes web-search URLs by removing brittle tracking params', () => {
    const url =
      'https://www.wsj.com/tech/ai/story?gaa_at=eafs&gaa_n=token&utm_source=newsletter&fbclid=abc123';
    const normalized = normalizeWebSearchUrl(url);
    expect(normalized).toBe('https://www.wsj.com/tech/ai/story');
  });

  it('keeps non-tracking query params while removing tracking params', () => {
    const url = 'https://example.com/search?q=ai&sort=date&utm_medium=email&gclid=123';
    const normalized = normalizeWebSearchUrl(url);
    expect(normalized).toBe('https://example.com/search?q=ai&sort=date');
  });

  it('builds direct + reader fallback attempts for HTTP(S) links', () => {
    const attempts = buildWebSearchNavigationAttempts(
      'https://www.wsj.com/livecoverage/stocks?gaa_at=x'
    );
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts[0]?.reason).toBe('direct');
    expect(attempts[0]?.target).toBe('https://www.wsj.com/livecoverage/stocks');
    expect(attempts.some((attempt) => attempt.reason === 'reader')).toBe(true);
  });

  it('extracts normalized entries and deduplicates by normalized URL', () => {
    const result: ToolResult = {
      success: true,
      output: 'ok',
      duration: 1,
      artifacts: [
        {
          type: 'data',
          name: 'search-results.json',
          mimeType: 'application/json',
          content: JSON.stringify({
            results: [
              {
                title: 'WSJ 1',
                url: 'https://www.wsj.com/tech/ai/story?gaa_at=eafs',
                content: 'first',
              },
              {
                title: 'WSJ 1 duplicate',
                url: 'https://www.wsj.com/tech/ai/story',
                content: 'duplicate',
              },
              {
                title: 'Reuters',
                url: 'https://www.reuters.com/video/watch/idRW398209022026RP1/',
                content: 'video page',
              },
            ],
          }),
        },
      ],
    };

    const entries = extractWebSearchEntries(result);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.normalizedUrl).toBe('https://www.wsj.com/tech/ai/story');
    expect(entries[0]?.title).toBe('WSJ 1');
    expect(entries[0]?.snippet).toBe('first');
    expect(entries[1]?.normalizedUrl).toBe(
      'https://www.reuters.com/video/watch/idRW398209022026RP1/'
    );
  });

  it('detects human-verification walls from page content markers', () => {
    const blocked = isHumanVerificationWall(
      'Please verify you are a human',
      'https://www.investors.com/news/technology/ai-stocks',
      '<html><body>Powered by PerimeterX, Inc.</body></html>'
    );
    expect(blocked).toBe(true);
  });

  it('does not flag normal article pages as human-verification walls', () => {
    const blocked = isHumanVerificationWall(
      'AI Stocks To Watch In 2026',
      'https://example.com/news/ai-stocks',
      '<html><body><article>Market commentary and earnings outlook.</article></body></html>'
    );
    expect(blocked).toBe(false);
  });
});
