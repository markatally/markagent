/**
 * SemanticScholarSkill - Semantic Scholar API for paper search and metadata
 * Returns structured data only: citation count, year/venue, abstract.
 */

import type { PaperSearchSkill, RawPaperResult, PaperSearchSkillOptions } from './types';

const BASE_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const PAPER_URL = 'https://api.semanticscholar.org/graph/v1/paper';
const USER_AGENT = 'Mark-Agent/1.0 (research; mailto:support@markagent.dev)';

const FIELDS = 'title,authors,year,venue,url,abstract,citationCount,externalIds';

export const SemanticScholarSkill: PaperSearchSkill = {
  id: 'semantic_scholar',
  name: 'Semantic Scholar Search',
  description: 'Search papers via Semantic Scholar API. Returns citation count, venue, and publication year.',

  async search(query: string, options: PaperSearchSkillOptions): Promise<RawPaperResult[]> {
    const { limit, sortBy } = options;
    const params = new URLSearchParams({
      query,
      limit: String(Math.min(limit, 100)),
      fields: FIELDS,
    });
    if (sortBy === 'date') {
      params.set('sort', 'year');
      params.set('sortOrder', 'desc');
    } else if (sortBy === 'citations') {
      params.set('sort', 'citationCount');
      params.set('sortOrder', 'desc');
    }
    const res = await fetch(`${BASE_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{
      paperId?: string;
      title?: string;
      authors?: Array<{ name?: string }>;
      year?: number;
      venue?: string;
      url?: string;
      abstract?: string;
      citationCount?: number;
      externalIds?: { DOI?: string; ArXiv?: string };
    }> };
    if (!data.data || !Array.isArray(data.data)) return [];
    return data.data.map((item) => {
      let publicationDate: string | null = null;
      if (item.year != null) {
        publicationDate = `${item.year}-01-01`;
      }
      return {
        title: item.title ?? 'Untitled',
        authors: item.authors?.map((a) => a.name ?? '').filter(Boolean) ?? [],
        abstract: item.abstract ?? undefined,
        link: item.url ?? `https://www.semanticscholar.org/paper/${item.paperId ?? ''}`,
        source: 'semantic_scholar',
        doi: item.externalIds?.DOI ?? null,
        arxivId: item.externalIds?.ArXiv ?? null,
        semanticScholarId: item.paperId ?? null,
        publicationDate,
        venue: item.venue ?? null,
        citationCount: item.citationCount ?? null,
      };
    });
  },
};
