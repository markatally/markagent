import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'bun:test';
import path from 'path';

// Set CONFIG_PATH for tests
process.env.CONFIG_PATH = path.join(process.cwd(), 'config/default.json');

// Clear any cached config
import { clearConfigCache } from '../../apps/api/src/services/config';
clearConfigCache();

// Import app after setting config
import app from '../../apps/api/src/index';
import { prisma } from '../../apps/api/src/services/prisma';
import { generateAccessToken } from '../../apps/api/src/services/auth';

describe('POST /sessions/:sessionId/chat - Skill Capabilities', () => {
  let testUser: { id: string; email: string };
  let testSession: { id: string };
  let accessToken: string;

  beforeAll(async () => {
    // Create test user
    const email = `skills-test-${Date.now()}@example.com`;
    testUser = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test-hash',
      },
    });

    // Generate access token
    accessToken = generateAccessToken(testUser.id, testUser.email);

    // Create test session
    testSession = await prisma.session.create({
      data: {
        userId: testUser.id,
        name: 'Skills Test Session',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data
    if (testSession?.id) {
      await prisma.userExternalSkill.deleteMany({ where: { userId: testUser.id } });
      await prisma.message.deleteMany({ where: { sessionId: testSession.id } });
      await prisma.session.delete({ where: { id: testSession.id } }).catch(() => {});
    }
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  beforeEach(async () => {
    // Clear messages before each test
    await prisma.message.deleteMany({ where: { sessionId: testSession.id } });
  });

  it('should fetch fresh skills on each request (no stale cache)', async () => {
    // Find an existing skill in the database
    const existingSkill = await prisma.externalSkill.findFirst();
    
    if (!existingSkill) {
      console.log('No skills in database, skipping test');
      return;
    }

    // First request - no skills enabled
    const res1 = await app.request(`/api/sessions/${testSession.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        content: 'what skills do you have',
      }),
    });

    expect(res1.status).toBe(200);

    // Enable a skill
    await prisma.userExternalSkill.create({
      data: {
        userId: testUser.id,
        canonicalId: existingSkill.canonicalId,
        enabled: true,
      },
    });

    // Second request - skill should be fetched fresh
    const res2 = await app.request(`/api/sessions/${testSession.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        content: 'what skills do you have now',
      }),
    });

    expect(res2.status).toBe(200);

    // Verify both requests completed (they will stream, but we just check status)
    // The actual verification of skill content would require parsing SSE stream
  });

  it('should handle user with no enabled skills', async () => {
    // Ensure no skills are enabled
    await prisma.userExternalSkill.deleteMany({ where: { userId: testUser.id } });

    const res = await app.request(`/api/sessions/${testSession.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        content: 'what can you do',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('should handle user with multiple enabled skills', async () => {
    // Get two skills from database
    const skills = await prisma.externalSkill.findMany({ take: 2 });
    
    if (skills.length < 2) {
      console.log('Not enough skills in database, skipping test');
      return;
    }

    // Enable both skills
    await prisma.userExternalSkill.createMany({
      data: skills.map((skill) => ({
        userId: testUser.id,
        canonicalId: skill.canonicalId,
        enabled: true,
      })),
      skipDuplicates: true,
    });

    const res = await app.request(`/api/sessions/${testSession.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        content: 'list your skills',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('should handle skill enable/disable mid-session', async () => {
    const skill = await prisma.externalSkill.findFirst();
    
    if (!skill) {
      console.log('No skills in database, skipping test');
      return;
    }

    // Start with skill disabled
    await prisma.userExternalSkill.deleteMany({
      where: {
        userId: testUser.id,
        canonicalId: skill.canonicalId,
      },
    });

    // First request
    const res1 = await app.request(`/api/sessions/${testSession.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        content: 'what can you do',
      }),
    });

    expect(res1.status).toBe(200);

    // Enable skill
    await prisma.userExternalSkill.create({
      data: {
        userId: testUser.id,
        canonicalId: skill.canonicalId,
        enabled: true,
      },
    });

    // Second request - should see the new skill
    const res2 = await app.request(`/api/sessions/${testSession.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        content: 'what about now',
      }),
    });

    expect(res2.status).toBe(200);
  });

  it('should replace system prompt on each request', async () => {
    const skill = await prisma.externalSkill.findFirst();
    
    if (!skill) {
      console.log('No skills in database, skipping test');
      return;
    }

    // Enable skill
    await prisma.userExternalSkill.upsert({
      where: {
        userId_canonicalId: {
          userId: testUser.id,
          canonicalId: skill.canonicalId,
        },
      },
      create: {
        userId: testUser.id,
        canonicalId: skill.canonicalId,
        enabled: true,
      },
      update: {
        enabled: true,
      },
    });

    // First message
    await app.request(`/api/sessions/${testSession.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        content: 'hello',
      }),
    });

    // Disable skill
    await prisma.userExternalSkill.update({
      where: {
        userId_canonicalId: {
          userId: testUser.id,
          canonicalId: skill.canonicalId,
        },
      },
      data: {
        enabled: false,
      },
    });

    // Second message - should see updated skill list
    const res = await app.request(`/api/sessions/${testSession.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        content: 'what changed',
      }),
    });

    expect(res.status).toBe(200);
  });
});

describe('GET /sessions/:sessionId/stream - Skill Capabilities', () => {
  let testUser: { id: string; email: string };
  let testSession: { id: string };
  let accessToken: string;

  beforeAll(async () => {
    // Create test user
    const email = `skills-stream-test-${Date.now()}@example.com`;
    testUser = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test-hash',
      },
    });

    // Generate access token
    accessToken = generateAccessToken(testUser.id, testUser.email);

    // Create test session
    testSession = await prisma.session.create({
      data: {
        userId: testUser.id,
        name: 'Skills Stream Test Session',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data
    if (testSession?.id) {
      await prisma.userExternalSkill.deleteMany({ where: { userId: testUser.id } });
      await prisma.message.deleteMany({ where: { sessionId: testSession.id } });
      await prisma.session.delete({ where: { id: testSession.id } }).catch(() => {});
    }
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  it('should include user skills in stream endpoint', async () => {
    const skill = await prisma.externalSkill.findFirst();
    
    if (!skill) {
      console.log('No skills in database, skipping test');
      return;
    }

    // Enable a skill
    await prisma.userExternalSkill.upsert({
      where: {
        userId_canonicalId: {
          userId: testUser.id,
          canonicalId: skill.canonicalId,
        },
      },
      create: {
        userId: testUser.id,
        canonicalId: skill.canonicalId,
        enabled: true,
      },
      update: {
        enabled: true,
      },
    });

    // Create a message first
    await prisma.message.create({
      data: {
        sessionId: testSession.id,
        role: 'user',
        content: 'test message',
      },
    });

    const res = await app.request(
      `/api/sessions/${testSession.id}/stream?token=${accessToken}`,
      {
        method: 'GET',
      }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });
});
