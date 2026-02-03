/**
 * ArxivSearchSkill - Official arXiv API for paper search and metadata
 * Returns structured data only. Uses arXiv submission (published) date as v1 date.
 * 
 * TIME-RANGE ENFORCEMENT:
 * - Supports AbsoluteDateWindow for precise query-time filtering
 * - When absoluteDateWindow is provided, it takes precedence over dateRange string
 */

import type { PaperSearchSkill, RawPaperResult, PaperSearchSkillOptions, AbsoluteDateWindow } from './types';

const BASE_URL = 'https://export.arxiv.org/api/query';
const USER_AGENT = 'Mark-Agent/1.0 (research; mailto:support@markagent.dev)';

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Build arXiv search query with proper formatting
 * 
 * @param query - Search query
 * @param dateRange - Legacy date range string (e.g., "last-12-months")
 * @param absoluteDateWindow - New absolute date window (preferred)
 * 
 * WHY absoluteDateWindow is preferred:
 * - Dates are already computed, no re-parsing needed
 * - strict flag is preserved for downstream enforcement
 * - Consistent behavior across all skills
 * 
 * IMPORTANT arXiv API quirks:
 * 1. Multi-word queries like "AI agent" need each word prefixed with field:
 *    - WRONG: all:AI+agent (parsed as all:AI OR agent)
 *    - RIGHT: all:AI+AND+all:agent (explicit AND between field:term pairs)
 * 2. Square brackets in date ranges MUST be URL-encoded: %5B and %5D
 * 3. Date format is YYYYMMDDTTTT (12 digits: year, month, day, hour, minute)
 */
function buildArXivQuery(
  query: string, 
  dateRange?: string,
  absoluteDateWindow?: AbsoluteDateWindow
): string {
  // Split query into terms and prefix each with "all:" joined by AND
  // This ensures "AI agent" becomes "all:AI+AND+all:agent" not "all:AI+agent"
  const terms = query.trim().split(/\s+/).filter(t => t.length > 0);
  let q = terms.map(term => `all:${term}`).join('+AND+');
  
  // PRIORITY 1: Use absoluteDateWindow if provided (new preferred method)
  // WHY: This uses pre-computed absolute dates, preventing any drift
  if (absoluteDateWindow) {
    // Format: YYYYMMDDTTTT where TTTT is HHMM in GMT
    // Start date: beginning of day (0000)
    // End date: end of day (2359) to be INCLUSIVE of the entire end date
    const startStr = absoluteDateWindow.startDate.replace(/-/g, '') + '0000';
    const endStr = absoluteDateWindow.endDate.replace(/-/g, '') + '2359';
    // URL-encode brackets: [ = %5B, ] = %5D (required for arXiv API)
    q += `+AND+submittedDate:%5B${startStr}+TO+${endStr}%5D`;
    console.log(`[ArxivSkill] Using absolute date window: ${absoluteDateWindow.startDate} to ${absoluteDateWindow.endDate} (strict=${absoluteDateWindow.strict})`);
    return q;
  }
  
  // PRIORITY 2: Fall back to legacy dateRange string parsing
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
      // Use proper arXiv date format with URL-encoded brackets
      q += `+AND+submittedDate:%5B${y}${m}${d}0000+TO+999912312359%5D`;
    } else {
      const yearRange = dateRange.match(/(\d{4})-(\d{4})/);
      if (yearRange) {
        // Year range: Jan 1 start year to Dec 31 end year
        q += `+AND+submittedDate:%5B${yearRange[1]}01010000+TO+${yearRange[2]}12312359%5D`;
      } else if (/^\d{4}$/.test(dateRange)) {
        // Single year: Jan 1 to Dec 31 of that year
        q += `+AND+submittedDate:%5B${dateRange}01010000+TO+${dateRange}12312359%5D`;
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
    const { limit, sortBy, dateRange, absoluteDateWindow } = options;
    // Build URL manually to avoid double-encoding of pre-encoded characters like %5B/%5D
    // buildArXivQuery returns a pre-encoded query string with URL-encoded brackets
    const searchQuery = buildArXivQuery(query, dateRange, absoluteDateWindow);
    const maxResults = String(Math.min(limit, 100));
    const sortParam = mapSort(sortBy);
    const url = `${BASE_URL}?search_query=${searchQuery}&start=0&max_results=${maxResults}&sortBy=${sortParam}&sortOrder=descending`;
    console.log(`[ArxivSkill] Fetching: ${url}`);
    const res = await fetch(url, {
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
