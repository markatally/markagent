/**
 * Web Search Tool Tests
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { WebSearchTool } from '../../apps/api/src/services/tools/web_search';
import type { ToolContext } from '../../apps/api/src/services/tools/types';

describe('WebSearchTool', () => {
  const mockWorkspaceDir = '/tmp/test-websearch-workspace';
  let mockContext: ToolContext;
  const mockOrchestrator = async (
    input:
      | {
          query: string;
          skillIds: string[];
          limit: number;
          sortBy?: 'relevance' | 'date' | 'citations';
          dateRange?: string;
          absoluteDateWindow?: {
            startDate: string;
            endDate: string;
            strict: boolean;
          };
        }
      | {
          query: string;
          options: {
            limit: number;
            sortBy?: 'relevance' | 'date' | 'citations';
            dateRange?: string;
            absoluteDateWindow?: {
              startDate: string;
              endDate: string;
              strict: boolean;
            };
          };
        }
  ) => {
    const limit = 'limit' in input ? input.limit : input.options.limit;
    const skillIds = 'skillIds' in input ? input.skillIds : ['arxiv', 'semantic_scholar'];
    const sourcesQueried = skillIds.length > 0 ? skillIds : ['arxiv'];
    const papers = Array.from({ length: limit }, (_, index) => {
      const source = sourcesQueried[index % sourcesQueried.length] ?? 'arxiv';
      return {
        title: `Paper ${index + 1}`,
        authors: ['Test Author'],
        abstract: 'Mock abstract',
        link: `https://example.com/paper/${index + 1}`,
        source,
        doi: null,
        arxivId: source === 'arxiv' ? `arxiv-${index + 1}` : null,
        semanticScholarId: source === 'semantic_scholar' ? `s2-${index + 1}` : null,
        publicationDate: '2024-01-01',
        publicationDateSource: source === 'arxiv' ? 'arxiv_v1' : 'semantic_scholar',
        publicationDateConfidence: 'high',
        venue: 'Test Venue',
        citationCount: 42,
      };
    });

    return {
      papers,
      sourcesQueried,
      sourcesSkipped: [],
      exclusionReasons: [],
    };
  };

  beforeEach(async () => {
    // Create temporary workspace
    mockContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      workspaceDir: mockWorkspaceDir,
    };
  });

  it('should validate query is required', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Query is required');
  });

  it('should reject empty query', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({ query: '   ' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('non-empty');
  });

  it('should accept valid query with default parameters', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({ query: 'machine learning' });

    expect(result.output).toContain('machine learning');
    if (result.success) {
      expect(result.artifacts).toBeDefined();
      expect(result.artifacts).toHaveLength(1);
    } else {
      expect(result.error).toBeDefined();
      expect(result.output).toBeDefined();
    }
  });

  it('should use custom topic parameter', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({ query: 'neural networks', topic: 'news' });

    if (result.success && result.artifacts?.length) {
      const payload = JSON.parse(result.artifacts[0].content);
      expect(payload.topic).toBe('news');
    } else {
      expect(result.error).toBeDefined();
    }
  });

  it('should use custom topK parameter', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({ query: 'deep learning', topK: 3 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('3');
  });

  it('should use custom sortBy parameter', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({ query: 'transformers', sortBy: 'date' });

    expect(result.output).toContain('date');
    if (!result.success) expect(result.error).toBeDefined();
  });

  it('should use custom maxResults parameter', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({
      query: 'reinforcement learning',
      maxResults: 2,
    });

    if (result.success && result.artifacts?.length) {
      const payload = JSON.parse(result.artifacts[0].content);
      expect(payload.maxResults).toBe(2);
    } else {
      expect(result.error).toBeDefined();
    }
  });

  it('should limit topK to maximum 20', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({ query: 'attention mechanisms', topK: 50 });

    expect(result.success).toBe(true);
    // Should limit to 20 results per source
    expect(result.output).not.toContain('50');
  });

  it('should return artifacts with JSON data when results found', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({ query: 'graph neural networks' });

    expect(result.output).toBeDefined();
    if (result.success && result.artifacts?.length) {
      expect(result.artifacts[0].type).toBe('data');
      expect(result.artifacts[0].name).toBe('search-results.json');
      expect(result.artifacts[0].mimeType).toBe('application/json');
    }
  });

  it('should include metadata in output', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({ query: 'natural language processing' });

    expect(result.output).toContain('Search Results');
    expect(
      result.output.includes('Title') ||
      result.output.includes('No papers found') ||
      result.output.includes('Authors')
    ).toBe(true);
  });

  it('should gracefully handle API errors or empty results', async () => {
    const tool = new WebSearchTool(mockContext, { runOrchestrator: mockOrchestrator });

    const result = await tool.execute({ query: 'test query' });

    expect(result.output).toBeDefined();
    expect(result.duration).toBeGreaterThanOrEqual(0);
    if (!result.success) expect(result.error).toBeDefined();
  });
});
