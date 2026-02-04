import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ExternalSkillOrchestrator } from '../../apps/api/src/services/skills/external-executor';
import { ExecutionLogger } from '../../apps/api/src/services/skills/execution-logger';
import type { UnifiedSkill } from '../../apps/api/src/services/external-skills/types';

const baseSkill = (overrides: Partial<UnifiedSkill> = {}): UnifiedSkill => ({
  contractVersion: '1.0.0',
  canonicalId: 'chain-skill',
  version: '1.0.0',
  source: 'github',
  kind: 'function',
  name: 'Chain Skill',
  description: 'Chain test skill',
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

describe('Multi-Skill Chaining Behavior', () => {
  const orchestrator = new ExternalSkillOrchestrator();
  const originalLogExecution = ExecutionLogger.prototype.logExecution;

  beforeAll(() => {
    ExecutionLogger.prototype.logExecution = async () => 'execution-id';
  });

  it('propagates traceId across chained executions', async () => {
    const firstSkill = baseSkill({ canonicalId: 'skill-one', kind: 'function' });
    const firstResult = await orchestrator.execute(firstSkill, 'input', {}, { traceId: 'trace-1' });
    expect(firstResult.metadata?.traceId).toBe('trace-1');

    const secondSkill = baseSkill({ canonicalId: 'skill-two', kind: 'function' });
    const secondResult = await orchestrator.execute(secondSkill, 'input', {}, { traceId: 'trace-1' });
    expect(secondResult.metadata?.traceId).toBe('trace-1');
  });

  it('allows parentExecutionId to be set for chained calls', async () => {
    const skill = baseSkill({ canonicalId: 'skill-parent', kind: 'function' });
    const result = await orchestrator.execute(skill, 'input', {}, { parentExecutionId: 'parent-1' });

    expect(result.metadata?.traceId).toBeDefined();
  });

  afterAll(() => {
    ExecutionLogger.prototype.logExecution = originalLogExecution;
  });
});
