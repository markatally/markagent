import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { UnifiedSkill } from './types';

interface ProtectedPattern {
  pattern: string;
  reason: string;
}

interface ProtectionConfig {
  protectedPatterns: ProtectedPattern[];
  protectedIds: string[];
  enforcementLevel?: 'RUNTIME' | 'SYNC_ONLY';
}

const DEFAULT_CONFIG: ProtectionConfig = {
  protectedPatterns: [],
  protectedIds: [],
  enforcementLevel: 'RUNTIME',
};

export class SkillProtectionEnforcer {
  private config: ProtectionConfig | null = null;

  async loadConfig(): Promise<ProtectionConfig> {
    if (this.config) return this.config;
    const configPath = path.resolve(
      process.cwd(),
      'apps',
      'api',
      'external-skills',
      'protected.json'
    );
    try {
      const raw = await readFile(configPath, 'utf8');
      this.config = JSON.parse(raw) as ProtectionConfig;
    } catch {
      this.config = DEFAULT_CONFIG;
    }
    return this.config;
  }

  async isProtected(canonicalId: string, name?: string): Promise<boolean> {
    const config = await this.loadConfig();
    if (config.protectedIds.includes(canonicalId)) return true;
    if (name) {
      for (const entry of config.protectedPatterns) {
        const regex = new RegExp(entry.pattern, 'i');
        if (regex.test(name)) return true;
      }
    }
    return false;
  }

  async getProtectionReason(canonicalId: string, name?: string): Promise<string | undefined> {
    const config = await this.loadConfig();
    if (config.protectedIds.includes(canonicalId)) {
      return 'Protected canonical ID';
    }
    if (name) {
      for (const entry of config.protectedPatterns) {
        const regex = new RegExp(entry.pattern, 'i');
        if (regex.test(name)) return entry.reason;
      }
    }
    return undefined;
  }

  async assertCanDelete(canonicalId: string, name?: string): Promise<void> {
    if (await this.isProtected(canonicalId, name)) {
      throw new Error(`Protected skill cannot be deleted: ${canonicalId}`);
    }
  }

  async assertCanOverwrite(canonicalId: string, name?: string): Promise<void> {
    if (await this.isProtected(canonicalId, name)) {
      throw new Error(`Protected skill cannot be overwritten: ${canonicalId}`);
    }
  }

  createExtendedVariant(baseId: string, newSkill: UnifiedSkill): string {
    const versionSuffix = newSkill.version ? `-${sanitizeId(newSkill.version)}` : '';
    return `${baseId}-extended${versionSuffix}`;
  }
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
