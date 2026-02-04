import { describe, it, expect } from 'bun:test';
import { PromptRuntime } from '../../apps/api/src/services/skills/runtimes/prompt-runtime';
import { createExecutionContext } from '@mark/shared';
import type { ExternalSkillContract } from '@mark/shared';

const baseSkill = (overrides: Partial<ExternalSkillContract> = {}): ExternalSkillContract => ({
  contractVersion: '1.0.0',
  canonicalId: 'prompt-skill',
  version: '1.0.0',
  source: 'github',
  kind: 'prompt',
  name: 'Prompt Skill',
  description: 'Prompt skill for fallback testing',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: { type: 'object', properties: {} },
  lifecycle: { status: 'active' },
  sourceInfo: {
    repoUrl: 'https://github.com/test/repo',
    repoPath: 'skill.md',
    syncedAt: new Date(),
  },
  ...overrides,
});

describe('Failure Fallback Behavior', () => {
  it('retries according to policy before succeeding', async () => {
    let callCount = 0;
    const llmClient = {
      chat: async () => {
        callCount += 1;
        if (callCount < 3) {
          throw new Error('rate limit');
        }
        return {
          content: '{"ok":true}',
          finishReason: 'stop',
        };
      },
    };

    const runtime = new PromptRuntime(llmClient as any);
    const context = createExecutionContext({
      traceId: 'trace-1',
      resolvedPolicy: { retryCount: 2, resolvedAt: new Date(), source: 'skill' },
      allowedTools: [],
    });

    const result = await runtime.run(baseSkill(), 'input', {}, context);
    expect(result.success).toBe(true);
    expect(callCount).toBe(3);
  });

  it('classifies timeout errors', async () => {
    const llmClient = {
      chat: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { content: '{"ok":true}', finishReason: 'stop' };
      },
    };

    const runtime = new PromptRuntime(llmClient as any);
    const context = createExecutionContext({
      traceId: 'trace-2',
      resolvedPolicy: { timeoutMs: 10, resolvedAt: new Date(), source: 'skill' },
      allowedTools: [],
    });

    const result = await runtime.run(baseSkill(), 'input', {}, context);
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('TIMEOUT');
  });
});
