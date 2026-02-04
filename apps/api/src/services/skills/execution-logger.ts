import { prisma } from '../prisma';
import type { ExecutionContext, ExternalSkillContract } from '@mark/shared';
import type { RuntimeResult } from './runtimes/types';

export class ExecutionLogger {
  async logExecution(
    skill: ExternalSkillContract,
    input: string,
    parameters: Record<string, unknown>,
    result: RuntimeResult,
    context: ExecutionContext,
    policySnapshot: unknown
  ): Promise<string> {
    const execution = await prisma.externalSkillExecution.create({
      data: {
        canonicalId: skill.canonicalId,
        userId: context.userId,
        sessionId: context.sessionId,
        traceId: context.traceId,
        parentExecutionId: context.parentExecutionId,
        input: { input, parameters },
        output: result.output ?? null,
        status: result.success ? 'success' : 'error',
        errorType: result.error?.type,
        errorMessage: result.error?.message,
        executionTimeMs: result.metrics.executionTimeMs,
        tokensUsed: result.metrics.tokensUsed,
        toolsUsed: [...result.metrics.toolsUsed],
        policySnapshot,
        completedAt: new Date(),
      },
    });

    return execution.id;
  }
}
