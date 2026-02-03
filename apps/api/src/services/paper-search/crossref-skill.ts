/**
 * CrossRefResolverSkill - CrossRef API for DOI resolution and publisher metadata
 * Used to resolve exact publication dates (YYYY-MM-DD) from DOI.
 * Does not support full-text search; use resolveByDoi for known DOIs.
 */

import type { PaperSearchSkill, RawPaperResult, PaperSearchSkillOptions } from './types';

const BASE_URL = 'https://api.crossref.org/works';
const USER_AGENT = 'Mark-Agent/1.0 (research; mailto:support@markagent.dev)';

function normalizeDoi(doi: string): string {
  return doi.replace(/^https?:\/\/doi\.org\//i, '').trim();
}

export const CrossRefResolverSkill: PaperSearchSkill = {
  id: 'crossref',
  name: 'CrossRef DOI Resolver',
  description: 'Resolve DOI to publisher metadata and exact publication date. No search; use with known DOIs.',

  async search(_query: string, _options: PaperSearchSkillOptions): Promise<RawPaperResult[]> {
    return [];
  },

  async resolveByDoi(doi: string): Promise<RawPaperResult | null> {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;
    const encoded = encodeURIComponent(normalized);
    const res = await fetch(`${BASE_URL}/${encoded}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      message?: {
        title?: string[];
        author?: Array<{ given?: string; family?: string }>;
        abstract?: string;
        DOI?: string;
        published?: { 'date-parts'?: number[][] };
        'published-print'?: { 'date-parts'?: number[][] };
        'published-online'?: { 'date-parts'?: number[][] };
        container?: string[];
      };
    };
    const msg = data.message;
    if (!msg || !msg.title?.length) return null;
    const title = msg.title[0] ?? 'Untitled';
    const authors = (msg.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(' ').trim()).filter(Boolean);
    const dateParts = msg.published?.['date-parts']?.[0]
      ?? msg['published-print']?.['date-parts']?.[0]
      ?? msg['published-online']?.['date-parts']?.[0];
    let publicationDate: string | null = null;
    if (dateParts && dateParts.length >= 1) {
      const y = dateParts[0];
      const m = dateParts[1] != null ? String(dateParts[1]).padStart(2, '0') : '01';
      const d = dateParts[2] != null ? String(dateParts[2]).padStart(2, '0') : '01';
      publicationDate = `${y}-${m}-${d}`;
    }
    const container = msg.container?.[0];
    return {
      title,
      authors: authors.length > 0 ? authors : ['Unknown'],
      abstract: msg.abstract ?? undefined,
      link: `https://doi.org/${normalized}`,
      source: 'crossref',
      doi: normalized,
      publicationDate,
      venue: container ?? null,
    };
  },
};
