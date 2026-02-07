/**
 * Web Search Tool - General internet search (news, articles, docs)
 * Uses Tavily for AI-friendly web search. Falls back to Brave Search if needed.
 */

import type { Tool, ToolContext, ToolResult } from './types';

type SearchTopic = 'general' | 'news';
type SearchDepth = 'basic' | 'advanced';

type WebSearchResult = {
  title: string;
  url: string;
  content?: string;
  score?: number;
  publishedDate?: string;
  source?: string;
};

export class WebSearchTool implements Tool {
  name = 'web_search';
  description =
    'Search the internet for current information, news, articles, documentation, and general web content. Returns relevant web pages with titles, URLs, and content snippets. Use topic "news" for current events.';
  requiresConfirmation = false;
  timeout = 60000;

  inputSchema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string' as const,
        description: 'Search query for finding web results (e.g., "AI agent news", "model context protocol").',
      },
      topic: {
        type: 'string' as const,
        description: 'Search topic: general or news (default: general)',
        enum: ['general', 'news'],
      },
      maxResults: {
        type: 'number' as const,
        description: 'Number of results to return (default: 5, max: 10)',
        minimum: 1,
        maximum: 10,
      },
      includeContent: {
        type: 'boolean' as const,
        description: 'Whether to include content snippets (default: true)',
      },
      searchDepth: {
        type: 'string' as const,
        description: 'Search depth: basic or advanced (default: basic)',
        enum: ['basic', 'advanced'],
      },
    },
    required: ['query'],
  };

  constructor(private context: ToolContext) {}

  async execute(
    params: Record<string, unknown>,
    onProgress?: (current: number, total: number, message?: string) => void
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const query = String(params.query ?? '').trim();
    if (!query) {
      return {
        success: false,
        output: '',
        error: 'Query is required and must be a non-empty string',
        duration: Date.now() - startTime,
      };
    }

    const topic = (params.topic as SearchTopic) || 'general';
    const maxResultsRaw = Number(params.maxResults);
    const maxResults = Math.min(
      Math.max(Number.isFinite(maxResultsRaw) ? maxResultsRaw : 5, 1),
      10
    );
    const includeContent = params.includeContent !== false;
    const searchDepth = (params.searchDepth as SearchDepth) || 'basic';

    onProgress?.(0, 100, 'Preparing web search...');

    try {
      const tavilyKey = process.env.TAVILY_API_KEY;
      const braveKey = process.env.BRAVE_SEARCH_API_KEY;

      if (!tavilyKey && !braveKey) {
        return {
          success: false,
          output: 'Web search requires a TAVILY_API_KEY or BRAVE_SEARCH_API_KEY. Please configure one in your .env file.',
          error: 'Missing web search API keys',
          duration: Date.now() - startTime,
        };
      }

      let results: WebSearchResult[] = [];
      let provider = 'tavily';

      if (tavilyKey) {
        onProgress?.(20, 100, 'Searching the web (Tavily)...');
        results = await this.searchWithTavily({
          apiKey: tavilyKey,
          query,
          topic,
          maxResults,
          includeContent,
          searchDepth,
        });
      } else if (braveKey) {
        provider = 'brave';
        onProgress?.(20, 100, 'Searching the web (Brave)...');
        results = await this.searchWithBrave({
          apiKey: braveKey,
          query,
          topic,
          maxResults,
          includeContent,
        });
      }

      onProgress?.(80, 100, 'Formatting results...');
      const output = this.formatResults(query, results, provider);

      const artifactPayload = {
        query,
        topic,
        provider,
        maxResults,
        results,
        zeroResults: results.length === 0,
      };

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
        artifacts: [
          {
            type: 'data',
            name: 'search-results.json',
            content: JSON.stringify(artifactPayload, null, 2),
            mimeType: 'application/json',
          },
        ],
        ...(results.length === 0 && {
          warning: `No web results found for query "${query}". Consider refining the query.`,
        }),
      };
    } catch (error: unknown) {
      return {
        success: false,
        output: `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  private async searchWithTavily(input: {
    apiKey: string;
    query: string;
    topic: SearchTopic;
    maxResults: number;
    includeContent: boolean;
    searchDepth: SearchDepth;
  }): Promise<WebSearchResult[]> {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: input.apiKey,
        query: input.query,
        topic: input.topic,
        search_depth: input.searchDepth,
        max_results: input.maxResults,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tavily search failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((item: any) => ({
      title: String(item.title ?? ''),
      url: String(item.url ?? ''),
      content: input.includeContent ? String(item.content ?? '') : undefined,
      score: typeof item.score === 'number' ? item.score : undefined,
      publishedDate: item.published_date ? String(item.published_date) : undefined,
      source: 'tavily',
    })).filter((item: WebSearchResult) => item.title && item.url);
  }

  private async searchWithBrave(input: {
    apiKey: string;
    query: string;
    topic: SearchTopic;
    maxResults: number;
    includeContent: boolean;
  }): Promise<WebSearchResult[]> {
    const endpoint = input.topic === 'news'
      ? 'https://api.search.brave.com/res/v1/news/search'
      : 'https://api.search.brave.com/res/v1/web/search';
    const params = new URLSearchParams({
      q: input.query,
      count: String(input.maxResults),
    });

    const response = await fetch(`${endpoint}?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': input.apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Brave search failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const results = input.topic === 'news'
      ? (Array.isArray(data?.results) ? data.results : [])
      : (Array.isArray(data?.web?.results) ? data.web.results : []);

    return results.map((item: any) => ({
      title: String(item.title ?? ''),
      url: String(item.url ?? ''),
      content: input.includeContent
        ? String(item.description ?? item.snippet ?? item.extra_snippets?.[0] ?? '')
        : undefined,
      score: typeof item.score === 'number' ? item.score : undefined,
      publishedDate: item.published_time ? String(item.published_time) : undefined,
      source: 'brave',
    })).filter((item: WebSearchResult) => item.title && item.url);
  }

  private formatResults(query: string, results: WebSearchResult[], provider: string): string {
    if (results.length === 0) {
      return `Web Search Results for: "${query}"\nNo results found.\nProvider: ${provider}`;
    }

    let text = `Web Search Results for: "${query}"\n`;
    text += `Results: ${results.length} | Provider: ${provider}\n`;
    text += '='.repeat(60) + '\n\n';

    results.forEach((result, index) => {
      text += `Result ${index + 1}/${results.length}:\n`;
      text += `Title: ${result.title}\n`;
      text += `URL: ${result.url}\n`;
      if (result.publishedDate) text += `Published: ${result.publishedDate}\n`;
      if (result.content) text += `Snippet: ${result.content}\n`;
      if (result.score != null) text += `Score: ${result.score}\n`;
      if (result.source) text += `Source: ${result.source}\n`;
      text += '\n' + '-'.repeat(40) + '\n\n';
    });

    text += '='.repeat(60);
    return text;
  }
}
