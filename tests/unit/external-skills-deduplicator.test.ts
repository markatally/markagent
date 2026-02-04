import { describe, it, expect } from 'bun:test';
import {
  deduplicateSkills,
  similarityScore,
} from '../../apps/api/src/services/external-skills/deduplicator';
import type { UnifiedSkill } from '../../apps/api/src/services/external-skills/types';

describe('Skill Deduplicator', () => {
  const mockSource = {
    repoUrl: 'https://github.com/test/repo',
    repoPath: 'skills/test.md',
    syncedAt: new Date(),
  };

  const createSkill = (id: string, name: string, description: string): UnifiedSkill => ({
    canonicalId: id,
    name,
    description,
    version: '1.0.0',
    invocationPattern: 'prompt',
    dependencies: [],
    capabilityLevel: 'EXTERNAL',
    executionScope: 'AGENT',
    source: mockSource,
    isProtected: false,
  });

  it('identifies duplicate skills with high similarity', () => {
    const skills = [
      createSkill('skill1', 'web search', 'Search the web for information'),
      createSkill('skill2', 'web-search', 'Search web for information'),
      createSkill('skill3', 'code generator', 'Generate code from description'),
    ];

    const result = deduplicateSkills(skills, 0.7);

    expect(result.canonicalSkills.length).toBeLessThan(skills.length);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('keeps skills with low similarity separate', () => {
    const skills = [
      createSkill('skill1', 'web search', 'Search the web'),
      createSkill('skill2', 'code generator', 'Generate code'),
      createSkill('skill3', 'file reader', 'Read files'),
    ];

    const result = deduplicateSkills(skills, 0.8);

    expect(result.canonicalSkills.length).toBe(3);
    expect(result.candidates.length).toBe(0);
  });

  it('calculates similarity score correctly', () => {
    const skill1 = createSkill('s1', 'web search', 'Search the internet for information');
    const skill2 = createSkill('s2', 'web-search', 'Search internet for information');

    const score = similarityScore(skill1, skill2);

    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('calculates low similarity for different skills', () => {
    const skill1 = createSkill('s1', 'web search', 'Search the internet');
    const skill2 = createSkill('s2', 'code generator', 'Generate Python code');

    const score = similarityScore(skill1, skill2);

    expect(score).toBeLessThanOrEqual(0.3);
  });

  it('handles schemas in similarity calculation', () => {
    const skill1: UnifiedSkill = {
      ...createSkill('s1', 'api call', 'Call an API'),
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string' },
        },
      },
    };

    const skill2: UnifiedSkill = {
      ...createSkill('s2', 'api-call', 'Make API call'),
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string' },
        },
      },
    };

    const score = similarityScore(skill1, skill2);

    // Schema similarity boosts the score, expect at least 0.6
    expect(score).toBeGreaterThan(0.6);
  });

  it('returns all skills as canonical when threshold is 1.0', () => {
    const skills = [
      createSkill('s1', 'web search', 'Search the web'),
      createSkill('s2', 'websearch', 'Search the internet'),
    ];

    const result = deduplicateSkills(skills, 1.0);

    expect(result.canonicalSkills.length).toBe(2);
    expect(result.candidates.length).toBe(0);
  });
});
