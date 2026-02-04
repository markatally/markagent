import type { UnifiedSkill } from './types';

export interface DeduplicationCandidate {
  canonical: UnifiedSkill;
  merged: UnifiedSkill[];
  similarityScore: number;
}

export interface DeduplicationResult {
  canonicalSkills: UnifiedSkill[];
  candidates: DeduplicationCandidate[];
}

export function deduplicateSkills(
  skills: UnifiedSkill[],
  threshold = 0.82
): DeduplicationResult {
  const remaining = [...skills];
  const canonicalSkills: UnifiedSkill[] = [];
  const candidates: DeduplicationCandidate[] = [];

  while (remaining.length > 0) {
    const base = remaining.shift();
    if (!base) break;

    const merged: UnifiedSkill[] = [];
    let bestScore = 0;

    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      const other = remaining[i];
      const score = similarityScore(base, other);
      if (score >= threshold) {
        merged.push(other);
        remaining.splice(i, 1);
        bestScore = Math.max(bestScore, score);
      }
    }

    canonicalSkills.push(base);
    if (merged.length > 0) {
      candidates.push({
        canonical: base,
        merged,
        similarityScore: bestScore,
      });
    }
  }

  return { canonicalSkills, candidates };
}

export function similarityScore(a: UnifiedSkill, b: UnifiedSkill): number {
  const textA = `${a.name} ${a.description}`;
  const textB = `${b.name} ${b.description}`;
  const textScore = jaccard(tokens(textA), tokens(textB));

  const schemaA = schemaKeys(a.inputSchema, a.outputSchema);
  const schemaB = schemaKeys(b.inputSchema, b.outputSchema);
  const schemaScore = jaccard(schemaA, schemaB);

  return round(0.7 * textScore + 0.3 * schemaScore);
}

function tokens(text: string): Set<string> {
  const parts = text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
  return new Set(parts);
}

function schemaKeys(...schemas: Array<unknown | undefined>): Set<string> {
  const keys: string[] = [];
  for (const schema of schemas) {
    collectSchemaKeys(schema, keys);
  }
  return new Set(keys);
}

function collectSchemaKeys(schema: unknown, keys: string[]): void {
  if (!schema || typeof schema !== 'object') return;
  const record = schema as Record<string, unknown>;

  if (record.properties && typeof record.properties === 'object') {
    Object.keys(record.properties as Record<string, unknown>).forEach((key) => {
      keys.push(key.toLowerCase());
      collectSchemaKeys((record.properties as Record<string, unknown>)[key], keys);
    });
  }

  if (record.items) {
    collectSchemaKeys(record.items, keys);
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
