/**
 * External Skill Bridge
 * Converts UnifiedSkill (external) to Skill (product) interface
 */

import type { UnifiedSkill } from '../external-skills/types';
import type { Skill, SkillCategory, SkillParameter } from '../../../../../skills';

/**
 * Adapter for converting external skills to product skills
 */
export class ExternalSkillAdapter {
  /**
   * Convert UnifiedSkill to Skill interface
   */
  toProductSkill(external: UnifiedSkill): Skill {
    return {
      name: external.name,
      description: external.description,
      aliases: this.extractAliases(external),
      category: this.mapCategory(external.category),
      systemPrompt: external.systemPrompt || this.generateDefaultSystemPrompt(external),
      userPromptTemplate:
        external.userPromptTemplate || this.generateDefaultUserPrompt(external),
      requiredTools: this.normalizeRequiredTools(external) || this.inferRequiredTools(external),
      parameters: this.convertInputSchema(external),
    };
  }

  /**
   * Check if external skill can be executed
   */
  canExecute(external: UnifiedSkill): boolean {
    // Check if skill is active and has required fields
    if (external.status && external.status !== 'ACTIVE') {
      return false;
    }

    // Must have valid invocation pattern
    const validPatterns = ['prompt', 'function', 'workflow', 'mcp'];
    const kind = this.resolveKind(external);
    if (!validPatterns.includes(kind)) {
      return false;
    }

    if (kind === 'function' && !external.functionDefinition) {
      return false;
    }

    return true;
  }

  /**
   * Extract aliases from external skill metadata
   */
  private extractAliases(external: UnifiedSkill): string[] {
    const aliases: string[] = [];

    // Use canonical name variations
    if (external.name !== external.canonicalId) {
      aliases.push(external.name.toLowerCase().replace(/\s+/g, '-'));
    }

    // Add category-based alias if appropriate
    if (external.category) {
      const categoryAlias = `${external.category}-${external.canonicalId}`;
      if (categoryAlias.length < 30) {
        aliases.push(categoryAlias);
      }
    }

    return aliases;
  }

  /**
   * Map external category to product skill category
   */
  private mapCategory(category?: string): SkillCategory {
    if (!category) return 'development';

    const categoryMap: Record<string, SkillCategory> = {
      development: 'development',
      debugging: 'debugging',
      testing: 'testing',
      devops: 'devops',
      documentation: 'documentation',
      analysis: 'analysis',
      data: 'data',
      web: 'web',
      integration: 'integration',
      planning: 'planning',
    };

    const normalized = category.toLowerCase();
    return categoryMap[normalized] || 'development';
  }

  /**
   * Generate default system prompt if not provided
   */
  private generateDefaultSystemPrompt(external: UnifiedSkill): string {
    const kind = this.resolveKind(external);
    return `You are executing the "${external.name}" skill.

Description: ${external.description}

Follow these guidelines:
1. Understand the user's request clearly
2. Use the appropriate tools and context
3. Provide clear, actionable results
4. Handle errors gracefully

Skill metadata:
- Version: ${external.version}
- Invocation pattern: ${kind}
- Capability level: ${external.capabilityLevel}`;
  }

  /**
   * Generate default user prompt template if not provided
   */
  private generateDefaultUserPrompt(external: UnifiedSkill): string {
    return `Execute the following task using the "${external.name}" skill:

{userInput}

Context:
- Workspace files: {workspaceFiles}
- Additional context: {context}

Please provide a detailed response.`;
  }

  /**
   * Infer required tools based on invocation pattern and metadata
   */
  private inferRequiredTools(external: UnifiedSkill): string[] {
    const tools: string[] = [];
    const kind = this.resolveKind(external);

    // Based on invocation pattern
    switch (kind) {
      case 'prompt':
        // Prompt-based skills typically need basic tools
        tools.push('file_reader');
        break;

      case 'function':
        // Function-based skills might need code execution
        tools.push('code_executor', 'file_reader', 'file_writer');
        break;

      case 'workflow':
        // Workflow skills need orchestration tools
        tools.push('workflow_executor', 'file_reader', 'file_writer');
        break;

      case 'mcp':
        // MCP skills need MCP runtime
        tools.push('mcp_runtime');
        break;
    }

    // Based on category
    if (external.category) {
      const categoryTools: Record<string, string[]> = {
        development: ['file_writer', 'code_analyzer'],
        debugging: ['debugger', 'log_analyzer'],
        testing: ['test_runner'],
        devops: ['shell_executor', 'docker_client'],
        documentation: ['file_writer', 'markdown_renderer'],
      };

      const additionalTools = categoryTools[external.category.toLowerCase()];
      if (additionalTools) {
        tools.push(...additionalTools);
      }
    }

    return [...new Set(tools)]; // Deduplicate
  }

  /**
   * Convert JSON schema input schema to skill parameters
   */
  private convertInputSchema(external: UnifiedSkill): SkillParameter[] {
    if (!external.inputSchema) {
      return [];
    }

    const params: SkillParameter[] = [];
    const schema = external.inputSchema;

    // Handle JSON Schema properties
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const prop = propSchema as any;

        params.push({
          name: key,
          description: prop.description || `Parameter: ${key}`,
          required: Array.isArray(schema.required) && schema.required.includes(key),
          type: this.mapJsonSchemaType(prop.type),
          default: prop.default,
        });
      }
    }

    return params;
  }

  private resolveKind(external: UnifiedSkill): 'prompt' | 'function' | 'workflow' | 'mcp' {
    return external.kind ?? external.invocationPattern ?? 'prompt';
  }

  private normalizeRequiredTools(external: UnifiedSkill): string[] | undefined {
    if (!external.requiredTools) return undefined;
    return external.requiredTools.map((tool) => (typeof tool === 'string' ? tool : tool.name));
  }

  /**
   * Map JSON Schema type to skill parameter type
   */
  private mapJsonSchemaType(jsonType: string | undefined): SkillParameter['type'] {
    switch (jsonType) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return 'array';
      default:
        return 'string';
    }
  }
}

/**
 * Singleton instance
 */
let adapterInstance: ExternalSkillAdapter | null = null;

/**
 * Get the external skill adapter instance
 */
export function getExternalSkillAdapter(): ExternalSkillAdapter {
  if (!adapterInstance) {
    adapterInstance = new ExternalSkillAdapter();
  }
  return adapterInstance;
}
