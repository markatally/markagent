import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { authRoutes } from '../../apps/api/src/routes/auth';
import { prisma } from '../../apps/api/src/services/prisma';

describe('Phase 2: Auth Routes', () => {
  let testEmail: string;
  let testPassword: string;
  let createdUserId: string;

  beforeAll(() => {
    testEmail = `test-${Date.now()}@example.com`;
    testPassword = 'TestPassword123!';
  });

  afterAll(async () => {
    // Cleanup: delete test user if created
    if (createdUserId) {
      try {
        await prisma.user.delete({ where: { id: createdUserId } });
      } catch (err) {
        // Ignore if already deleted
      }
    }
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
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

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe(testEmail);
      expect(data.user.id).toBeDefined();
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();

      // Store for cleanup
      createdUserId = data.user.id;
    });

    it('should reject duplicate email', async () => {
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

      expect(res.status).toBe(409);

      const data = await res.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('USER_EXISTS');
    });

    it('should reject invalid email', async () => {
      const app = new Hono();
      app.route('/api/auth', authRoutes);

      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invalid-email',
          password: testPassword,
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject short password', async () => {
      const app = new Hono();
      app.route('/api/auth', authRoutes);

      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `new-${Date.now()}@example.com`,
          password: '123',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with correct credentials', async () => {
      const app = new Hono();
      app.route('/api/auth', authRoutes);

      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe(testEmail);
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
    });

    it('should reject wrong password', async () => {
      const app = new Hono();
      app.route('/api/auth', authRoutes);

      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: 'WrongPassword123!',
        }),
      });

      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject non-existent user', async () => {
      const app = new Hono();
      app.route('/api/auth', authRoutes);

      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: testPassword,
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh tokens with valid refresh token', async () => {
      const app = new Hono();
      app.route('/api/auth', authRoutes);

      // First login to get refresh token
      const loginRes = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      });

      const loginData = await loginRes.json();
      const refreshToken = loginData.refreshToken;

      // Wait 1 second to ensure different iat timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Now refresh
      const refreshRes = await app.request('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      expect(refreshRes.status).toBe(200);

      const refreshData = await refreshRes.json();
      expect(refreshData.accessToken).toBeDefined();
      expect(refreshData.refreshToken).toBeDefined();
      expect(refreshData.accessToken).not.toBe(loginData.accessToken);
    });

    it('should reject invalid refresh token', async () => {
      const app = new Hono();
      app.route('/api/auth', authRoutes);

      const res = await app.request('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'invalid.token.here' }),
      });

      expect(res.status).toBe(401);
    });
  });
});
