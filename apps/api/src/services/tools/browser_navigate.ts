import type { Tool, ToolResult, ToolContext } from './types';
import { getBrowserManager } from '../browser/manager';
import { normalizeWebSearchUrl } from '../browser/orchestrator';

/**
 * Browser Navigate Tool
 * Navigate to a URL in the real browser. Use when you need to open or go to a specific webpage.
 */
export class BrowserNavigateTool implements Tool {
  name = 'browser_navigate';
  description =
    'Navigate the browser to a URL. Opens or navigates to the given web page. Returns the page title and final URL after load. Use this to open websites the user or research requires.';
  requiresConfirmation = false;
  timeout = 30000;

  inputSchema = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string' as const,
        description: 'Full URL to navigate to (e.g., https://example.com)',
      },
    },
    required: ['url'],
  };

  constructor(private context: ToolContext) {}

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now();
    const urlRaw = String(params.url ?? '').trim();
    const url = normalizeWebSearchUrl(urlRaw);
    if (!url) {
      return {
        success: false,
        output: '',
        error: 'url is required',
        duration: Date.now() - startTime,
      };
    }

    const manager = getBrowserManager();
    const page = await manager.getPage(this.context.sessionId);
    if (!page) {
      return {
        success: false,
        output: '',
        error: 'Browser is not available. Enable browser mode in configuration.',
        duration: Date.now() - startTime,
      };
    }

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout });
      const title = await page.title();
      const finalUrl = page.url();
      manager.setCurrentUrl(this.context.sessionId, finalUrl, title);

      return {
        success: true,
        output: `Navigated to ${finalUrl}. Title: ${title}. Status: ${response?.status() ?? 'unknown'}.`,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Navigation failed';
      return {
        success: false,
        output: '',
        error: message,
        duration: Date.now() - startTime,
      };
    }
  }
}
