/**
 * Paper Search - Open-source academic retrieval skills and orchestration
 * Skills return structured data only. Publication dates resolved via tools.
 * 
 * TIME-RANGE ENFORCEMENT:
 * - Use parseTimeRangeFromInput() to parse user expressions into structured intent
 * - Use filterPapersByDateWindow() for post-search verification
 * - Strict time ranges are NEVER expanded on retry
 */

export * from './types';
export { ArxivSearchSkill } from './arxiv-skill';
export { SemanticScholarSkill } from './semantic-scholar-skill';
export { CrossRefResolverSkill } from './crossref-skill';
export { createPaperSearchOrchestrator } from './orchestrator';
export type { OrchestratorDeps } from './orchestrator';

// Time range parsing and validation utilities
export {
  parseTimeRangeFromInput,
  parseDateRangeString,
  intentToAbsoluteDateWindow,
  filterPapersByDateWindow,
  isDateWithinWindow,
  isStrictTimeRange,
  describeTimeWindow,
  validateTimeRange,
} from './time-range-parser';
export type {
  TimeRangeIntent,
  AbsoluteDateWindow,
  TimeRangeValidationResult,
} from './time-range-parser';

import type { PaperSearchSkill } from './types';
import { ArxivSearchSkill } from './arxiv-skill';
import { SemanticScholarSkill } from './semantic-scholar-skill';
import { CrossRefResolverSkill } from './crossref-skill';

const SKILL_MAP: Record<string, PaperSearchSkill> = {
  [ArxivSearchSkill.id]: ArxivSearchSkill,
  [SemanticScholarSkill.id]: SemanticScholarSkill,
  [CrossRefResolverSkill.id]: CrossRefResolverSkill,
};

export function getPaperSearchSkill(id: string): PaperSearchSkill | undefined {
  return SKILL_MAP[id];
}

export const DEFAULT_PAPER_SEARCH_SKILL_IDS = ['arxiv', 'semantic_scholar'] as const;
