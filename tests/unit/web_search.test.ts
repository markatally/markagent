/**
 * Web Search Tool Tests
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { WebSearchTool } from '../../apps/api/src/services/tools/web_search';
import type { ToolContext } from '../../apps/api/src/services/tools/types';

const mockContext: ToolContext = {
  sessionId: 'test-session',
  userId: 'test-user',
  workspaceDir: '/tmp/test-websearch-workspace',
};

const originalFetch = globalThis.fetch;
const originalTavilyKey = process.env.TAVILY_API_KEY;
const originalBraveKey = process.env.BRAVE_SEARCH_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
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

describe('WebSearchTool', () => {
  it('validates that query is required', async () => {
    const tool = new WebSearchTool(mockContext);
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Query is required');
  });

  it('returns a clear error when no provider API keys are configured', async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    const tool = new WebSearchTool(mockContext);
    const result = await tool.execute({ query: 'AI news' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing web search API keys');
  });

  it('uses Tavily when key is available and includes artifact payload', async () => {
    process.env.TAVILY_API_KEY = 'test-tavily';
    delete process.env.BRAVE_SEARCH_API_KEY;

    let requestBody: any = null;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Fresh AI Update',
              url: 'https://example.com/news?utm_source=feed',
              content: 'Short summary',
              score: 0.91,
              published_date: '2026-02-11T09:00:00Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const tool = new WebSearchTool(mockContext);
    const result = await tool.execute({ query: 'AI updates', topic: 'news', maxResults: 3 });

    expect(result.success).toBe(true);
    expect(requestBody.topic).toBe('news');
    expect(requestBody.max_results).toBe(3);
    expect(result.output).toContain('Fresh AI Update');
    expect(result.output).toContain('Published (UTC): 2026-02-11T09:00:00.000Z');
    const payload = JSON.parse(result.artifacts?.[0]?.content ?? '{}');
    expect(payload.provider).toBe('tavily');
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].url).toBe('https://example.com/news');
  });

  it('falls back to Brave when Tavily key is missing', async () => {
    delete process.env.TAVILY_API_KEY;
    process.env.BRAVE_SEARCH_API_KEY = 'test-brave';

    let calledUrl = '';
    globalThis.fetch = (async (url) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Brave AI Story',
              url: 'https://brave.example.com/story',
              description: 'Story body',
              published_time: '2026-02-11T08:00:00Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const tool = new WebSearchTool(mockContext);
    const result = await tool.execute({ query: 'AI', topic: 'news' });

    expect(result.success).toBe(true);
    expect(calledUrl).toContain('/news/search');
    const payload = JSON.parse(result.artifacts?.[0]?.content ?? '{}');
    expect(payload.provider).toBe('brave');
    expect(payload.results[0].title).toBe('Brave AI Story');
  });

  it('clamps maxResults to the schema bounds', async () => {
    process.env.TAVILY_API_KEY = 'test-tavily';
    delete process.env.BRAVE_SEARCH_API_KEY;

    let requestBody: any = null;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const tool = new WebSearchTool(mockContext);
    await tool.execute({ query: 'AI', maxResults: 99 });
    expect(requestBody.max_results).toBe(10);

    await tool.execute({ query: 'AI', maxResults: 0 });
    expect(requestBody.max_results).toBe(1);
  });

  it('surfaces provider HTTP failures in the tool error output', async () => {
    process.env.TAVILY_API_KEY = 'test-tavily';
    delete process.env.BRAVE_SEARCH_API_KEY;

    globalThis.fetch = (async () =>
      new Response('bad gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } })) as typeof fetch;

    const tool = new WebSearchTool(mockContext);
    const result = await tool.execute({ query: 'AI reliability' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Web search failed');
  });
});
