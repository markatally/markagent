import type { JSONSchema } from './index';

// ============ CONTRACT VERSION ============
// MAJOR: Breaking changes (fields removed, types changed, required fields added)
// MINOR: Backward-compatible additions (new optional fields)
// PATCH: Documentation, bug fixes
export const CONTRACT_VERSION = '1.0.0';

// Minimum supported version for runtime execution
export const MIN_SUPPORTED_CONTRACT_VERSION = '1.0.0';

// ============ Types ============
export type SkillSource = 'github' | 'mcp' | 'internal';
export type SkillKind = 'prompt' | 'function' | 'workflow' | 'mcp';
export type SkillLifecycleStatus = 'active' | 'deprecated' | 'disabled' | 'review';
export type ExecutionErrorType =
  | 'LLM'
  | 'TOOL'
  | 'VALIDATION'
  | 'TIMEOUT'
  | 'POLICY'
  | 'VERSION'
  | 'UNKNOWN';

export interface ToolSpec {
  name: string;
  required: boolean;
  permissions?: string[];
}

export type ToolRequirement = ToolSpec | string;

export interface ExecutionPolicy {
  timeoutMs?: number;
  retryCount?: number;
  maxCost?: number;
  maxTokens?: number;
  allowedTools?: string[];
  requireConfirmation?: boolean;
}

export interface SkillLifecycle {
  status: SkillLifecycleStatus;
  reviewedAt?: Date;
  reviewedBy?: string;
  deprecatedAt?: Date;
  deprecationReason?: string;
}

// ============ THE CANONICAL CONTRACT ============
export interface ExternalSkillContract {
  // Version of this contract (for evolution tracking)
  readonly contractVersion: string;

  // Identity
  readonly canonicalId: string;
  readonly version: string;
  readonly source: SkillSource;
  readonly kind: SkillKind;

  // Metadata
  readonly name: string;
  readonly description: string;
  readonly category?: string;

  // Schema (required for validation)
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema;

  // Execution configuration
  readonly requiredTools?: ToolRequirement[];
  readonly executionPolicy?: ExecutionPolicy;

  // Prompts (for prompt-kind skills)
  readonly systemPrompt?: string;
  readonly userPromptTemplate?: string;

  // Governance
  readonly lifecycle: SkillLifecycle;

  // Source tracing
  readonly sourceInfo: {
    readonly repoUrl?: string;
    readonly repoPath?: string;
    readonly commitHash?: string;
    readonly syncedAt: Date;
  };
}

// ============ Contract Errors ============
export class IncompatibleContractError extends Error {
  constructor(
    public readonly skillId: string,
    public readonly skillContractVersion: string,
    public readonly minSupportedVersion: string
  ) {
    super(
      `Skill "${skillId}" has contract version ${skillContractVersion}, ` +
        `but minimum supported is ${minSupportedVersion}. ` +
        `Update the skill or upgrade the platform.`
    );
    this.name = 'IncompatibleContractError';
  }
}
