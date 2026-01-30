/**
 * MCP Service Types
 * Types for Model Context Protocol integration
 */

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // For SSE transport
  enabled: boolean;
}

/**
 * MCP configuration from config file
 */
export interface MCPConfig {
  enabled: boolean;
  servers: MCPServerConfig[];
  connectionTimeout: number;
  requestTimeout: number;
}

/**
 * MCP tool definition (from MCP SDK)
 */
export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * MCP tool execution result
 */
export interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * Connection status for an MCP server
 */
export interface MCPConnectionStatus {
  serverName: string;
  connected: boolean;
  toolCount: number;
  error?: string;
  lastConnected?: Date;
}
