/**
 * Enhanced Skill Processor
 * Extends the base SkillProcessor to support external skills
 */

import { SkillProcessor, type SkillInvocation } from './processor';
import { getDynamicSkillRegistry, type EnhancedSkill } from './dynamic-registry';
import { getExternalSkillLoader } from '../external-skills/loader';
import { getExternalSkillOrchestrator, type ExecutionContextInput } from './external-executor';
import type { UnifiedSkill } from '../external-skills/types';

/**
 * Extended invocation that includes external skill metadata
 */
export interface EnhancedSkillInvocation extends Omit<SkillInvocation, 'skill'> {
  skill: EnhancedSkill;
  isExternal: boolean;
  externalSkill?: UnifiedSkill;
}

export interface SkillProcessorContext extends ExecutionContextInput {
  additionalContext?: Record<string, string>;
}

/**
 * Enhanced processor with external skill support
 */
export class EnhancedSkillProcessor extends SkillProcessor {
  private registry = getDynamicSkillRegistry();

  /**
   * Parse command and return enhanced invocation
   */
  async parseCommandAsync(input: string): Promise<EnhancedSkillInvocation | null> {
    const trimmed = input.trim();

    if (!trimmed.startsWith('/')) {
      return null;
    }

    // Extract command and arguments
    const parts = trimmed.substring(1).split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Find the skill (product or external)
    const skill = await this.registry.getSkill(commandName);
    if (!skill) {
      return null;
    }

    // Parse parameters
    const parameters: Record<string, string> = {};
    const userInputParts: string[] = [];

    for (const arg of args) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        const key = arg.substring(0, eqIndex);
        const value = arg.substring(eqIndex + 1);
        parameters[key] = value;
      } else {
        userInputParts.push(arg);
      }
    }

    const userInput = userInputParts.join(' ');

    // Get external skill if applicable
    let externalSkill: UnifiedSkill | undefined;
    if (skill.isExternal && skill.externalMetadata) {
      const loader = getExternalSkillLoader();
      const loaded = await loader.getSkill(skill.externalMetadata.canonicalId);
      if (loaded) {
        externalSkill = loaded;
      }
    }

    return {
      skillName: skill.name,
      skill,
      userInput,
      parameters,
      isExternal: skill.isExternal,
      externalSkill,
    };
  }

  /**
   * Execute an enhanced invocation
   */
  async executeInvocation(
    invocation: EnhancedSkillInvocation,
    context: SkillProcessorContext = {}
  ): Promise<any> {
    if (!invocation.isExternal || !invocation.externalSkill) {
      // Regular product skill - use standard prompt formatting
      return this.formatPrompts(invocation as SkillInvocation, {
        workspaceFiles: context.workspaceFiles,
        additionalContext: context.additionalContext,
      });
    }

    // External skill - use orchestrator
    const orchestrator = getExternalSkillOrchestrator();
    return orchestrator.execute(
      invocation.externalSkill,
      invocation.userInput,
      invocation.parameters,
      {
        traceId: context.traceId,
        parentExecutionId: context.parentExecutionId,
        sessionId: context.sessionId,
        userId: context.userId,
        userTier: context.userTier,
        workspaceId: context.workspaceId,
        workspaceFiles: context.workspaceFiles,
        metadata: context.metadata,
      }
    );
  }

  /**
   * Get all skills (including external)
   */
  async getAllSkillsAsync(): Promise<EnhancedSkill[]> {
    return this.registry.listAll(true);
  }

  /**
   * Get skills by category (including external)
   */
  async getSkillsByCategoryAsync(category: string): Promise<EnhancedSkill[]> {
    return this.registry.listByCategory(category);
  }

  /**
   * Enable an external skill
   */
  async enableExternalSkill(canonicalId: string): Promise<boolean> {
    return this.registry.enableExternal(canonicalId);
  }

  /**
   * Disable an external skill
   */
  disableExternalSkill(canonicalId: string): void {
    this.registry.disableExternal(canonicalId);
  }

  /**
   * List available external skills
   */
  async listAvailableExternalSkills(): Promise<UnifiedSkill[]> {
    return this.registry.listAvailableExternal();
  }

  /**
   * Search skills
   */
  async searchSkills(query: string): Promise<EnhancedSkill[]> {
    return this.registry.search(query);
  }

  /**
   * Get skill statistics
   */
  async getSkillStats() {
    return this.registry.getStats();
  }

  /**
   * Format help text for enhanced skill
   */
  formatEnhancedSkillHelp(skill: EnhancedSkill): string {
    let help = this.formatSkillHelp(skill);

    if (skill.isExternal && skill.externalMetadata) {
      help += `\nExternal Skill Information:\n`;
      help += `  - Canonical ID: ${skill.externalMetadata.canonicalId}\n`;
      help += `  - Version: ${skill.externalMetadata.version}\n`;
      help += `  - Invocation Pattern: ${skill.externalMetadata.invocationPattern}\n`;
      help += `  - Source: ${skill.externalMetadata.source.repoUrl}\n`;
    }

    return help;
  }
}

/**
 * Singleton instance
 */
let enhancedProcessorInstance: EnhancedSkillProcessor | null = null;

/**
 * Get the enhanced skill processor instance
 */
export function getEnhancedSkillProcessor(): EnhancedSkillProcessor {
  if (!enhancedProcessorInstance) {
    enhancedProcessorInstance = new EnhancedSkillProcessor();
  }
  return enhancedProcessorInstance;
}
