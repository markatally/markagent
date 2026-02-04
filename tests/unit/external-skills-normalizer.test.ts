import { describe, it, expect } from 'bun:test';
import {
  normalizeSkillDescriptor,
  type RawSkillDescriptor,
} from '../../apps/api/src/services/external-skills/normalizer';

describe('Skill Normalizer', () => {
  const mockSource = {
    repoUrl: 'https://github.com/test/repo',
    repoPath: 'skills/test.md',
    syncedAt: new Date(),
  };

  it('normalizes markdown skill with frontmatter', () => {
    const descriptor: RawSkillDescriptor = {
      filePath: 'test.md',
      content: `---
name: test-skill
description: A test skill
---

# Test Skill

This is a test skill description.`,
      source: mockSource,
    };

    const result = normalizeSkillDescriptor(descriptor);

    expect(result.name).toBe('test-skill');
    expect(result.description).toBe('A test skill');
    expect(result.canonicalId).toBe('test-skill');
    expect(result.invocationPattern).toBe('prompt');
    expect(result.capabilityLevel).toBe('EXTERNAL');
    expect(result.executionScope).toBe('AGENT');
  });

  it('normalizes JSON skill', () => {
    const descriptor: RawSkillDescriptor = {
      filePath: 'test.json',
      content: JSON.stringify({
        name: 'json-skill',
        description: 'A JSON test skill',
        version: '1.0.0',
        inputSchema: { type: 'object', properties: {} },
        dependencies: ['tool1', 'tool2'],
      }),
      source: mockSource,
    };

    const result = normalizeSkillDescriptor(descriptor);

    expect(result.name).toBe('json-skill');
    expect(result.description).toBe('A JSON test skill');
    expect(result.version).toBe('1.0.0');
    expect(result.dependencies).toEqual(['tool1', 'tool2']);
    expect(result.inputSchema).toBeDefined();
  });

  it('normalizes TypeScript skill', () => {
    const descriptor: RawSkillDescriptor = {
      filePath: 'test.ts',
      content: `
export const skill = {
  name: "typescript-skill",
  description: "A TypeScript skill",
  version: "2.0.0",
};`,
      source: mockSource,
    };

    const result = normalizeSkillDescriptor(descriptor);

    expect(result.name).toBe('typescript-skill');
    expect(result.description).toBe('A TypeScript skill');
    expect(result.version).toBe('2.0.0');
  });

  it('handles malformed JSON gracefully', () => {
    const descriptor: RawSkillDescriptor = {
      filePath: 'bad.json',
      content: '{ invalid json',
      source: mockSource,
    };

    const result = normalizeSkillDescriptor(descriptor);

    expect(result.name).toBe('external-skill');
    expect(result.description).toBe('External skill');
  });

  it('derives canonical ID from name', () => {
    const descriptor: RawSkillDescriptor = {
      filePath: 'test.json',
      content: JSON.stringify({
        name: 'My Cool Skill!',
      }),
      source: mockSource,
    };

    const result = normalizeSkillDescriptor(descriptor);

    expect(result.canonicalId).toBe('my-cool-skill');
  });
});
