import type {
  ExternalSkillContract,
  ExecutionPolicy,
  UserTier,
  ResolvedExecutionPolicy,
} from '@mark/shared';

export interface PolicyResolutionInput {
  userId?: string;
  sessionId?: string;
  userTier?: UserTier;
}

const DEFAULT_POLICIES: Record<UserTier | 'default', ExecutionPolicy> = {
  free: { timeoutMs: 30000, retryCount: 1, maxTokens: 4000 },
  pro: { timeoutMs: 60000, retryCount: 2, maxTokens: 16000 },
  enterprise: { timeoutMs: 120000, retryCount: 3, maxTokens: 32000 },
  default: { timeoutMs: 30000, retryCount: 1, maxTokens: 4000 },
};

export class ExecutionPolicyResolver {
  /**
   * Resolve execution policy from skill definition and user tier.
   * Returns an immutable policy snapshot.
   */
  resolve(skill: ExternalSkillContract, input: PolicyResolutionInput): ResolvedExecutionPolicy {
    const tier = input.userTier || 'default';
    const tierDefault = DEFAULT_POLICIES[tier];
    const skillPolicy = skill.executionPolicy || {};

    return Object.freeze({
      timeoutMs: skillPolicy.timeoutMs ?? tierDefault.timeoutMs,
      retryCount: skillPolicy.retryCount ?? tierDefault.retryCount,
      maxTokens: skillPolicy.maxTokens ?? tierDefault.maxTokens,
      maxCost: skillPolicy.maxCost,
      allowedTools: skillPolicy.allowedTools,
      requireConfirmation: skillPolicy.requireConfirmation,
      resolvedAt: new Date(),
      source: skillPolicy.timeoutMs ? 'skill' : 'default',
    });
  }

  /**
   * Compute allowed tools from skill requirements and policy.
   */
  resolveAllowedTools(
    skill: ExternalSkillContract,
    policy: ResolvedExecutionPolicy
  ): string[] {
    const skillTools =
      skill.requiredTools?.map((tool) => (typeof tool === 'string' ? tool : tool.name)) || [];
    const policyTools = policy.allowedTools || [];

    if (policyTools.length > 0) {
      return skillTools.filter((tool) => policyTools.includes(tool));
    }

    return skillTools;
  }
}
