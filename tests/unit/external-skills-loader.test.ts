import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ExternalSkillLoader } from '../../apps/api/src/services/external-skills/loader';
import { prisma } from '../../apps/api/src/services/prisma';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

describe('External Skill Loader', () => {
  const loader = new ExternalSkillLoader();
  const testSkillId = 'test-loader-skill';
  const testDir = path.resolve(process.cwd(), 'apps', 'api', 'external-skills', 'canonical', testSkillId);
  const testFilePath = path.join(testDir, 'skill.json');

  beforeAll(async () => {
    // Create test directory and skill file
    await mkdir(testDir, { recursive: true });
    await writeFile(
      testFilePath,
      JSON.stringify({
        canonicalId: testSkillId,
        name: 'Test Loader Skill',
        description: 'A test skill for loader',
        version: '1.0.0',
        invocationPattern: 'prompt',
        dependencies: [],
        capabilityLevel: 'EXTERNAL',
        executionScope: 'AGENT',
        source: {
          repoUrl: 'https://github.com/test/repo',
          repoPath: 'test.md',
          syncedAt: new Date().toISOString(),
        },
        isProtected: false,
      })
    );

    // Create database record
    await prisma.externalSkill.create({
      data: {
        canonicalId: testSkillId,
        name: 'Test Loader Skill',
        description: 'A test skill for loader',
        version: '1.0.0',
        status: 'ACTIVE',
        invocationPattern: 'prompt',
        dependencies: [],
        filePath: path.relative(path.resolve(process.cwd(), 'apps', 'api', 'external-skills'), testFilePath),
        capabilityLevel: 'EXTERNAL',
        executionScope: 'AGENT',
        isProtected: false,
        mergedFrom: [],
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.externalSkill.deleteMany({
      where: { canonicalId: testSkillId },
    });
    await rm(testDir, { recursive: true, force: true });
  });

  it('loads skill by canonical ID', async () => {
    const skill = await loader.getSkill(testSkillId);

    expect(skill).toBeDefined();
    expect(skill?.canonicalId).toBe(testSkillId);
    expect(skill?.name).toBe('Test Loader Skill');
  });

  it('returns null for non-existent skill', async () => {
    const skill = await loader.getSkill('non-existent-skill');
    expect(skill).toBeNull();
  });

  it('lists all skills', async () => {
    const skills = await loader.listSkills();

    expect(skills).toBeDefined();
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
  });

  it('filters skills by category', async () => {
    const skills = await loader.listSkills({ category: 'test-category' });

    expect(Array.isArray(skills)).toBe(true);
    // Should be empty or contain only skills with that category
    skills.forEach((skill) => {
      if (skill.category) {
        expect(skill.category).toBe('test-category');
      }
    });
  });

  it('filters skills by capability level', async () => {
    const skills = await loader.listSkills({ capabilityLevel: 'EXTERNAL' });

    expect(Array.isArray(skills)).toBe(true);
    skills.forEach((skill) => {
      expect(skill.capabilityLevel).toBe('EXTERNAL');
    });
  });

  it('creates skill snapshot for session', async () => {
    const sessionId = 'test-session-' + Date.now();
    const snapshot = await loader.getSkillSnapshot(sessionId);

    expect(snapshot).toBeDefined();
    expect(snapshot.snapshotId).toBeDefined();
    expect(snapshot.createdAt).toBeInstanceOf(Date);
    expect(snapshot.skills).toBeDefined();
    expect(snapshot.skills.size).toBeGreaterThan(0);
  });

  it('reuses snapshot for same session', async () => {
    const sessionId = 'test-session-reuse-' + Date.now();
    const snapshot1 = await loader.getSkillSnapshot(sessionId);
    const snapshot2 = await loader.getSkillSnapshot(sessionId);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
  });

  it('snapshot has getSkill method', async () => {
    const sessionId = 'test-session-method-' + Date.now();
    const snapshot = await loader.getSkillSnapshot(sessionId);

    const skill = snapshot.getSkill(testSkillId);

    expect(skill).toBeDefined();
    expect(skill?.canonicalId).toBe(testSkillId);
    expect(skill?.snapshotId).toBe(snapshot.snapshotId);
  });

  it('snapshot has listSkills method', async () => {
    const sessionId = 'test-session-list-' + Date.now();
    const snapshot = await loader.getSkillSnapshot(sessionId);

    const skills = snapshot.listSkills();

    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
  });

  it('snapshot has isProtected method', async () => {
    const sessionId = 'test-session-protected-' + Date.now();
    const snapshot = await loader.getSkillSnapshot(sessionId);

    const isProtected = snapshot.isProtected('ppt-generate');

    expect(typeof isProtected).toBe('boolean');
  });
});
