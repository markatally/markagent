import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';

// Set CONFIG_PATH for tests
process.env.CONFIG_PATH = path.join(process.cwd(), 'config/default.json');

// Clear any cached config
import { clearConfigCache, getConfig, loadConfig } from '../../apps/api/src/services/config';
clearConfigCache();

// Import app after setting config
import app from '../../apps/api/src/index';
import { prisma } from '../../apps/api/src/services/prisma';
import { generateAccessToken } from '../../apps/api/src/services/auth';

describe('Chat Integration Tests', () => {
  let testUser: { id: string; email: string };
  let testSession: { id: string };
  let accessToken: string;

  beforeAll(async () => {
    // Create test user
    const email = `chat-test-${Date.now()}@example.com`;
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
        name: 'Chat Test Session',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data
    if (testSession?.id) {
      await prisma.message.deleteMany({ where: { sessionId: testSession.id } });
      await prisma.session.delete({ where: { id: testSession.id } }).catch(() => {});
    }
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('Config Loading', () => {
    it('should load config successfully', () => {
      clearConfigCache();
      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config.llm).toBeDefined();
      expect(config.session).toBeDefined();
      expect(config.tools).toBeDefined();
      expect(config.security).toBeDefined();
    });

    it('should have valid LLM config', () => {
      const config = getConfig();

      expect(config.llm.provider).toBeDefined();
      expect(config.llm.model).toBeDefined();
      expect(config.llm.maxTokens).toBeGreaterThan(0);
      expect(config.llm.timeout).toBeGreaterThan(0);
    });

    it('should have valid session config', () => {
      const config = getConfig();

      expect(config.session.maxHistoryMessages).toBeGreaterThan(0);
      expect(config.session.contextWindowTokens).toBeGreaterThan(0);
    });

    it('should have valid tools config', () => {
      const config = getConfig();

      expect(Array.isArray(config.tools.enabled)).toBe(true);
      expect(config.tools.enabled.length).toBeGreaterThan(0);
      expect(config.tools.enabled).toContain('bash_executor');
      expect(config.tools.enabled).toContain('file_reader');
    });
  });

  describe('POST /api/sessions/:sessionId/chat', () => {
    it('should require authentication', async () => {
      const res = await app.request(`/api/sessions/${testSession.id}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Hello' }),
      });

      expect(res.status).toBe(401);
    });

    it('should require content in body', async () => {
      const res = await app.request(`/api/sessions/${testSession.id}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    it('should return 404 for non-existent session', async () => {
      const res = await app.request('/api/sessions/non-existent-id/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ content: 'Hello' }),
      });

      expect(res.status).toBe(404);
    });

    it('should create user message and return SSE stream', async () => {
      const res = await app.request(`/api/sessions/${testSession.id}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ content: 'Hello, this is a test message' }),
      });

      // Should return 200 OK for SSE stream
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      // Verify message was created in database
      const messages = await prisma.message.findMany({
        where: { sessionId: testSession.id },
        orderBy: { createdAt: 'desc' },
      });

      expect(messages.length).toBeGreaterThan(0);
      const userMessage = messages.find(m => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.content).toBe('Hello, this is a test message');
    });

    it('should handle inactive session', async () => {
      // Create inactive session
      const inactiveSession = await prisma.session.create({
        data: {
          userId: testUser.id,
          name: 'Inactive Session',
          status: 'completed',
        },
      });

      const res = await app.request(`/api/sessions/${inactiveSession.id}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ content: 'Hello' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('SESSION_NOT_ACTIVE');

      // Cleanup
      await prisma.session.delete({ where: { id: inactiveSession.id } });
    });
  });

  describe('Skill Command Detection', () => {
    it('should detect /code command', async () => {
      const res = await app.request(`/api/sessions/${testSession.id}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ content: '/code Create a hello world function' }),
      });

      // Should process successfully (SSE stream)
      expect(res.status).toBe(200);

      // Verify the message was saved
      const messages = await prisma.message.findMany({
        where: {
          sessionId: testSession.id,
          content: '/code Create a hello world function',
        },
      });

      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/sessions/:sessionId/stream', () => {
    it('should require authentication', async () => {
      const res = await app.request(`/api/sessions/${testSession.id}/stream`, {
        method: 'GET',
      });

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent session', async () => {
      const res = await app.request('/api/sessions/non-existent-id/stream', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(404);
    });
  });
});

describe('Skills API Integration Tests', () => {
  let accessToken: string;
  let testUser: { id: string };

  beforeAll(async () => {
    // Create test user
    const email = `skills-test-${Date.now()}@example.com`;
    testUser = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test-hash',
      },
    });

    accessToken = generateAccessToken(testUser.id, email);
  });

  afterAll(async () => {
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  describe('GET /api/skills', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/skills', { method: 'GET' });
      expect(res.status).toBe(401);
    });

    it('should list all skills', async () => {
      const res = await app.request('/api/skills', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.skills).toBeDefined();
      expect(Array.isArray(body.skills)).toBe(true);
      expect(body.skills.length).toBeGreaterThanOrEqual(31); // 31 skills documented
      expect(body.total).toBeGreaterThanOrEqual(31);
      expect(body.categories).toBeDefined();
    });

    it('should include expected skills', async () => {
      const res = await app.request('/api/skills', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      const body = await res.json();
      const skillNames = body.skills.map((s: any) => s.name);

      expect(skillNames).toContain('code');
      expect(skillNames).toContain('debug');
      expect(skillNames).toContain('test');
      expect(skillNames).toContain('deploy');
    });
  });

  describe('GET /api/skills/:name', () => {
    it('should return skill details', async () => {
      const res = await app.request('/api/skills/code', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.name).toBe('code');
      expect(body.description).toBeDefined();
      expect(body.category).toBe('development');
      expect(body.systemPrompt).toBeDefined();
      expect(body.userPromptTemplate).toBeDefined();
      expect(body.requiredTools).toBeDefined();
      expect(Array.isArray(body.requiredTools)).toBe(true);
    });

    it('should return 404 for unknown skill', async () => {
      const res = await app.request('/api/skills/unknown-skill', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('SKILL_NOT_FOUND');
    });
  });
});

describe('Files API Integration Tests', () => {
  let accessToken: string;
  let testUser: { id: string };
  let testSession: { id: string };

  beforeAll(async () => {
    // Create test user
    const email = `files-test-${Date.now()}@example.com`;
    testUser = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test-hash',
      },
    });

    accessToken = generateAccessToken(testUser.id, email);

    // Create test session
    testSession = await prisma.session.create({
      data: {
        userId: testUser.id,
        name: 'Files Test Session',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    if (testSession?.id) {
      await prisma.file.deleteMany({ where: { sessionId: testSession.id } });
      await prisma.session.delete({ where: { id: testSession.id } }).catch(() => {});
    }
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  describe('GET /api/sessions/:sessionId/files', () => {
    it('should require authentication', async () => {
      const res = await app.request(`/api/sessions/${testSession.id}/files`, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    });

    it('should list files (empty initially)', async () => {
      const res = await app.request(`/api/sessions/${testSession.id}/files`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.files).toBeDefined();
      expect(Array.isArray(body.files)).toBe(true);
    });

    it('should return 404 for non-existent session', async () => {
      const res = await app.request('/api/sessions/non-existent/files', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/sessions/:sessionId/files', () => {
    it('should require authentication', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['test content'], { type: 'text/plain' }), 'test.txt');

      const res = await app.request(`/api/sessions/${testSession.id}/files`, {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(401);
    });

    it('should require file in form data', async () => {
      const res = await app.request(`/api/sessions/${testSession.id}/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'multipart/form-data',
        },
        body: new FormData(),
      });

      expect(res.status).toBe(400);
    });
  });
});
