import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import externalSkillsRoutes from '../../apps/api/src/routes/external-skills';
import { prisma } from '../../apps/api/src/services/prisma';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

describe('External Skills Routes', () => {
  const app = new Hono();
  app.route('/api/external-skills', externalSkillsRoutes);

  const testSkillId = 'test-external-skill-route';
  const externalSkillsRoot = process.cwd().endsWith(path.join('apps', 'api'))
    ? path.resolve(process.cwd(), 'external-skills')
    : path.resolve(process.cwd(), 'apps', 'api', 'external-skills');
  const testDir = path.join(externalSkillsRoot, 'canonical', testSkillId);
  const testFilePath = path.join(testDir, 'skill.json');

  beforeAll(async () => {
    await prisma.externalSkillExecution.deleteMany({
      where: { canonicalId: testSkillId },
    });
    await prisma.externalSkill.deleteMany({
      where: { canonicalId: testSkillId },
    });

    await mkdir(testDir, { recursive: true });
    await writeFile(
      testFilePath,
      JSON.stringify({
        contractVersion: '1.0.0',
        canonicalId: testSkillId,
        kind: 'function',
        source: 'github',
        name: 'Route Test Skill',
        description: 'Route test skill',
        version: '1.0.0',
        status: 'ACTIVE',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
        lifecycle: { status: 'active' },
        invocationPattern: 'function',
        dependencies: [],
        capabilityLevel: 'EXTERNAL',
        executionScope: 'AGENT',
        sourceInfo: {
          repoUrl: 'https://github.com/test/repo',
          repoPath: 'test.md',
          syncedAt: new Date().toISOString(),
        },
        isProtected: false,
      })
    );

    await prisma.externalSkill.create({
      data: {
        canonicalId: testSkillId,
        name: 'Route Test Skill',
        description: 'Route test skill',
        version: '1.0.0',
        status: 'ACTIVE',
        invocationPattern: 'function',
        dependencies: [],
        filePath: path.relative(externalSkillsRoot, testFilePath),
        capabilityLevel: 'EXTERNAL',
        executionScope: 'AGENT',
        isProtected: false,
        mergedFrom: [],
      },
    });
  });

  afterAll(async () => {
    await prisma.externalSkillExecution.deleteMany({
      where: { canonicalId: testSkillId },
    });
    await prisma.externalSkill.deleteMany({
      where: { canonicalId: testSkillId },
    });
    await rm(testDir, { recursive: true, force: true });
  });

  it('lists external skills', async () => {
    const res = await app.request('/api/external-skills');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data.skills)).toBe(true);
    const found = data.skills.find((skill: any) => skill.canonicalId === testSkillId);
    expect(found).toBeDefined();
  });

  it('gets external skill details', async () => {
    const res = await app.request(`/api/external-skills/${testSkillId}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.skill.canonicalId).toBe(testSkillId);
  });

  it('enables and executes an external skill', async () => {
    const enableRes = await app.request(`/api/external-skills/${testSkillId}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enableRes.status).toBe(200);

    const execRes = await app.request(`/api/external-skills/${testSkillId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Run function',
        parameters: { test: true },
      }),
    });
    expect(execRes.status).toBe(200);

    const data = await execRes.json();
    expect(data.success).toBe(true);
  });
});
