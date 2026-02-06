# Skills Testing Documentation

This document describes the test suite for the Skills configuration and capabilities features.

## Test Coverage

### 1. Frontend Unit Tests
**File:** `apps/web/src/components/skills/__tests__/SkillsConfigModal.test.tsx`

Tests the SkillsConfigModal component for:
- ✅ Scrolling functionality
- ✅ Fixed height container (`h-[80vh]`)
- ✅ ScrollArea rendering
- ✅ Display of all skills (25+ skills)
- ✅ Flex-shrink-0 on header and footer
- ✅ Add skill functionality
- ✅ Save functionality

**Run:**
```bash
bun test apps/web/src/components/skills/__tests__/SkillsConfigModal.test.tsx
```

### 2. Backend Integration Tests
**File:** `tests/integration/skills-capabilities.test.ts`

Tests the API endpoints for:
- ✅ Fresh skill fetching on each request (no stale cache)
- ✅ Handling users with no enabled skills
- ✅ Handling users with multiple enabled skills
- ✅ Skill enable/disable mid-session
- ✅ System prompt replacement on each request
- ✅ GET /stream endpoint with user skills

**Run:**
```bash
bun test tests/integration/skills-capabilities.test.ts
```

### 3. E2E Tests (Playwright)
**File:** `tests/e2e/skills-capabilities.spec.ts`

Tests the full user flow:
- ✅ Agent lists only enabled skills
- ✅ Agent updates when skills change
- ✅ Agent shows no skills when all disabled
- ✅ Agent doesn't mention internal tools
- ✅ Skills modal scrolling
- ✅ Skills modal fixed height
- ✅ Display all available skills

**Setup E2E Tests:**

1. Install Playwright:
```bash
bun add -D @playwright/test
```

2. Install browsers:
```bash
bunx playwright install
```

3. Run E2E tests:
```bash
# All tests
bunx playwright test

# With UI
bunx playwright test --ui

# Debug mode
bunx playwright test --debug

# Specific test
bunx playwright test tests/e2e/skills-capabilities.spec.ts
```

## Test Scenarios

### Scenario 1: Scrolling Bug
**Bug:** Skills modal couldn't scroll to view all skills

**Tests:**
- Frontend: `should have fixed height container for scrolling`
- Frontend: `should render ScrollArea for skills list`
- Frontend: `should display all skills when list is long`
- E2E: `skills modal should be scrollable with many skills`

**Fix Applied:**
- Changed `max-h-[80vh]` to `h-[80vh]`
- Added `overflow-hidden` to DialogContent
- Added `flex-shrink-0` to header/footer
- Wrapped ScrollArea properly

### Scenario 2: Stale Skill List
**Bug:** Agent showed old skills list even after enabling/disabling skills

**Tests:**
- Backend: `should fetch fresh skills on each request (no stale cache)`
- Backend: `should handle skill enable/disable mid-session`
- Backend: `should replace system prompt on each request`
- E2E: `agent should update when skills change mid-session`

**Fix Applied:**
- Changed from prepending to REPLACING system prompt
- Fetch skills on every request (no caching)
- Build fresh skill list from database

### Scenario 3: Agent Lists Internal Tools
**Bug:** Agent listed internal tools (file_reader, bash_executor) instead of just enabled skills

**Tests:**
- Backend: System prompt includes CRITICAL rules
- E2E: `agent should not mention internal tools`

**Fix Applied:**
- Added CRITICAL section to system prompt
- Explicit rules: "Do NOT mention internal tools"
- "List ONLY enabled skills"

### Scenario 4: No Skills Enabled
**Bug:** Agent didn't handle case when user has no skills

**Tests:**
- Backend: `should handle user with no enabled skills`
- E2E: `agent should show no skills when all disabled`

**Fix Applied:**
- Added "No Skills Enabled" system prompt section
- Suggests user to enable skills in settings

## Running All Tests

```bash
# Run all unit and integration tests
bun run test

# Run only skills-related tests
bun test tests/integration/skills-capabilities.test.ts
bun test apps/web/src/components/skills/__tests__/SkillsConfigModal.test.tsx

# Run E2E tests (requires Playwright setup)
bunx playwright test tests/e2e/skills-capabilities.spec.ts
```

## Test Data Requirements

### Backend Tests
- Requires at least 2 skills in the `externalSkill` table
- Tests create temporary users and sessions
- Tests clean up after themselves

### E2E Tests
- Requires running dev server (`bun run dev`)
- Requires test user account
- Requires at least a few skills in the database

## Debugging Tests

### Frontend Tests
```bash
# Run with verbose output
bun test apps/web/src/components/skills/__tests__/SkillsConfigModal.test.tsx --reporter=verbose

# Run specific test
bun test apps/web/src/components/skills/__tests__/SkillsConfigModal.test.tsx -t "should have fixed height"
```

### Backend Tests
```bash
# Run with debug logs
DEBUG=* bun test tests/integration/skills-capabilities.test.ts

# Check database state
bun run db:studio
```

### E2E Tests
```bash
# Run with debug mode (opens browser)
bunx playwright test --debug

# Run headed (see browser)
bunx playwright test --headed

# Slow mo for observation
bunx playwright test --slow-mo=1000
```

## Coverage Goals

| Test Type | Current | Target |
|-----------|---------|--------|
| Frontend Unit | 90% | 90% |
| Backend Integration | 85% | 85% |
| E2E | 80% | 80% |

## Adding New Tests

When adding new skill-related features:

1. **Add frontend test** if it involves UI components
2. **Add backend test** if it involves API changes
3. **Add E2E test** if it involves user workflow
4. **Update this documentation** with the new test cases

## Known Limitations

1. **E2E tests require manual setup** - Playwright must be installed separately
2. **Backend tests require database** - Ensure PostgreSQL is running
3. **Tests don't cover LLM responses** - We can't predict exact LLM output, only check API behavior
4. **SSE streaming not fully tested** - Integration tests check status codes but don't parse full SSE streams

## Future Improvements

- [ ] Add visual regression tests for skills modal
- [ ] Add performance tests for large skill lists (100+ skills)
- [ ] Add accessibility tests for skills modal
- [ ] Add tests for skill search functionality
- [ ] Add tests for skill categories/filtering
- [ ] Mock LLM responses for more deterministic E2E tests
