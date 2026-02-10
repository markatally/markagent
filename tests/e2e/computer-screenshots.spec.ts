/**
 * E2E: Computer tab and step screenshots in PPT pipeline
 *
 * Verifies:
 * 1. Computer tab shows viewport area (placeholder or screenshot) when open
 * 2. After sending a PPT-style message, placeholder appears and screenshots can appear per step
 */

import { test, expect, type Page } from '@playwright/test';

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

async function openInspectorAndComputerTab(page: Page) {
  const inspectorHeading = page.getByText('Inspector');
  const openInspector = page.getByRole('button', { name: /open inspector/i });
  if ((await inspectorHeading.count()) === 0 && (await openInspector.count()) > 0) {
    await openInspector.click();
  }
  await expect(inspectorHeading).toBeVisible({ timeout: 10000 });
  const computerTab = page.getByRole('tab', { name: 'Computer' });
  await computerTab.click();
}

test.describe('Computer tab and step screenshots', () => {
  test('Computer tab shows viewport area (placeholder or screenshot or Sandbox)', async ({
    page,
  }) => {
    await login(page);

    const newChatBtn = page.locator('[data-testid="new-chat-button"]');
    await newChatBtn.click();
    await page.waitForURL(/\/chat\/[^/]+/, { timeout: 15000 });

    const computerSwitch = page.getByRole('switch', { name: /toggle computer mode/i });
    if ((await computerSwitch.getAttribute('data-state')) === 'unchecked') {
      await computerSwitch.click();
    }

    await openInspectorAndComputerTab(page);

    const placeholder = page.locator('[data-testid="computer-viewport-placeholder"]');
    const viewport = page.locator('[data-testid="browser-viewport"]');
    const screenshotImg = page.locator('[data-testid="browser-viewport-screenshot"]');
    const sandboxSection = page.getByText('Sandbox:');

    await expect(
      placeholder.or(viewport).or(screenshotImg).or(sandboxSection)
    ).toBeVisible({ timeout: 10000 });
  });

  test('sending PPT message shows placeholder then step screenshots can appear', async ({
    page,
  }) => {
    test.skip(!!process.env.CI, 'skip in CI');
    await login(page);

    const newChatBtn = page.locator('[data-testid="new-chat-button"]');
    await newChatBtn.click();
    await page.waitForURL(/\/chat\/[^/]+/, { timeout: 15000 });

    const chatInput = page.locator('[data-testid="chat-input"]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    const computerSwitch = page.getByRole('switch', { name: /toggle computer mode/i });
    if ((await computerSwitch.getAttribute('data-state')) === 'unchecked') {
      await computerSwitch.click();
    }

    await chatInput.fill('Make a 1-slide PPT about cats.');
    await chatInput.press('Enter');

    await openInspectorAndComputerTab(page);

    const placeholder = page.locator('[data-testid="computer-viewport-placeholder"]');
    await expect(placeholder).toBeVisible({ timeout: 15000 });
    await expect(placeholder.getByText(/No visual steps yet|Snapshot unavailable for this step/i)).toBeVisible();

    const screenshotImg = page.locator('[data-testid="browser-viewport-screenshot"]');
    const browserOff = page.getByText('Browser view is off');
    const snapshotUnavailable = placeholder.getByText(/Snapshot unavailable for this step/i);
    await expect
      .poll(
        async () => {
          const screenshotVisible = await screenshotImg.first().isVisible().catch(() => false);
          const browserOffVisible = await browserOff.first().isVisible().catch(() => false);
          const snapshotUnavailableVisible = await snapshotUnavailable.first().isVisible().catch(() => false);
          return screenshotVisible || browserOffVisible || snapshotUnavailableVisible;
        },
        { timeout: 90000 }
      )
      .toBe(true);
  });
});
