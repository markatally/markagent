/**
 * Paper Search Tool - Research-grade academic paper discovery
 * Uses open-source PaperSearchSkills (arXiv, Semantic Scholar, CrossRef) and
 * orchestration: merge, dedupe by title/DOI, date resolution via tools only.
 * LLM must never hallucinate papers, venues, or dates; use tool output only.
 *
 * TIME-RANGE ENFORCEMENT:
 * - User time expressions are parsed into structured AbsoluteDateWindow
 * - Strict time ranges (e.g., "last 1 month") are NEVER expanded on retry
 * - Post-search validation filters out any papers outside the window
 */

import type { Tool, ToolContext, ToolResult } from './types';
import {
  getPaperSearchSkill,
  createPaperSearchOrchestrator,
  CrossRefResolverSkill,
  DEFAULT_PAPER_SEARCH_SKILL_IDS,
} from '../paper-search';
import type { ResolvedPaper, AbsoluteDateWindow } from '../paper-search';
import {
  parseDateRangeString,
  filterPapersByDateWindow,
  intentToAbsoluteDateWindow,
  isStrictTimeRange,
  describeTimeWindow,
  validateTimeRange,
} from '../paper-search/time-range-parser';

type SearchSource = 'arxiv' | 'semantic_scholar' | 'all';

const SOURCE_TO_SKILL_IDS: Record<SearchSource, string[]> = {
  arxiv: ['arxiv'],
  semantic_scholar: ['semantic_scholar'],
  all: [...DEFAULT_PAPER_SEARCH_SKILL_IDS],
};

type PaperSearchOrchestrator = ReturnType<typeof createPaperSearchOrchestrator>;
type TimeAwareAbsoluteDateWindow = AbsoluteDateWindow & {
  intent?: {
    unit?: 'days' | 'weeks' | 'months' | 'years' | 'absolute';
    originalExpression?: string;
    startYear?: number;
    endYear?: number;
  };
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeQueryWithTimeIntent(
  originalQuery: string,
  absoluteDateWindow?: TimeAwareAbsoluteDateWindow
): string {
  if (!absoluteDateWindow?.intent) {
    return originalQuery;
  }

  let cleaned = originalQuery;
  const expression = absoluteDateWindow.intent.originalExpression;
  if (expression) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(expression), 'gi'), ' ');
  }

  // If the user specified an absolute year/year-range, remove raw year tokens from query text.
  // Year filtering should happen through dateRange, not keyword matching against "2026".
  if (absoluteDateWindow.intent.unit === 'absolute') {
    const years = new Set<number>();
    if (absoluteDateWindow.intent.startYear != null) years.add(absoluteDateWindow.intent.startYear);
    if (absoluteDateWindow.intent.endYear != null) years.add(absoluteDateWindow.intent.endYear);
    for (const year of years) {
      cleaned = cleaned.replace(new RegExp(`\\b${year}\\b`, 'g'), ' ');
    }
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || originalQuery;
}

function extractSearchTopicQuery(originalQuery: string): string {
  let cleaned = originalQuery;

  // Remove presentation/task framing that hurts academic API retrieval quality.
  cleaned = cleaned
    .replace(
      /\b(?:and|then)?\s*(?:generate|create|make|build)\s+(?:a\s+)?(?:presentation|ppt|pptx|slides?|deck)\b.*$/i,
      ' '
    )
    .replace(/\b(?:for|as)\s+(?:a\s+)?(?:tech|technical)\s+talk\b/i, ' ')
    .replace(/\b(?:collect|find|get|search|look up|show me)\b/gi, ' ')
    .replace(/\b(?:top|best|hottest|most popular)\s+\d+\b/gi, ' ')
    .replace(/\b(?:paper|papers|research|article|articles)\b/gi, ' ');

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || originalQuery;
}

function inferRankingRule(
  query: string,
  explicitSortBy?: string
): { sortBy: 'relevance' | 'date' | 'citations'; rankingRule: string } {
  if (explicitSortBy === 'date' || explicitSortBy === 'citations' || explicitSortBy === 'relevance') {
    return {
      sortBy: explicitSortBy,
      rankingRule: `explicit sortBy=${explicitSortBy}`,
    };
  }

  const lower = query.toLowerCase();
  const hottestPattern = /\b(hottest|top|best|most influential|most impactful|most popular)\b/;
  if (hottestPattern.test(lower)) {
    return {
      sortBy: 'date',
      rankingRule: 'inferred hottest/top intent: rank by recency first',
    };
  }

  return {
    sortBy: 'relevance',
    rankingRule: 'default relevance ranking',
  };
}

export class PaperSearchTool implements Tool {
  name = 'paper_search';
  description =
    'Search academic papers using open-source APIs (arXiv, Semantic Scholar). Returns structured metadata including title, authors, publication date (resolved from APIs only), venue, DOI, and links. Results are merged and deduplicated across sources; publication dates are resolved via CrossRef > arXiv v1 > Semantic Scholar. Do not invent papers, venues, or dates—use only the returned results. IMPORTANT: Do NOT add year ranges (like "2023 2024") to the query text - the APIs return recent papers by default. Use only topic keywords for the query parameter.';
  requiresConfirmation = false;
  timeout = 60000;

  inputSchema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string' as const,
        description: 'Search query for finding papers. Use topic keywords only (e.g., "AI agents", "transformer architecture"). Do NOT include year ranges like "2023 2024" - the APIs return recent papers by default.',
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
        description: 'Optional date range filter. IMPORTANT: Use EXACTLY the time range the user specified. Examples: "last-1-month" (for "last 1 month" or "past month"), "last-2-weeks", "last-3-months", "last-1-year", "2020-2024". The format is "last-N-unit" where N is the number and unit is days/weeks/months/years. Do NOT round up or expand the time range.',
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

  private runOrchestrator: PaperSearchOrchestrator;

  constructor(
    private context: ToolContext,
    deps?: { runOrchestrator?: PaperSearchOrchestrator }
  ) {
    this.runOrchestrator =
      deps?.runOrchestrator ??
      createPaperSearchOrchestrator({
        getSkill: (id) => getPaperSearchSkill(id),
        crossrefSkill: CrossRefResolverSkill,
      });
  }

  async execute(
    params: Record<string, unknown>,
    onProgress?: (current: number, total: number, message?: string) => void
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const query = String(params.query ?? '').trim();
    try {
      const sourcesParam = (params.sources as SearchSource) || 'all';
      const parsedTopK = Number(
        params.topK ?? params.maxResults
      );
      const exceededTopK = Number.isFinite(parsedTopK) && parsedTopK > 20;
      const topK = Math.min(
        Math.max(Number.isFinite(parsedTopK) ? parsedTopK : 5, 1),
        20
      );
      const sortByParam = params.sortBy as string | undefined;
      const ranking = inferRankingRule(query, sortByParam);
      const sortBy = ranking.sortBy;
      let dateRange = params.dateRange as string | undefined;
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

      // ============================================================
      // PRE-SEARCH VALIDATION GATE: Parse time range into absolute window
      // WHY: Convert relative time ("last 1 month") to absolute dates ONCE
      // This prevents time-range drift during retries
      // ============================================================
      let absoluteDateWindow: TimeAwareAbsoluteDateWindow | undefined;
      if (dateRange) {
        const intent = parseDateRangeString(dateRange);
        absoluteDateWindow = intent ? intentToAbsoluteDateWindow(intent) : undefined;
      } else {
        // If model omitted dateRange but user query contains explicit time constraints
        // (e.g., "released in 2026"), infer and enforce it automatically.
        const inferred = validateTimeRange(query);
        absoluteDateWindow = inferred.absoluteDateWindow;
        if (absoluteDateWindow?.intent?.unit === 'absolute' && absoluteDateWindow.intent.startYear != null) {
          if (
            absoluteDateWindow.intent.endYear != null &&
            absoluteDateWindow.intent.endYear !== absoluteDateWindow.intent.startYear
          ) {
            dateRange = `${absoluteDateWindow.intent.startYear}-${absoluteDateWindow.intent.endYear}`;
          } else {
            dateRange = String(absoluteDateWindow.intent.startYear);
          }
        }
      }
      if (absoluteDateWindow) {
        console.log(`[PaperSearchTool] Time range parsed: ${describeTimeWindow(absoluteDateWindow)}`);
      }

      const searchQuery = sanitizeQueryWithTimeIntent(
        extractSearchTopicQuery(query),
        absoluteDateWindow
      );

      onProgress?.(0, 100, 'Preparing search...');
      const skillIds = SOURCE_TO_SKILL_IDS[sourcesParam] ?? DEFAULT_PAPER_SEARCH_SKILL_IDS;

      onProgress?.(10, 100, `Searching ${skillIds.length} source(s)...`);
      let out = await this.runOrchestrator({
        query: searchQuery,
        skillIds,
        limit: topK,
        sortBy: sortBy as 'relevance' | 'date' | 'citations',
        dateRange,
        absoluteDateWindow, // Pass absolute window for query-time filtering
      });

      let searchAttempt = 1;
      let usedFallback = false;

      // ============================================================
      // RETRY LOGIC WITH STRICT TIME RANGE ENFORCEMENT
      // WHY: If time range is strict, we NEVER expand or remove it
      // This is the key fix for the "last 1 month -> 12 months" bug
      // ============================================================
      const isStrict = isStrictTimeRange(absoluteDateWindow);

      if (out.papers.length === 0 && enableRetry) {
        onProgress?.(40, 100, 'No results found, trying broader search...');
        const reformulated = this.reformulateQuery(query);
        for (const q of reformulated) {
          if (searchAttempt > maxRetries) break;
          searchAttempt++;
          onProgress?.(40 + searchAttempt * 10, 100, `Trying alternative query (${searchAttempt}/${maxRetries + 1})...`);

          // CRITICAL FIX: If strict time range, NEVER remove the date filter
          // Previously: dateRange: usedFallback ? undefined : dateRange
          // This caused "last 1 month" to silently expand to "all time"
          const retryDateRange = isStrict ? dateRange : (usedFallback ? undefined : dateRange);
          const retryDateWindow = isStrict ? absoluteDateWindow : (usedFallback ? undefined : absoluteDateWindow);

          const next = await this.runOrchestrator({
            query: sanitizeQueryWithTimeIntent(q, absoluteDateWindow),
            skillIds,
            limit: topK,
            sortBy: sortBy as 'relevance' | 'date' | 'citations',
            dateRange: retryDateRange,
            absoluteDateWindow: retryDateWindow,
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

      // ============================================================
      // POST-SEARCH VERIFICATION: Filter papers by date window
      // WHY: Even if the API returns papers outside the window, we filter them
      // This is the final gate that ensures strict time compliance
      // ============================================================
      let dateFilteredCount = 0;
      if (absoluteDateWindow && out.papers.length > 0) {
        const evaluated = filterPapersByDateWindow(out.papers, absoluteDateWindow);
        const filtered = evaluated.filter((paper) => paper.included);
        const reasons = evaluated
          .filter((paper) => !paper.included)
          .map((paper) => paper.exclusionReason)
          .filter((reason): reason is string => !!reason);
        dateFilteredCount = out.papers.length - filtered.length;
        out.papers = filtered.map((paper) => {
          const { included, exclusionReason, ...rest } = paper as ResolvedPaper & {
            included: boolean;
            exclusionReason?: string;
          };
          return rest;
        });
        if (reasons.length > 0) {
          out.exclusionReasons.push(...reasons.slice(0, 5)); // Limit to avoid noise
          if (dateFilteredCount > 0) {
            out.exclusionReasons.push(
              `${dateFilteredCount} paper(s) excluded: outside time window [${absoluteDateWindow.startDate} to ${absoluteDateWindow.endDate}]`
            );
          }
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
        out.exclusionReasons,
        exceededTopK
      );

      // CRITICAL: Zero results is NOT an error - it's informational
      // The agent should use this information to trigger recovery strategies
      // rather than treating it as a fatal failure
      const hasProviderError = out.sourcesQueried.length === 0 && out.sourcesSkipped.length > 0;
      const searchStatus = hasProviderError
        ? 'provider_error'
        : papers.length === 0
          ? 'zero_results'
          : 'success';

      const artifactPayload = {
        query,
        searchQuery,
        originalQuery: query,
        sources: skillIds,
        sourcesQueried: out.sourcesQueried,
        sourcesSkipped: out.sourcesSkipped,
        searchAttempts: searchAttempt,
        usedFallback,
        sortBy,
        topK,
        rankingRule: ranking.rankingRule,
        results: papers,
        exclusionReasons: out.exclusionReasons,
        // Time range enforcement metadata
        timeRange: absoluteDateWindow ? {
          startDate: absoluteDateWindow.startDate,
          endDate: absoluteDateWindow.endDate,
          strict: absoluteDateWindow.strict,
          papersFilteredByDate: dateFilteredCount,
        } : undefined,
        // Explicit flag for downstream consumers
        zeroResults: papers.length === 0,
        searchStatus,
        suggestion: papers.length === 0
          ? (hasProviderError
              ? 'Search providers returned errors. Retry shortly or try a different source/topic query.'
              : isStrict
              ? `No papers found within the strict time window [${absoluteDateWindow?.startDate} to ${absoluteDateWindow?.endDate}]. The time constraint was enforced as requested.`
              : 'Try broader terms, remove date filters, or reformulate the query')
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
          warning: hasProviderError
            ? `Search providers failed for query "${query}". Check provider availability and retry.`
            : `No papers found for query "${query}". Consider reformulating the query.`,
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
    exclusionReasons: string[],
    suppressDetails: boolean
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
    if (suppressDetails) {
      text += 'Results omitted due to requested limit exceeding max (20).';
      text += '\n\n' + '='.repeat(60) + '\n💡 Use only these results; do not invent papers, venues, or dates.';
      return text;
    }

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
