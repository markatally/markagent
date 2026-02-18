import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const VIDEO_PROMPT =
  '请总结这个视频主要内容： https://www.bilibili.com/video/BV1ZpzhBLE82';

async function login(page: Page) {
  await page.request.post('/api/auth/register', {
    data: { email: 'test@example.com', password: 'test-password' },
  });
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

test.describe('Video Summary Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test('starts and completes video summary run without runtime error', async ({ page }) => {
    test.setTimeout(8 * 60 * 1000);
    test.skip(!!process.env.CI, 'skip in CI due external video dependency');

    await login(page);

    const newChatBtn = page.locator('[data-testid="new-chat-button"]');
    await newChatBtn.click();
    await page.waitForURL(/\/chat\/[^/]+/, { timeout: 15000 });

    const chatInput = page.locator('[data-testid="chat-input"]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    await chatInput.fill(VIDEO_PROMPT);
    await chatInput.press('Enter');

    await openInspector(page);

    // Task started: either stop button is visible or reasoning/computer tool rows appear.
    const stopBtn = page.getByRole('button', { name: /stop response/i });
    const reasoningRunning = page.getByText(/Reasoning Trace/i);
    const videoProbeRow = page.getByText(/Video Probe|Extracting transcript|Tool: Video Probe/i);
    await expect
      .poll(
        async () => {
          const stopVisible = await stopBtn.first().isVisible().catch(() => false);
          const probeVisible = await videoProbeRow.first().isVisible().catch(() => false);
          const reasoningVisible = await reasoningRunning.first().isVisible().catch(() => false);
          return stopVisible || probeVisible || reasoningVisible;
        },
        { timeout: 120000 }
      )
      .toBe(true);

    const outDir = '/Users/mark/Git/markagent/output/playwright';
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: join(outDir, 'video-summary-flow-start.png'), fullPage: true });

    // Task completed: send button becomes available again and assistant message is visible.
    const sendBtn = page.getByRole('button', { name: /send message/i });
    await expect(sendBtn).toBeVisible({ timeout: 420000 });

    const assistantMessages = page.locator('[data-testid="assistant-message"]');
    await expect(assistantMessages.last()).toBeVisible({ timeout: 120000 });
    const assistantText = ((await assistantMessages.last().textContent()) || '').trim();
    expect(assistantText.length).toBeGreaterThan(30);
    expect(assistantText).toMatch(/transcript|根据 transcript|According to the transcript|重点|总结/i);

    // Guard against the regression in the screenshot.
    await expect(page.getByText('Failed to send message')).toHaveCount(0);
    await expect(page.getByText('finalizeReasoningTrace is not defined')).toHaveCount(0);

    await page.screenshot({ path: join(outDir, 'video-summary-flow-end.png'), fullPage: true });
  });

  test('follow-up question uses transcript context without file/shell tool errors', async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000);
    test.skip(!!process.env.CI, 'skip in CI due external video dependency');

    await login(page);

    const newChatBtn = page.locator('[data-testid="new-chat-button"]');
    await newChatBtn.click();
    await page.waitForURL(/\/chat\/[^/]+/, { timeout: 15000 });

    const chatInput = page.locator('[data-testid="chat-input"]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    await chatInput.fill(VIDEO_PROMPT);
    await chatInput.press('Enter');

    const sendBtn = page.getByRole('button', { name: /send message/i });
    await expect(sendBtn).toBeVisible({ timeout: 420000 });

    await chatInput.fill('将视频中的逐字稿总结成一篇文章');
    await chatInput.press('Enter');

    await openInspector(page);
    await expect(sendBtn).toBeVisible({ timeout: 420000 });

    const assistantMessages = page.locator('[data-testid="assistant-message"]');
    await expect(assistantMessages.last()).toBeVisible({ timeout: 120000 });
    const assistantText = ((await assistantMessages.last().textContent()) || '').trim();
    expect(assistantText.length).toBeGreaterThan(80);

    await expect(page.getByText(/Tool:\s*File Reader/i)).toHaveCount(0);
    await expect(page.getByText(/Tool:\s*Shell Command/i)).toHaveCount(0);
    await expect(page.getByText(/Sandbox unavailable/i)).toHaveCount(0);
    await expect(page.getByText(/File not found/i)).toHaveCount(0);

    const outDir = '/Users/mark/Git/markagent/output/playwright';
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: join(outDir, 'video-summary-followup-end.png'), fullPage: true });
  });
});
