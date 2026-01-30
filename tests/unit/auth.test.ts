import { describe, it, expect } from 'bun:test';
import { hashPassword, verifyPassword, generateTokenPair, verifyToken, type TokenPayload } from '../../apps/api/src/services/auth';

describe('Phase 2: Auth Service', () => {
  describe('Password Hashing', () => {
    it('should hash password', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
      expect(hash.startsWith('$2')).toBe(true); // bcrypt hash prefix
    });

    it('should verify correct password', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'testPassword123';
      const wrongPassword = 'wrongPassword';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(wrongPassword, hash);

      expect(isValid).toBe(false);
    });

    it('should create different hashes for same password', async () => {
      const password = 'testPassword123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2); // Salt makes them different
      expect(await verifyPassword(password, hash1)).toBe(true);
      expect(await verifyPassword(password, hash2)).toBe(true);
    });
  });

  describe('JWT Token Generation', () => {
    it('should generate access and refresh tokens', () => {
      const userId = 'test-user-id-123';
      const email = 'test@example.com';
      const tokens = generateTokenPair(userId, email);

      expect(tokens).toBeDefined();
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
    });

    it('should generate valid JWT format', () => {
      const userId = 'test-user-id-123';
      const email = 'test@example.com';
      const tokens = generateTokenPair(userId, email);

      // JWT format: header.payload.signature
      const accessParts = tokens.accessToken.split('.');
      const refreshParts = tokens.refreshToken.split('.');

      expect(accessParts.length).toBe(3);
      expect(refreshParts.length).toBe(3);
    });
  });

  describe('JWT Token Verification', () => {
    it('should verify valid access token', () => {
      const userId = 'test-user-id-123';
      const email = 'test@example.com';
      const { accessToken } = generateTokenPair(userId, email);

      const decoded = verifyToken(accessToken);

      expect(decoded).toBeDefined();
      expect(decoded.userId).toBe(userId);
      expect(decoded.email).toBe(email);
      expect(decoded.type).toBe('access');
    });

    it('should verify valid refresh token', () => {
      const userId = 'test-user-id-123';
      const email = 'test@example.com';
      const { refreshToken } = generateTokenPair(userId, email);

      const decoded = verifyToken(refreshToken);

      expect(decoded).toBeDefined();
      expect(decoded.userId).toBe(userId);
      expect(decoded.email).toBe(email);
      expect(decoded.type).toBe('refresh');
    });

    it('should reject invalid token', () => {
      const invalidToken = 'invalid.token.string';

      expect(() => verifyToken(invalidToken)).toThrow();
    });

    it('should reject expired token', () => {
      // Generate token with -1 second expiry to make it expired
      const userId = 'test-user-id-123';
      const email = 'test@example.com';
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { userId, email, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' }
      );

      expect(() => verifyToken(expiredToken)).toThrow();
    });

    it('should distinguish access and refresh tokens', () => {
      const userId = 'test-user-id-123';
      const email = 'test@example.com';
      const { accessToken, refreshToken } = generateTokenPair(userId, email);

      const accessDecoded = verifyToken(accessToken);
      const refreshDecoded = verifyToken(refreshToken);

      expect(accessDecoded.type).toBe('access');
      expect(refreshDecoded.type).toBe('refresh');
    });
  });
});
