import { createHash } from 'crypto';
import { tokenizeQuery } from './parser';
import type {
  EmbeddingProvider,
  EvidenceItem,
  QueryUnderstanding,
  RetrievalResult,
  TranscriptDocument,
  TranscriptSegment,
} from './types';

type SegmentScore = {
  segment: TranscriptSegment;
  score: number;
  reasons: string[];
};

const segmentEmbeddingCache = new Map<string, number[]>();

function makeTranscriptKey(document: TranscriptDocument): string {
  const hash = createHash('sha1');
  hash.update(document.fullText);
  return hash.digest('hex');
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function overlapScore(queryTokens: string[], segmentTokens: string[]): number {
  if (queryTokens.length === 0 || segmentTokens.length === 0) return 0;
  const set = new Set(segmentTokens);
  let hits = 0;
  for (const token of queryTokens) {
    if (set.has(token)) hits += 1;
  }
  return hits / queryTokens.length;
}

function charBigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, '').toLowerCase();
  const grams = new Set<string>();
  for (let i = 0; i < compact.length - 1; i += 1) {
    grams.add(compact.slice(i, i + 2));
  }
  return grams;
}

function bigramJaccard(a: string, b: string): number {
  const ag = charBigrams(a);
  const bg = charBigrams(b);
  if (ag.size === 0 || bg.size === 0) return 0;
  let intersection = 0;
  for (const item of ag) {
    if (bg.has(item)) intersection += 1;
  }
  const union = ag.size + bg.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function timeRangeScore(segment: TranscriptSegment, startSeconds: number, endSeconds: number): number {
  const overlapStart = Math.max(segment.startSeconds, startSeconds);
  const overlapEnd = Math.min(segment.endSeconds, endSeconds);
  if (overlapEnd >= overlapStart) return 1;
  if (segment.startSeconds < startSeconds) return Math.max(0, 1 - (startSeconds - segment.startSeconds) / 20);
  return Math.max(0, 1 - (segment.startSeconds - endSeconds) / 20);
}

function hasStrictOverlap(segment: TranscriptSegment, startSeconds: number, endSeconds: number): boolean {
  return segment.startSeconds >= startSeconds && segment.startSeconds <= endSeconds;
}

function sampleEvenlyByTimeline<T>(items: T[], maxItems: number): T[] {
  if (maxItems <= 0) return [];
  if (items.length <= maxItems) return items;
  if (maxItems === 1) return [items[0]];
  const selected: T[] = [];
  for (let i = 0; i < maxItems; i += 1) {
    const idx = Math.round((i / (maxItems - 1)) * (items.length - 1));
    selected.push(items[idx]);
  }
  return selected;
}

function toEvidence(items: SegmentScore[]): EvidenceItem[] {
  return items.map((item) => ({
    segmentId: item.segment.id,
    stamp: item.segment.stamp,
    startSeconds: item.segment.startSeconds,
    text: item.segment.text,
    score: Number(item.score.toFixed(4)),
    reasons: item.reasons,
  }));
}

function toConfidence(topScore: number): 'high' | 'medium' | 'low' {
  if (topScore >= 0.72) return 'high';
  if (topScore >= 0.45) return 'medium';
  return 'low';
}

async function computeSemanticScores(
  embeddingProvider: EmbeddingProvider | undefined,
  doc: TranscriptDocument,
  queryText: string
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (!embeddingProvider || doc.segments.length === 0) return scores;

  try {
    const docKey = makeTranscriptKey(doc);
    const missingSegments = doc.segments.filter((segment) => !segmentEmbeddingCache.has(`${docKey}:${segment.id}`));
    if (missingSegments.length > 0) {
      const vectors = await embeddingProvider.embedTexts(missingSegments.map((s) => s.text));
      for (let i = 0; i < missingSegments.length; i += 1) {
        segmentEmbeddingCache.set(`${docKey}:${missingSegments[i].id}`, vectors[i] || []);
      }
    }

    const [queryVector] = await embeddingProvider.embedTexts([queryText]);
    if (!queryVector || queryVector.length === 0) return scores;
    for (const segment of doc.segments) {
      const vector = segmentEmbeddingCache.get(`${docKey}:${segment.id}`) || [];
      scores.set(segment.id, Math.max(0, cosineSimilarity(queryVector, vector)));
    }
  } catch {
    // Semantic retrieval is best-effort and should not break grounding pipeline.
    return new Map<string, number>();
  }
  return scores;
}

export async function retrieveTranscriptEvidence(input: {
  document: TranscriptDocument;
  understanding: QueryUnderstanding;
  embeddingProvider?: EmbeddingProvider;
  maxEvidence?: number;
}): Promise<RetrievalResult> {
  const { document, understanding, embeddingProvider } = input;
  const maxEvidence = input.maxEvidence ?? 10;
  if (document.segments.length === 0) {
    return { evidence: [], confidence: 'low', mode: 'hybrid' };
  }

  if (understanding.intent === 'summary') {
    let scopedSegments = document.segments;
    if (understanding.timeRange) {
      const start = understanding.timeRange.startSeconds;
      const end = understanding.timeRange.endSeconds;
      scopedSegments = document.segments.filter((segment) => {
        const overlapStart = Math.max(segment.startSeconds, start);
        const overlapEnd = Math.min(segment.endSeconds, end);
        return overlapEnd >= overlapStart;
      });
    }
    // Summary intent should cover the full scoped transcript instead of sparse keyframe sampling.
    // Keep a high safety cap to avoid pathological payload sizes.
    const sampled = scopedSegments.slice(0, 800);
    return {
      evidence: sampled.map((segment) => ({
        segmentId: segment.id,
        stamp: segment.stamp,
        startSeconds: segment.startSeconds,
        text: segment.text,
        score: 1,
        reasons: ['timeline-coverage'],
      })),
      confidence: sampled.length > 0 ? 'high' : 'low',
      mode: understanding.timeRange ? 'time_range' : 'timeline',
    };
  }

  if (understanding.intent === 'time_range' && understanding.timeRange) {
    const start = understanding.timeRange.startSeconds;
    const end = understanding.timeRange.endSeconds;
    const strictOverlap = document.segments
      .filter((segment) => hasStrictOverlap(segment, start, end))
      .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
    const sampled = sampleEvenlyByTimeline(strictOverlap, 160);
    return {
      evidence: sampled.map((segment) => ({
        segmentId: segment.id,
        stamp: segment.stamp,
        startSeconds: segment.startSeconds,
        text: segment.text,
        score: 1,
        reasons: ['time-range-overlap'],
      })),
      confidence: sampled.length > 0 ? 'high' : 'low',
      mode: 'time_range',
    };
  }

  const queryTokens = understanding.keywords.length > 0 ? understanding.keywords : tokenizeQuery(understanding.normalizedQuery);
  const semanticScores = await computeSemanticScores(embeddingProvider, document, understanding.normalizedQuery);
  const scored: SegmentScore[] = [];
  const hasTimeRange = Boolean(understanding.timeRange);
  const timeStart = understanding.timeRange?.startSeconds ?? 0;
  const timeEnd = understanding.timeRange?.endSeconds ?? 0;
  const sameScript =
    understanding.script === document.script ||
    understanding.script === 'unknown' ||
    document.script === 'unknown';

  for (const segment of document.segments) {
    const segmentTokens = [...segment.latinTokens, ...segment.cjkTokens];
    const lexical = overlapScore(queryTokens, segmentTokens);
    const fuzzy = bigramJaccard(understanding.normalizedQuery, segment.text);
    const semanticRaw = semanticScores.get(segment.id) || 0;
    const semantic =
      sameScript && lexical < 0.05 && fuzzy < 0.05 ? semanticRaw * 0.2 : semanticRaw;
    const time = hasTimeRange ? timeRangeScore(segment, timeStart, timeEnd) : 0;

    const reasons: string[] = [];
    if (lexical > 0.05) reasons.push('keyword');
    if (fuzzy > 0.08) reasons.push('fuzzy');
    if (semantic > 0.25) reasons.push('semantic');
    if (time > 0.6) reasons.push('time-range');

    const score = hasTimeRange
      ? 0.55 * time + 0.2 * lexical + 0.15 * semantic + 0.1 * fuzzy
      : 0.35 * lexical + 0.35 * semantic + 0.3 * fuzzy;

    scored.push({ segment, score, reasons });
  }

  scored.sort((a, b) => b.score - a.score || a.segment.startSeconds - b.segment.startSeconds);
  let filtered = hasTimeRange
    ? scored.filter((item) => item.reasons.includes('time-range') && item.score >= 0.4)
    : scored.filter((item) => item.score >= 0.24);

  if (!hasTimeRange && filtered.length > 0 && sameScript) {
    filtered = filtered.filter((item) => item.reasons.includes('keyword') || item.reasons.includes('fuzzy'));
  }

  filtered = filtered.slice(0, maxEvidence);

  const topScore = filtered[0]?.score ?? 0;
  return {
    evidence: toEvidence(filtered),
    confidence: toConfidence(topScore),
    mode: hasTimeRange ? 'time_range' : 'hybrid',
  };
}
