import { tokenizeQuery } from './parser';
import type { EvidenceItem, QueryUnderstanding } from './types';

type VerificationResult = {
  ok: boolean;
  reason?: string;
};

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function extractEntityTokens(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) || [];
  return new Set(matches.filter((token) => token.length >= 2));
}

function extractCitations(answer: string): string[] {
  return answer.match(/\[E\d+\]/g) || [];
}

function noveltyRatio(answer: string, evidence: EvidenceItem[]): number {
  const evidenceText = evidence.map((e) => e.text).join('\n');
  const evidenceTokens = new Set(tokenizeQuery(evidenceText));
  const answerTokens = tokenizeQuery(answer);
  if (answerTokens.length === 0) return 1;
  let unknown = 0;
  for (const token of answerTokens) {
    if (!evidenceTokens.has(token)) unknown += 1;
  }
  return unknown / answerTokens.length;
}

export function verifyGroundedAnswer(params: {
  answer: string;
  evidence: EvidenceItem[];
  understanding: QueryUnderstanding;
}): VerificationResult {
  const { answer, evidence, understanding } = params;
  if (!answer.trim()) return { ok: false, reason: 'empty-answer' };
  if (evidence.length === 0) return { ok: false, reason: 'no-evidence' };

  if (understanding.intent === 'summary') {
    if (answer.trim().length < 24) {
      return { ok: false, reason: 'summary-too-short' };
    }

    const evidenceText = evidence.map((e) => e.text).join('\n');
    const evidenceEntities = extractEntityTokens(evidenceText);
    const answerEntities = extractEntityTokens(answer);
    if (evidenceEntities.size >= 3 && answerEntities.size >= 2) {
      const hasSharedEntity = [...answerEntities].some((token) => evidenceEntities.has(token));
      if (!hasSharedEntity) {
        return { ok: false, reason: 'missing-shared-entities' };
      }
    }

    const answerHasCjk = hasCjk(answer);
    const evidenceHasCjk = hasCjk(evidenceText);
    const isChineseSummaryOverNonCjkTranscript = answerHasCjk && !evidenceHasCjk;
    if (!isChineseSummaryOverNonCjkTranscript) {
      const scriptMismatch = answerHasCjk !== evidenceHasCjk;
      const ratio = noveltyRatio(answer, evidence);
      const threshold = scriptMismatch ? 0.92 : 0.85;
      if (ratio > threshold) {
        return { ok: false, reason: 'unsupported-novel-terms' };
      }
    }
    return { ok: true };
  }

  const citations = extractCitations(answer);
  if (citations.length === 0) {
    return { ok: false, reason: 'missing-citations' };
  }

  const ratio = noveltyRatio(answer, evidence);
  const threshold = 0.55;
  if (ratio > threshold) {
    return { ok: false, reason: 'unsupported-novel-terms' };
  }
  return { ok: true };
}
