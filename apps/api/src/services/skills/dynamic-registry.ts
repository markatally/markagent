/**
 * Dynamic Skill Registry
 * Manages both static (product) skills and dynamic (external) skills
 */

import { ContractVersionValidator } from '@mark/shared';
import { getSkill, listSkills, type Skill } from '../../../../../skills';
import { getExternalSkillLoader } from '../external-skills/loader';
import { getExternalSkillAdapter } from './external-bridge';
import type { UnifiedSkill } from '../external-skills/types';

export interface EnhancedSkill extends Skill {
  isExternal: boolean;
  externalMetadata?: {
    canonicalId: string;
    version: string;
    contractVersion?: string;
    capabilityLevel: string;
    invocationPattern: string;
    source: {
      repoUrl: string;
      repoPath: string;
    };
  };
}

/**
 * Registry that combines product and external skills
 */
export class DynamicSkillRegistry {
  private enabledExternalSkills: Set<string> = new Set();
  private externalSkillCache: Map<string, EnhancedSkill> = new Map();
  private cacheExpiry: number = 5 * 60 * 1000; // 5 minutes
  private lastCacheTime: number = 0;

  /**
   * Get a skill by name or alias (searches both product and external)
   */
  async getSkill(nameOrAlias: string): Promise<EnhancedSkill | null> {
    // First, try product skills
    const productSkill = getSkill(nameOrAlias);
    if (productSkill) {
      return {
        ...productSkill,
        isExternal: false,
      };
    }

    // Then try external skills
    await this.refreshCacheIfNeeded();

    const normalizedName = nameOrAlias.toLowerCase();
    return this.externalSkillCache.get(normalizedName) || null;
  }

  /**
   * List all available skills (product + enabled external)
   */
  async listAll(includeExternal: boolean = true): Promise<EnhancedSkill[]> {
    const skills: EnhancedSkill[] = [];

    // Add product skills
    const productSkills = listSkills();
    skills.push(
      ...productSkills.map((skill) => ({
        ...skill,
        isExternal: false,
      }))
    );

    // Add external skills if requested
    if (includeExternal) {
      await this.refreshCacheIfNeeded();
      skills.push(...Array.from(this.externalSkillCache.values()));
    }

    return skills;
  }

  /**
   * List skills by category
   */
  async listByCategory(category: string): Promise<EnhancedSkill[]> {
    const allSkills = await this.listAll();
    return allSkills.filter((skill) => skill.category === category);
  }

  /**
   * Enable an external skill
   */
  async enableExternal(canonicalId: string): Promise<boolean> {
    const loader = getExternalSkillLoader();
    const externalSkill = await loader.getSkill(canonicalId);

    if (!externalSkill) {
      return false;
    }

    const validation = ContractVersionValidator.validateAtRegistration(externalSkill);
    if (!validation.valid) {
      return false;
    }

    this.enabledExternalSkills.add(canonicalId);
    await this.addToCache(externalSkill);
    return true;
  }

  /**
   * Disable an external skill
   */
  disableExternal(canonicalId: string): void {
    this.enabledExternalSkills.delete(canonicalId);
    this.externalSkillCache.delete(canonicalId);
  }

  /**
   * Check if an external skill is enabled
   */
  isExternalEnabled(canonicalId: string): boolean {
    return this.enabledExternalSkills.has(canonicalId);
  }

  /**
   * Get all enabled external skill IDs
   */
  getEnabledExternal(): string[] {
    return Array.from(this.enabledExternalSkills);
  }

  /**
   * List available external skills (not necessarily enabled)
   */
  async listAvailableExternal(): Promise<UnifiedSkill[]> {
    const loader = getExternalSkillLoader();
    return loader.listSkills({
      capabilityLevel: 'EXTERNAL',
      status: 'ACTIVE',
    });
  }

  /**
   * Refresh the external skill cache if expired
   */
  private async refreshCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCacheTime < this.cacheExpiry) {
      return;
    }

    await this.refreshCache();
  }

  /**
   * Force refresh the external skill cache
   */
  async refreshCache(): Promise<void> {
    const loader = getExternalSkillLoader();
    const adapter = getExternalSkillAdapter();

    // Clear old cache
    this.externalSkillCache.clear();

    // Load enabled external skills
    for (const canonicalId of this.enabledExternalSkills) {
      const externalSkill = await loader.getSkill(canonicalId);
      if (!externalSkill) continue;
      const validation = ContractVersionValidator.validateAtRegistration(externalSkill);
      if (!validation.valid) continue;
      if (adapter.canExecute(externalSkill)) {
        await this.addToCache(externalSkill);
      }
    }

    this.lastCacheTime = Date.now();
  }

  /**
   * Add an external skill to the cache
   */
  private async addToCache(externalSkill: UnifiedSkill): Promise<void> {
    const adapter = getExternalSkillAdapter();
    const productSkill = adapter.toProductSkill(externalSkill);

    const enhancedSkill: EnhancedSkill = {
      ...productSkill,
      isExternal: true,
      externalMetadata: {
        canonicalId: externalSkill.canonicalId,
        version: externalSkill.version,
        contractVersion: externalSkill.contractVersion,
        capabilityLevel: externalSkill.capabilityLevel,
        invocationPattern: externalSkill.kind,
        source: {
          repoUrl: externalSkill.sourceInfo.repoUrl || '',
          repoPath: externalSkill.sourceInfo.repoPath || '',
        },
      },
    };

    // Store by canonical ID
    this.externalSkillCache.set(externalSkill.canonicalId, enhancedSkill);

    // Also store by aliases
    for (const alias of productSkill.aliases) {
      this.externalSkillCache.set(alias, enhancedSkill);
    }
  }

  /**
   * Search skills by keyword
   */
  async search(query: string): Promise<EnhancedSkill[]> {
    const allSkills = await this.listAll();
    const lowerQuery = query.toLowerCase();

    return allSkills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery) ||
        skill.aliases.some((alias) => alias.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get skill statistics
   */
  async getStats(): Promise<{
    totalSkills: number;
    productSkills: number;
    externalSkills: number;
    enabledExternal: number;
    categories: Record<string, number>;
  }> {
    const allSkills = await this.listAll();

    const stats = {
      totalSkills: allSkills.length,
      productSkills: allSkills.filter((s) => !s.isExternal).length,
      externalSkills: allSkills.filter((s) => s.isExternal).length,
      enabledExternal: this.enabledExternalSkills.size,
      categories: {} as Record<string, number>,
    };

    // Count by category
    for (const skill of allSkills) {
      stats.categories[skill.category] = (stats.categories[skill.category] || 0) + 1;
    }

    return stats;
  }
}

/**
 * Singleton instance
 */
let registryInstance: DynamicSkillRegistry | null = null;

/**
 * Get the dynamic skill registry instance
 */
export function getDynamicSkillRegistry(): DynamicSkillRegistry {
  if (!registryInstance) {
    registryInstance = new DynamicSkillRegistry();
  }
  return registryInstance;
}
