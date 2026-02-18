import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useChatStore } from '../../../stores/chatStore';
import { ComputerPanel } from '../ComputerPanel';

vi.mock('../../../hooks/useBrowserStream', () => ({
  useBrowserStream: () => ({
    frameDataUrl: null,
    status: 'idle',
    error: null,
  }),
}));

describe('ComputerPanel', () => {
  beforeEach(() => {
    useChatStore.setState({
      isStreaming: false,
      streamingSessionId: null,
      selectedMessageId: null,
      messages: new Map(),
      terminalLines: new Map(),
      executionSteps: new Map(),
      sandboxFiles: new Map(),
      sandboxStatus: 'idle',
      pptPipeline: new Map(),
      isPptTask: new Map(),
      files: new Map(),
      browserSession: new Map(),
      agentSteps: new Map(),
      agentRunStartIndex: new Map(),
    });
  });

  it('renders neutral empty state when no computer activity exists', () => {
    render(<ComputerPanel sessionId="session-empty" compact />);

    expect(screen.getByTestId('computer-empty-state')).toBeInTheDocument();
    expect(screen.queryByText('Browser view is off')).not.toBeInTheDocument();
  });

  it('shows synthesized replay snapshot (not browser-off) for historical timeline steps without snapshots', () => {
    useChatStore.setState({
      messages: new Map([
        [
          'session-history',
          [
            {
              id: 'msg-history',
              sessionId: 'session-history',
              role: 'assistant',
              content: 'history',
              createdAt: new Date(),
            },
          ],
        ],
      ]),
      browserSession: new Map([
        [
          'session-history',
          {
            active: false,
            currentUrl: 'https://example.com',
            currentTitle: 'Example',
            status: 'closed',
            actions: [],
            currentActionIndex: 0,
          },
        ],
      ]),
      agentSteps: new Map([
        [
          'session-history',
          {
            currentStepIndex: 0,
            steps: [
              {
                stepIndex: 0,
                messageId: 'msg-history',
                type: 'browse',
                output: 'Visit page',
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now(),
                  url: 'https://example.com',
                  metadata: {
                    actionDescription: 'Visit page',
                  },
                },
              },
            ],
          },
        ],
      ]),
    });

    render(<ComputerPanel sessionId="session-history" compact />);

    expect(screen.getByTestId('browser-viewport-screenshot')).toBeInTheDocument();
    expect(screen.queryByText('Browser view is off')).not.toBeInTheDocument();
  });

  it('renders selected historical task snapshot instead of latest run snapshot', () => {
    const oldShot =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>old</text></svg>');
    const newShot =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>new</text></svg>');

    useChatStore.setState({
      selectedMessageId: 'msg-old',
      isStreaming: true,
      streamingSessionId: 'session-history',
      messages: new Map([
        [
          'session-history',
          [
            {
              id: 'u1',
              sessionId: 'session-history',
              role: 'user',
              content: 'first',
              createdAt: new Date(),
            },
            {
              id: 'msg-old',
              sessionId: 'session-history',
              role: 'assistant',
              content: 'first reply',
              createdAt: new Date(),
            },
            {
              id: 'u2',
              sessionId: 'session-history',
              role: 'user',
              content: 'second',
              createdAt: new Date(),
            },
            {
              id: 'msg-new',
              sessionId: 'session-history',
              role: 'assistant',
              content: 'second reply',
              createdAt: new Date(),
            },
          ],
        ],
      ]),
      browserSession: new Map([
        [
          'session-history',
          {
            active: true,
            currentUrl: 'https://new.example.com',
            currentTitle: 'New',
            status: 'active',
            actions: [],
            currentActionIndex: 0,
          },
        ],
      ]),
      agentSteps: new Map([
        [
          'session-history',
          {
            currentStepIndex: 1,
            steps: [
              {
                stepIndex: 0,
                messageId: 'msg-old',
                type: 'browse',
                output: 'Old run',
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now() - 1000,
                  url: 'https://old.example.com',
                  screenshot: oldShot,
                  metadata: { actionDescription: 'Visit page' },
                },
              },
              {
                stepIndex: 1,
                messageId: 'msg-new',
                type: 'browse',
                output: 'New run',
                snapshot: {
                  stepIndex: 1,
                  timestamp: Date.now(),
                  url: 'https://new.example.com',
                  screenshot: newShot,
                  metadata: { actionDescription: 'Visit page' },
                },
              },
            ],
          },
        ],
      ]),
    });

    render(<ComputerPanel sessionId="session-history" compact />);

    const viewport = screen.getByTestId('browser-viewport-screenshot');
    expect(viewport).toHaveAttribute('src', oldShot);
  });

  it('does not reuse unrelated screenshot across different timeline URLs', () => {
    const shot =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>only-one</text></svg>');

    useChatStore.setState({
      messages: new Map([
        [
          'session-history',
          [
            {
              id: 'msg-history',
              sessionId: 'session-history',
              role: 'assistant',
              content: 'history',
              createdAt: new Date(),
            },
          ],
        ],
      ]),
      browserSession: new Map([
        [
          'session-history',
          {
            active: false,
            currentUrl: 'https://new.example.com',
            currentTitle: 'New',
            status: 'closed',
            actions: [
              {
                id: 'a1',
                type: 'navigate',
                url: 'https://new.example.com',
                timestamp: Date.now(),
                screenshotDataUrl: shot,
              },
            ],
            currentActionIndex: 0,
          },
        ],
      ]),
      agentSteps: new Map([
        [
          'session-history',
          {
            currentStepIndex: 1,
            steps: [
              {
                stepIndex: 0,
                messageId: 'msg-history',
                type: 'browse',
                output: 'First',
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now() - 1000,
                  url: 'https://first.example.com',
                  screenshot: shot,
                  metadata: { actionDescription: 'Visit page' },
                },
              },
              {
                stepIndex: 1,
                messageId: 'msg-history',
                type: 'browse',
                output: 'Second',
                snapshot: {
                  stepIndex: 1,
                  timestamp: Date.now(),
                  url: 'https://second.example.com',
                  metadata: { actionDescription: 'Visit page' },
                },
              },
            ],
          },
        ],
      ]),
    });

    render(<ComputerPanel sessionId="session-history" compact />);

    const screenshot = screen.getByTestId('browser-viewport-screenshot');
    expect(screenshot).toBeInTheDocument();
    expect(screenshot).not.toHaveAttribute('src', shot);
  });

  it('uses url-matched browser action screenshot when timeline step screenshot is missing', () => {
    const matchedShot =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>matched</text></svg>');

    useChatStore.setState({
      browserSession: new Map([
        [
          'session-history',
          {
            active: false,
            currentUrl: 'https://hitconsultant.net/category/health-it/page/857/',
            currentTitle: 'Page 857',
            status: 'closed',
            actions: [
              {
                id: 'a1',
                type: 'navigate',
                url: 'https://hitconsultant.net/category/health-it/page/856/',
                timestamp: Date.now() - 1000,
              },
              {
                id: 'a2',
                type: 'navigate',
                url: 'https://hitconsultant.net/category/health-it/page/857',
                timestamp: Date.now(),
                screenshotDataUrl: matchedShot,
              },
            ],
            currentActionIndex: 1,
          },
        ],
      ]),
      agentSteps: new Map([
        [
          'session-history',
          {
            currentStepIndex: 0,
            steps: [
              {
                stepIndex: 0,
                type: 'browse',
                output: 'Visit page',
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now(),
                  url: 'https://hitconsultant.net/category/health-it/page/857/',
                  metadata: { actionDescription: 'Visit page' },
                },
              },
            ],
          },
        ],
      ]),
    });

    render(<ComputerPanel sessionId="session-history" compact />);

    expect(screen.queryByText(/Snapshot unavailable for this step/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('browser-viewport-screenshot')).toHaveAttribute('src', matchedShot);
  });

  it('starts live run timeline from step 1 using run start index', () => {
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-live',
      browserSession: new Map([
        [
          'session-live',
          {
            active: true,
            currentUrl: 'https://new.example.com',
            currentTitle: 'New',
            status: 'active',
            actions: [],
            currentActionIndex: 0,
          },
        ],
      ]),
      agentRunStartIndex: new Map([['session-live', 3]]),
      agentSteps: new Map([
        [
          'session-live',
          {
            currentStepIndex: 3,
            steps: [
              {
                stepIndex: 0,
                type: 'browse',
                output: 'Old 1',
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now() - 3000,
                  url: 'https://old-1.example.com',
                  metadata: { actionDescription: 'Visit page' },
                },
              },
              {
                stepIndex: 1,
                type: 'browse',
                output: 'Old 2',
                snapshot: {
                  stepIndex: 1,
                  timestamp: Date.now() - 2000,
                  url: 'https://old-2.example.com',
                  metadata: { actionDescription: 'Visit page' },
                },
              },
              {
                stepIndex: 2,
                type: 'browse',
                output: 'Old 3',
                snapshot: {
                  stepIndex: 2,
                  timestamp: Date.now() - 1000,
                  url: 'https://old-3.example.com',
                  metadata: { actionDescription: 'Visit page' },
                },
              },
              {
                stepIndex: 3,
                type: 'browse',
                output: 'New 1',
                snapshot: {
                  stepIndex: 3,
                  timestamp: Date.now(),
                  url: 'https://new.example.com',
                  metadata: { actionDescription: 'Visit page' },
                },
              },
            ],
          },
        ],
      ]),
    });

    render(<ComputerPanel sessionId="session-live" compact />);

    expect(screen.getByText('Step 1 of 1')).toBeInTheDocument();
  });

  it('reuses nearest snapshot for non-url final steps to avoid empty completed viewport', () => {
    const shot =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>visit</text></svg>');

    useChatStore.setState({
      messages: new Map([
        [
          'session-finished',
          [
            {
              id: 'msg-finished',
              sessionId: 'session-finished',
              role: 'assistant',
              content: 'done',
              createdAt: new Date(),
            },
          ],
        ],
      ]),
      browserSession: new Map([
        [
          'session-finished',
          {
            active: false,
            currentUrl: 'https://example.com',
            currentTitle: 'Example',
            status: 'closed',
            actions: [],
            currentActionIndex: 0,
          },
        ],
      ]),
      agentSteps: new Map([
        [
          'session-finished',
          {
            currentStepIndex: 1,
            steps: [
              {
                stepIndex: 0,
                messageId: 'msg-finished',
                type: 'browse',
                output: 'Visit page',
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now() - 1000,
                  url: 'https://example.com',
                  screenshot: shot,
                  metadata: { actionDescription: 'Visit page' },
                },
              },
              {
                stepIndex: 1,
                messageId: 'msg-finished',
                type: 'finalize',
                output: 'Completed',
                snapshot: {
                  stepIndex: 1,
                  timestamp: Date.now(),
                  metadata: { actionDescription: 'Browser closed' },
                },
              },
            ],
          },
        ],
      ]),
    });

    render(<ComputerPanel sessionId="session-finished" compact />);

    expect(screen.queryByText(/Snapshot unavailable for this step/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('browser-viewport-screenshot')).toHaveAttribute('src', shot);
  });

  it('does not show stale browser timeline when latest assistant message has no computer steps', () => {
    const shot =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>stale</text></svg>');

    useChatStore.setState({
      messages: new Map([
        [
          'session-stale',
          [
            {
              id: 'u-old',
              sessionId: 'session-stale',
              role: 'user',
              content: 'old prompt',
              createdAt: new Date(Date.now() - 2000),
            },
            {
              id: 'msg-old',
              sessionId: 'session-stale',
              role: 'assistant',
              content: 'old answer',
              createdAt: new Date(Date.now() - 1900),
            },
            {
              id: 'u-new',
              sessionId: 'session-stale',
              role: 'user',
              content: 'hi',
              createdAt: new Date(Date.now() - 1000),
            },
            {
              id: 'msg-new',
              sessionId: 'session-stale',
              role: 'assistant',
              content: 'Hi! How can I help you today?',
              createdAt: new Date(Date.now() - 900),
            },
          ],
        ],
      ]),
      browserSession: new Map([
        [
          'session-stale',
          {
            active: false,
            currentUrl: 'https://example.com',
            currentTitle: 'Example',
            status: 'closed',
            actions: [
              {
                id: 'a1',
                type: 'navigate',
                url: 'https://example.com',
                timestamp: Date.now() - 1500,
                screenshotDataUrl: shot,
              },
            ],
            currentActionIndex: 0,
          },
        ],
      ]),
      agentSteps: new Map([
        [
          'session-stale',
          {
            currentStepIndex: 0,
            steps: [
              {
                stepIndex: 0,
                messageId: 'msg-old',
                type: 'browse',
                output: 'Visit page',
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now() - 1500,
                  url: 'https://example.com',
                  metadata: { actionDescription: 'Visit page' },
                },
              },
            ],
          },
        ],
      ]),
    });

    render(<ComputerPanel sessionId="session-stale" compact />);

    expect(screen.getByTestId('computer-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-viewport-screenshot')).not.toBeInTheDocument();
  });

  it('restores historical snapshots by timestamp window when messageId scope is missing', () => {
    const oldShot =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>old-window</text></svg>');
    const newShot =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>new-window</text></svg>');

    const now = Date.now();
    const oldAssistantAt = new Date(now - 3000);
    const newAssistantAt = new Date(now - 1000);

    useChatStore.setState({
      selectedMessageId: 'msg-old',
      messages: new Map([
        [
          'session-window-scope',
          [
            {
              id: 'u-old',
              sessionId: 'session-window-scope',
              role: 'user',
              content: 'old',
              createdAt: new Date(now - 3500),
            },
            {
              id: 'msg-old',
              sessionId: 'session-window-scope',
              role: 'assistant',
              content: 'old reply',
              createdAt: oldAssistantAt,
            },
            {
              id: 'u-new',
              sessionId: 'session-window-scope',
              role: 'user',
              content: 'new',
              createdAt: new Date(now - 1500),
            },
            {
              id: 'msg-new',
              sessionId: 'session-window-scope',
              role: 'assistant',
              content: 'new reply',
              createdAt: newAssistantAt,
            },
          ],
        ],
      ]),
      browserSession: new Map([
        [
          'session-window-scope',
          {
            active: false,
            currentUrl: 'https://new.example.com',
            currentTitle: 'New',
            status: 'closed',
            actions: [],
            currentActionIndex: 0,
          },
        ],
      ]),
      agentSteps: new Map([
        [
          'session-window-scope',
          {
            currentStepIndex: 1,
            steps: [
              {
                stepIndex: 0,
                // Intentionally missing messageId to simulate historical scope loss
                type: 'browse',
                output: 'Old run',
                snapshot: {
                  stepIndex: 0,
                  timestamp: oldAssistantAt.getTime() - 100,
                  url: 'https://old.example.com',
                  screenshot: oldShot,
                  metadata: { actionDescription: 'Visit page' },
                },
              },
              {
                stepIndex: 1,
                // Intentionally missing messageId to simulate historical scope loss
                type: 'browse',
                output: 'New run',
                snapshot: {
                  stepIndex: 1,
                  timestamp: newAssistantAt.getTime() - 100,
                  url: 'https://new.example.com',
                  screenshot: newShot,
                  metadata: { actionDescription: 'Visit page' },
                },
              },
            ],
          },
        ],
      ]),
    });

    render(<ComputerPanel sessionId="session-window-scope" compact />);

    const viewport = screen.getByTestId('browser-viewport-screenshot');
    expect(viewport).toHaveAttribute('src', oldShot);
  });

  it('does not show stale standalone browser timeline while streaming with no run-scoped steps', () => {
    const staleShot =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>stale-live</text></svg>');

    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-live-stale',
      selectedMessageId: null,
      browserSession: new Map([
        [
          'session-live-stale',
          {
            active: true,
            currentUrl: 'https://example.com',
            currentTitle: 'Example',
            status: 'active',
            actions: [
              {
                id: 'a-old',
                type: 'navigate',
                url: 'https://example.com',
                timestamp: Date.now() - 1000,
                screenshotDataUrl: staleShot,
              },
            ],
            currentActionIndex: 0,
          },
        ],
      ]),
      agentRunStartIndex: new Map([['session-live-stale', 1]]),
      agentSteps: new Map([
        [
          'session-live-stale',
          {
            currentStepIndex: 0,
            steps: [
              {
                stepIndex: 0,
                messageId: 'msg-old',
                type: 'browse',
                output: 'Old run step',
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now() - 2000,
                  url: 'https://example.com',
                  metadata: { actionDescription: 'Visit page' },
                },
              },
            ],
          },
        ],
      ]),
    });

    render(<ComputerPanel sessionId="session-live-stale" compact />);

    expect(screen.getByTestId('computer-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-viewport-screenshot')).not.toBeInTheDocument();
  });
});
