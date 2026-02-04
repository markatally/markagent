/**
 * External Skill Orchestrator (Policy-Driven Runtime)
 */

import { randomUUID } from 'crypto';
import type { ExecutionContext, UserTier } from '@mark/shared';
import { ContractVersionValidator, createExecutionContext } from '@mark/shared';
import type { UnifiedSkill } from '../external-skills/types';
import { ExecutionPolicyResolver } from './policy-resolver';
import { ExecutionLogger } from './execution-logger';
import { createTraceContext } from './tracing';
import {
  FunctionRuntime,
  MCPRuntime,
  PromptRuntime,
  WorkflowRuntime,
  getRuntimeRegistry,
  type RuntimeResult,
} from './runtimes';

export interface ExecutionContextInput {
  traceId?: string;
  parentExecutionId?: string;
  sessionId?: string;
  userId?: string;
  userTier?: UserTier;
  workspaceId?: string;
  workspaceFiles?: string[];
  metadata?: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  output?: unknown;
  rawOutput?: string;
  normalizedOutput?: unknown;
  error?: string;
  errorType?: string;
  executionTimeMs: number;
  metadata?: {
    invocationPattern: string;
    skillId: string;
    traceId?: string;
    toolsUsed?: string[];
    retryCount?: number;
  };
}

export class ExternalSkillOrchestrator {
  private runtimeRegistry = getRuntimeRegistry();
  private policyResolver = new ExecutionPolicyResolver();
  private executionLogger = new ExecutionLogger();

  constructor() {
    this.ensureRuntime(new PromptRuntime());
    this.ensureRuntime(new FunctionRuntime());
    this.ensureRuntime(new WorkflowRuntime());
    this.ensureRuntime(new MCPRuntime());
  }

  private ensureRuntime(runtime: PromptRuntime | FunctionRuntime | WorkflowRuntime | MCPRuntime) {
    if (!this.runtimeRegistry.get(runtime.kind)) {
      this.runtimeRegistry.register(runtime);
    }
  }

  async execute(
    skill: UnifiedSkill,
    input: string,
    parameters: Record<string, unknown> = {},
    contextInput: ExecutionContextInput = {}
  ): Promise<ExecutionResult> {
    ContractVersionValidator.validateAtRuntime(skill);
    const skillKind = skill.kind ?? skill.invocationPattern ?? 'prompt';

    if (skill.status && skill.status !== 'ACTIVE') {
      return {
        success: false,
        error: `Skill is not active: ${skill.status}`,
        executionTimeMs: 0,
        metadata: {
          invocationPattern: skillKind,
          skillId: skill.canonicalId,
        },
      };
    }

    const policy = this.policyResolver.resolve(skill, {
      userId: contextInput.userId,
      sessionId: contextInput.sessionId,
      userTier: contextInput.userTier,
    });
    const allowedTools = this.policyResolver.resolveAllowedTools(skill, policy);

    const traceContext = createTraceContext({
      traceId: contextInput.traceId || randomUUID(),
      parentExecutionId: contextInput.parentExecutionId,
      sessionId: contextInput.sessionId,
      userId: contextInput.userId,
    });

    const executionContext: ExecutionContext = createExecutionContext({
      traceId: traceContext.traceId,
      parentExecutionId: traceContext.parentExecutionId,
      sessionId: traceContext.sessionId,
      userId: traceContext.userId,
      userTier: contextInput.userTier,
      resolvedPolicy: policy,
      allowedTools,
      workspaceId: contextInput.workspaceId,
      workspaceFiles: contextInput.workspaceFiles,
      metadata: contextInput.metadata,
    });

    const runtime = this.runtimeRegistry.get(skillKind);
    if (!runtime) {
      return {
        success: false,
        error: `No runtime registered for skill kind: ${skillKind}`,
        executionTimeMs: 0,
        metadata: {
          invocationPattern: skillKind,
          skillId: skill.canonicalId,
        },
      };
    }

    const result = await runtime.run(skill, input, parameters, executionContext);
    await this.executionLogger.logExecution(
      skill,
      input,
      parameters,
      result,
      executionContext,
      policy
    );

    return this.formatResult(skill, skillKind, result, executionContext);
  }

  private formatResult(
    skill: UnifiedSkill,
    skillKind: string,
    result: RuntimeResult,
    context: ExecutionContext
  ): ExecutionResult {
    return {
      success: result.success,
      output: result.output,
      rawOutput: result.rawOutput,
      normalizedOutput: result.normalizedOutput,
      error: result.error?.message,
      errorType: result.error?.type,
      executionTimeMs: result.metrics.executionTimeMs,
      metadata: {
        invocationPattern: skillKind,
        skillId: skill.canonicalId,
        traceId: context.traceId,
        toolsUsed: [...result.metrics.toolsUsed],
        retryCount: result.metrics.retryCount,
      },
    };
  }

  canExecute(skill: UnifiedSkill): boolean {
    return !!this.runtimeRegistry.get(skill.kind);
  }
}

let orchestratorInstance: ExternalSkillOrchestrator | null = null;

export function getExternalSkillOrchestrator(): ExternalSkillOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new ExternalSkillOrchestrator();
  }
  return orchestratorInstance;
}
