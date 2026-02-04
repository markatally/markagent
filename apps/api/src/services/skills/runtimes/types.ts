import type {
  ExecutionContext,
  ExecutionErrorType,
  ExternalSkillContract,
} from '@mark/shared';

/**
 * Result of a skill runtime execution.
 * Contains both raw and validated output.
 */
export interface RuntimeResult {
  readonly success: boolean;
  readonly output?: unknown;
  readonly rawOutput?: string;
  readonly normalizedOutput?: unknown;
  readonly error?: {
    readonly type: ExecutionErrorType;
    readonly message: string;
    readonly details?: unknown;
  };
  readonly metrics: {
    readonly executionTimeMs: number;
    readonly tokensUsed?: number;
    readonly toolsUsed: readonly string[];
    readonly retryCount: number;
  };
}

/**
 * Skill Runtime Interface.
 *
 * HARD REQUIREMENT: Runtimes receive ExecutionContext explicitly.
 * They MUST NOT import from request handlers or access global session state.
 */
export interface SkillRuntime {
  readonly kind: string;

  run(
    skill: ExternalSkillContract,
    input: string,
    parameters: Readonly<Record<string, unknown>>,
    context: ExecutionContext
  ): Promise<RuntimeResult>;
}

export interface RuntimeRegistry {
  get(kind: string): SkillRuntime | undefined;
  register(runtime: SkillRuntime): void;
  list(): readonly SkillRuntime[];
}
