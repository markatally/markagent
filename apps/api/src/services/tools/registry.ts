import type { Tool, ToolContext } from './types';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { FileReaderTool } from './file_reader';
import { FileWriterTool } from './file_writer';
import { BashExecutorTool } from './bash_executor';
import { bridgeAllMCPToolsSync } from '../mcp/bridge';

/**
 * Tool Registry
 * Manages available tools and converts them to LLM function calling format
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private mcpToolsLoaded = false;

  constructor(private context: ToolContext) {
    this.registerBuiltInTools();
  }

  /**
   * Register built-in tools
   */
  private registerBuiltInTools(): void {
    this.register(new FileReaderTool(this.context));
    this.register(new FileWriterTool(this.context));
    this.register(new BashExecutorTool(this.context));
  }

  /**
   * Register MCP tools (if available)
   * Should be called after MCP manager is initialized
   */
  registerMCPTools(): void {
    if (this.mcpToolsLoaded) return;

    try {
      const mcpTools = bridgeAllMCPToolsSync();
      for (const tool of mcpTools) {
        this.register(tool);
      }
      this.mcpToolsLoaded = true;
    } catch (error) {
      console.error('Failed to register MCP tools:', error);
    }
  }

  /**
   * Register a tool
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool
   */
  unregister(toolName: string): void {
    this.tools.delete(toolName);
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Convert tools to OpenAI function calling format
   */
  toOpenAIFunctions(toolNames?: string[]): ChatCompletionTool[] {
    const tools = toolNames
      ? toolNames.map((name) => this.tools.get(name)).filter((t): t is Tool => t !== undefined)
      : this.getAllTools();

    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Check if a tool requires user confirmation
   */
  requiresConfirmation(toolName: string): boolean {
    const tool = this.getTool(toolName);
    return tool?.requiresConfirmation ?? false;
  }

  /**
   * Get tool timeout
   */
  getTimeout(toolName: string): number {
    const tool = this.getTool(toolName);
    return tool?.timeout ?? 30000;
  }

  /**
   * Check if a tool is an MCP tool
   */
  isMCPTool(toolName: string): boolean {
    // Use the isMCPTool function from bridge
    const { isMCPTool } = require('../mcp/bridge');
    return isMCPTool(toolName);
  }
}

// Singleton instance per context
const registryCache = new Map<string, ToolRegistry>();

/**
 * Get or create tool registry for a session
 */
export function getToolRegistry(context: ToolContext): ToolRegistry {
  const cacheKey = context.sessionId;

  if (!registryCache.has(cacheKey)) {
    const registry = new ToolRegistry(context);
    // Try to load MCP tools
    registry.registerMCPTools();
    registryCache.set(cacheKey, registry);
  }

  return registryCache.get(cacheKey)!;
}

/**
 * Clear tool registry cache for a session
 */
export function clearToolRegistry(sessionId: string): void {
  registryCache.delete(sessionId);
}

/**
 * Refresh MCP tools in all registries
 * Call this after MCP manager is initialized
 */
export function refreshMCPToolsInAllRegistries(): void {
  for (const registry of registryCache.values()) {
    registry.registerMCPTools();
  }
}
