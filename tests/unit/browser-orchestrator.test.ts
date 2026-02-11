import { describe, it, expect } from 'bun:test';
import type { ToolResult } from '../../apps/api/src/services/tools/types';
import {
  normalizeWebSearchUrl,
  buildWebSearchNavigationAttempts,
  extractWebSearchEntries,
  isHumanVerificationWall,
  classifyNavigationFailure,
  resolveDomainNavigationPolicy,
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

  it('unwraps legacy r.jina proxy URLs during normalization', () => {
    const url =
      'https://r.jina.ai/https://www.cnbc.com/2026/02/04/cnbcs-the-china-connection-newsletter-for-chinese-businesses-its-not-about-which-ai-is-the-smartest.html?utm_source=feed';
    const normalized = normalizeWebSearchUrl(url);
    expect(normalized).toBe(
      'https://www.cnbc.com/2026/02/04/cnbcs-the-china-connection-newsletter-for-chinese-businesses-its-not-about-which-ai-is-the-smartest.html'
    );
  });

  it('builds only direct first-party attempts for HTTP(S) links', () => {
    const attempts = buildWebSearchNavigationAttempts(
      'https://www.wsj.com/livecoverage/stocks?gaa_at=x'
    );
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0]?.reason).toBe('direct');
    expect(attempts[0]?.target).toBe('https://www.wsj.com/livecoverage/stocks');
    expect(attempts.some((attempt) => attempt.target.includes('r.jina.ai'))).toBe(false);
  });

  it('unwraps r.jina URLs into source-domain direct attempts', () => {
    const attempts = buildWebSearchNavigationAttempts(
      'https://r.jina.ai/https://www.reuters.com/video/watch/idRW290705022026RP1/?chan=business'
    );
    expect(attempts[0]?.target).toBe('https://www.reuters.com/video/watch/idRW290705022026RP1/?chan=business');
    expect(
      attempts.some(
        (attempt) =>
          attempt.target ===
            'https://www.reuters.com/video/watch/idRW290705022026RP1/?chan=business' &&
          attempt.reason === 'direct'
      )
    ).toBe(true);
    expect(attempts.some((attempt) => attempt.target.includes('r.jina.ai'))).toBe(false);
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

  it('detects 403 Forbidden from page content', () => {
    const blocked = isHumanVerificationWall(
      '403 Forbidden',
      'https://www.washingtonpost.com/technology/2026/02/07/ai-spending-economy-shortages/',
      '<html><body><h1>403 Forbidden</h1><p>Access denied.</p></body></html>'
    );
    expect(blocked).toBe(true);
  });

  it('detects "forbidden" and "access denied" in HTML body', () => {
    expect(
      isHumanVerificationWall(
        'Error',
        'https://example.com/blocked',
        '<html><body>Access denied. You do not have permission.</body></html>'
      )
    ).toBe(true);
    expect(
      isHumanVerificationWall(
        'Forbidden',
        'https://example.com/forbidden',
        '<html><body>Request forbidden by policy.</body></html>'
      )
    ).toBe(true);
  });

  it('does not treat plain numeric 401/403 mentions as verification walls', () => {
    const blocked = isHumanVerificationWall(
      'Market update',
      'https://example.com/news',
      '<html><body>Shares rose to 401 points after dipping from 403 earlier in the session.</body></html>'
    );
    expect(blocked).toBe(false);
  });

  it('does not treat r.jina payload text specially once proxy wrappers are removed', () => {
    const blocked = isHumanVerificationWall(
      'Pretty-print',
      'https://r.jina.ai/https://www.wsj.com/tech/ai/when-your-ai-hobby-becomes-a-supermeme-96c93df3',
      '{"data":null,"code":451,"name":"SecurityCompromiseError","status":45102,"message":"Anonymous access to domain www.wsj.com blocked due to previous abuse. DDoS attack suspected: Too many domains"}'
    );
    expect(blocked).toBe(false);
  });

  it('classifies retryable and non-retryable failures consistently', () => {
    expect(classifyNavigationFailure({ statusCode: 429 })).toBe('rate_limited');
    expect(classifyNavigationFailure({ statusCode: 503 })).toBe('http_5xx');
    expect(classifyNavigationFailure({ statusCode: 403 })).toBe('http_4xx');
    expect(classifyNavigationFailure({ errorMessage: 'net::ERR_NAME_NOT_RESOLVED ENOTFOUND' })).toBe(
      'dns'
    );
    expect(classifyNavigationFailure({ errorMessage: 'Navigation timeout of 15000ms exceeded' })).toBe(
      'timeout'
    );
  });

  it('resolves domain-specific navigation policy for known hosts', () => {
    const wsj = resolveDomainNavigationPolicy('https://www.wsj.com/tech/ai/story');
    expect(wsj.name).toBe('wsj');
    expect(wsj.navTimeoutMs).toBeGreaterThan(15000);
    expect(wsj.maxAttempts).toBe(2);

    const unknown = resolveDomainNavigationPolicy('https://example.org/path');
    expect(unknown.name).toBe('default');
    expect(unknown.maxAttempts).toBe(2);
  });
});
