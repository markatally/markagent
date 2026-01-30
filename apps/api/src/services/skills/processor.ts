/**
 * Skill Processor
 * Parses slash commands and formats prompts for skill invocation
 */

import { getSkill, listSkills, type Skill } from '../../../../../skills';

/**
 * Parsed skill invocation
 */
export interface SkillInvocation {
  skillName: string;
  skill: Skill;
  userInput: string;
  parameters: Record<string, string>;
}

/**
 * Formatted prompts for LLM
 */
export interface FormattedPrompts {
  systemPrompt: string;
  userPrompt: string;
  requiredTools: string[];
}

/**
 * SkillProcessor - Handles slash command parsing and prompt formatting
 */
export class SkillProcessor {
  /**
   * Check if input starts with a slash command
   */
  isSkillCommand(input: string): boolean {
    const trimmed = input.trim();
    return trimmed.startsWith('/') && trimmed.length > 1;
  }

  /**
   * Parse a slash command into a skill invocation
   * Returns null if no valid skill is found
   */
  parseCommand(input: string): SkillInvocation | null {
    const trimmed = input.trim();

    if (!trimmed.startsWith('/')) {
      return null;
    }

    // Extract command and arguments
    // Format: /command argument1 argument2 ...
    // Or: /command key=value key2=value2 ...
    const parts = trimmed.substring(1).split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Find the skill
    const skill = getSkill(commandName);
    if (!skill) {
      return null;
    }

    // Parse parameters
    const parameters: Record<string, string> = {};
    const userInputParts: string[] = [];

    for (const arg of args) {
      // Check for key=value format
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        const key = arg.substring(0, eqIndex);
        const value = arg.substring(eqIndex + 1);
        parameters[key] = value;
      } else {
        // Regular argument - part of user input
        userInputParts.push(arg);
      }
    }

    const userInput = userInputParts.join(' ');

    return {
      skillName: skill.name,
      skill,
      userInput,
      parameters,
    };
  }

  /**
   * Format prompts for LLM using skill templates
   */
  formatPrompts(
    invocation: SkillInvocation,
    context?: { workspaceFiles?: string[]; additionalContext?: Record<string, string> }
  ): FormattedPrompts {
    const { skill, userInput, parameters } = invocation;

    // Build context for template substitution
    const templateContext: Record<string, string> = {
      userInput,
      workspaceFiles: context?.workspaceFiles?.join(', ') || '(none)',
      ...parameters,
      ...context?.additionalContext,
    };

    // Substitute variables in user prompt template
    let userPrompt = skill.userPromptTemplate;
    for (const [key, value] of Object.entries(templateContext)) {
      userPrompt = userPrompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
    }

    // Clean up any remaining template variables
    userPrompt = userPrompt.replace(/\{[^}]+\}/g, '');

    return {
      systemPrompt: skill.systemPrompt,
      userPrompt: userPrompt.trim(),
      requiredTools: skill.requiredTools,
    };
  }

  /**
   * Get all available skills
   */
  getAllSkills(): Skill[] {
    return listSkills();
  }

  /**
   * Get skill by name or alias
   */
  getSkill(nameOrAlias: string): Skill | undefined {
    return getSkill(nameOrAlias);
  }

  /**
   * Format skill help text
   */
  formatSkillHelp(skill: Skill): string {
    let help = `/${skill.name} - ${skill.description}\n`;
    help += `Category: ${skill.category}\n`;

    if (skill.aliases.length > 0) {
      help += `Aliases: ${skill.aliases.map((a) => '/' + a).join(', ')}\n`;
    }

    if (skill.parameters && skill.parameters.length > 0) {
      help += `Parameters:\n`;
      for (const param of skill.parameters) {
        const req = param.required ? '(required)' : '(optional)';
        help += `  - ${param.name}: ${param.description} ${req}\n`;
      }
    }

    help += `Required tools: ${skill.requiredTools.join(', ')}\n`;

    return help;
  }

  /**
   * List skills by category
   */
  listSkillsByCategory(): Map<string, Skill[]> {
    const skills = this.getAllSkills();
    const byCategory = new Map<string, Skill[]>();

    for (const skill of skills) {
      const category = skill.category;
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category)!.push(skill);
    }

    return byCategory;
  }
}

// Singleton instance
let skillProcessor: SkillProcessor | null = null;

/**
 * Get the skill processor instance
 */
export function getSkillProcessor(): SkillProcessor {
  if (!skillProcessor) {
    skillProcessor = new SkillProcessor();
  }
  return skillProcessor;
}
