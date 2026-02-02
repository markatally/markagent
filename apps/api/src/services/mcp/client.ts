/**
 * MCP Client Manager
 * Manages connections to MCP servers and provides tool access
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import type {
  MCPServerConfig,
  MCPConfig,
  MCPToolDefinition,
  MCPToolResult,
  MCPConnectionStatus,
} from './types';
import { mergeServerConfigs, resolveEnvVars } from './servers';
import { getConfig } from '../config';

/**
 * MCP Client wrapper for a single server
 */
class MCPClientConnection {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: MCPToolDefinition[] = [];
  private connected = false;
  private error: string | null = null;
  private lastConnected: Date | null = null;

  constructor(
    private config: MCPServerConfig,
    private timeout: number
  ) {}

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    const resolvedConfig = resolveEnvVars(this.config);

    if (resolvedConfig.transport === 'stdio') {
      if (!resolvedConfig.command) {
        throw new Error(`MCP server ${this.config.name} missing command for stdio transport`);
      }

      // Create client
      this.client = new Client(
        {
          name: 'mark-agent',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      // Spawn the server process
      const serverProcess = spawn(resolvedConfig.command, resolvedConfig.args || [], {
        env: {
          ...process.env,
          ...resolvedConfig.env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Create transport
      this.transport = new StdioClientTransport({
        reader: serverProcess.stdout,
        writer: serverProcess.stdin,
      });

      // Connect with timeout
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), this.timeout)
      );

      try {
        await Promise.race([connectPromise, timeoutPromise]);
        this.connected = true;
        this.lastConnected = new Date();
        this.error = null;

        // Fetch available tools
        await this.refreshTools();
      } catch (error: any) {
        this.error = error.message;
        this.connected = false;
        throw error;
      }
    } else {
      throw new Error(`Transport ${resolvedConfig.transport} not yet supported`);
    }
  }

  /**
   * Refresh the list of available tools
   */
  async refreshTools(): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('Client not connected');
    }

    const response = await this.client.listTools();
    this.tools = response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as MCPToolDefinition['inputSchema'],
    }));
  }

  /**
   * Get available tools
   */
  getTools(): MCPToolDefinition[] {
    return this.tools;
  }

  /**
   * Execute a tool
   */
  async executeTool(toolName: string, params: Record<string, any>): Promise<MCPToolResult> {
    if (!this.client || !this.connected) {
      throw new Error('Client not connected');
    }

    const result = await this.client.callTool({
      name: toolName,
      arguments: params,
    });

    return {
      content: result.content as MCPToolResult['content'],
      isError: result.isError,
    };
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.client = null;
    this.connected = false;
  }

  /**
   * Get connection status
   */
  getStatus(): MCPConnectionStatus {
    return {
      serverName: this.config.name,
      connected: this.connected,
      toolCount: this.tools.length,
      error: this.error || undefined,
      lastConnected: this.lastConnected || undefined,
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get server name
   */
  getName(): string {
    return this.config.name;
  }
}

/**
 * MCP Client Manager
 * Manages multiple MCP server connections
 */
export class MCPClientManager {
  private connections: Map<string, MCPClientConnection> = new Map();
  private config: MCPConfig;

  constructor() {
    const appConfig = getConfig();
    // MCP config might not be in the config file yet, use defaults
    const mcpConfig = (appConfig as any).mcp || {
      enabled: false,
      servers: [],
      connectionTimeout: 10000,
      requestTimeout: 30000,
    };

    this.config = {
      enabled: mcpConfig.enabled,
      servers: mergeServerConfigs(mcpConfig.servers || []),
      connectionTimeout: mcpConfig.connectionTimeout,
      requestTimeout: mcpConfig.requestTimeout,
    };
  }

  /**
   * Check if MCP is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Initialize connections to all enabled servers
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    const enabledServers = this.config.servers.filter((s) => s.enabled);

    await Promise.all(
      enabledServers.map(async (serverConfig) => {
        const connection = new MCPClientConnection(
          serverConfig,
          this.config.connectionTimeout
        );

        try {
          await connection.connect();
          this.connections.set(serverConfig.name, connection);
          console.log(`MCP: Connected to ${serverConfig.name}`);
        } catch (error: any) {
          console.error(`MCP: Failed to connect to ${serverConfig.name}:`, error.message);
          // Store failed connection for status reporting
          this.connections.set(serverConfig.name, connection);
        }
      })
    );
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllTools(): Array<{ serverName: string; tool: MCPToolDefinition }> {
    const tools: Array<{ serverName: string; tool: MCPToolDefinition }> = [];

    for (const [serverName, connection] of this.connections) {
      if (connection.isConnected()) {
        for (const tool of connection.getTools()) {
          tools.push({ serverName, tool });
        }
      }
    }

    return tools;
  }

  /**
   * Execute a tool on a specific server
   */
  async executeTool(
    serverName: string,
    toolName: string,
    params: Record<string, any>
  ): Promise<MCPToolResult> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server ${serverName} not found`);
    }

    if (!connection.isConnected()) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    return connection.executeTool(toolName, params);
  }

  /**
   * Get connection status for all servers
   */
  getStatus(): MCPConnectionStatus[] {
    return Array.from(this.connections.values()).map((c) => c.getStatus());
  }

  /**
   * Get a specific server connection
   */
  getConnection(serverName: string): MCPClientConnection | undefined {
    return this.connections.get(serverName);
  }

  /**
   * Disconnect from all servers
   */
  async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.connections.values()).map((c) => c.disconnect())
    );
    this.connections.clear();
  }
}

// Singleton instance
let mcpManager: MCPClientManager | null = null;
let initializing = false;

/**
 * Get or create the MCP client manager
 */
export async function getMCPManager(): Promise<MCPClientManager> {
  if (!mcpManager) {
    mcpManager = new MCPClientManager();
    if (mcpManager.isEnabled() && !initializing) {
      initializing = true;
      await mcpManager.initialize();
      initializing = false;
    }
  }
  return mcpManager;
}

/**
 * Get MCP manager without initializing (for sync access)
 */
export function getMCPManagerSync(): MCPClientManager | null {
  return mcpManager;
}

// Cleanup on process exit
process.on('SIGTERM', async () => {
  if (mcpManager) {
    await mcpManager.shutdown();
  }
});

process.on('SIGINT', async () => {
  if (mcpManager) {
    await mcpManager.shutdown();
  }
});
