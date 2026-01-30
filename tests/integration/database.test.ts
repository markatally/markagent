import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { prisma } from '../../apps/api/src/services/prisma';

describe('Phase 1: Database Connection', () => {
  beforeAll(async () => {
    // Ensure database is accessible
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Database Connectivity', () => {
    it('should connect to PostgreSQL', async () => {
      const result = await prisma.$queryRaw`SELECT 1 as value`;
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should have User table', async () => {
      const count = await prisma.user.count();
      expect(typeof count).toBe('number');
    });

    it('should have Session table', async () => {
      const count = await prisma.session.count();
      expect(typeof count).toBe('number');
    });

    it('should have Message table', async () => {
      const count = await prisma.message.count();
      expect(typeof count).toBe('number');
    });

    it('should have ToolCall table', async () => {
      const count = await prisma.toolCall.count();
      expect(typeof count).toBe('number');
    });
  });

  describe('Database Operations', () => {
    it('should perform basic query', async () => {
      const users = await prisma.user.findMany({
        take: 1,
      });
      expect(Array.isArray(users)).toBe(true);
    });

    it('should handle transactions', async () => {
      const result = await prisma.$transaction(async (tx) => {
        const userCount = await tx.user.count();
        return userCount;
      });
      expect(typeof result).toBe('number');
    });
  });
});
