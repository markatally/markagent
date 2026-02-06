---
name: webapp-testing
description: Guide for testing the Mark Agent web application using Vitest and Playwright. Use when writing unit tests, integration tests, E2E tests, or debugging test failures.
---

# Web Application Testing

This skill provides guidance for testing the Mark Agent frontend and backend.

## Testing Stack

- **Unit Tests**: Vitest + React Testing Library
- **E2E Tests**: Playwright
- **API Tests**: Vitest + supertest
- **Coverage**: c8/istanbul

## Test Organization

```
apps/
├── web/
│   └── src/
│       ├── components/
│       │   └── __tests__/       # Component tests
│       ├── hooks/
│       │   └── __tests__/       # Hook tests
│       └── stores/
│           └── __tests__/       # Store tests
├── api/
│   └── src/
│       ├── routes/
│       │   └── __tests__/       # API route tests
│       └── services/
│           └── __tests__/       # Service unit tests
└── tests/
    └── e2e/                     # Playwright E2E tests
```

## Unit Testing (Vitest)

### Component Testing

```typescript
// apps/web/src/components/__tests__/ChatInput.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatInput } from '../chat/ChatInput';

describe('ChatInput', () => {
  it('should call onSubmit when form is submitted', async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} />);

    const input = screen.getByRole('textbox');
    await fireEvent.change(input, { target: { value: 'Hello' } });
    await fireEvent.submit(input.closest('form')!);

    expect(onSubmit).toHaveBeenCalledWith('Hello');
  });

  it('should disable input while loading', () => {
    render(<ChatInput onSubmit={vi.fn()} isLoading />);

    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
```

### Hook Testing

```typescript
// apps/web/src/hooks/__tests__/useSession.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { useSession } from '../useSession';

const wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

describe('useSession', () => {
  it('should fetch session data', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '123', name: 'Test' }),
    });

    const { result } = renderHook(() => useSession('123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: '123', name: 'Test' });
  });
});
```

### Store Testing (Zustand)

```typescript
// apps/web/src/stores/__tests__/sessionStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../sessionStore';

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ messages: [], isLoading: false });
  });

  it('should add message', () => {
    const { addMessage } = useSessionStore.getState();
    addMessage({ id: '1', role: 'user', content: 'Hello' });

    expect(useSessionStore.getState().messages).toHaveLength(1);
  });
});
```

## API Testing

### Route Handler Tests

```typescript
// apps/api/src/routes/__tests__/sessions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { sessionsRoute } from '../sessions';

const app = new Hono().route('/sessions', sessionsRoute);

describe('Sessions API', () => {
  it('POST /sessions should create a session', async () => {
    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Session' }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('id');
  });

  it('GET /sessions/:id should return 404 for invalid id', async () => {
    const res = await app.request('/sessions/invalid-id');
    expect(res.status).toBe(404);
  });
});
```

### Service Tests

```typescript
// apps/api/src/services/__tests__/llm.test.ts
import { describe, it, expect, vi } from 'vitest';
import { LLMClient } from '../llm/client';

vi.mock('openai', () => ({
  OpenAI: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Response' } }],
        }),
      },
    },
  })),
}));

describe('LLMClient', () => {
  it('should send chat completion request', async () => {
    const client = new LLMClient();
    const response = await client.chat([{ role: 'user', content: 'Hello' }]);

    expect(response.choices[0].message.content).toBe('Response');
  });
});
```

## E2E Testing (Playwright)

### Setup

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### E2E Test Examples

```typescript
// tests/e2e/chat.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Chat Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to load
    await page.waitForLoadState('networkidle');
  });

  test('should send a message and receive response', async ({ page }) => {
    // Type message
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('Hello, agent!');

    // Submit
    await page.getByRole('button', { name: /send/i }).click();

    // Wait for response
    await expect(page.getByText('Hello, agent!')).toBeVisible();
    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({
      timeout: 30000,
    });
  });

  test('should display tool execution progress', async ({ page }) => {
    await page.getByRole('textbox').fill('List files in the workspace');
    await page.getByRole('button', { name: /send/i }).click();

    // Tool execution indicator should appear
    await expect(page.getByText(/executing/i)).toBeVisible();
    await expect(page.locator('[data-testid="tool-result"]')).toBeVisible({
      timeout: 60000,
    });
  });
});
```

### Testing SSE Streams

```typescript
// tests/e2e/streaming.spec.ts
import { test, expect } from '@playwright/test';

test('should stream response in real-time', async ({ page }) => {
  await page.goto('/');

  // Intercept SSE connection
  const ssePromise = page.waitForResponse(
    (response) => response.url().includes('/stream') && response.status() === 200
  );

  await page.getByRole('textbox').fill('Write a short poem');
  await page.getByRole('button', { name: /send/i }).click();

  // Verify SSE connection established
  await ssePromise;

  // Verify streaming content appears incrementally
  const messageContainer = page.locator('[data-testid="assistant-message"]');
  await expect(messageContainer).toBeVisible();

  // Content should grow over time (streaming)
  const initialLength = await messageContainer.textContent();
  await page.waitForTimeout(1000);
  const laterLength = await messageContainer.textContent();

  expect(laterLength!.length).toBeGreaterThan(initialLength!.length);
});
```

## Test Commands

```bash
# Run all tests
bun run test

# Run with coverage
bun run test --coverage

# Run specific test file
bun run test src/services/__tests__/llm.test.ts

# Run E2E tests
bunx playwright test

# Run E2E tests with UI
bunx playwright test --ui

# Debug E2E test
bunx playwright test --debug
```

## Testing Best Practices

### Do's
- Test behavior, not implementation
- Use meaningful test descriptions
- Mock external dependencies (LLM, database)
- Test error cases and edge cases
- Keep tests independent and isolated

### Don'ts
- Don't test library code (React, Hono)
- Don't use arbitrary timeouts (use waitFor)
- Don't share state between tests
- Don't test private implementation details

## Coverage Requirements

Aim for these coverage targets:

| Area | Target |
|------|--------|
| Services | 80%+ |
| Routes | 75%+ |
| Components | 70%+ |
| Utilities | 90%+ |
