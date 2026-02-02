# PROGRESS.md

**Purpose:** Single source of truth for execution state. Update on every significant change.

---

## Current Status

| Field | Value |
|-------|-------|
| **Last Updated** | 2026-02-02 |
| **Active Phase** | Phase 7 - LangGraph Integration |
| **Status** | ✅ Core Integration Complete |
| **Blocked By** | None |

### Quick Summary

The Mark Agent is a **complete full-stack AI agent system** with:
- ✅ Authentication & session management
- ✅ LLM integration with streaming (GLM-4.7)
- ✅ Tool system (file_reader, file_writer, bash_executor, ppt_generator, web_search)
- ✅ Docker sandbox for isolated code execution
- ✅ MCP client integration
- ✅ 31 agent skills (slash commands)
- ✅ React frontend with real-time SSE streaming
- ✅ 217 tests passing (unit + integration)

**Latest Architecture Addition:** LangGraph-based orchestration system designed and implemented (not yet integrated into main flow).

---

## Active Focus

### Phase 7: LangGraph Integration

**Goal:** Integrate the LangGraph orchestration system into the existing codebase incrementally, without breaking current functionality.

**New Components Created:**
| Component | Location | Status |
|-----------|----------|--------|
| Type definitions | `apps/api/src/services/langgraph/types.ts` | ✅ Complete |
| Skill registry | `apps/api/src/services/langgraph/skills.ts` | ✅ Complete |
| Graph nodes | `apps/api/src/services/langgraph/nodes.ts` | ✅ Complete |
| Graph executor | `apps/api/src/services/langgraph/graphs.ts` | ✅ Complete |
| Validation rules | `apps/api/src/services/langgraph/validation.ts` | ✅ Complete |
| Architecture docs | `docs/LANGGRAPH_ARCHITECTURE.md` | ✅ Complete |

**Integration Status:**
| Task | Status | Notes |
|------|--------|-------|
| LangGraph module structure | ✅ | Clean exports via index.ts |
| Research scenario skills | ✅ | PaperDiscovery, Summarize, Compare, Synthesis |
| Validation framework | ✅ | Hard constraints enforced |
| Wire into stream.ts | ✅ | New `/agent` endpoint added (backward compatible) |
| Frontend progress display | ⏳ | Show graph execution |
| End-to-end testing | ⏳ | After frontend update |

---

## Next Steps (Executable Plan)

### Immediate (This Session) - COMPLETED ✅

1. ~~**Wire LangGraph into stream.ts** (non-breaking)~~ ✅
   - Added new route: `POST /api/sessions/:id/agent` for graph-based execution
   - Existing `POST /api/sessions/:id/chat` unchanged (backward compatible)
   - AgentRouter integrates with existing tools and LLM client

2. ~~**Add intent detection**~~ ✅
   - IntentParsingNode classifies user prompts
   - Routes to appropriate scenario graph based on classification

### Short-Term (Next Sessions)

3. **Test research flow end-to-end**
   - Verify paper discovery with web_search tool
   - Verify claim synthesis with citation validation
   - Test validation gates (minimum 3 papers)

4. **Frontend integration**
   - Add API client method for `/agent` endpoint
   - Display graph execution progress (node-by-node)
   - Show validation results and errors
   - Handle `agent.node` and `agent.error` SSE events

5. **Implement remaining scenario nodes**
   - PPT: OutlineGeneration, SlideContent, PPTExport nodes
   - Summary: ContentChunk, KeyExtract, SummaryGenerate nodes

### Medium-Term

6. **Add checkpoint/resume capability**
   - Save graph state to database
   - Allow resumption from checkpoints

7. **Performance optimization**
   - Parallel node execution where safe
   - Caching for repeated operations

8. **Additional scenario graphs**
   - Code review graph
   - Documentation generation graph

---

## Implementation Status

### Backend (`apps/api/`)

| Feature | Status | Notes |
|---------|--------|-------|
| Database (PostgreSQL + Prisma) | ✅ | Running, migrations applied |
| Authentication (JWT + bcrypt) | ✅ | register/login/refresh working |
| Session management | ✅ | Full CRUD operations |
| Message management | ✅ | Create/list/get messages |
| LLM service | ✅ | GLM-4.7 via OpenAI-compatible API |
| Token counter | ✅ | tiktoken for context management |
| Config loader | ✅ | JSON + env var configuration |
| SSE streaming | ✅ | Real-time response streaming |
| Tool system | ✅ | 5 tools + registry + executor |
| Tool continuation loop | ✅ | Re-calls LLM after tool execution |
| Docker sandbox | ✅ | Isolated code execution |
| File upload/download | ✅ | routes/files.ts + services/files.ts |
| MCP integration | ✅ | External tool servers |
| Skill processor | ✅ | 31 slash commands |
| **LangGraph orchestration** | ✅ | Module complete, `/agent` endpoint integrated |

### Frontend (`apps/web/`)

| Feature | Status | Notes |
|---------|--------|-------|
| React + Vite + TypeScript | ✅ | Running on :3000 |
| shadcn/ui components | ✅ | 16 components installed |
| API client | ✅ | Auto-refresh, error handling |
| Auth store (Zustand) | ✅ | Persistent auth state |
| Chat store | ✅ | Streaming + tool calls |
| SSE client | ✅ | Auto-reconnect |
| Login/Register flow | ✅ | Validated forms |
| Session management | ✅ | Sidebar with CRUD |
| Chat interface | ✅ | Messages, streaming, tool display |
| Error handling | ✅ | ErrorBoundary, toasts |
| Responsive design | ✅ | Mobile-first |

### Test Coverage

| Category | Count | Status |
|----------|-------|--------|
| Backend unit tests | 97 | ✅ All passing |
| Backend integration tests | 22 | ✅ All passing |
| Phase 6 feature tests | 84 | ✅ All passing |
| Frontend component tests | 14 | ✅ All passing |
| **Total** | **217** | **100% pass rate** |

---

## Environment

### Services

| Service | URL | Status |
|---------|-----|--------|
| Frontend | http://localhost:3000 | Running |
| Backend API | http://localhost:4000 | Running |
| PostgreSQL | localhost:5432 | Running |
| Redis | localhost:6379 | Running |
| Prisma Studio | http://localhost:5555 | Available |

### Required Configuration

```bash
# .env (required)
LLM_API_KEY=<your_api_key>
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mark
REDIS_URL=redis://localhost:6379
JWT_SECRET=<generated>
ENCRYPTION_KEY=<generated>
```

### Start Commands

```bash
# Start infrastructure
colima start  # Docker (if not running)
docker-compose up -d db redis

# Start development servers
bun run dev  # Both frontend + backend
# OR
bun run dev:api  # Backend only
bun run dev:web  # Frontend only

# Run tests
bun run test
```

---

## Known Issues

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| External API timeouts in tests | Low | Known | arXiv/Semantic Scholar may timeout |
| Docker socket path | Low | Fixed | Auto-detects Colima/Docker Desktop |
| None blocking | - | - | All critical issues resolved |

---

## Session History (Archive)

<details>
<summary>Click to expand session history</summary>

### Session 10 — 2026-01-31

**Tool-Call Livelock Fix:**
- Diagnosed: Agent stuck after tool execution (tool completes, no assistant response)
- Root cause: Single-pass LLM execution - tool results never fed back
- Fixed: Added `processAgentTurn()` continuation loop in stream.ts
- Added: Step limits (maxToolSteps: 10, maxExecutionTime: 5min)
- Added: 60s frontend idle timeout protection

### Session 9 — 2026-01-31

**Docker Sandbox Socket Fix:**
- Fixed `FailedToOpenSocket` error for Docker operations
- Added auto-detection for Docker socket (Colima, Docker Desktop, Podman)
- Built `mark-sandbox:latest` Docker image

### Session 8 — 2026-01-31

**Web Search Implementation:**
- Created `WebSearchTool` for academic paper search
- Integrated: arXiv API, alphaXiv API, Semantic Scholar API
- Features: Multiple sources, date filtering, sort options, normalized metadata

### Session 7 — 2026-01-31

**PPT Generation Implementation:**
- Created `PptGeneratorTool` using pptxgenjs
- Features: Title slides, content, bullet points, speaker notes
- Added `ArtifactDisplay` component with download functionality

### Session 6 — 2026-01-31

**Phase 6 Advanced Features:**
- Docker sandbox for isolated code execution
- File upload/download with validation
- MCP client integration
- Skill invocation system (31 commands)
- 84 new tests added

### Sessions 3-5 — 2026-01-30

**Phases 1-5 Implementation:**
- Phase 1: Environment setup (Docker, PostgreSQL, Redis, Prisma)
- Phase 2: Core backend (Auth, Sessions, Messages)
- Phase 3: LLM integration (Streaming, Token counting)
- Phase 4: Tool system (3 tools + registry + executor)
- Phase 5: Frontend (React, SSE, Chat interface)

### Sessions 1-2 — 2026-01-29

**Project Initialization:**
- Created CLAUDE.md, SKILL.md
- Created 4 Claude Code skills
- Installed dependencies (880 packages)
- Generated secrets for .env

</details>

---

## Quick Reference

| Symbol | Meaning |
|--------|---------|
| ✅ | Completed |
| 🔄 | In Progress |
| ⏳ | Pending |
| ❌ | Blocked |

---

## Constraints (Always Follow)

1. **No breaking changes** - Existing functionality must remain available
2. **Incremental changes** - Prefer small, verifiable modifications
3. **Deterministic orchestration** - No implicit LLM-driven control flow
4. **Evidence-backed claims** - All synthesized claims must cite sources
5. **Test coverage** - Add tests for new functionality
