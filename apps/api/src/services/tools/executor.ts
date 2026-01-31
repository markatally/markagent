import type { Tool, ToolResult, ToolExecutionError } from './types';
import { getToolRegistry } from './registry';
import type { ToolContext } from './types';

/**
 * Tool Executor
 * Executes tools with timeout and error handling
 */
export class ToolExecutor {
  constructor(private context: ToolContext) {}

  /**
   * Execute a tool by name with given parameters
   */
  async execute(
    toolName: string,
    params: Record<string, any>,
    options?: ToolExecutionOptions
  ): Promise<ToolResult> {
    const registry = getToolRegistry(this.context);
    const tool = registry.getTool(toolName);

    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool not found: ${toolName}`,
        duration: 0,
      };
    }

    const startTime = Date.now();

    try {
      // Execute tool with timeout and optional progress callback
      const result = await this.executeWithTimeout(
        tool,
        params,
        tool.timeout,
        options?.onProgress
      );
      return result;
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : 'Tool execution failed',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeParallel(
    tools: Array<{ name: string; params: Record<string, any>; options?: ToolExecutionOptions }>
  ): Promise<ToolResult[]> {
    const promises = tools.map(({ name, params, options }) => this.execute(name, params, options));
    return Promise.all(promises);
  }

  /**
   * Execute multiple tools sequentially
   */
  async executeSequential(
    tools: Array<{ name: string; params: Record<string, any>; options?: ToolExecutionOptions }>
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const { name, params, options } of tools) {
      const result = await this.execute(name, params, options);
      results.push(result);

      // Stop on first failure if configured
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute tool with timeout
   */
  private async executeWithTimeout(
    tool: Tool,
    params: Record<string, any>,
    timeoutMs: number,
    onProgress?: ProgressCallback
  ): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      tool
        .execute(params, onProgress)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Validate tool parameters against schema
   */
  validateParams(toolName: string, params: Record<string, any>): { valid: boolean; errors: string[] } {
    const registry = getToolRegistry(this.context);
    const tool = registry.getTool(toolName);

    if (!tool) {
      return {
        valid: false,
        errors: [`Tool not found: ${toolName}`],
      };
    }

    const errors: string[] = [];
    const schema = tool.inputSchema;

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in params)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Basic type checking (simplified - could use a full JSON schema validator)
    if (schema.properties) {
      for (const [key, value] of Object.entries(params)) {
        if (!(key in schema.properties)) {
          errors.push(`Unknown field: ${key}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Get or create tool executor for a session
 */
export function getToolExecutor(context: ToolContext): ToolExecutor {
  return new ToolExecutor(context);
}
