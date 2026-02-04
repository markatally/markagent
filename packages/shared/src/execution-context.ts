import type { ExecutionPolicy } from './external-skill-contract';

// ============ EXECUTION CONTEXT VERSION ============
// Bump when context shape changes
export const EXECUTION_CONTEXT_VERSION = '1.0.0';

// ============ User Tier (for policy resolution) ============
export type UserTier = 'free' | 'pro' | 'enterprise';

// ============ Resolved Policy (immutable snapshot) ============
export interface ResolvedExecutionPolicy extends ExecutionPolicy {
  readonly resolvedAt: Date;
  readonly source: 'skill' | 'user' | 'session' | 'default';
}

// ============ THE EXECUTION CONTEXT ============
// This is the ONLY way runtimes access execution metadata.
// All fields are readonly to enforce immutability.
export interface ExecutionContext {
  // Version of this context shape
  readonly contextVersion: string;

  // Tracing (required)
  readonly traceId: string;
  readonly parentExecutionId?: string;

  // Session/User (required for policy resolution)
  readonly sessionId?: string;
  readonly userId?: string;
  readonly userTier: UserTier;

  // Resolved policy (computed, immutable)
  readonly resolvedPolicy: ResolvedExecutionPolicy;

  // Tool permissions (computed from policy + skill)
  readonly allowedTools: readonly string[];

  // Workspace context (optional)
  readonly workspaceId?: string;
  readonly workspaceFiles?: readonly string[];

  // Additional context (optional, read-only)
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ============ Context Factory ============
export interface ExecutionContextInput {
  traceId: string;
  parentExecutionId?: string;
  sessionId?: string;
  userId?: string;
  userTier?: UserTier;
  resolvedPolicy: ResolvedExecutionPolicy;
  allowedTools: string[];
  workspaceId?: string;
  workspaceFiles?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Create an immutable ExecutionContext.
 * This is the ONLY way to create a context - ensures shape is enforced.
 */
export function createExecutionContext(input: ExecutionContextInput): ExecutionContext {
  const resolvedPolicy = Object.freeze({ ...input.resolvedPolicy });
  const allowedTools = Object.freeze([...input.allowedTools]);
  const workspaceFiles = input.workspaceFiles
    ? Object.freeze([...input.workspaceFiles])
    : undefined;
  const metadata = input.metadata ? Object.freeze({ ...input.metadata }) : undefined;

  return Object.freeze({
    contextVersion: EXECUTION_CONTEXT_VERSION,
    traceId: input.traceId,
    parentExecutionId: input.parentExecutionId,
    sessionId: input.sessionId,
    userId: input.userId,
    userTier: input.userTier ?? 'free',
    resolvedPolicy,
    allowedTools,
    workspaceId: input.workspaceId,
    workspaceFiles,
    metadata,
  });
}

/**
 * Validate that a context object has the required shape.
 * Used in tests and at runtime boundaries.
 */
export function validateExecutionContext(context: unknown): context is ExecutionContext {
  if (!context || typeof context !== 'object') return false;

  const ctx = context as Record<string, unknown>;

  // Required fields
  if (typeof ctx.contextVersion !== 'string') return false;
  if (typeof ctx.traceId !== 'string') return false;
  if (typeof ctx.userTier !== 'string') return false;
  if (!ctx.resolvedPolicy || typeof ctx.resolvedPolicy !== 'object') return false;
  if (!Array.isArray(ctx.allowedTools)) return false;

  // Validate resolvedPolicy shape
  const policy = ctx.resolvedPolicy as Record<string, unknown>;
  if (!(policy.resolvedAt instanceof Date) && typeof policy.resolvedAt !== 'string')
    return false;
  if (typeof policy.source !== 'string') return false;

  return true;
}
