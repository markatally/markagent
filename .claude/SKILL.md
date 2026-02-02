---
name: mark-agent
description: Guide for developing and extending the Mark Agent - an AI-powered autonomous agent with tool execution, MCP integration, and sandbox capabilities. Use this skill when working on agent features, adding skills/tools, implementing API endpoints, or debugging the agent system.
---

# Mark Agent Development

This skill provides specialized guidance for developing and extending the Mark Agent codebase.

## Project Context

Mark Agent is a full-stack TypeScript monorepo that implements an autonomous AI agent with:
- Natural language task execution
- Tool calling and code execution
- MCP (Model Context Protocol) integration
- Docker sandbox isolation
- Real-time streaming via SSE

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│     LLM     │
│  (React)    │ SSE │   (Hono)    │     │  (GLM-4.7)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │  Tools  │  │   MCP   │  │ Sandbox │
        └─────────┘  └─────────┘  └─────────┘
```

## Development Workflows

### Adding a New Agent Skill

Agent skills are slash commands that provide specialized prompts for common tasks.

1. **Create skill file** in `skills/<category>/<skill-name>.ts`:
```typescript
import { Skill } from '../types';

export const mySkill: Skill = {
  name: 'my-skill',
  description: 'What this skill does',
  aliases: ['/alias1', '/alias2'],
  category: 'development',
  systemPrompt: `You are an expert in...`,
  userPromptTemplate: `Task: {task}\nContext: {context}`,
  requiredTools: ['file_reader', 'file_writer'],
};
```

2. **Register** in `skills/index.ts`:
```typescript
import { mySkill } from './development/my-skill';
export const skills = [...existingSkills, mySkill];
```

### Adding a New Tool

Tools are functions the agent can call during execution.

1. **Define tool** in `apps/api/src/services/tools/<tool-name>.ts`:
```typescript
import { Tool, ToolResult } from '../../types';

export const myTool: Tool = {
  name: 'my_tool',
  description: 'Clear description for LLM',
  requiresConfirmation: false,
  timeout: 30000,
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '...' },
    },
    required: ['param1'],
  },
  async execute(params): Promise<ToolResult> {
    // Implementation
    return { success: true, output: 'Result', duration: 0 };
  },
};
```

2. **Register** in tool registry and include in LLM function calling.

### Adding an API Endpoint

1. **Create route handler** in `apps/api/src/routes/<resource>.ts`:
```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

const schema = z.object({ /* validation */ });

export const myRoute = new Hono()
  .post('/', zValidator('json', schema), async (c) => {
    const data = c.req.valid('json');
    // Implementation
    return c.json({ success: true });
  });
```

2. **Register** in main router at `apps/api/src/index.ts`.

### Implementing SSE Streaming

For real-time updates, use Server-Sent Events:

```typescript
// Backend
app.get('/api/sessions/:id/stream', async (c) => {
  return streamSSE(c, async (stream) => {
    const emitter = getSessionEmitter(c.req.param('id'));

    emitter.on('event', async (data) => {
      await stream.writeSSE({
        event: data.type,
        data: JSON.stringify(data),
      });
    });
  });
});

// Frontend
const eventSource = new EventSource(`/api/sessions/${id}/stream`);
eventSource.addEventListener('message.delta', (e) => {
  const data = JSON.parse(e.data);
  // Handle streaming content
});
```

### Working with the Sandbox

Docker sandbox provides isolated code execution:

```typescript
import Docker from 'dockerode';

const docker = new Docker();

async function executeInSandbox(sessionId: string, code: string) {
  const container = await docker.createContainer({
    Image: 'python:3.11-slim',
    Cmd: ['python', '-c', code],
    HostConfig: {
      Memory: 512 * 1024 * 1024,
      NetworkMode: 'none',
      Binds: [`/tmp/workspaces/${sessionId}:/workspace`],
    },
  });

  await container.start();
  const output = await container.logs({ stdout: true, stderr: true });
  await container.remove();

  return output.toString();
}
```

## Code Patterns

### LLM Integration Pattern

Always use the OpenAI-compatible client:

```typescript
import { OpenAI } from 'openai';

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: config.llm.baseUrl,
});

// With streaming
const stream = await client.chat.completions.create({
  model: config.llm.model,
  messages,
  tools: toolDefinitions,
  stream: true,
});

for await (const chunk of stream) {
  // Process streaming chunks
}
```

### Error Handling Pattern

```typescript
import { ErrorCodes } from '@mark/shared';

try {
  // Operation
} catch (error) {
  if (error instanceof ToolExecutionError) {
    return {
      success: false,
      error: ErrorCodes.TOOL_EXECUTION_FAILED,
      message: formatUserError(error),
    };
  }
  throw error;
}
```

### Database Pattern (Prisma)

```typescript
import { prisma } from '../lib/prisma';

// Always use transactions for related operations
await prisma.$transaction(async (tx) => {
  const session = await tx.session.create({ data: {...} });
  await tx.message.create({ data: { sessionId: session.id, ...} });
  return session;
});
```

## Testing Guidelines

### Unit Tests (Vitest)

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('MyTool', () => {
  it('should execute successfully', async () => {
    const result = await myTool.execute({ param1: 'value' });
    expect(result.success).toBe(true);
  });
});
```

### Testing Tools

```bash
# Run all tests
bun run test

# Run specific test file
bun run test src/services/tools/my-tool.test.ts

# Watch mode
bun run test --watch
```

## Security Checklist

When implementing new features, verify:

- [ ] All user inputs validated with Zod
- [ ] No sensitive data in logs (use Pino redaction)
- [ ] Sandbox operations have timeouts
- [ ] File operations restricted to workspace
- [ ] API endpoints have proper authentication
- [ ] Tool confirmations for destructive operations

## Common Issues & Solutions

### Issue: SSE connection drops
**Solution**: Ensure nginx/proxy has buffering disabled for SSE endpoints.

### Issue: Sandbox timeout
**Solution**: Check container resource limits and increase timeout in tool config.

### Issue: Context window exceeded
**Solution**: Use the TokenCounter utility to truncate messages appropriately.

### Issue: Tool execution fails silently
**Solution**: Always wrap tool execution in try-catch and return structured errors.

## Key Files Reference

| File | Purpose |
|------|---------|
| `apps/api/src/services/llm/client.ts` | LLM client implementation |
| `apps/api/src/services/tools/registry.ts` | Tool registration |
| `apps/api/src/services/sandbox/manager.ts` | Docker sandbox management |
| `apps/api/src/services/mcp/client.ts` | MCP protocol client |
| `skills/index.ts` | Agent skill registry |
| `packages/shared/src/types/index.ts` | Shared type definitions |
| `config/default.json` | Runtime configuration |
