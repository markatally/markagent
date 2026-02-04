import type { ExecutionContext, ExecutionErrorType, ExternalSkillContract } from '@mark/shared';
import type { RuntimeResult, SkillRuntime } from './types';

export class FunctionRuntime implements SkillRuntime {
  readonly kind = 'function';

  async run(
    skill: ExternalSkillContract,
    _input: string,
    parameters: Readonly<Record<string, unknown>>,
    _context: ExecutionContext
  ): Promise<RuntimeResult> {
    const startTime = Date.now();

    try {
      return {
        success: true,
        output: {
          message: 'Function execution not yet implemented',
          parameters,
        },
        metrics: {
          executionTimeMs: Date.now() - startTime,
          toolsUsed: [],
          retryCount: 0,
        },
      };
    } catch (error) {
      return this.buildErrorResult(error, 'UNKNOWN', startTime);
    }
  }

  private buildErrorResult(
    error: unknown,
    errorType: ExecutionErrorType,
    startTime: number
  ): RuntimeResult {
    return {
      success: false,
      error: {
        type: errorType,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      metrics: {
        executionTimeMs: Date.now() - startTime,
        toolsUsed: [],
        retryCount: 0,
      },
    };
  }
}
