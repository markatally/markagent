---
name: mcp-integration
description: Guide for implementing and extending MCP (Model Context Protocol) integrations in Mark Agent. Use when adding new MCP servers, implementing MCP tools, or debugging MCP connections.
---

# MCP Integration Development

This skill provides guidance for working with MCP (Model Context Protocol) in the Mark Agent.

## Overview

MCP enables the agent to interact with external services through standardized tools and resources. The Mark Agent supports multiple MCP server connections.

## MCP Architecture

```
┌─────────────────┐
│   Mark Agent   │
│   (MCP Client)  │
└────────┬────────┘
         │ JSON-RPC
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌───────┐ ┌───────┐ ┌──────────┐
│GitHub │ │ File  │ │ Database │
│Server │ │System │ │  Server  │
└───────┘ └───────┘ └──────────┘
```

## Four-Phase Development Process

### Phase 1: Research & Planning

Before implementing an MCP server:

1. **Study the target API** - Understand endpoints, authentication, rate limits
2. **Review MCP protocol** - Reference `modelcontextprotocol.io` for specs
3. **Plan tool design** - Balance API coverage with workflow-oriented tools
4. **Identify resources** - What data should be exposed as MCP resources

### Phase 2: Implementation

#### Server Configuration

Define MCP servers in `apps/api/src/services/mcp/servers.ts`:

```typescript
import { MCPServerConfig } from '@mark/shared';

export const mcpServers: MCPServerConfig[] = [
  {
    name: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN },
  },
  {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
  },
];
```

#### MCP Client Implementation

```typescript
// apps/api/src/services/mcp/client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class MCPClient {
  private clients: Map<string, Client> = new Map();

  async connect(config: MCPServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });

    const client = new Client({ name: 'mark-agent', version: '1.0.0' });
    await client.connect(transport);

    this.clients.set(config.name, client);
  }

  async listTools(serverName: string): Promise<MCPTool[]> {
    const client = this.clients.get(serverName);
    const { tools } = await client.listTools();
    return tools;
  }

  async callTool(serverName: string, name: string, args: any): Promise<any> {
    const client = this.clients.get(serverName);
    return client.callTool({ name, arguments: args });
  }

  async listResources(serverName: string): Promise<Resource[]> {
    const client = this.clients.get(serverName);
    const { resources } = await client.listResources();
    return resources;
  }

  async readResource(serverName: string, uri: string): Promise<string> {
    const client = this.clients.get(serverName);
    const { contents } = await client.readResource({ uri });
    return contents[0].text;
  }
}
```

#### Tool Design Principles

1. **Clear naming** - Use action-oriented names: `github_create_issue`, not `issue`
2. **Focused responses** - Return only relevant data, not entire API responses
3. **Actionable errors** - Include fix suggestions in error messages
4. **Pagination support** - Handle large datasets efficiently

```typescript
// Good tool design
const tool: MCPTool = {
  name: 'github_list_issues',
  description: 'List issues in a repository with optional filtering',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
      limit: { type: 'number', default: 10, maximum: 100 },
    },
    required: ['owner', 'repo'],
  },
};
```

### Phase 3: Integration

Bridge MCP tools with the agent's tool system:

```typescript
// apps/api/src/services/tools/mcp-bridge.ts
export async function bridgeMCPTools(mcpClient: MCPClient): Promise<Tool[]> {
  const tools: Tool[] = [];

  for (const [serverName, client] of mcpClient.clients) {
    const mcpTools = await mcpClient.listTools(serverName);

    for (const mcpTool of mcpTools) {
      tools.push({
        name: `${serverName}_${mcpTool.name}`,
        description: mcpTool.description,
        inputSchema: mcpTool.inputSchema,
        requiresConfirmation: isDestructive(mcpTool),
        timeout: 30000,
        async execute(params) {
          const result = await mcpClient.callTool(serverName, mcpTool.name, params);
          return { success: true, output: JSON.stringify(result), duration: 0 };
        },
      });
    }
  }

  return tools;
}
```

### Phase 4: Testing

Test MCP integrations with the MCP Inspector:

```bash
# Install MCP Inspector
npx @modelcontextprotocol/inspector

# Test a server
npx @modelcontextprotocol/inspector npx -y @modelcontextprotocol/server-github
```

## Supported MCP Servers

| Server | Purpose | Package |
|--------|---------|---------|
| filesystem | Local file access | `@modelcontextprotocol/server-filesystem` |
| github | GitHub API | `@modelcontextprotocol/server-github` |
| postgres | PostgreSQL queries | `@modelcontextprotocol/server-postgres` |
| slack | Slack messaging | `@modelcontextprotocol/server-slack` |
| google-drive | Drive files | `@anthropic/server-google-drive` |

## Error Handling

```typescript
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

try {
  await mcpClient.callTool(server, tool, args);
} catch (error) {
  if (error instanceof McpError) {
    switch (error.code) {
      case ErrorCode.MethodNotFound:
        return { error: `Tool '${tool}' not found on server '${server}'` };
      case ErrorCode.InvalidParams:
        return { error: `Invalid parameters: ${error.message}` };
      default:
        return { error: `MCP error: ${error.message}` };
    }
  }
  throw error;
}
```

## Resources

- MCP Protocol Spec: https://modelcontextprotocol.io
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Official MCP Servers: https://github.com/modelcontextprotocol/servers
