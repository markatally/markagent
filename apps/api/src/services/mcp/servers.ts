/**
 * MCP Server Configurations
 * Default configurations for common MCP servers
 */

import type { MCPServerConfig } from './types';

/**
 * Default MCP server configurations
 * These can be overridden in config/default.json
 */
export const defaultMCPServers: MCPServerConfig[] = [
  {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    enabled: false,
  },
  {
    name: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}',
    },
    enabled: false,
  },
  {
    name: 'sqlite',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '/workspace/db.sqlite'],
    enabled: false,
  },
  {
    name: 'puppeteer',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    enabled: false,
  },
];

/**
 * Merge default configs with user configs
 */
export function mergeServerConfigs(
  userConfigs: MCPServerConfig[]
): MCPServerConfig[] {
  const merged = new Map<string, MCPServerConfig>();

  // Add defaults
  for (const config of defaultMCPServers) {
    merged.set(config.name, config);
  }

  // Override with user configs
  for (const config of userConfigs) {
    merged.set(config.name, config);
  }

  return Array.from(merged.values());
}

/**
 * Resolve environment variables in config
 */
export function resolveEnvVars(config: MCPServerConfig): MCPServerConfig {
  const resolved = { ...config };

  if (resolved.env) {
    resolved.env = Object.fromEntries(
      Object.entries(resolved.env).map(([key, value]) => {
        // Replace ${VAR_NAME} with environment variable value
        const resolvedValue = value.replace(/\$\{(\w+)\}/g, (_, varName) => {
          return process.env[varName] || '';
        });
        return [key, resolvedValue];
      })
    );
  }

  // Also resolve args
  if (resolved.args) {
    resolved.args = resolved.args.map((arg) =>
      arg.replace(/\$\{(\w+)\}/g, (_, varName) => {
        return process.env[varName] || '';
      })
    );
  }

  return resolved;
}
