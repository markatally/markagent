import type { JSONSchema, ExternalSkillContract } from '@mark/shared';

export type CapabilityLevel = 'EXTERNAL' | 'INTERNAL' | 'PRODUCT';
export type ExecutionScope = 'SYSTEM' | 'AGENT' | 'USER_VISIBLE';

export interface SkillSourceInfo {
  repoUrl: string;
  repoPath: string;
  commitHash?: string;
  license?: string;
  syncedAt: Date;
}

export interface UnifiedSkill extends ExternalSkillContract {
  runtimeVersion?: string;
  status?: 'ACTIVE' | 'EXTENDED' | 'DEPRECATED' | 'PROTECTED';
  invocationPattern?: 'function' | 'prompt' | 'workflow' | 'mcp';
  functionDefinition?: Record<string, unknown>;
  dependencies: string[];
  requiredTools?: string[];
  capabilityLevel: CapabilityLevel;
  executionScope: ExecutionScope;
  sourceInfo: SkillSourceInfo;
  isProtected: boolean;
  protectionReason?: string;
  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;
}

export interface SkillFilter {
  category?: string;
  capabilityLevel?: CapabilityLevel;
  executionScope?: ExecutionScope;
  status?: 'ACTIVE' | 'EXTENDED' | 'DEPRECATED' | 'PROTECTED';
}

export interface ResolvedSkill extends UnifiedSkill {
  resolvedAt: Date;
  snapshotId: string;
}

export interface SkillSnapshot {
  snapshotId: string;
  createdAt: Date;
  skills: Map<string, ResolvedSkill>;

  getSkill(canonicalId: string): ResolvedSkill | undefined;
  listSkills(filter?: SkillFilter): ResolvedSkill[];
  isProtected(canonicalId: string): boolean;
}
