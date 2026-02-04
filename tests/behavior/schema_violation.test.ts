import { describe, it, expect } from 'bun:test';
import { PromptRuntime } from '../../apps/api/src/services/skills/runtimes/prompt-runtime';
import { createExecutionContext } from '@mark/shared';
import type { ExternalSkillContract } from '@mark/shared';

const baseSkill = (overrides: Partial<ExternalSkillContract> = {}): ExternalSkillContract => ({
  contractVersion: '1.0.0',
  canonicalId: 'schema-skill',
  version: '1.0.0',
  source: 'github',
  kind: 'prompt',
  name: 'Schema Skill',
  description: 'Schema validation test skill',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
    },
    required: ['ok'],
  },
  lifecycle: { status: 'active' },
  sourceInfo: {
    repoUrl: 'https://github.com/test/repo',
    repoPath: 'skill.md',
    syncedAt: new Date(),
  },
  ...overrides,
});

describe('Schema Violation Behavior', () => {
  it('returns validation error when output schema is violated', async () => {
    const llmClient = {
      chat: async () => ({
        content: '{"not_ok":true}',
        finishReason: 'stop',
      }),
    };

    const runtime = new PromptRuntime(llmClient as any);
    const context = createExecutionContext({
      traceId: 'trace-schema',
      resolvedPolicy: { resolvedAt: new Date(), source: 'skill' },
      allowedTools: [],
    });

    const result = await runtime.run(baseSkill(), 'input', {}, context);
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('VALIDATION');
  });
});
