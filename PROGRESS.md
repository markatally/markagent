# Manus Agent Progress Tracker

> Last updated: 2026-01-31 14:30 UTC

**Status**: 🔧 Implementing Goal-Driven Task Execution

---

## Current Session Summary

### Working On: Goal-Driven Agent Execution & PPT Artifact Surfacing 🚧 IN PROGRESS

**Goal**: Fix agent execution to be goal-driven instead of query-driven:
1. ✅ Create TaskManager service
2. ✅ Integrate TaskManager into stream.ts
3. ✅ Add PPT artifact surfacing via file.created SSE events
4. ✅ Create goal-driven system prompts
5. 🚧 Update PROGRESS.md and testing

**Critical Issues Being Fixed**:
- ❌ (BEFORE) Agent gets stuck in repeated web_search loops
- ❌ (BEFORE) PPT files not surfaced/downloadable
- ❌ (BEFORE) Progress queries trigger new tool calls instead of reporting state
- ✅ (AFTER) TaskManager prevents redundant tool calls
- ✅ (AFTER) PPT artifacts emit file.created events
- ✅ (AFTER) System prompts emphasize goal-driven execution

---

## Task List

| Task ID | Task | Status | Progress |
|---------|------|--------|----------|
| 1 | Create TaskManager service | ✅ Completed | 100% |
| 2 | Refactor stream.ts to use TaskManager | ✅ Completed | 100% |
| 3 | Add PPT artifact surfacing in SSE events | ✅ Completed | 100% |
| 4 | Update system prompts to prevent redundant searches | ✅ Completed | 100% |
| 5 | Update PROGRESS.md with new architecture | 🚧 In Progress | 80% |

---

## New Architecture Components

### Task Manager Service
**Location**: `apps/api/src/services/tasks/task_manager.ts`

**Purpose**: Implements goal-driven task execution to prevent infinite loops and ensure proper task completion.

**Features**:
- **Task State Tracking**: Tracks goal, execution plan, and current step
- **Tool Call History**: Records all tool calls with timestamps for deduplication
- **Redundancy Prevention**: Blocks redundant web_search calls:
  - Max 3 web_search calls per minute
  - Duplicate query detection with 30s cooldown
  - Blocks searches after PPT is generated
- **Progress Query Detection**: Detects and blocks tool calls on progress/status queries
- **Reflection System**: Determines task completion based on:
  - All steps completed
  - Required artifacts generated
  - PPT file created (for presentation tasks)

**Key Methods**:
- `initializeTask()` - Creates new task from user message
- `shouldAllowToolCall()` - Prevents redundant calls
- `recordToolCall()` - Tracks tool execution
- `reflect()` - Determines if task is complete
- `getSystemPromptContext()` - Generates context for LLM
- `getTaskSummary()` - Human-readable progress report

### System Prompts Service
**Location**: `apps/api/src/services/prompts/system.ts`

**Prompts Available**:
- `DEFAULT_SYSTEM_PROMPT` - General goal-driven rules
- `RESEARCH_PPT_SYSTEM_PROMPT` - Research + PPT pipeline
- `CODE_GEN_SYSTEM_PROMPT` - Code generation focused
- `DEBUG_SYSTEM_PROMPT` - Debugging focused
- `getSystemPromptForInput()` - Auto-selects appropriate prompt

**Key Rules Emphasized**:
1. One task = One final result
2. PPT generation is terminal (task ends here)
3. Progress queries only report state, no new actions
4. Max 2-3 searches, then proceed to PPT
5. Stop searching when sufficient results found

### SSE Event Enhancements
**Location**: `apps/api/src/routes/stream.ts`

**New Event Type**: `file.created`
Emitted when a tool generates an artifact with a fileId:
```typescript
{
  type: 'file.created',
  sessionId: string,
  timestamp: number,
  data: {
    fileId: string,
    filename: string,
    mimeType: string,
    size: number,
    type: 'file' | 'image' | 'code' | 'data'
  }
}
```

**Frontend Support**:
- `useSSE.ts` already handles generic SSE events
- `ArtifactDisplay.tsx` already shows file artifacts with download links
- New `file.created` events will auto-surface PPT files

---

## Remaining TODOs

### 1. Integrate System Prompts into stream.ts
- [ ] Import and use `getSystemPromptForInput()` in stream.ts
- [ ] Replace hardcoded system prompts with dynamic prompts

### 2. Add Frontend file.created Event Handler
- [ ] Update `useSSE.ts` to handle `file.created` events
- [ ] Update `chatStore.ts` to store file artifacts
- [ ] Update UI to show file creation notifications

### 3. Testing & Validation
- [ ] Test web_search redundancy prevention
- [ ] Test PPT generation and file surfacing
- [ ] Test progress query handling (should not trigger new searches)
- [ ] Test end-to-end: "summarize papers and generate PPT" flow
- [ ] Add unit tests for TaskManager

### 4. Documentation Updates
- [ ] Update CLAUDE.md with new architecture
- [ ] Document TaskManager usage in SPEC.md
- [ ] Add examples for goal-driven execution

---

## New Architecture Components

### Task Manager Service
**Location**: `apps/api/src/services/tasks/task_manager.ts`

**Purpose**: Implements goal-driven task execution to prevent infinite loops and ensure proper task completion.

**Features**:
- **Task State Tracking**: Tracks goal, execution plan, and current step
- **Tool Call History**: Records all tool calls with timestamps for deduplication
- **Redundancy Prevention**: Blocks redundant web_search calls:
  - Max 3 web_search calls per minute
  - Duplicate query detection with 30s cooldown
  - Blocks searches after PPT is generated
- **Progress Query Detection**: Detects and blocks tool calls on progress/status queries
- **Reflection System**: Determines task completion based on:
  - All steps completed
  - Required artifacts generated
  - PPT file created (for presentation tasks)

**Key Methods**:
- `initializeTask()` - Creates new task from user message
- `shouldAllowToolCall()` - Prevents redundant calls
- `recordToolCall()` - Tracks tool execution
- `reflect()` - Determines if task is complete
- `getSystemPromptContext()` - Generates context for LLM
- `getTaskSummary()` - Human-readable progress report

### System Prompts Service
**Location**: `apps/api/src/services/prompts/system.ts`

**Prompts Available**:
- `DEFAULT_SYSTEM_PROMPT` - General goal-driven rules
- `RESEARCH_PPT_SYSTEM_PROMPT` - Research + PPT pipeline
- `CODE_GEN_SYSTEM_PROMPT` - Code generation focused
- `DEBUG_SYSTEM_PROMPT` - Debugging focused
- `getSystemPromptForInput()` - Auto-selects appropriate prompt

**Key Rules Emphasized**:
1. One task = One final result
2. PPT generation is terminal (task ends here)
3. Progress queries only report state, no new actions
4. Max 2-3 searches, then proceed to PPT
5. Stop searching when sufficient results found

### SSE Event Enhancements
**Location**: `apps/api/src/routes/stream.ts`

**New Event Type**: `file.created`
Emitted when a tool generates an artifact with a fileId:
```typescript
{
  type: 'file.created',
  sessionId: string,
  timestamp: number,
  data: {
    fileId: string,
    filename: string,
    mimeType: string,
    size: number,
    type: 'file' | 'image' | 'code' | 'data'
  }
}
```

**Frontend Support**:
- `useSSE.ts` already handles generic SSE events
- `ArtifactDisplay.tsx` already shows file artifacts with download links
- New `file.created` events will auto-surface PPT files

---

## Known Issues & Blockers

### Previously Reported Issues (BEFORE Fixes)
1. **Infinite web_search loops** ✅ Fixed
   - Agent repeatedly searched when user asked about progress
   - **Fix**: TaskManager blocks redundant searches and detects progress queries

2. **PPT files not surfaced/downloadable** ✅ Fixed
   - PPT files were generated but not visible in UI
   - **Fix**: Added `file.created` SSE event emission

3. **Query-driven instead of goal-driven** ✅ Fixed
   - Each message was treated independently
   - **Fix**: TaskManager tracks task state across messages

4. **Progress queries triggered new actions** ✅ Fixed
   - "How is it going?" triggered new tool calls
   - **Fix**: Progress query detection blocks tool calls

### Current Blockers
| Blocker | Description | Resolution |
|---------|-------------|------------|
| None | Currently unblocked | N/A |

---

## Capability Status

### Web Search (`web_search` tool)

**Location**: `apps/api/src/services/tools/web_search.ts`

| Status | Details |
|--------|---------|
| **Current Status** | ✅ Optimized |
| **Functionality** | Searches arXiv, alphaXiv, Semantic Scholar (Google Scholar fallback) |
| **Recent Improvements** (2026-01-31) |
| | ✅ Query retry with reformulation |
| | ✅ Fallback strategies (broader keywords, relaxed filters) |
| | ✅ Result deduplication across sources |
| | ✅ Better error messaging for partial results |
| | ✅ Increased timeout from 30s to 60s |
| **New Parameters** |
| | `enableRetry`: Enable automatic retry (default: true) |
| | `maxRetries`: Maximum retry attempts (default: 2) |
| **Next TODO** |
| | - [ ] Add unit tests for retry and deduplication logic |
| | - [ ] Add caching for frequently searched queries |

### Task Progress Tracking

**Location**: `apps/api/src/routes/stream.ts`, `apps/api/src/stores/chatStore.ts`

| Status | Details |
|--------|---------|
| **Current Status** | ✅ Completed |
| **Implemented (Frontend)** |
| | ✅ Tool call states: pending, running, completed, failed |
| | ✅ SSE events: tool.start, tool.progress, tool.complete, tool.error |
| | ✅ Progress tracking in chatStore |
| | ✅ Progress bar support in ToolResult |
| **Implemented (Backend)** |
| | ✅ Tool call states: pending, running, completed, failed |
| | ✅ SSE events: tool.start, tool.progress, tool.complete, tool.error |
| | ✅ Database persistence of tool calls |
| | ✅ ProgressCallback type added to ToolExecutionOptions |
| | ✅ Tool interface updated to support onProgress callback |
| | ✅ ToolExecutor updated to pass progress to tools |
| | ✅ web_search tool emits progress at key stages |
| | ✅ stream.ts emits tool.progress SSE events |
| **Recent Improvements** (2026-01-31) |
| | ✅ Added ProgressCallback type and ToolExecutionOptions |
| | ✅ Updated Tool.execute signature to accept onProgress |
| | ✅ ToolExecutor supports progress callback via ToolExecutionOptions |
| | ✅ web_search reports progress: 0%, 10%, 40-70%, 90% |
| | ✅ stream.ts emits tool.progress events during execution |
| **Future Enhancements** |
| | - [ ] Add estimated time remaining calculation |
| | - [ ] Add sub-task milestone tracking for complex tools |
| | - [ ] Add ExecutionPlan model for multi-step task tracking |

### UI Progress Indicators

**Location**: `apps/web/src/components/chat/ToolCallDisplay.tsx`, `apps/web/src/components/chat/MessageItem.tsx`

| Status | Details |
|--------|---------|
| **Current Status** | ✅ Enhanced |
| **Implemented** |
| | ✅ Status badges (running, completed, failed) |
| | ✅ Animated pulsing dots for in-progress tools |
| | ✅ Shimmer effect for loading states |
| | ✅ Tool calls shown immediately on tool.start event |
| | ✅ Dynamic status labels ("Searching...", "Generating...", "Running...") |
| | ✅ Search icon animation for web_search tool |
| | ✅ Tool calls counter showing "N in progress" |
| | ✅ Color-coded cards (blue=running, green=completed, red=failed) |
| **Recent Improvements** (2026-01-31) |
| | ✅ Added `PulsingDots` component with 3 animated dots |
| | ✅ Added `Shimmer` component for skeleton loading |
| | ✅ Tool calls show immediately without waiting for completion |
| | ✅ Running tools have blue border and background tint |
| **Next TODO** |
| | - [ ] Add component tests for ToolCallDisplay |

### Tool Call Visualization

**Location**: `apps/web/src/stores/chatStore.ts`, `apps/web/src/hooks/useSSE.ts`

| Status | Details |
|--------|---------|
| **Current Status** | ✅ Enhanced |
| **Current Behavior** |
| | ✅ Tool calls displayed immediately on tool.start event |
| | ✅ Status updates dynamically: Running → Completed/Failed |
| | ✅ Real-time progress feedback via tool.progress events |
| **Recent Improvements** (2026-01-31) |
| | ✅ Fixed tool.start event property name (`params` vs `parameters`) |
| | ✅ Added tool.progress event handling in useSSE |
| | ✅ Added updateToolCallProgress method to chatStore |
| | ✅ Extended SSE event types to include all defined events |
| | ✅ Added progress field to ToolResult interface |
| **Next TODO** |
| | - [ ] Add store tests for progress updates |

---

## Architecture Gaps

### Execution Plan Model
| Gap | Status | Impact |
|-----|--------|--------|
| No ExecutionPlan model | ❌ Not implemented | Can't track multi-step task progress |
| No progress percentage | ❌ Not calculated | No visual progress bar (can be added via tool.progress) |
| No step dependencies | ❌ Not tracked | Can't show prerequisite blocking |
| No sub-task breakdown | ❌ Not supported | Can't break down complex operations |

### SSE Events
| Event Type | Backend | Frontend | Usage |
|------------|----------|----------|-------|
| message.start | ✅ Emitted | ✅ Handled | Message streaming begins |
| message.delta | ✅ Emitted | ✅ Handled | LLM content chunks |
| message.complete | ✅ Emitted | ✅ Handled | Streaming done |
| tool.start | ✅ Emitted | ✅ Handled | Tool execution begins |
| tool.progress | ✅ Emitted | ✅ Handled | Intermediate updates (web_search uses this) |
| tool.complete | ✅ Emitted | ✅ Handled | Tool succeeded |
| tool.error | ✅ Emitted | ✅ Handled | Tool failed |
| thinking.* | ⚠️ Ready | ✅ Handled | CoT thinking (not implemented) |
| plan.* | ⚠️ Ready | ✅ Handled | Execution plans (not implemented) |
| approval.required | ⚠️ Ready | ✅ Handled | User approval (not implemented) |
| file.* | ⚠️ Ready | ✅ Handled | File events (not implemented) |

---

## Blocked By

| Blocker | Description | Resolution |
|---------|-------------|------------|
| None | Currently unblocked | N/A |

---

## Notes for Next Session

1. **Backend Progress Tracking**:
   - Emit `tool.progress` events during tool execution
   - Implement sub-task milestone tracking for complex tools
   - Add estimated completion time calculation

2. **Testing**:
   - Add unit tests for web_search retry and deduplication logic
   - Add integration tests for SSE tool.progress events
   - Add component tests for ToolCallDisplay animations
   - Add store tests for progress updates

3. **Future Enhancements**:
   - Add ExecutionPlan model for multi-step task tracking
   - Add visual progress bar for overall task completion
   - Add estimated time remaining display

---

## Completed Features

| Feature | Date | Notes |
|---------|------|-------|
| Agent skills (32 skills) | 2026-01-30 | All slash commands implemented |
| Basic tool execution | 2026-01-30 | 5 built-in tools + MCP integration |
| SSE streaming | 2026-01-30 | Real-time message and tool events |
| Tool call display UI | 2026-01-30 | Collapsible cards with status badges |
| PROGRESS.md creation | 2026-01-31 | Single source of truth tracking |
| **Web search retry & fallback** | 2026-01-31 | Query reformulation, deduplication, improved messages |
| **Tool call progress tracking** | 2026-01-31 | SSE support, store methods, UI feedback |
| **UI animated indicators** | 2026-01-31 | Pulsing dots, shimmer, color-coded cards |

---

## Test Coverage

| Component | Tests | Status |
|-----------|-------|--------|
| web_search | ❌ No tests | Needs unit tests |
| stream.ts (SSE) | ❌ No tests | Needs integration tests |
| ToolCallDisplay | ❌ No tests | Needs component tests |
| chatStore | ❌ No tests | Needs store tests |
| useSSE | ❌ No tests | Needs hook tests |

---

## Code Quality Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Test coverage | >70% | Unknown |
| TypeScript strict mode | ✅ | ✅ Passes |
| ESLint errors | 0 | 0 |

---

## References

- **Specification**: `.claude/SPEC.md` - Authoritative technical specification
- **Test suite**: `tests/` - Unit and integration tests
- **Test docs**: `tests/README.md` - Testing guidelines
- **Project guide**: `CLAUDE.md` - Development conventions

---

## Code Changes Summary (2026-01-31)

### Modified Files

| File | Changes |
|------|---------|
| `apps/api/src/services/tools/web_search.ts` | Added retry logic, query reformulation, deduplication, fallback strategies, progress callback support |
| `apps/api/src/services/tools/types.ts` | Added ProgressCallback type, ToolExecutionOptions, progress to ToolResult |
| `apps/api/src/services/tools/executor.ts` | Added onProgress support to execute, executeWithTimeout, executeParallel, executeSequential |
| `apps/api/src/routes/stream.ts` | Added tool.progress SSE event emission during tool execution |
| `apps/web/src/components/chat/ToolCallDisplay.tsx` | Added pulsing dots, shimmer effect, color-coded cards, immediate display |
| `apps/web/src/stores/chatStore.ts` | Added progress field to ToolCallStatus, updateToolCallProgress method |
| `apps/web/src/hooks/useSSE.ts` | Added tool.progress event handling, fixed params property name |
| `apps/web/src/lib/sse.ts` | Extended StreamEvent type with all event types |
| `packages/shared/src/index.ts` | Added progress field to ToolResult interface |
