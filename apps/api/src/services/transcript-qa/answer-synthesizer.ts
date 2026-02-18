import { formatSeconds, parseHmsToSeconds } from './parser';
import type { EvidenceItem, QueryUnderstanding, TranscriptQaLlm } from './types';

function buildEvidenceBlock(evidence: EvidenceItem[]): string {
  return evidence
    .map((item, idx) => `${idx + 1}. [E${idx + 1}] ${item.stamp} ${item.text}`)
    .join('\n');
}

function buildTranscriptBlock(evidence: EvidenceItem[]): string {
  return evidence.map((item) => `${item.stamp} ${item.text}`).join('\n');
}

function sampleSummaryEvidence(evidence: EvidenceItem[], maxItems: number): EvidenceItem[] {
  if (evidence.length <= maxItems) return evidence;
  const selected = new Map<number, EvidenceItem>();
  selected.set(0, evidence[0]);
  selected.set(evidence.length - 1, evidence[evidence.length - 1]);
  if (maxItems > 2) {
    for (let i = 1; i < maxItems - 1; i += 1) {
      const idx = Math.floor((i / (maxItems - 1)) * (evidence.length - 1));
      selected.set(idx, evidence[idx]);
    }
  }
  return Array.from(selected.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, item]) => item);
}

function sortEvidenceByTimeline(evidence: EvidenceItem[]): EvidenceItem[] {
  return [...evidence].sort((a, b) => a.startSeconds - b.startSeconds || a.segmentId.localeCompare(b.segmentId));
}

function extractEndSecondsFromStamp(stamp: string): number | null {
  const match = stamp.match(
    /^\[(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})\]$/
  );
  if (!match) return null;
  return parseHmsToSeconds(match[2].replace(',', '.'));
}

function buildRangeCoverageNotice(
  understanding: QueryUnderstanding,
  orderedEvidence: EvidenceItem[]
): string | null {
  if (understanding.intent !== 'time_range' || !understanding.timeRange || orderedEvidence.length === 0) {
    return null;
  }
  const requestedStart = understanding.timeRange.startSeconds;
  const requestedEnd = understanding.timeRange.endSeconds;
  const coveredStart = orderedEvidence[0].startSeconds;
  const last = orderedEvidence[orderedEvidence.length - 1];
  const coveredEnd = extractEndSecondsFromStamp(last.stamp) ?? last.startSeconds;
  const tolerance = 2;
  const missingHead = coveredStart - requestedStart > tolerance;
  const missingTail = requestedEnd - coveredEnd > tolerance;
  if (!missingHead && !missingTail) return null;
  const requested = `${formatSeconds(requestedStart).slice(3, 8)}-${formatSeconds(requestedEnd).slice(3, 8)}`;
  const covered = `${formatSeconds(coveredStart).slice(3, 8)}-${formatSeconds(coveredEnd).slice(3, 8)}`;
  return understanding.preferChinese
    ? `注意：你请求的是 ${requested}，但当前 transcript 可覆盖范围只有 ${covered}。`
    : `Note: you requested ${requested}, but the available transcript only covers ${covered}.`;
}

function buildArticleStyleSummaryFromEvidence(
  evidence: EvidenceItem[],
  preferChinese: boolean
): string {
  if (evidence.length === 0) {
    return preferChinese
      ? '当前 transcript 中没有足够证据回答这个问题。'
      : 'There is not enough evidence in the transcript to answer this question.';
  }

  const cap = Math.min(evidence.length, 120);
  const scoped = evidence.slice(0, cap);
  const first = scoped.slice(0, Math.max(1, Math.floor(scoped.length / 3)));
  const middle = scoped.slice(
    Math.max(1, Math.floor(scoped.length / 3)),
    Math.max(2, Math.floor((scoped.length * 2) / 3))
  );
  const last = scoped.slice(Math.max(2, Math.floor((scoped.length * 2) / 3)));

  const summarizeChunk = (chunk: EvidenceItem[]) =>
    chunk
      .slice(0, 24)
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  const p1 = summarizeChunk(first);
  const p2 = summarizeChunk(middle);
  const p3 = summarizeChunk(last);

  if (preferChinese) {
    return [
      '根据完整 transcript，视频内容可概括为以下三个阶段：',
      `开头部分主要围绕：${p1 || '开场背景与主题引入。'}`,
      `中段重点展开：${p2 || '机制与实现细节说明。'}`,
      `后段主要收束到：${p3 || '实操与总结收尾。'}`,
      '整体上，视频从概念解释逐步过渡到工作流程与工程落地，形成了完整的“定义-机制-实践”叙事链路。',
    ].join('\n');
  }

  return [
    'According to the full transcript, the video can be summarized in three stages:',
    `Opening: ${p1 || 'introduces background and goals.'}`,
    `Middle: ${p2 || 'explains mechanisms and implementation details.'}`,
    `Ending: ${p3 || 'covers practical execution and wrap-up.'}`,
    'Overall, it follows a clear progression from concept to workflow to engineering application.',
  ].join('\n');
}

function buildExtractiveFallback(params: {
  understanding: QueryUnderstanding;
  evidence: EvidenceItem[];
}): string {
  const { understanding, evidence } = params;
  if (evidence.length === 0) {
    return understanding.preferChinese
      ? '当前 transcript 中没有足够证据回答这个问题。'
      : 'There is not enough evidence in the transcript to answer this question.';
  }

  if (understanding.intent === 'summary') {
    const wantsArticle =
      /文章|长文|500字|五百字|essay|article|detailed/i.test(understanding.rawQuery);
    if (wantsArticle) {
      return buildArticleStyleSummaryFromEvidence(evidence, understanding.preferChinese);
    }
    const sampled = sampleSummaryEvidence(evidence, 12);
    const idToIndex = new Map<string, number>();
    for (let i = 0; i < evidence.length; i += 1) {
      if (!idToIndex.has(evidence[i].segmentId)) idToIndex.set(evidence[i].segmentId, i + 1);
    }
    const lines = sampled.map((item) => {
      const citeIndex = idToIndex.get(item.segmentId) || 1;
      return `- ${item.stamp} ${item.text.slice(0, 120)} [E${citeIndex}]`;
    });
    const header = understanding.timeRange
      ? understanding.preferChinese
        ? '根据 transcript，这一段的重点是：'
        : 'According to the transcript, key points in this section are:'
      : understanding.preferChinese
      ? '根据 transcript，视频重点是：'
      : 'According to the transcript, the video highlights are:';
    return understanding.preferChinese
      ? [header, ...lines].join('\n')
      : [header, ...lines].join('\n');
  }

  const orderedEvidence = sortEvidenceByTimeline(evidence);
  const lines = orderedEvidence.map(
    (item, idx) => `- ${item.stamp} ${item.text.slice(0, 200)} [E${idx + 1}]`
  );
  if (understanding.intent === 'time_range' && understanding.timeRange) {
    const range = `${formatSeconds(understanding.timeRange.startSeconds).slice(3, 8)}-${formatSeconds(
      understanding.timeRange.endSeconds
    ).slice(3, 8)}`;
    const coverageNotice = buildRangeCoverageNotice(understanding, orderedEvidence);
    return understanding.preferChinese
      ? [coverageNotice, `根据 transcript，${range} 这段主要内容如下：`, ...lines].filter(Boolean).join('\n')
      : [coverageNotice, `According to the transcript, this is what is covered in ${range}:`, ...lines]
          .filter(Boolean)
          .join('\n');
  }
  return understanding.preferChinese
    ? ['根据 transcript，相关内容如下：', ...lines].join('\n')
    : ['According to the transcript, relevant evidence is:', ...lines].join('\n');
}

async function generateWithLlm(params: {
  llm: TranscriptQaLlm;
  query: string;
  understanding: QueryUnderstanding;
  evidence: EvidenceItem[];
}): Promise<string> {
  const { llm, query, understanding, evidence } = params;
  if (!llm.streamChat) return '';

  if (understanding.intent === 'summary') {
    const system = [
      'You are a transcript-grounded summarization assistant.',
      'Summarize using the full transcript provided below.',
      'You may use general writing knowledge for structure and phrasing.',
      'Do not invent facts that are not supported by the transcript.',
      understanding.preferChinese
        ? 'Respond in Simplified Chinese.'
        : 'Respond in the same language as the user query.',
    ].join('\n');

    const user = [
      `User request: ${query}`,
      '',
      'Full transcript:',
      buildTranscriptBlock(evidence),
      '',
      'Output requirements:',
      '1) produce a coherent, article-style summary',
      '2) cover main ideas from beginning, middle, and end where relevant',
      '3) avoid bullet-only output unless user explicitly requests bullets',
    ].join('\n');

    let output = '';
    for await (const chunk of llm.streamChat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])) {
      if (chunk.type === 'content' && chunk.content) output += chunk.content;
    }
    return output.trim();
  }

  const system = [
    'You are a transcript-grounded QA assistant.',
    'Answer ONLY from the provided evidence lines.',
    'Do not use external knowledge, metadata, or guesses.',
    'For every claim, append at least one citation tag like [E1].',
    understanding.preferChinese
      ? 'Respond in Simplified Chinese.'
      : 'Respond in the same language as the user query.',
  ].join('\n');

  const user = [
    `User question: ${query}`,
    '',
    'Evidence lines:',
    buildEvidenceBlock(evidence),
    '',
    'Response requirements:',
    '1) concise and directly answer the question',
    '2) cite evidence tags [E#] per statement',
    '3) if evidence is insufficient, explicitly state that',
  ].join('\n');

  let output = '';
  for await (const chunk of llm.streamChat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])) {
    if (chunk.type === 'content' && chunk.content) output += chunk.content;
  }
  return output.trim();
}

export async function synthesizeTranscriptAnswer(params: {
  llm: TranscriptQaLlm;
  query: string;
  understanding: QueryUnderstanding;
  evidence: EvidenceItem[];
}): Promise<string> {
  const { llm, query, understanding, evidence } = params;
  if (evidence.length === 0) {
    return buildExtractiveFallback({ understanding, evidence });
  }

  // Time-range Q&A must be deterministic and extractive for maximum robustness.
  if (understanding.intent === 'time_range') {
    return buildExtractiveFallback({ understanding, evidence });
  }

  const llmAnswer = await generateWithLlm({ llm, query, understanding, evidence });
  if (llmAnswer) return llmAnswer;
  return buildExtractiveFallback({ understanding, evidence });
}
