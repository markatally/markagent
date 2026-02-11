import { afterEach, describe, expect, it } from 'bun:test';
import { WebSearchTool, inferWebSearchTemporalConstraint, parsePublishedDate } from '../../apps/api/src/services/tools/web_search';
import type { ToolContext } from '../../apps/api/src/services/tools/types';

const mockContext: ToolContext = {
  sessionId: 'test-session',
  userId: 'test-user',
  workspaceDir: '/tmp/test-web-search',
};

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalTavilyKey = process.env.TAVILY_API_KEY;
const originalBraveKey = process.env.BRAVE_SEARCH_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  if (originalTavilyKey == null) {
    delete process.env.TAVILY_API_KEY;
  } else {
    process.env.TAVILY_API_KEY = originalTavilyKey;
  }
  if (originalBraveKey == null) {
    delete process.env.BRAVE_SEARCH_API_KEY;
  } else {
    process.env.BRAVE_SEARCH_API_KEY = originalBraveKey;
  }
});

describe('web_search temporal constraints', () => {
  it('detects last-24-hours style constraints as strict timestamp windows', () => {
    const nowMs = Date.parse('2026-02-11T12:00:00.000Z');
    const constraint = inferWebSearchTemporalConstraint(
      'please search big AI events happened in last 24 hours',
      nowMs
    );
    expect(constraint).toBeTruthy();
    expect(constraint?.label).toBe('last 24 hours');
    expect(constraint?.allowDateOnly).toBe(false);
    expect(constraint?.startUtcMs).toBe(nowMs - 24 * 60 * 60 * 1000);
    expect(constraint?.endUtcMs).toBe(nowMs);
  });

  it('parses date-only and timestamp publication fields with precision metadata', () => {
    const dayOnly = parsePublishedDate('2026-02-11');
    expect(dayOnly?.precision).toBe('day');
    expect(dayOnly?.utcMs).toBe(Date.parse('2026-02-11T00:00:00.000Z'));

    const timestamp = parsePublishedDate('2026-02-11T07:30:00Z');
    expect(timestamp?.precision).toBe('timestamp');
    expect(timestamp?.utcMs).toBe(Date.parse('2026-02-11T07:30:00.000Z'));
  });

  it('filters stale, undated, and low-precision results for strict 24-hour requests', async () => {
    const nowMs = Date.parse('2026-02-11T12:00:00.000Z');
    Date.now = () => nowMs;
    process.env.TAVILY_API_KEY = 'test-key';
    delete process.env.BRAVE_SEARCH_API_KEY;

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'Fresh',
              url: 'https://example.com/fresh',
              content: 'Fresh item',
              published_date: '2026-02-11T09:00:00Z',
            },
            {
              title: 'Old',
              url: 'https://example.com/old',
              content: 'Old item',
              published_date: '2026-02-09T10:00:00Z',
            },
            {
              title: 'No date',
              url: 'https://example.com/no-date',
              content: 'No date',
            },
            {
              title: 'Day precision',
              url: 'https://example.com/day-precision',
              content: 'Date only',
              published_date: '2026-02-11',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const tool = new WebSearchTool(mockContext);
    const result = await tool.execute({ query: 'major AI events in the last 24 hours' });
    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.output).toContain('Applied UTC Window');
    expect(result.output).toContain('Published (UTC): 2026-02-11T09:00:00.000Z');

    const artifact = result.artifacts?.find((item) => item.name === 'search-results.json');
    expect(artifact).toBeTruthy();
    const payload = JSON.parse(artifact!.content);
    expect(payload.topic).toBe('news');
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].title).toBe('Fresh');
    expect(payload.temporalFilterStats.outOfWindow).toBe(1);
    expect(payload.temporalFilterStats.missingDate).toBe(1);
    expect(payload.temporalFilterStats.lowPrecision).toBe(1);
  });
});
