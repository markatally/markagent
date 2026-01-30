import { describe, it, expect, beforeAll } from 'bun:test';
import path from 'path';

// Set CONFIG_PATH for tests if not already set
if (!process.env.CONFIG_PATH) {
  process.env.CONFIG_PATH = path.join(process.cwd(), 'config/default.json');
}

// Import after setting CONFIG_PATH
import {
  MCPClientManager,
  getMCPManagerSync,
  mergeServerConfigs,
  resolveEnvVars,
  defaultMCPServers,
  isMCPTool,
  parseMCPToolName,
} from '../../apps/api/src/services/mcp';
import type { MCPServerConfig, MCPToolDefinition } from '../../apps/api/src/services/mcp/types';

describe('Phase 6.3: MCP Client Integration', () => {
  describe('MCP Server Configuration', () => {
    it('should have default MCP servers defined', () => {
      expect(Array.isArray(defaultMCPServers)).toBe(true);
      expect(defaultMCPServers.length).toBeGreaterThan(0);
    });

    it('should have filesystem server in defaults', () => {
      const filesystem = defaultMCPServers.find((s) => s.name === 'filesystem');
      expect(filesystem).toBeDefined();
      expect(filesystem?.transport).toBe('stdio');
      expect(filesystem?.command).toBe('npx');
    });

    it('should merge user configs with defaults', () => {
      const userConfigs: MCPServerConfig[] = [
        {
          name: 'filesystem',
          transport: 'stdio',
          command: 'custom-cmd',
          args: ['custom-arg'],
          enabled: true,
        },
        {
          name: 'custom-server',
          transport: 'stdio',
          command: 'custom',
          enabled: true,
        },
      ];

      const merged = mergeServerConfigs(userConfigs);

      // Should override filesystem
      const filesystem = merged.find((s) => s.name === 'filesystem');
      expect(filesystem?.command).toBe('custom-cmd');
      expect(filesystem?.enabled).toBe(true);

      // Should add custom server
      const custom = merged.find((s) => s.name === 'custom-server');
      expect(custom).toBeDefined();
    });

    it('should resolve environment variables in config', () => {
      process.env.TEST_TOKEN = 'secret123';

      const config: MCPServerConfig = {
        name: 'test',
        transport: 'stdio',
        command: 'test',
        args: ['--workspace', '${WORKSPACE_DIR}'],
        env: {
          TOKEN: '${TEST_TOKEN}',
        },
        enabled: true,
      };

      const resolved = resolveEnvVars(config);

      expect(resolved.env?.TOKEN).toBe('secret123');

      delete process.env.TEST_TOKEN;
    });

    it('should handle missing env vars gracefully', () => {
      const config: MCPServerConfig = {
        name: 'test',
        transport: 'stdio',
        command: 'test',
        env: {
          MISSING: '${NONEXISTENT_VAR}',
        },
        enabled: true,
      };

      const resolved = resolveEnvVars(config);
      expect(resolved.env?.MISSING).toBe('');
    });
  });

  describe('MCPClientManager', () => {
    it('should create manager instance', () => {
      const manager = new MCPClientManager();
      expect(manager).toBeDefined();
    });

    it('should report enabled status', () => {
      const manager = new MCPClientManager();
      const isEnabled = manager.isEnabled();
      // Config has mcp.enabled = false by default
      expect(typeof isEnabled).toBe('boolean');
    });

    it('should have initialize method', () => {
      const manager = new MCPClientManager();
      expect(typeof manager.initialize).toBe('function');
    });

    it('should have getAllTools method', () => {
      const manager = new MCPClientManager();
      expect(typeof manager.getAllTools).toBe('function');

      // When not connected, should return empty array
      const tools = manager.getAllTools();
      expect(Array.isArray(tools)).toBe(true);
    });

    it('should have executeTool method', () => {
      const manager = new MCPClientManager();
      expect(typeof manager.executeTool).toBe('function');
    });

    it('should have getStatus method', () => {
      const manager = new MCPClientManager();
      expect(typeof manager.getStatus).toBe('function');

      const status = manager.getStatus();
      expect(Array.isArray(status)).toBe(true);
    });

    it('should have shutdown method', () => {
      const manager = new MCPClientManager();
      expect(typeof manager.shutdown).toBe('function');
    });
  });

  describe('MCP Tool Bridging', () => {
    it('should detect MCP tool names', () => {
      expect(isMCPTool('filesystem_read_file')).toBe(true);
      expect(isMCPTool('github_create_issue')).toBe(true);
      expect(isMCPTool('sqlite_query')).toBe(true);
    });

    it('should not detect built-in tools as MCP tools', () => {
      expect(isMCPTool('file_reader')).toBe(false);
      expect(isMCPTool('file_writer')).toBe(false);
      expect(isMCPTool('bash_executor')).toBe(false);
    });

    it('should parse MCP tool names correctly', () => {
      const result = parseMCPToolName('filesystem_read_file');
      expect(result).toEqual({
        serverName: 'filesystem',
        toolName: 'read_file',
      });
    });

    it('should parse multi-underscore tool names', () => {
      const result = parseMCPToolName('github_create_pull_request');
      expect(result).toEqual({
        serverName: 'github',
        toolName: 'create_pull_request',
      });
    });

    it('should return null for invalid tool names', () => {
      const result = parseMCPToolName('notamcptool');
      expect(result).toBeNull();
    });
  });

  describe('MCPToolDefinition', () => {
    it('should have correct structure', () => {
      const mockTool: MCPToolDefinition = {
        name: 'read_file',
        description: 'Read a file from the filesystem',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      };

      expect(mockTool.name).toBe('read_file');
      expect(mockTool.inputSchema.type).toBe('object');
      expect(mockTool.inputSchema.properties?.path).toBeDefined();
    });
  });

  describe('MCPToolResult', () => {
    it('should support text content', () => {
      const result = {
        content: [{ type: 'text', text: 'File contents here' }],
        isError: false,
      };

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('File contents here');
      expect(result.isError).toBe(false);
    });

    it('should support error results', () => {
      const result = {
        content: [{ type: 'text', text: 'Error: File not found' }],
        isError: true,
      };

      expect(result.isError).toBe(true);
    });

    it('should support image content', () => {
      const result = {
        content: [
          {
            type: 'image',
            data: 'base64encodeddata',
            mimeType: 'image/png',
          },
        ],
      };

      expect(result.content[0].type).toBe('image');
      expect(result.content[0].mimeType).toBe('image/png');
    });
  });
});
