import { test } from '@playwright/test';

const VIDEO_PROMPT = '请总结这个视频主要内容： https://www.bilibili.com/video/BV1ZpzhBLE82';
const FOLLOWUP_PROMPT = '总结transcripts内容为500字左右的文章';

async function login(page: any) {
  await page.request.post('/api/auth/register', {
    data: { email: 'test@example.com', password: 'test-password' },
  }).catch(() => {});
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

test('capture two assistant outputs', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  await login(page);

  await page.locator('[data-testid="new-chat-button"]').click();
  await page.waitForURL(/\/chat\/[^/]+/, { timeout: 15000 });

  const chatInput = page.locator('[data-testid="chat-input"]');
  const sendBtn = page.getByRole('button', { name: /send message/i });
  const assistantMessages = page.locator('[data-testid="assistant-message"]');

  await chatInput.fill(VIDEO_PROMPT);
  await chatInput.press('Enter');
  await sendBtn.waitFor({ state: 'visible', timeout: 420000 });
  const first = ((await assistantMessages.last().textContent()) || '').trim();

  await chatInput.fill(FOLLOWUP_PROMPT);
  await chatInput.press('Enter');
  await sendBtn.waitFor({ state: 'visible', timeout: 420000 });
  const second = ((await assistantMessages.last().textContent()) || '').trim();

  console.log('===FIRST_OUTPUT_BEGIN===');
  console.log(first);
  console.log('===FIRST_OUTPUT_END===');
  console.log('===SECOND_OUTPUT_BEGIN===');
  console.log(second);
  console.log('===SECOND_OUTPUT_END===');
});
