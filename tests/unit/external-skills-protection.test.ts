import { describe, it, expect } from 'bun:test';
import { SkillProtectionEnforcer } from '../../apps/api/src/services/external-skills/protection';
import type { UnifiedSkill } from '../../apps/api/src/services/external-skills/types';

describe('Skill Protection Enforcer', () => {
  const enforcer = new SkillProtectionEnforcer();

  const mockSource = {
    repoUrl: 'https://github.com/test/repo',
    repoPath: 'skills/test.md',
    syncedAt: new Date(),
  };

  const createSkill = (id: string, name: string): UnifiedSkill => ({
    canonicalId: id,
    name,
    description: 'Test skill',
    version: '1.0.0',
    invocationPattern: 'prompt',
    dependencies: [],
    capabilityLevel: 'EXTERNAL',
    executionScope: 'AGENT',
    source: mockSource,
    isProtected: false,
  });

  it('detects protected IDs from config', async () => {
    const isProtected = await enforcer.isProtected('ppt-generate');
    expect(isProtected).toBe(true);
  });

  it('detects protected patterns (ppt)', async () => {
    const isProtected = await enforcer.isProtected('custom-id', 'PowerPoint Generator');
    expect(isProtected).toBe(true);
  });

  it('detects protected patterns (web search)', async () => {
    const isProtected = await enforcer.isProtected('custom-id', 'web search tool');
    expect(isProtected).toBe(true);
  });

  it('detects protected patterns (academic search)', async () => {
    const isProtected = await enforcer.isProtected('custom-id', 'arXiv paper search');
    expect(isProtected).toBe(true);
  });

  it('allows non-protected skills', async () => {
    const isProtected = await enforcer.isProtected('custom-skill', 'Custom Skill');
    expect(isProtected).toBe(false);
  });

  it('gets protection reason for protected skills', async () => {
    const reason = await enforcer.getProtectionReason('ppt-generate');
    expect(reason).toBeDefined();
    expect(reason).toContain('Protected');
  });

  it('returns undefined for non-protected skills', async () => {
    const reason = await enforcer.getProtectionReason('custom-skill', 'Custom Skill');
    expect(reason).toBeUndefined();
  });

  it('throws when trying to delete protected skill', async () => {
    await expect(enforcer.assertCanDelete('ppt-generate')).rejects.toThrow('Protected');
  });

  it('throws when trying to overwrite protected skill', async () => {
    await expect(enforcer.assertCanOverwrite('web-search')).rejects.toThrow('Protected');
  });

  it('allows delete for non-protected skills', async () => {
    await expect(enforcer.assertCanDelete('custom-skill')).resolves.toBeUndefined();
  });

  it('creates extended variant for protected skills', () => {
    const skill = createSkill('ppt-generate', 'PPT Generator');
    skill.version = '2.0.0';

    const extendedId = enforcer.createExtendedVariant('ppt-generate', skill);

    expect(extendedId).toContain('ppt-generate');
    expect(extendedId).toContain('extended');
    expect(extendedId).toContain('2-0-0');
  });

  it('sanitizes version in extended variant ID', () => {
    const skill = createSkill('test', 'Test');
    skill.version = '1.2.3-beta';

    const extendedId = enforcer.createExtendedVariant('test', skill);

    expect(extendedId).toMatch(/^test-extended-[\w-]+$/);
    expect(extendedId).not.toContain('..');
  });
});
