import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { authRoutes } from '../../apps/api/src/routes/auth';
import { sessionRoutes } from '../../apps/api/src/routes/sessions';
import { requireAuth } from '../../apps/api/src/middleware/auth';
import { prisma } from '../../apps/api/src/services/prisma';

describe('Phase 2: Session Routes', () => {
  let testEmail: string;
  let testPassword: string;
  let accessToken: string;
  let userId: string;

  // Helper function to create a session
  async function createTestSession(name = 'Test Session'): Promise<string> {
    const app = new Hono();
    app.use('*', requireAuth);
    app.route('/api/sessions', sessionRoutes);

    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name }),
    });

    const data: any = await res.json();
    return data.id;
  }

  beforeAll(async () => {
    // Create test user
    testEmail = `test-sessions-${Date.now()}@example.com`;
    testPassword = 'TestPassword123!';

    const app = new Hono();
    app.route('/api/auth', authRoutes);

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    const data = await res.json();
    accessToken = data.accessToken;
    userId = data.user.id;
  });

  afterAll(async () => {
    // Cleanup
    try {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    } catch (err) {
      // Ignore errors
    }
  });

  describe('POST /api/sessions', () => {
    it('should create a new session', async () => {
      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: 'Test Session',
        }),
      });

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.id).toBeDefined();
      expect(data.name).toBe('Test Session');
      expect(data.status).toBe('active');
    });

    it('should reject without auth token', async () => {
      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test Session',
        }),
      });

      expect(res.status).toBe(401);
    });

    it('should use default title if not provided', async () => {
      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.name).toContain('New Session');
    });
  });

  describe('GET /api/sessions', () => {
    it('should list user sessions', async () => {
      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request('/api/sessions', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.sessions).toBeDefined();
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.sessions.length).toBeGreaterThan(0);
    });

    it('should filter by status', async () => {
      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request('/api/sessions?status=active', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.sessions).toBeDefined();
      expect(Array.isArray(data.sessions)).toBe(true);
      data.sessions.forEach((session: any) => {
        expect(session.status).toBe('active');
      });
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('should get session by id', async () => {
      // Create a session for this test
      const sessionId = await createTestSession('Get Test Session');

      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request(`/api/sessions/${sessionId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.id).toBe(sessionId);
      expect(data.userId).toBe(userId);
      expect(data.messages).toBeDefined();
      expect(Array.isArray(data.messages)).toBe(true);
    });

    it('should reject access to other user session', async () => {
      // Create a session for the first user
      const firstUserSessionId = await createTestSession('First User Session');

      // Create another user
      const app = new Hono();
      app.route('/api/auth', authRoutes);

      const otherUserRes = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `other-${Date.now()}@example.com`,
          password: testPassword,
        }),
      });

      const otherUserData = await otherUserRes.json();
      const otherAccessToken = otherUserData.accessToken;

      // Try to access first user's session with second user's token
      const app2 = new Hono();
      app2.use('*', requireAuth);
      app2.route('/api/sessions', sessionRoutes);

      const res = await app2.request(`/api/sessions/${firstUserSessionId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${otherAccessToken}`,
        },
      });

      expect(res.status).toBe(404);

      // Cleanup
      await prisma.user.delete({ where: { id: otherUserData.user.id } });
    });

    it('should return 404 for non-existent session', async () => {
      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request('/api/sessions/non-existent-id', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/sessions/:id', () => {
    it('should update session title', async () => {
      // Create a session for this test
      const sessionId = await createTestSession('Original Title');

      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: 'Updated Title',
        }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.name).toBe('Updated Title');
    });

    it('should update session status', async () => {
      // Create a session for this test
      const sessionId = await createTestSession('Status Test Session');

      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          status: 'archived',
        }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('archived');
    });
  });

  describe('DELETE /api/sessions/:id', () => {
    it('should delete session', async () => {
      // Create a session for this test
      const sessionId = await createTestSession('Delete Test Session');

      const app = new Hono();
      app.use('*', requireAuth);
      app.route('/api/sessions', sessionRoutes);

      const res = await app.request(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.message).toBeDefined();

      // Verify it's deleted
      const getRes = await app.request(`/api/sessions/${sessionId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(getRes.status).toBe(404);
    });
  });
});
