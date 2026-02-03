/**
 * Paper Search - Open-source academic retrieval skills and orchestration
 * Skills return structured data only. Publication dates resolved via tools.
 */

export * from './types';
export { ArxivSearchSkill } from './arxiv-skill';
export { SemanticScholarSkill } from './semantic-scholar-skill';
export { CrossRefResolverSkill } from './crossref-skill';
export { createPaperSearchOrchestrator } from './orchestrator';
export type { OrchestratorDeps } from './orchestrator';

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
