# E2E Tests

End-to-end tests for Mark Agent using Playwright.

## Setup

### 1. Install Playwright

```bash
bun add -D @playwright/test
```

### 2. Install Browsers

```bash
bunx playwright install
```

This will install Chromium, Firefox, and WebKit browsers.

### 3. Verify Setup

```bash
bunx playwright --version
```

## Running Tests

### Run All Tests

```bash
bunx playwright test
```

### Run Specific Test File

```bash
bunx playwright test e2e/skills-capabilities.spec.ts
```

### Run with UI Mode (Interactive)

```bash
bunx playwright test --ui
```

This opens a browser where you can:
- See tests running in real-time
- Debug failing tests
- View traces and screenshots

### Run in Debug Mode

```bash
bunx playwright test --debug
```

This opens a browser with developer tools and pauses at each step.

### Run Headed (See Browser)

```bash
bunx playwright test --headed
```

### Run Specific Test

```bash
bunx playwright test -g "agent should list only enabled skills"
```

## Test Reports

After running tests, view the HTML report:

```bash
bunx playwright show-report
```

## Writing Tests

### Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Setup before each test
    await page.goto('/');
  });

  test('should do something', async ({ page }) => {
    // Test implementation
    await page.click('button');
    await expect(page.locator('.result')).toBeVisible();
  });
});
```

### Best Practices

1. **Use data-testid attributes** for reliable selectors:
   ```typescript
   await page.click('[data-testid="submit-button"]');
   ```

2. **Wait for elements** before interacting:
   ```typescript
   await page.waitForSelector('[data-testid="content"]');
   ```

3. **Use explicit waits** instead of timeouts:
   ```typescript
   // Good
   await expect(page.locator('.message')).toBeVisible();
   
   // Avoid
   await page.waitForTimeout(3000);
   ```

4. **Clean up after tests**:
   ```typescript
   test.afterEach(async ({ page }) => {
     // Cleanup logic
   });
   ```

## Configuration

Configuration is in `playwright.config.ts` at the project root.

Key settings:
- `testDir`: './e2e' - test files location
- `baseURL`: 'http://localhost:3000' - app URL
- `webServer`: starts dev server automatically
- `retries`: 2 on CI, 0 locally

## Debugging

### View Traces

When a test fails, traces are collected automatically:

```bash
bunx playwright show-trace trace.zip
```

### Screenshots

Failed tests capture screenshots automatically in `test-results/`

### Videos

Failed tests record videos in `test-results/`

### Console Logs

View console logs from the browser:

```typescript
page.on('console', msg => console.log(msg.text()));
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bunx playwright install --with-deps
      - run: bunx playwright test
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

## Troubleshooting

### Port Already in Use

If port 3000 is already in use:

```bash
# Option 1: Stop existing server
pkill -f "bun.*dev"

# Option 2: Use different port
# Edit playwright.config.ts and update baseURL
```

### Browser Installation Issues

```bash
# Reinstall browsers
bunx playwright install --force

# Install with system dependencies
bunx playwright install --with-deps
```

### Test Timeout

Increase timeout in playwright.config.ts:

```typescript
use: {
  timeout: 60000, // 60 seconds
}
```

## Available Tests

### skills-capabilities.spec.ts
Tests for agent skill functionality:
- Agent lists only enabled skills
- Agent updates when skills change
- Skills modal scrolling
- No internal tool mentions

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Selectors](https://playwright.dev/docs/selectors)
- [Assertions](https://playwright.dev/docs/test-assertions)
