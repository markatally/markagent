import { describe, it, expect } from 'bun:test';
import {
  createExecutionContext,
  validateExecutionContext,
  EXECUTION_CONTEXT_VERSION,
} from '@mark/shared';

describe('ExecutionContext', () => {
  describe('createExecutionContext', () => {
    it('creates context with correct version', () => {
      const ctx = createExecutionContext({
        traceId: 'trace-123',
        resolvedPolicy: { resolvedAt: new Date(), source: 'default' },
        allowedTools: ['tool1'],
      });
      expect(ctx.contextVersion).toBe(EXECUTION_CONTEXT_VERSION);
    });

    it('creates immutable context (Object.isFrozen)', () => {
      const ctx = createExecutionContext({
        traceId: 'trace-123',
        resolvedPolicy: { resolvedAt: new Date(), source: 'default' },
        allowedTools: ['tool1'],
      });
      expect(Object.isFrozen(ctx)).toBe(true);
      expect(Object.isFrozen(ctx.resolvedPolicy)).toBe(true);
      expect(Object.isFrozen(ctx.allowedTools)).toBe(true);
    });

    it('includes all required fields', () => {
      const ctx = createExecutionContext({
        traceId: 'trace-123',
        sessionId: 'session-456',
        userId: 'user-789',
        userTier: 'pro',
        resolvedPolicy: {
          timeoutMs: 60000,
          resolvedAt: new Date(),
          source: 'skill',
        },
        allowedTools: ['file_reader', 'file_writer'],
      });

      expect(ctx.traceId).toBe('trace-123');
      expect(ctx.sessionId).toBe('session-456');
      expect(ctx.userId).toBe('user-789');
      expect(ctx.userTier).toBe('pro');
      expect(ctx.resolvedPolicy.timeoutMs).toBe(60000);
      expect(ctx.allowedTools).toContain('file_reader');
    });

    it('defaults userTier to free', () => {
      const ctx = createExecutionContext({
        traceId: 'trace-123',
        resolvedPolicy: { resolvedAt: new Date(), source: 'default' },
        allowedTools: [],
      });
      expect(ctx.userTier).toBe('free');
    });
  });

  describe('validateExecutionContext', () => {
    it('returns true for valid context', () => {
      const ctx = createExecutionContext({
        traceId: 'trace-123',
        resolvedPolicy: { resolvedAt: new Date(), source: 'default' },
        allowedTools: [],
      });
      expect(validateExecutionContext(ctx)).toBe(true);
    });

    it('returns false for missing traceId', () => {
      const invalid = { contextVersion: '1.0.0', userTier: 'free' };
      expect(validateExecutionContext(invalid)).toBe(false);
    });

    it('returns false for missing resolvedPolicy', () => {
      const invalid = { contextVersion: '1.0.0', traceId: 'x', userTier: 'free' };
      expect(validateExecutionContext(invalid)).toBe(false);
    });

    it('returns false for non-array allowedTools', () => {
      const invalid = {
        contextVersion: '1.0.0',
        traceId: 'x',
        userTier: 'free',
        resolvedPolicy: { resolvedAt: new Date(), source: 'default' },
        allowedTools: 'not-an-array',
      };
      expect(validateExecutionContext(invalid)).toBe(false);
    });
  });

  describe('immutability enforcement', () => {
    it('prevents modification of context fields', () => {
      const ctx = createExecutionContext({
        traceId: 'trace-123',
        resolvedPolicy: { resolvedAt: new Date(), source: 'default' },
        allowedTools: ['tool1'],
      });

      expect(() => {
        (ctx as any).traceId = 'modified';
      }).toThrow();
    });

    it('prevents modification of nested arrays', () => {
      const ctx = createExecutionContext({
        traceId: 'trace-123',
        resolvedPolicy: { resolvedAt: new Date(), source: 'default' },
        allowedTools: ['tool1'],
      });

      expect(() => {
        (ctx.allowedTools as any).push('tool2');
      }).toThrow();
    });
  });
});
