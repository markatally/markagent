import { describe, expect, it } from 'bun:test';
import { ExternalSkillAdapter } from '../../apps/api/src/services/skills/external-bridge';
import type { UnifiedSkill } from '../../apps/api/src/services/external-skills/types';

const baseSkill = (): UnifiedSkill => ({
  contractVersion: '1.0.0',
  canonicalId: 'test-skill',
  version: '1.0.0',
  source: 'github',
  kind: 'prompt',
  name: 'Test Skill',
  description: 'Test description',
  category: 'development',
  inputSchema: { type: 'object', properties: { language: { type: 'string' } } },
  outputSchema: { type: 'object', properties: {} },
  lifecycle: { status: 'active' },
  sourceInfo: {
    repoUrl: 'https://github.com/test/repo',
    repoPath: 'skill.md',
    syncedAt: new Date(),
  },
  dependencies: [],
  capabilityLevel: 'EXTERNAL',
  executionScope: 'AGENT',
  isProtected: false,
});

describe('ExternalSkillAdapter', () => {
  it('converts UnifiedSkill to product Skill', () => {
    const adapter = new ExternalSkillAdapter();
    const skill = baseSkill();

    const productSkill = adapter.toProductSkill(skill);

    expect(productSkill.name).toBe('Test Skill');
    expect(productSkill.description).toBe('Test description');
    expect(productSkill.category).toBe('development');
    expect(productSkill.requiredTools.length).toBeGreaterThan(0);
  });

  it('rejects inactive skills', () => {
    const adapter = new ExternalSkillAdapter();
    const skill = { ...baseSkill(), status: 'DEPRECATED' as const };

    expect(adapter.canExecute(skill)).toBe(false);
  });

  it('infers tools when requiredTools are missing', () => {
    const adapter = new ExternalSkillAdapter();
    const skill = { ...baseSkill(), requiredTools: undefined };

    const productSkill = adapter.toProductSkill(skill);
    expect(productSkill.requiredTools.length).toBeGreaterThan(0);
  });

  it('maps input schema to parameters', () => {
    const adapter = new ExternalSkillAdapter();
    const skill = baseSkill();

    const productSkill = adapter.toProductSkill(skill);
    expect(productSkill.parameters?.length).toBe(1);
    expect(productSkill.parameters?.[0]?.name).toBe('language');
  });
});
