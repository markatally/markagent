/**
 * MCP Tool Bridge
 * Bridges MCP tools to the native Tool interface
 */

import type { Tool, ToolResult, ToolContext } from '../tools/types';
import { getMCPManager, getMCPManagerSync, MCPClientManager } from './client';
import type { MCPToolDefinition, MCPToolResult } from './types';

/**
 * Create a bridged tool from an MCP tool definition
 */
function createBridgedTool(
  serverName: string,
  mcpTool: MCPToolDefinition,
  manager: MCPClientManager
): Tool {
  // Create unique tool name: {serverName}_{toolName}
  const bridgedName = `${serverName}_${mcpTool.name}`;

  return {
    name: bridgedName,
    description: mcpTool.description || `MCP tool: ${mcpTool.name} from ${serverName}`,
    requiresConfirmation: false, // MCP tools manage their own safety
    timeout: 30000,

    inputSchema: {
      type: 'object' as const,
      properties: mcpTool.inputSchema.properties || {},
      required: mcpTool.inputSchema.required || [],
    },

    execute: async (params: Record<string, any>): Promise<ToolResult> => {
      const startTime = Date.now();

      try {
        const result = await manager.executeTool(serverName, mcpTool.name, params);

        // Convert MCP result to ToolResult format
        const output = formatMCPResult(result);

        return {
          success: !result.isError,
          output,
          error: result.isError ? output : undefined,
          duration: Date.now() - startTime,
        };
      } catch (error: any) {
        return {
          success: false,
          output: '',
          error: error.message || 'MCP tool execution failed',
          duration: Date.now() - startTime,
        };
      }
    },
  };
}

/**
 * Format MCP result content to string
 */
function formatMCPResult(result: MCPToolResult): string {
  if (!result.content || result.content.length === 0) {
    return '(no output)';
  }

  return result.content
    .map((item) => {
      if (item.type === 'text' && item.text) {
        return item.text;
      }
      if (item.type === 'image' && item.data) {
        return `[Image: ${item.mimeType || 'unknown type'}]`;
      }
      if (item.type === 'resource') {
        return `[Resource: ${JSON.stringify(item)}]`;
      }
      return JSON.stringify(item);
    })
    .join('\n');
}

/**
 * Bridge all MCP tools from all connected servers
 * Returns an array of Tool objects that can be registered with the tool registry
 */
export async function bridgeAllMCPTools(context: ToolContext): Promise<Tool[]> {
  const manager = await getMCPManager();

  if (!manager.isEnabled()) {
    return [];
  }

  const mcpTools = manager.getAllTools();
  return mcpTools.map(({ serverName, tool }) =>
    createBridgedTool(serverName, tool, manager)
  );
}

/**
 * Bridge MCP tools synchronously (for cases where async isn't possible)
 * Returns empty array if manager not initialized
 */
export function bridgeAllMCPToolsSync(): Tool[] {
  const manager = getMCPManagerSync();

  if (!manager || !manager.isEnabled()) {
    return [];
  }

  const mcpTools = manager.getAllTools();
  return mcpTools.map(({ serverName, tool }) =>
    createBridgedTool(serverName, tool, manager)
  );
}

/**
 * Get list of available MCP tool names
 */
export async function getMCPToolNames(): Promise<string[]> {
  const manager = await getMCPManager();

  if (!manager.isEnabled()) {
    return [];
  }

  return manager.getAllTools().map(
    ({ serverName, tool }) => `${serverName}_${tool.name}`
  );
}

// Built-in tool names that contain underscores (not MCP tools)
const BUILTIN_TOOLS = new Set([
  'file_reader',
  'file_writer',
  'bash_executor',
  'python_executor',
  'paper_search',
  'web_search',
  'web_scraper',
  'code_analyzer',
  'test_runner',
  'git_operations',
]);

/**
 * Check if a tool name is an MCP tool
 */
export function isMCPTool(toolName: string): boolean {
  // MCP tools have format: {serverName}_{toolName}
  // But built-in tools also have underscores, so check explicitly
  return toolName.includes('_') && !BUILTIN_TOOLS.has(toolName);
}

/**
 * Parse MCP tool name into server and tool names
 */
export function parseMCPToolName(
  bridgedName: string
): { serverName: string; toolName: string } | null {
  const underscoreIndex = bridgedName.indexOf('_');
  if (underscoreIndex === -1) {
    return null;
  }

  return {
    serverName: bridgedName.substring(0, underscoreIndex),
    toolName: bridgedName.substring(underscoreIndex + 1),
  };
}
