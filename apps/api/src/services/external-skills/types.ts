import type { JSONSchema } from '@mark/shared';

export type CapabilityLevel = 'EXTERNAL' | 'INTERNAL' | 'PRODUCT';
export type ExecutionScope = 'SYSTEM' | 'AGENT' | 'USER_VISIBLE';

export interface SkillSourceInfo {
  repoUrl: string;
  repoPath: string;
  commitHash?: string;
  license?: string;
  syncedAt: Date;
}

export interface UnifiedSkill {
  canonicalId: string;
  name: string;
  description: string;
  version: string;
  runtimeVersion?: string;
  category?: string;
  status?: 'ACTIVE' | 'EXTENDED' | 'DEPRECATED' | 'PROTECTED';

  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;

  invocationPattern: 'function' | 'prompt' | 'workflow' | 'mcp';
  systemPrompt?: string;
  userPromptTemplate?: string;
  functionDefinition?: Record<string, unknown>;

  dependencies: string[];
  requiredTools?: string[];

  capabilityLevel: CapabilityLevel;
  executionScope: ExecutionScope;

  source: SkillSourceInfo;
  isProtected: boolean;
  protectionReason?: string;
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
