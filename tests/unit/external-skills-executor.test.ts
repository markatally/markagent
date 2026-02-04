import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { ExternalSkillOrchestrator } from '../../apps/api/src/services/skills/external-executor';
import { ExecutionLogger } from '../../apps/api/src/services/skills/execution-logger';
import type { UnifiedSkill } from '../../apps/api/src/services/external-skills/types';

const baseSkill = (overrides: Partial<UnifiedSkill> = {}): UnifiedSkill => ({
  contractVersion: '1.0.0',
  canonicalId: 'test-skill',
  version: '1.0.0',
  source: 'github',
  kind: 'function',
  name: 'Test Skill',
  description: 'Test description',
  inputSchema: { type: 'object', properties: {} },
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
  ...overrides,
});

describe('ExternalSkillOrchestrator', () => {
  const orchestrator = new ExternalSkillOrchestrator();
  const originalLogExecution = ExecutionLogger.prototype.logExecution;

  beforeAll(() => {
    ExecutionLogger.prototype.logExecution = async () => 'test-execution-id';
  });

  afterAll(() => {
    ExecutionLogger.prototype.logExecution = originalLogExecution;
  });

  it('executes function runtime for function skills', async () => {
    const skill = baseSkill({ kind: 'function' });
    const result = await orchestrator.execute(skill, 'input');

    expect(result.success).toBe(true);
    expect(result.metadata?.invocationPattern).toBe('function');
  });

  it('rejects inactive skills', async () => {
    const skill = baseSkill({ status: 'DEPRECATED' as const });
    const result = await orchestrator.execute(skill, 'input');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not active');
  });

  it('returns error when runtime is missing', async () => {
    const skill = baseSkill({ kind: 'unknown' as any });
    const result = await orchestrator.execute(skill, 'input');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No runtime registered');
  });
});
