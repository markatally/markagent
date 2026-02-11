import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import type { BrowserAction } from '../../packages/shared/src';

let useChatStore: typeof import('../../apps/web/src/stores/chatStore').useChatStore;

const createAction = (overrides: Partial<BrowserAction> = {}): BrowserAction => ({
  id: overrides.id ?? `action-${Date.now()}`,
  type: overrides.type ?? 'navigate',
  url: overrides.url,
  selector: overrides.selector,
  text: overrides.text,
  timestamp: overrides.timestamp ?? Date.now(),
  frameIndex: overrides.frameIndex,
  screenshotDataUrl: overrides.screenshotDataUrl,
});

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => {
    storage[k] = v;
  },
  removeItem: (k: string) => {
    delete storage[k];
  },
  clear: () => {
    for (const k of Object.keys(storage)) delete storage[k];
  },
  key: () => null,
  length: 0,
};

describe('Computer mode browser timeline', () => {
  beforeAll(async () => {
    (globalThis as any).localStorage = mockLocalStorage;
    const mod = await import('../../apps/web/src/stores/chatStore');
    useChatStore = mod.useChatStore;
  });

  beforeEach(() => {
    mockLocalStorage.removeItem('mark-agent-computer-session-1');
    mockLocalStorage.removeItem('mark-agent-computer-session-2');
    useChatStore.getState().clearBrowserSession('session-1');
    useChatStore.getState().clearBrowserSession('session-2');
  });

  it('should attach screenshots to each browser action in order', () => {
    const sessionId = 'session-1';
    const { addBrowserAction, setBrowserActionScreenshot } = useChatStore.getState();

    addBrowserAction(sessionId, createAction({ id: 'a1', type: 'navigate', url: 'https://example.com', timestamp: 1 }));
    setBrowserActionScreenshot(sessionId, 'data:image/jpeg;base64,one');

    addBrowserAction(sessionId, createAction({ id: 'a2', type: 'click', selector: '#submit', timestamp: 2 }));
    setBrowserActionScreenshot(sessionId, 'data:image/jpeg;base64,two');

    const actions = useChatStore.getState().browserSession.get(sessionId)?.actions ?? [];
    expect(actions).toHaveLength(2);
    expect(actions[0].screenshotDataUrl).toBe('data:image/jpeg;base64,one');
    expect(actions[1].screenshotDataUrl).toBe('data:image/jpeg;base64,two');
  });

  it('should store a screenshot for each of 5 steps so each step displays correctly', () => {
    const sessionId = 'session-1';
    const { addBrowserAction, setBrowserActionScreenshot } = useChatStore.getState();
    const urls = [
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
      'https://example.com/4',
      'https://example.com/5',
    ];
    for (let i = 0; i < 5; i++) {
      addBrowserAction(
        sessionId,
        createAction({ id: `step-${i}`, type: 'navigate', url: urls[i], timestamp: i })
      );
      setBrowserActionScreenshot(sessionId, `data:image/jpeg;base64,step-${i}`);
    }
    const actions = useChatStore.getState().browserSession.get(sessionId)?.actions ?? [];
    expect(actions).toHaveLength(5);
    actions.forEach((action, index) => {
      expect(action.screenshotDataUrl).toBe(`data:image/jpeg;base64,step-${index}`);
    });
  });

  it('should show correct screenshot when seeking timeline (currentActionIndex)', () => {
    const sessionId = 'session-1';
    const { addBrowserAction, setBrowserActionScreenshot, setBrowserActionIndex } = useChatStore.getState();
    for (let i = 0; i < 3; i++) {
      addBrowserAction(
        sessionId,
        createAction({ id: `a${i}`, type: 'navigate', url: `https://example.com/${i}`, timestamp: i })
      );
      setBrowserActionScreenshot(sessionId, `data:image/jpeg;base64,snap-${i}`);
    }
    const getSession = () => useChatStore.getState().browserSession.get(sessionId);
    expect(getSession()?.actions).toHaveLength(3);
    expect(getSession()?.currentActionIndex).toBe(2); // last added

    setBrowserActionIndex(sessionId, 0);
    expect(getSession()?.currentActionIndex).toBe(0);
    expect(getSession()?.actions[0]?.screenshotDataUrl).toBe('data:image/jpeg;base64,snap-0');

    setBrowserActionIndex(sessionId, 1);
    expect(getSession()?.currentActionIndex).toBe(1);
    expect(getSession()?.actions[1]?.screenshotDataUrl).toBe('data:image/jpeg;base64,snap-1');

    setBrowserActionIndex(sessionId, 2);
    expect(getSession()?.currentActionIndex).toBe(2);
    expect(getSession()?.actions[2]?.screenshotDataUrl).toBe('data:image/jpeg;base64,snap-2');
  });

  it('should ignore screenshot updates when no action exists', () => {
    const sessionId = 'session-2';
    useChatStore.getState().setBrowserActionScreenshot(sessionId, 'data:image/png;base64,noop');

    const session = useChatStore.getState().browserSession.get(sessionId);
    expect(session).toBeUndefined();
  });

  it('should persist and rehydrate browser state from localStorage (survives refresh)', () => {
    const sessionId = 'session-1';
    const COMPUTER_STATE_PREFIX = 'mark-agent-computer-';
    const { addBrowserAction, setBrowserActionScreenshot, clearBrowserSession, loadComputerStateFromStorage } =
      useChatStore.getState();

    addBrowserAction(sessionId, createAction({ id: 'a1', type: 'navigate', url: 'https://example.com', timestamp: 1 }));
    setBrowserActionScreenshot(sessionId, 'data:image/jpeg;base64,one');

    expect(useChatStore.getState().browserSession.get(sessionId)?.actions).toHaveLength(1);
    const saved = globalThis.localStorage.getItem(COMPUTER_STATE_PREFIX + sessionId);
    expect(saved).toBeTruthy();

    clearBrowserSession(sessionId);
    expect(useChatStore.getState().browserSession.get(sessionId)).toBeUndefined();
    globalThis.localStorage.setItem(COMPUTER_STATE_PREFIX + sessionId, saved!);

    loadComputerStateFromStorage(sessionId);
    const rehydrated = useChatStore.getState().browserSession.get(sessionId);
    expect(rehydrated?.actions).toHaveLength(1);
    expect(rehydrated?.actions[0].screenshotDataUrl).toBe('data:image/jpeg;base64,one');
  });

  it('should migrate legacy raw-base64 screenshots on hydration and clamp replay indexes', () => {
    const sessionId = 'session-1';
    const COMPUTER_STATE_PREFIX = 'mark-agent-computer-';
    const rawBase64 = 'A'.repeat(80);

    globalThis.localStorage.setItem(
      COMPUTER_STATE_PREFIX + sessionId,
      JSON.stringify({
        browserSession: {
          active: false,
          currentUrl: 'https://example.com',
          currentTitle: 'Example',
          status: 'closed',
          currentActionIndex: 8,
          actions: [
            {
              id: 'legacy-action',
              type: 'navigate',
              url: 'https://example.com',
              timestamp: 1,
              screenshotDataUrl: rawBase64,
            },
          ],
        },
        pptPipeline: {
          steps: [],
          browseActivity: [
            {
              action: 'visit',
              url: 'https://example.com',
              timestamp: 1,
              screenshotDataUrl: rawBase64,
            },
          ],
        },
        isPptTask: false,
        agentSteps: {
          currentStepIndex: 9,
          steps: [
            {
              stepIndex: 0,
              type: 'browse',
              snapshot: {
                stepIndex: 0,
                timestamp: 1,
                screenshot: rawBase64,
              },
            },
          ],
        },
      })
    );

    useChatStore.getState().loadComputerStateFromStorage(sessionId);

    const browserSession = useChatStore.getState().browserSession.get(sessionId);
    expect(browserSession?.currentActionIndex).toBe(0);
    expect(browserSession?.actions[0]?.screenshotDataUrl).toBe(`data:image/jpeg;base64,${rawBase64}`);

    const pipeline = useChatStore.getState().pptPipeline.get(sessionId);
    expect(pipeline?.browseActivity[0]?.screenshotDataUrl).toBe(`data:image/jpeg;base64,${rawBase64}`);

    const timeline = useChatStore.getState().agentSteps.get(sessionId);
    expect(timeline?.currentStepIndex).toBe(0);
    expect(timeline?.steps[0]?.snapshot?.screenshot).toBe(`data:image/jpeg;base64,${rawBase64}`);
  });
});
