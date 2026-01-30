# CLAUDE.md

This file provides guidance for Claude Code when working with this repository.

## Session Management (CRITICAL - READ FIRST)

### On Every Session Start
```
1. READ PROGRESS.md immediately
2. Report current status to user
3. Ask if user wants to continue from where we left off
```

### Auto-Update PROGRESS.md When:
| Event | Action |
|-------|--------|
| Task completed | Mark task ✅, update status |
| New blocker found | Add to "Blocked By" section |
| Phase transition | Update "Active Phase" |
| Error/failure | Log in "Notes for Next Session" |
| User says "save/update/break/bye/done" | Full progress sync |

### Progress Update Format
When updating, always include:
- Timestamp
- What was accomplished
- What's next
- Any blockers

### Trigger Phrases (auto-update on these)
`save progress`, `update progress`, `ending session`, `taking a break`, `bye`, `done for now`, `pause`, `stop here`

## Project Overview

Manus Agent is an AI-powered autonomous agent that executes complex tasks through natural language interaction, tool usage, and code execution. It's a full-stack TypeScript monorepo using Bun.

## Technical Specification

**IMPORTANT:** The authoritative technical specification is in `.claude/SPEC.md` (~2400 lines).

When implementing features, consult SPEC.md for:

| Section | Lines | Content |
|---------|-------|---------|
| LLM Client Pattern | 37-93 | `LLMClient` class with `chat()` and `streamChat()` methods |
| Shared Type Definitions | 176-427 | All interfaces (Message, ToolCall, ToolResult, etc.) |
| Tool Definitions | 504-730 | Complete schemas for 9 built-in tools |
| MCP Integration | 752-784 | MCP client interface and server configs |
| SSE Event Types | 1147-1199 | Real-time streaming event definitions |
| Token Counter | 1858-1913 | Context window management with tiktoken |
| Configuration Schema | 1658-1732 | `AppConfig` interface for runtime config |
| Security Patterns | 1951-2087 | JWT, encryption, validation patterns |

**Rule:** Always check SPEC.md before implementing LLM, tools, streaming, or security features.

## Tech Stack

- **Runtime**: Bun 1.0+ (Node.js 20+ compatible)
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Hono + TypeScript + Prisma ORM
- **Database**: PostgreSQL 16+
- **Cache/Queue**: Redis 7+ + BullMQ
- **LLM**: OpenAI-compatible API (GLM-4.7 via jiekou.ai)
- **Monorepo**: Turborepo workspaces

## Project Structure

```
manus-agent/
├── apps/
│   ├── web/                    # React frontend (Vite)
│   │   └── src/
│   │       ├── components/     # React components (chat/, progress/, session/, ui/)
│   │       ├── hooks/          # Custom React hooks
│   │       ├── stores/         # Zustand stores
│   │       └── types/          # TypeScript types
│   └── api/                    # Hono backend
│       └── src/
│           ├── routes/         # API route handlers
│           ├── services/       # Business logic (llm/, tools/, sandbox/, mcp/, memory/)
│           ├── middleware/     # Auth, rate limiting
│           └── worker.ts       # Background job processor
├── packages/
│   └── shared/                 # Shared types and utilities
├── tests/                      # Test suite (unit + integration)
│   ├── unit/                   # Unit tests for services
│   ├── integration/            # Integration tests for API routes
│   └── fixtures/               # Test fixtures and mock data
├── skills/                     # [PRODUCT] Agent skills - TypeScript (31 slash commands)
├── .claude/skills/             # [DEV] Claude Code skills - SKILL.md guidance files
├── config/                     # Runtime configuration (default.json)
└── docker/                     # Docker files and sandbox images
```

## Important: Two Skill Systems

This repo has TWO different skill systems - do not confuse them:

| Directory | Purpose | Format | Used By |
|-----------|---------|--------|---------|
| `skills/` | Product features (slash commands for Manus Agent users) | TypeScript `.ts` | End users at runtime |
| `.claude/skills/` | Development guidance for coding on this project | SKILL.md | Claude Code (AI) at dev time |

- **`skills/*.ts`** = Source code for the Manus Agent product (e.g., `/code`, `/debug`)
- **`.claude/skills/*/SKILL.md`** = Instructions for Claude Code to help develop this codebase

## Common Commands

```bash
# Install dependencies
bun install

# Development
bun run dev          # Start both frontend and backend
bun run dev:web      # Frontend only (http://localhost:3000)
bun run dev:api      # Backend only (http://localhost:4000)
bun run worker       # Background worker

# Database
bun run db:migrate   # Run Prisma migrations
bun run db:studio    # Open Prisma Studio
bun run db:generate  # Generate Prisma client

# Build and test
bun run build
bun run test                      # Run all tests from tests/ folder
bun test tests/unit/              # Run unit tests only
bun test tests/integration/       # Run integration tests only
bun test tests/unit/auth.test.ts  # Run specific test file
bun run lint

# Docker
docker-compose up -d db redis  # Start infrastructure
docker-compose up -d           # Start all services
```

## Coding Conventions

### TypeScript
- Strict TypeScript throughout
- Prefer interfaces over types for object shapes
- Export shared types from `packages/shared/src/types/`
- Use Zod for runtime validation

### React (apps/web)
- Functional components with hooks
- State management: Zustand
- UI components: shadcn/ui
- Styling: Tailwind CSS utilities
- Server state: @tanstack/react-query

### Backend (apps/api)
- Routing: Hono
- Database: Prisma
- Queue: BullMQ
- Logging: Pino
- Real-time: SSE (not WebSocket)

### File Naming
- Components: `PascalCase.tsx`
- Utilities/hooks: `camelCase.ts`
- Types: `types.ts` or `index.ts`
- Skills: `kebab-case.ts`

## Key Patterns

### LLM Integration
```typescript
import { OpenAI } from 'openai';
const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: config.llm.baseUrl,
});
```

### Tool Definition
```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(params: Record<string, any>): Promise<ToolResult>;
  requiresConfirmation: boolean;
  timeout: number;
}
```

### Skill Definition
```typescript
interface Skill {
  name: string;
  description: string;
  aliases: string[];
  category: SkillCategory;
  systemPrompt: string;
  userPromptTemplate: string;
  requiredTools: string[];
}
```

## Architecture

### API Endpoints
- `POST /api/auth/register|login|refresh` - Authentication
- `GET|POST|DELETE /api/sessions` - Session management
- `POST /api/sessions/:id/messages` - Send message
- `GET /api/sessions/:id/stream` - SSE real-time updates
- `POST /api/sessions/:id/files` - File upload
- `POST /api/sessions/:id/cancel|approve|reject` - Execution control

### SSE Event Types
`message.start|delta|complete`, `thinking.start|delta|complete`, `tool.start|progress|complete|error`, `plan.created`, `approval.required`, `file.created|modified|deleted`

### Sandbox
- Docker containers with resource limits (512MB RAM, 1 CPU, 1GB disk)
- Network disabled by default
- Isolated per-session workspace at `/workspace`

### Authentication
- JWT tokens (15min access, 7day refresh)
- Passwords: bcrypt
- API keys: AES-256-GCM encrypted

## Environment Variables

**Required:**
- `LLM_API_KEY` - LLM provider API key
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - 256-bit secret for JWT
- `ENCRYPTION_KEY` - 32-byte hex key for encryption

**Optional:**
- `LLM_BASE_URL` - Override LLM base URL
- `LLM_MODEL` - Override LLM model
- `CONFIG_PATH` - Config file path (default: ./config/default.json)
- `ALLOWED_ORIGINS` - CORS origins

## Skills (31 total)

| Category | Skills |
|----------|--------|
| development | /code, /refactor, /review, /api, /prompt, /tool, /auth, /component |
| debugging | /debug, /fix |
| testing | /test, /coverage |
| devops | /deploy, /docker, /git, /migrate, /ci, /env, /monitor |
| documentation | /docs, /api-docs, /changelog |
| analysis | /analyze, /security |
| web | /scrape, /search |
| data | /data, /sql |
| integration | /mcp |
| planning | /plan, /architect |

## Common Tasks

### Adding a new skill
1. Create `skills/<category>/<skill-name>.ts`
2. Export Skill object with required properties
3. Register in `skills/index.ts`

### Adding a new tool
1. Define in `apps/api/src/services/tools/`
2. Add to tool registry
3. Include schema for LLM function calling

### Adding a new API endpoint
1. Create handler in `apps/api/src/routes/`
2. Add Zod validation
3. Register in main router

### Writing tests
1. **Create test file in `tests/`:**
   - Unit tests: `tests/unit/<feature>.test.ts`
   - Integration tests: `tests/integration/<route>.test.ts`
2. **Import from source code:**
   ```typescript
   import { service } from '../../apps/api/src/services/service';
   import { route } from '../../apps/api/src/routes/route';
   ```
3. **Follow test structure:**
   ```typescript
   describe('Feature Name', () => {
     beforeAll(async () => { /* Setup */ });
     afterAll(async () => { /* Cleanup */ });

     it('should do something', () => {
       // Test implementation
     });
   });
   ```
4. **Run tests:** `bun run test` or `bun test tests/unit/my-test.test.ts`
5. **See `tests/README.md` for detailed guidelines**

## Security

- All inputs validated with Zod
- Sandbox: restricted privileges, no network by default
- Dangerous operations require user approval
- API keys stored encrypted
- Security headers: CSP, X-Frame-Options, etc.

## Key Files

- `.claude/SPEC.md` - **Authoritative technical specification** (implementation patterns)
- `config/default.json` - Runtime configuration
- `apps/api/prisma/schema.prisma` - Database schema
- `packages/shared/src/index.ts` - Shared TypeScript types (290 lines)
- `skills/index.ts` - Agent skill registry (product features)
- `docker-compose.yml` - Infrastructure definition
- `SKILL.md` - Claude Code development guidance
- `.claude/skills/` - Specialized Claude Code skills (api-development, mcp-integration, etc.)
- `tests/` - **Test suite** (97 tests: unit + integration)
- `tests/README.md` - Test documentation and guidelines
- `apps/api/TEST_RESULTS.md` - Test results and bug fixes
