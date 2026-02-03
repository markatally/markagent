/**
 * Web Search Tool Tests
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { WebSearchTool } from '../../apps/api/src/services/tools/web_search';
import type { ToolContext } from '../../apps/api/src/services/tools/types';

describe('WebSearchTool', () => {
  const mockWorkspaceDir = '/tmp/test-websearch-workspace';
  let mockContext: ToolContext;

  beforeEach(async () => {
    // Create temporary workspace
    mockContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      workspaceDir: mockWorkspaceDir,
    };
  });

  it('should validate query is required', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Query is required');
  });

  it('should reject empty query', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({ query: '   ' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('non-empty');
  });

  it('should accept valid query with default parameters', async () => {
    const tool = new WebSearchTool(mockContext);

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

  it('should use custom sources parameter', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({ query: 'neural networks', sources: 'arxiv' });

    expect(result.output).toContain('arxiv');
    if (!result.success) expect(result.error).toBeDefined();
  });

  it('should use custom topK parameter', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({ query: 'deep learning', topK: 3 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('3');
  });

  it('should use custom sortBy parameter', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({ query: 'transformers', sortBy: 'date' });

    expect(result.output).toContain('date');
    if (!result.success) expect(result.error).toBeDefined();
  });

  it('should handle multiple sources', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({
      query: 'reinforcement learning',
      sources: 'all',
      topK: 2,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('arxiv');
    expect(result.output).toContain('semantic_scholar');
  });

  it('should limit topK to maximum 20', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({ query: 'attention mechanisms', topK: 50 });

    expect(result.success).toBe(true);
    // Should limit to 20 results per source
    expect(result.output).not.toContain('50');
  });

  it('should return artifacts with JSON data when results found', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({ query: 'graph neural networks' });

    expect(result.output).toBeDefined();
    if (result.success && result.artifacts?.length) {
      expect(result.artifacts[0].type).toBe('data');
      expect(result.artifacts[0].name).toBe('search-results.json');
      expect(result.artifacts[0].mimeType).toBe('application/json');
    }
  });

  it('should include metadata in output', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({ query: 'natural language processing' });

    expect(result.output).toContain('Search Results');
    expect(
      result.output.includes('Title') ||
      result.output.includes('No papers found') ||
      result.output.includes('Authors')
    ).toBe(true);
  });

  it('should gracefully handle API errors or empty results', async () => {
    const tool = new WebSearchTool(mockContext);

    const result = await tool.execute({ query: 'test query' });

    expect(result.output).toBeDefined();
    expect(result.duration).toBeGreaterThanOrEqual(0);
    if (!result.success) expect(result.error).toBeDefined();
  });
});
