/**
 * Paper Search - Shared types for academic retrieval skills
 * All skills return structured data only (no free text).
 * Publication dates are resolved via tools, not LLM guessing.
 */

/** Source of publication date: priority order for resolution */
export type PublicationDateSource =
  | 'crossref'   // Publisher/DOI metadata (highest)
  | 'arxiv_v1'   // arXiv first submission date
  | 'semantic_scholar'
  | null;

/** Confidence when date is unknown */
export type DateConfidence = 'high' | 'medium' | 'low' | null;

/** Raw result from a single PaperSearchSkill (before merge/dedupe) */
export interface RawPaperResult {
  title: string;
  authors: string[];
  /** Abstract or summary; may be truncated */
  abstract?: string;
  /** Canonical link (arXiv abs, Semantic Scholar, etc.) */
  link: string;
  /** Source skill id, e.g. 'arxiv', 'semantic_scholar', 'crossref' */
  source: string;
  /** DOI if known */
  doi?: string | null;
  /** arXiv ID if from arXiv */
  arxivId?: string | null;
  /** Semantic Scholar paper ID if from S2 */
  semanticScholarId?: string | null;
  /** Publication date YYYY-MM-DD from this source; may be year-only (YYYY-01-01) */
  publicationDate?: string | null;
  /** Venue/journal name */
  venue?: string | null;
  /** Citation count when available */
  citationCount?: number | null;
  /** Exclusion reason if this result was filtered out */
  exclusionReason?: string | null;
}

/**
 * Resolved paper after orchestration: merged, deduped, date resolved.
 * Used in tool output and downstream skills.
 */
export interface ResolvedPaper {
  title: string;
  authors: string[];
  abstract?: string;
  link: string;
  /** Primary source; may have been merged from multiple */
  source: string;
  doi?: string | null;
  arxivId?: string | null;
  semanticScholarId?: string | null;
  /** Resolved publication date YYYY-MM-DD; null if unknown */
  publicationDate: string | null;
  /** Which source provided the date (null if unknown) */
  publicationDateSource: PublicationDateSource;
  /** Confidence when date is present */
  publicationDateConfidence: DateConfidence;
  venue?: string | null;
  citationCount?: number | null;
  /** If constraints could not be satisfied, why this paper was still included */
  exclusionReasons?: string[];
}

/** Options for a single skill search */
export interface PaperSearchSkillOptions {
  limit: number;
  sortBy?: 'relevance' | 'date' | 'citations';
  dateRange?: string;
}

/**
 * PaperSearchSkill interface.
 * Each skill encapsulates one external source and returns structured data only.
 */
export interface PaperSearchSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Search for papers by query */
  search(
    query: string,
    options: PaperSearchSkillOptions
  ): Promise<RawPaperResult[]>;
  /** Optional: resolve metadata by DOI (e.g. CrossRef) */
  resolveByDoi?(doi: string): Promise<RawPaperResult | null>;
}

/** Input for the orchestrator */
export interface PaperSearchOrchestratorInput {
  query: string;
  /** Which skill ids to call, e.g. ['arxiv', 'semantic_scholar'] */
  skillIds: string[];
  limit: number;
  sortBy?: 'relevance' | 'date' | 'citations';
  dateRange?: string;
}

/** Output from the orchestrator */
export interface PaperSearchOrchestratorOutput {
  papers: ResolvedPaper[];
  sourcesQueried: string[];
  /** Sources that failed or returned no results */
  sourcesSkipped: string[];
  exclusionReasons: string[];
}
