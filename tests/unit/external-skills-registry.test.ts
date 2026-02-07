import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { DynamicSkillRegistry } from '../../apps/api/src/services/skills/dynamic-registry';
import { prisma } from '../../apps/api/src/services/prisma';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

describe('DynamicSkillRegistry', () => {
  const registry = new DynamicSkillRegistry();
  const testSkillId = 'test-registry-skill';
  const externalSkillsRoot = process.cwd().endsWith(path.join('apps', 'api'))
    ? path.resolve(process.cwd(), 'external-skills')
    : path.resolve(process.cwd(), 'apps', 'api', 'external-skills');
  const testDir = path.join(externalSkillsRoot, 'canonical', testSkillId);
  const testFilePath = path.join(testDir, 'skill.json');

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(
      testFilePath,
      JSON.stringify({
        contractVersion: '1.0.0',
        canonicalId: testSkillId,
        kind: 'prompt',
        source: 'github',
        name: 'Test Registry Skill',
        description: 'A test skill for registry',
        version: '1.0.0',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
        lifecycle: { status: 'active' },
        invocationPattern: 'prompt',
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
        name: 'Test Registry Skill',
        description: 'A test skill for registry',
        version: '1.0.0',
        status: 'ACTIVE',
        invocationPattern: 'prompt',
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
    await prisma.externalSkill.deleteMany({
      where: { canonicalId: testSkillId },
    });
    await rm(testDir, { recursive: true, force: true });
  });

  it('enables and retrieves an external skill', async () => {
    const enabled = await registry.enableExternal(testSkillId);
    expect(enabled).toBe(true);

    const skill = await registry.getSkill(testSkillId);
    expect(skill).toBeDefined();
    expect(skill?.isExternal).toBe(true);
  });

  it('lists enabled external skills with metadata', async () => {
    const skills = await registry.listAll(true);
    const found = skills.find(
      (s) => s.isExternal && s.externalMetadata?.canonicalId === testSkillId
    );

    expect(found).toBeDefined();
    expect(found?.externalMetadata?.canonicalId).toBe(testSkillId);
  });
});
