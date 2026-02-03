/**
 * Web Search Tool - Research-grade academic paper discovery
 * Uses open-source PaperSearchSkills (arXiv, Semantic Scholar, CrossRef) and
 * orchestration: merge, dedupe by title/DOI, date resolution via tools only.
 * LLM must never hallucinate papers, venues, or dates; use tool output only.
 */

import type { Tool, ToolContext, ToolResult } from './types';
import {
  getPaperSearchSkill,
  createPaperSearchOrchestrator,
  CrossRefResolverSkill,
  DEFAULT_PAPER_SEARCH_SKILL_IDS,
} from '../paper-search';
import type { ResolvedPaper } from '../paper-search';

type SearchSource = 'arxiv' | 'semantic_scholar' | 'all';

const SOURCE_TO_SKILL_IDS: Record<SearchSource, string[]> = {
  arxiv: ['arxiv'],
  semantic_scholar: ['semantic_scholar'],
  all: [...DEFAULT_PAPER_SEARCH_SKILL_IDS],
};

export class WebSearchTool implements Tool {
  name = 'web_search';
  description =
    'Search academic papers using open-source APIs (arXiv, Semantic Scholar). Returns structured metadata including title, authors, publication date (resolved from APIs only), venue, DOI, and links. Results are merged and deduplicated across sources; publication dates are resolved via CrossRef > arXiv v1 > Semantic Scholar. Do not invent papers, venues, or dates—use only the returned results.';
  requiresConfirmation = false;
  timeout = 60000;

  inputSchema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string' as const,
        description: 'Search query for finding papers (keywords, phrases)',
      },
      sources: {
        type: 'string' as const,
        description: 'Sources to search: arxiv, semantic_scholar, all (default: all)',
        enum: ['arxiv', 'semantic_scholar', 'all'],
      },
      topK: {
        type: 'number' as const,
        description: 'Number of results to return (default: 5, max: 20)',
        minimum: 1,
        maximum: 20,
      },
      dateRange: {
        type: 'string' as const,
        description: 'Optional date range (e.g. "2020-2024", "last-5-years", "last-12-months")',
      },
      sortBy: {
        type: 'string' as const,
        description: 'Sort order: relevance, date, citations (default: relevance)',
        enum: ['relevance', 'date', 'citations'],
      },
      enableRetry: {
        type: 'boolean' as const,
        description: 'Retry with broader query if no results (default: true)',
      },
      maxRetries: {
        type: 'number' as const,
        description: 'Max retry attempts (default: 2)',
        minimum: 0,
        maximum: 5,
      },
    },
    required: ['query'],
  };

  private runOrchestrator = createPaperSearchOrchestrator({
    getSkill: (id) => getPaperSearchSkill(id),
    crossrefSkill: CrossRefResolverSkill,
  });

  constructor(private context: ToolContext) {}

  async execute(
    params: Record<string, unknown>,
    onProgress?: (current: number, total: number, message?: string) => void
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const query = String(params.query ?? '').trim();
    try {
      const sourcesParam = (params.sources as SearchSource) || 'all';
      const topK = Math.min(
        Math.max(Number(params.topK) ?? Number(params.maxResults) ?? 5, 1),
        20
      );
      const sortBy = (params.sortBy as string) || 'relevance';
      const dateRange = params.dateRange as string | undefined;
      const enableRetry = params.enableRetry !== false;
      const maxRetries = Math.min(Math.max(Number(params.maxRetries) || 2, 0), 5);

      if (!query) {
        return {
          success: false,
          output: '',
          error: 'Query is required and must be a non-empty string',
          duration: Date.now() - startTime,
        };
      }

      onProgress?.(0, 100, 'Preparing search...');
      const skillIds = SOURCE_TO_SKILL_IDS[sourcesParam] ?? DEFAULT_PAPER_SEARCH_SKILL_IDS;

      onProgress?.(10, 100, `Searching ${skillIds.length} source(s)...`);
      let out = await this.runOrchestrator({
        query,
        skillIds,
        limit: topK,
        sortBy: sortBy as 'relevance' | 'date' | 'citations',
        dateRange,
      });

      let searchAttempt = 1;
      let usedFallback = false;
      if (out.papers.length === 0 && enableRetry) {
        onProgress?.(40, 100, 'No results found, trying broader search...');
        const reformulated = this.reformulateQuery(query);
        for (const q of reformulated) {
          if (searchAttempt > maxRetries) break;
          searchAttempt++;
          onProgress?.(40 + searchAttempt * 10, 100, `Trying alternative query (${searchAttempt}/${maxRetries + 1})...`);
          const next = await this.runOrchestrator({
            query: q,
            skillIds,
            limit: topK,
            sortBy: sortBy as 'relevance' | 'date' | 'citations',
            dateRange: usedFallback ? undefined : dateRange,
          });
          out = {
            papers: [...out.papers, ...next.papers],
            sourcesQueried: [...new Set([...out.sourcesQueried, ...next.sourcesQueried])],
            sourcesSkipped: [...new Set([...out.sourcesSkipped, ...next.sourcesSkipped])],
            exclusionReasons: [...out.exclusionReasons, ...next.exclusionReasons],
          };
          if (out.papers.length > 0) {
            usedFallback = true;
            break;
          }
          usedFallback = true;
        }
      }

      onProgress?.(70, 100, 'Processing results...');
      const papers = out.papers.slice(0, topK);
      onProgress?.(90, 100, 'Formatting output...');

      const output = this.formatResults(
        papers,
        query,
        skillIds,
        sortBy,
        searchAttempt > 1,
        usedFallback,
        out.sourcesSkipped,
        out.exclusionReasons
      );

      // CRITICAL: Zero results is NOT an error - it's informational
      // The agent should use this information to trigger recovery strategies
      // rather than treating it as a fatal failure
      const artifactPayload = {
        query,
        originalQuery: query,
        sources: skillIds,
        sourcesQueried: out.sourcesQueried,
        sourcesSkipped: out.sourcesSkipped,
        searchAttempts: searchAttempt,
        usedFallback,
        sortBy,
        topK,
        results: papers,
        exclusionReasons: out.exclusionReasons,
        // Explicit flag for downstream consumers
        zeroResults: papers.length === 0,
        suggestion: papers.length === 0 
          ? 'Try broader terms, remove date filters, or reformulate the query'
          : undefined,
      };

      return {
        // RECALL-PERMISSIVE: Always return success to allow agent to continue
        // Zero results triggers recovery strategies, not agent termination
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
        // Provide informational warning (not error) for zero results
        ...(papers.length === 0 && {
          warning: `No papers found for query "${query}". Consider reformulating the query.`,
        }),
      };
    } catch (error: unknown) {
      // Network/API errors should still be reported, but as recoverable
      return {
        success: true, // Still allow agent to continue
        output: `Search encountered an error: ${error instanceof Error ? error.message : String(error)}. The agent may try alternative strategies.`,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        artifacts: [
          {
            type: 'data',
            name: 'search-results.json',
            content: JSON.stringify({
              query,
              results: [],
              zeroResults: true,
              searchError: error instanceof Error ? error.message : String(error),
              suggestion: 'Search failed; agent should try alternative queries or sources',
            }, null, 2),
            mimeType: 'application/json',
          },
        ],
      };
    }
  }

  private reformulateQuery(original: string): string[] {
    const cleaned = original
      .replace(/^(papers? about|research on|find|search for|looking for|i need|find me)\s+/i, '')
      .replace(/\s+(papers?|research|articles?)$/i, '')
      .trim();
    const out: string[] = cleaned !== original ? [cleaned] : [];
    const stop = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from']);
    const terms = original
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w.toLowerCase()))
      .join(' ');
    if (terms !== cleaned && terms.length > 3) out.push(terms);
    if (original.includes('"')) out.push(original.replace(/"/g, ''));
    return out;
  }

  private formatResults(
    results: ResolvedPaper[],
    query: string,
    sources: string[],
    sortBy: string,
    usedRetry: boolean,
    usedFallback: boolean,
    sourcesSkipped: string[],
    exclusionReasons: string[]
  ): string {
    if (results.length === 0) {
      let text = `🔍 Search Results for: "${query}"\n📊 No papers found\n`;
      text += `📌 Sources attempted: ${sources.join(', ')} | Sort: ${sortBy}\n`;
      if (sourcesSkipped.length) text += `⚠️ Skipped: ${sourcesSkipped.join(', ')}\n`;
      text += '='.repeat(60) + '\n\n💡 Try broader terms, remove filters, or check spelling.';
      return text;
    }

    let text = `🔍 Search Results for: "${query}"\n`;
    text += `📊 ${results.length} papers | Sources: ${sources.join(', ')} | Sort: ${sortBy}`;
    if (usedRetry) text += ' | Retry: used';
    if (usedFallback) text += ' | Fallback: used';
    text += '\n';
    if (sourcesSkipped.length) text += `⚠️ Skipped: ${sourcesSkipped.join(', ')}\n`;
    if (exclusionReasons.length) text += `📋 Notes: ${exclusionReasons.slice(0, 3).join('; ')}\n`;
    text += '='.repeat(60) + '\n\n';

    results.forEach((paper, i) => {
      text += `Result ${i + 1}/${results.length}:\n`;
      text += `📄 Title: ${paper.title}\n`;
      text += `✍️  Authors: ${paper.authors.join(', ')}\n`;
      if (paper.publicationDate) {
        text += `📅 Date: ${paper.publicationDate}`;
        if (paper.publicationDateSource) text += ` (source: ${paper.publicationDateSource})`;
        if (paper.publicationDateConfidence) text += ` [${paper.publicationDateConfidence}]`;
        text += '\n';
      }
      if (paper.venue) text += `🏛️  Venue: ${paper.venue}\n`;
      if (paper.citationCount != null) text += `📎 Citations: ${paper.citationCount}\n`;
      if (paper.doi) text += `🔗 DOI: ${paper.doi}\n`;
      text += `🔗 Link: ${paper.link}\n`;
      text += `📌 Source: ${paper.source}\n`;
      if (paper.abstract) text += `\n📝 Summary:\n${paper.abstract.slice(0, 500)}${paper.abstract.length > 500 ? '...' : ''}\n`;
      if (paper.exclusionReasons?.length) text += `⚠️ Notes: ${paper.exclusionReasons.join('; ')}\n`;
      text += '\n' + '-'.repeat(40) + '\n\n';
    });

    text += '='.repeat(60) + '\n💡 Use only these results; do not invent papers, venues, or dates.';
    return text;
  }
}
