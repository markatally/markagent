/**
 * ArxivSearchSkill - Official arXiv API for paper search and metadata
 * Returns structured data only. Uses arXiv submission (published) date as v1 date.
 */

import type { PaperSearchSkill, RawPaperResult, PaperSearchSkillOptions } from './types';

const BASE_URL = 'http://export.arxiv.org/api/query';
const USER_AGENT = 'Mark-Agent/1.0 (research; mailto:support@markagent.dev)';

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function buildArXivQuery(query: string, dateRange?: string): string {
  let q = `all:${query.replace(/\s+/g, '+')}`;
  if (dateRange) {
    const lower = dateRange.toLowerCase();
    const lastMatch = lower.match(/last-(\d+)-?(years?|months?|days?)/);
    if (lastMatch) {
      const num = parseInt(lastMatch[1], 10);
      const unit = lastMatch[2];
      const now = new Date();
      let start: Date;
      if (unit.startsWith('year')) {
        start = new Date(now.getFullYear() - num, 0, 1);
      } else if (unit.startsWith('month')) {
        start = new Date(now.getFullYear(), now.getMonth() - num, 1);
      } else {
        start = new Date(now.getTime() - num * 24 * 60 * 60 * 1000);
      }
      const y = start.getFullYear();
      const m = String(start.getMonth() + 1).padStart(2, '0');
      const d = String(start.getDate()).padStart(2, '0');
      q += `+AND+submittedDate:[${y}${m}${d}*+TO+99991231*]`;
    } else {
      const yearRange = dateRange.match(/(\d{4})-(\d{4})/);
      if (yearRange) {
        q += `+AND+submittedDate:[${yearRange[1]}*+TO+${yearRange[2]}*]`;
      } else if (/^\d{4}$/.test(dateRange)) {
        q += `+AND+submittedDate:[${dateRange}*]`;
      }
    }
  }
  return q;
}

function mapSort(sortBy?: string): string {
  const m: Record<string, string> = {
    relevance: 'relevance',
    date: 'submittedDate',
    citations: 'citationCount',
  };
  return m[sortBy || 'relevance'] || 'relevance';
}

export const ArxivSearchSkill: PaperSearchSkill = {
  id: 'arxiv',
  name: 'arXiv Search',
  description: 'Search and retrieve paper metadata from the official arXiv API. Returns submission (v1) date.',

  async search(query: string, options: PaperSearchSkillOptions): Promise<RawPaperResult[]> {
    const { limit, sortBy, dateRange } = options;
    const params = new URLSearchParams({
      search_query: buildArXivQuery(query, dateRange),
      start: '0',
      max_results: String(Math.min(limit, 100)),
      sortBy: mapSort(sortBy),
      sortOrder: 'descending',
    });
    const res = await fetch(`${BASE_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return [];
    const text = await res.text();
    const results: RawPaperResult[] = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(text)) !== null) {
      const entry = match[1];
      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
      const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
      const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
      const idMatch = entry.match(/<id>([^<]+)<\/id>/);
      const authorNames = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => stripHtml(m[1]).trim()).filter(Boolean);
      if (!titleMatch || !idMatch) continue;
      const arxivId = idMatch[1].split('/').pop()?.replace(/v\d+$/, '') ?? '';
      const link = `https://arxiv.org/abs/${arxivId}`;
      let publicationDate: string | null = null;
      if (publishedMatch) {
        try {
          publicationDate = new Date(publishedMatch[1].trim()).toISOString().split('T')[0];
        } catch {
          publicationDate = null;
        }
      }
      results.push({
        title: stripHtml(titleMatch[1]),
        authors: authorNames.length > 0 ? authorNames : ['Unknown'],
        abstract: summaryMatch ? stripHtml(summaryMatch[1]).slice(0, 1000) : undefined,
        link,
        source: 'arxiv',
        arxivId: arxivId || null,
        publicationDate,
        venue: 'arXiv',
      });
    }
    return results;
  },
};
