# Test Suite

This directory contains all tests for the Mark Agent project.

## Directory Structure

```
tests/
├── unit/                      # Unit tests for services and utilities
│   ├── auth.test.ts          # Authentication service tests
│   ├── config.test.ts        # Configuration loading tests
│   ├── llm.test.ts           # LLM client tests
│   ├── tokens.test.ts        # Token counter tests
│   └── tools.test.ts         # Tool system tests
├── integration/               # Integration tests for API routes
│   ├── auth-routes.test.ts   # Auth endpoint tests
│   ├── database.test.ts      # Database connectivity tests
│   └── sessions-routes.test.ts # Session CRUD tests
├── fixtures/                  # Test fixtures and mock data
├── node_modules/              # Symlink to apps/api/node_modules
└── tsconfig.json             # TypeScript config for tests
```

## Running Tests

### From Project Root

```bash
# Run all tests
bun run test

# Run specific test file
bun test tests/unit/auth.test.ts

# Run all unit tests
bun test tests/unit/

# Run all integration tests
bun test tests/integration/

# Run with timeout
bun test tests/ --timeout 30000

# Run tests matching pattern
bun test tests/ --grep "Phase 1"
```

### From Apps/API Directory

```bash
cd apps/api
bun run test
```

## Test Organization

### Unit Tests (`tests/unit/`)

Test individual services, utilities, and business logic in isolation:
- Mock external dependencies
- Test pure functions and class methods
- Verify error handling
- Test edge cases

**Example:**
```typescript
import { hashPassword, verifyPassword } from '../../apps/api/src/services/auth';

describe('Auth Service', () => {
  it('should hash password', async () => {
    const hash = await hashPassword('test123');
    expect(hash).toBeDefined();
  });
});
```

### Integration Tests (`tests/integration/`)

Test API endpoints and database operations:
- Test full request/response cycles
- Verify database operations
- Test authentication flows
- Test error responses

**Example:**
```typescript
import { Hono } from 'hono';
import { authRoutes } from '../../apps/api/src/routes/auth';

describe('Auth Routes', () => {
  it('should register user', async () => {
    const app = new Hono();
    app.route('/api/auth', authRoutes);

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    expect(res.status).toBe(201);
  });
});
```

## Test Conventions

### File Naming
- Use `.test.ts` suffix for all test files
- Name files after what they test: `auth.test.ts` tests auth service
- Keep test files focused on a single module

### Test Structure
```typescript
describe('Module Name', () => {
  describe('Feature/Method', () => {
    it('should do something specific', () => {
      // Test implementation
    });
  });
});
```

### Test Isolation
- Each test should be independent
- Use `beforeAll` for shared setup
- Use `afterAll` for cleanup
- Don't share mutable state between tests

**Good Example:**
```typescript
describe('Session Routes', () => {
  let accessToken: string;

  beforeAll(async () => {
    // Create test user
    accessToken = await createTestUser();
  });

  it('should create session', async () => {
    // Each test creates its own session
    const sessionId = await createSession();
    // Test with sessionId
  });
});
```

### Import Paths
All imports from source code use relative paths from `tests/` folder:
```typescript
import { service } from '../../apps/api/src/services/service';
import { route } from '../../apps/api/src/routes/route';
import { middleware } from '../../apps/api/src/middleware/middleware';
```

## Environment Variables

Tests require the following environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for JWT signing
- `ENCRYPTION_KEY` - Encryption key
- `LLM_API_KEY` - LLM provider API key (optional, tests skip if not set)
- `CONFIG_PATH` - Path to config file (set automatically by test runner)

## Writing New Tests

### 1. Create Test File

Create a new test file in the appropriate directory:
```bash
# For unit tests
touch tests/unit/my-feature.test.ts

# For integration tests
touch tests/integration/my-route.test.ts
```

### 2. Write Test

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { myFunction } from '../../apps/api/src/services/my-service';

describe('My Feature', () => {
  beforeAll(async () => {
    // Setup
  });

  afterAll(async () => {
    // Cleanup
  });

  describe('myFunction', () => {
    it('should handle valid input', () => {
      const result = myFunction('valid');
      expect(result).toBeDefined();
    });

    it('should reject invalid input', () => {
      expect(() => myFunction('invalid')).toThrow();
    });
  });
});
```

### 3. Run Test

```bash
bun test tests/unit/my-feature.test.ts
```

## Test Coverage

Current test coverage:
- **Unit Tests**: 40 tests across 5 files
- **Integration Tests**: 57 tests across 3 files
- **Total**: 97 tests with 100% pass rate

### Coverage by Phase
- Phase 1 (Config, Database): 19 tests ✅
- Phase 2 (Auth, Sessions): 32 tests ✅
- Phase 3 (LLM, Tokens): 12 tests ✅
- Phase 4 (Tools): 34 tests ✅

## Common Issues

### Module Not Found
If you get "Cannot find module" errors:
1. Check import paths use `../../apps/api/src/...`
2. Verify the file exists at the import path
3. Ensure `node_modules` symlink exists in tests folder

### Test Failures
If tests fail intermittently:
1. Check test isolation - tests should not share state
2. Add delays for timing-sensitive tests
3. Verify cleanup in `afterAll` hooks

### Configuration Errors
If config file not found:
1. Verify `CONFIG_PATH` is set in test script
2. Run from project root: `bun test tests/`
3. Check `config/default.json` exists

## Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [TEST_RESULTS.md](../apps/api/TEST_RESULTS.md) - Detailed test results
- [SPEC.md](../.claude/SPEC.md) - Technical specification
