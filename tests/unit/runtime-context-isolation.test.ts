import { describe, it, expect } from 'bun:test';

describe('Runtime Context Isolation', () => {
  it('PromptRuntime has no imports from request handlers', async () => {
    const runtimeSource = await Bun.file(
      'apps/api/src/services/skills/runtimes/prompt-runtime.ts'
    ).text();

    expect(runtimeSource).not.toMatch(/from ['"]\.\.\/\.\.\/routes/);
    expect(runtimeSource).not.toMatch(/from ['"]\.\.\/\.\.\/\.\.\/routes/);
    expect(runtimeSource).not.toMatch(/import.*Context.*from ['"]hono/);
  });

  it('Runtime only accesses metadata through ExecutionContext parameter', async () => {
    const runtimeSource = await Bun.file(
      'apps/api/src/services/skills/runtimes/prompt-runtime.ts'
    ).text();

    expect(runtimeSource).not.toMatch(/global\.(session|user|request)/);
  });
});
