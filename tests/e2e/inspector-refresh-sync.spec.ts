import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const VIDEO_PROMPT = '请总结这个视频主要内容： https://www.bilibili.com/video/BV1ZpzhBLE82';
const FOLLOWUP_PROMPT = '将视频中的逐字稿总结成一篇500字左右的文章';

async function login(page: Page) {
  await page.request
    .post('/api/auth/register', {
      data: { email: 'test@example.com', password: 'test-password' },
    })
    .catch(() => {});

  await page.goto('/');
  const chatInput = page.locator('[data-testid="chat-input"]');
  if (await chatInput.isVisible()) return;

  await page.goto('/login');
  await page.fill('input[type="email"]', 'test@example.com');
  await page.fill('input[type="password"]', 'test-password');
  await page.click('button:has-text("Log in")');
  await page.waitForURL(/\/chat/);
  await page.waitForSelector('[data-testid="chat-input"]', { timeout: 30000 });
}

async function openInspector(page: Page) {
  const inspectorHeading = page.getByText('Inspector');
  const openInspectorBtn = page.getByRole('button', { name: /open inspector/i });
  if ((await inspectorHeading.count()) === 0 && (await openInspectorBtn.count()) > 0) {
    await openInspectorBtn.click();
  }
  await expect(inspectorHeading).toBeVisible({ timeout: 10000 });
}

async function ensureSessionRoute(page: Page) {
  const pathname = new URL(page.url()).pathname;
  if (/^\/chat\/[^/]+$/.test(pathname)) return;
  const firstSessionHeading = page.locator('h3:has-text("New Session"), h3:has-text("Untitled Session")').first();
  await expect(firstSessionHeading).toBeVisible({ timeout: 10000 });
  await firstSessionHeading.click();
  await page.waitForURL(/\/chat\/[^/]+/, { timeout: 15000 });
}

test.describe('Inspector refresh sync', () => {
  test.describe.configure({ mode: 'serial' });

  test('shows running step duration increasing and preserves it after refresh', async ({ page }) => {
    test.setTimeout(2 * 60 * 1000);
    const outDir = '/Users/mark/Git/markagent/output/playwright';
    mkdirSync(outDir, { recursive: true });

    await login(page);
    await ensureSessionRoute(page);
    const sessionMatch = page.url().match(/\/chat\/([^/?#]+)/);
    expect(sessionMatch?.[1]).toBeTruthy();
    const sessionId = sessionMatch![1];

    await page.evaluate((sid: string) => {
      const now = Date.now();
      localStorage.setItem(
        `mark-agent-runtime-${sid}`,
        JSON.stringify({
          toolCalls: [
            {
              sessionId: sid,
              toolCallId: 'visual-run-1',
              toolName: 'video_transcript',
              params: { url: 'https://www.bilibili.com/video/BV1ZpzhBLE82' },
              status: 'running',
              startedAt: now - 4200,
            },
          ],
          reasoningSteps: [
            {
              stepId: 'tool-visual-run-1',
              label: 'Tool execution',
              status: 'running',
              startedAt: now - 4200,
            },
          ],
          isStreaming: true,
          streamingContent: '',
          isThinking: false,
        })
      );
    }, sessionId);

    await page.reload();
    await page.waitForURL(/\/chat\/[^/]+/, { timeout: 15000 });
    await openInspector(page);

    const durationLocator = page
      .locator('[data-testid="reasoning-trace-timeline"] li')
      .filter({ hasText: 'Step' })
      .locator('.w-20 > div')
      .first();
    await expect(durationLocator).toBeVisible({ timeout: 20000 });
    const durationBefore = (await durationLocator.textContent())?.trim() || '';
    await page.waitForTimeout(2200);
    const durationAfter = (await durationLocator.textContent())?.trim() || '';

    expect(durationBefore).toMatch(/s$/);
    expect(durationAfter).toMatch(/s$/);
    expect(durationBefore).not.toBe(durationAfter);

    await page.screenshot({
      path: join(outDir, 'inspector-refresh-before-reload.png'),
      fullPage: true,
    });

    await page.reload();
    await page.waitForURL(/\/chat\/[^/]+/, { timeout: 15000 });
    await openInspector(page);
    await expect(page.getByTestId('reasoning-trace-timeline')).toBeVisible({ timeout: 30000 });
    await expect(durationLocator).toBeVisible({ timeout: 20000 });

    await page.screenshot({
      path: join(outDir, 'inspector-refresh-after-reload.png'),
      fullPage: true,
    });
  });

  test('keeps video follow-up healthy after refresh and avoids 300000ms timeout error', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);
    test.skip(!!process.env.CI, 'skip in CI due external video dependency');

    const outDir = '/Users/mark/Git/markagent/output/playwright';
    mkdirSync(outDir, { recursive: true });

    await login(page);
    await ensureSessionRoute(page);

    const chatInput = page.locator('[data-testid="chat-input"]');
    const sendBtn = page.getByRole('button', { name: /send message/i });
    await chatInput.fill(VIDEO_PROMPT);
    await chatInput.press('Enter');
    await expect(sendBtn).toBeVisible({ timeout: 420000 });

    await chatInput.fill(FOLLOWUP_PROMPT);
    await chatInput.press('Enter');
    await openInspector(page);
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForURL(/\/chat\/[^/]+/, { timeout: 15000 });
    await openInspector(page);
    await expect(page.getByTestId('reasoning-trace-timeline')).toBeVisible({ timeout: 30000 });

    await expect(sendBtn).toBeVisible({ timeout: 540000 });

    await expect(page.getByText('Tool execution timed out after 300000ms')).toHaveCount(0);

    await page.screenshot({
      path: join(outDir, 'inspector-refresh-final.png'),
      fullPage: true,
    });
  });
});
