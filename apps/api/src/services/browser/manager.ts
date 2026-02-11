/**
 * Browser Manager
 * Manages Playwright Chromium browser instances per agent session
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page, CDPSession } from 'playwright';
import type { BrowserSessionInfo, BrowserConfig } from './types';
import { getConfig } from '../config';
import type { AppConfig } from '../config';
import { getFrameBufferService } from './frame-buffer';

type ScreencastFrameHandler = (params: { data: string; sessionId: number; metadata?: unknown }) => void;

export interface BrowserSession {
  sessionId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdpSession: CDPSession;
  screencastActive: boolean;
  screencastHandler?: ScreencastFrameHandler;
  createdAt: number;
  currentUrl?: string;
  currentTitle?: string;
  idleTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

function getBrowserConfig(): BrowserConfig | null {
  const config = getConfig() as AppConfig;
  const browser = config.browser;
  if (!browser || !browser.enabled) return null;
  return browser;
}

/**
 * BrowserManager - Manages Playwright Chromium instances per session
 */
export class BrowserManager {
  private sessions: Map<string, BrowserSession> = new Map();
  private config: BrowserConfig | null = null;

  constructor() {
    this.config = getBrowserConfig();
  }

  /**
   * Check if browser mode is enabled
   */
  isEnabled(): boolean {
    return this.config?.enabled ?? false;
  }

  /**
   * Get current session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Check if we can create a new session (under max concurrent)
   */
  canCreateSession(): boolean {
    if (!this.config) return false;
    return this.sessions.size < this.config.maxConcurrentSessions;
  }

  /**
   * Create a new browser session for the given sessionId
   */
  async create(sessionId: string): Promise<BrowserSession> {
    const config = this.config;
    if (!config) {
      throw new Error('Browser mode is not enabled');
    }
    if (!this.canCreateSession()) {
      throw new Error(
        `Max concurrent browser sessions (${config.maxConcurrentSessions}) reached`
      );
    }
    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId)!;
      return existing;
    }

    const viewport = config.viewport ?? DEFAULT_VIEWPORT;

    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-background-networking',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      },
    });

    const page = await context.newPage();
    const cdpSession = await context.newCDPSession(page);

    const browserSession: BrowserSession = {
      sessionId,
      browser,
      context,
      page,
      cdpSession,
      screencastActive: false,
      createdAt: Date.now(),
    };

    this.sessions.set(sessionId, browserSession);

    if (config.idleTimeoutMs > 0) {
      browserSession.idleTimer = setTimeout(() => {
        this.destroy(sessionId).catch((err) =>
          console.error('[BrowserManager] Idle destroy error:', err)
        );
      }, config.idleTimeoutMs);
    }

    return browserSession;
  }

  /**
   * Get existing browser session
   */
  getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get page for session (convenience; creates session if enabled and not exists)
   */
  async getPage(sessionId: string): Promise<Page | null> {
    let session = this.sessions.get(sessionId);
    if (!session && this.canCreateSession()) {
      session = await this.create(sessionId);
    }
    if (session?.idleTimer) {
      clearTimeout(session.idleTimer);
      const config = this.config;
      if (config?.idleTimeoutMs) {
        session.idleTimer = setTimeout(() => {
          this.destroy(sessionId).catch((err) =>
            console.error('[BrowserManager] Idle destroy error:', err)
          );
        }, config.idleTimeoutMs);
      }
    }
    return session?.page ?? null;
  }

  /**
   * Start CDP screencast for a session; pushes frames to FrameBufferService for WebSocket clients.
   */
  async startScreencast(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.screencastActive) return !!session?.screencastActive;

    const config = this.config;
    const screencast = config?.screencast ?? { format: 'jpeg' as const, quality: 60 };
    const frameBuffer = getFrameBufferService();

    const handler: ScreencastFrameHandler = (params) => {
      try {
        const data = Buffer.from(params.data, 'base64');
        frameBuffer.push(sessionId, data, params.metadata as any);
        void session.cdpSession.send('Page.screencastFrameAck', { sessionId: params.sessionId });
      } catch (err) {
        console.error('[BrowserManager] Screencast frame error:', err);
      }
    };

    try {
      await session.cdpSession.send('Page.startScreencast', {
        format: screencast.format ?? 'jpeg',
        quality: screencast.quality ?? 60,
        maxWidth: screencast.maxWidth ?? 1280,
        maxHeight: screencast.maxHeight ?? 720,
        everyNthFrame: screencast.everyNthFrame ?? 1,
      });
      session.cdpSession.on('Page.screencastFrame', handler);
      session.screencastHandler = handler;
      session.screencastActive = true;
      return true;
    } catch (err) {
      console.error('[BrowserManager] startScreencast error:', err);
      return false;
    }
  }

  /**
   * Stop CDP screencast for a session.
   */
  async stopScreencast(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.screencastActive) return;
    try {
      await session.cdpSession.send('Page.stopScreencast');
      if (session.screencastHandler) {
        session.cdpSession.off('Page.screencastFrame', session.screencastHandler);
        session.screencastHandler = undefined;
      }
      session.screencastActive = false;
    } catch (_) {
      session.screencastActive = false;
    }
  }

  /**
   * Update current URL/title for session (called by tools after navigation)
   */
  setCurrentUrl(sessionId: string, url: string, title?: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.currentUrl = url;
      session.currentTitle = title;
    }
  }

  /**
   * Get session info for SSE/UI
   */
  getSessionInfo(sessionId: string): BrowserSessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return {
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      status: 'active',
      currentUrl: session.currentUrl,
      currentTitle: session.currentTitle,
      screencastActive: session.screencastActive,
    };
  }

  /**
   * Destroy a browser session
   */
  async destroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }

    void this.stopScreencast(sessionId);
    getFrameBufferService().clear(sessionId);
    this.sessions.delete(sessionId);

    try {
      await session.cdpSession.detach();
    } catch (_) {
      // ignore
    }
    try {
      await session.context.close();
    } catch (_) {
      // ignore
    }
    try {
      await session.browser.close();
    } catch (err) {
      console.error('[BrowserManager] Browser close error:', err);
    }
  }

  /**
   * Destroy all sessions (e.g. on shutdown)
   */
  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.destroy(id)));
  }
}

let managerInstance: BrowserManager | null = null;

export function getBrowserManager(): BrowserManager {
  if (!managerInstance) {
    managerInstance = new BrowserManager();
  }
  return managerInstance;
}

export function resetBrowserManager(): void {
  if (managerInstance) {
    managerInstance.destroyAll();
    managerInstance = null;
  }
}
