import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatContainer } from '../ChatContainer';
import { useChatStore } from '../../../stores/chatStore';
import { apiClient } from '../../../lib/api';

vi.mock('../../canvas/DocumentCanvas', () => ({
  DocumentCanvas: () => <div data-testid="document-canvas" />,
}));

vi.mock('../ChatInput', () => ({
  ChatInput: ({ onSend }: { onSend: (content: string) => Promise<void> }) => (
    <button onClick={() => void onSend('hello')}>send</button>
  ),
}));

vi.mock('../../../hooks/useSessions', () => ({
  useSession: vi.fn(() => ({
    data: { id: 'session-1' },
    isLoading: false,
    error: null,
  })),
}));

vi.mock('../../../hooks/useChatLayout', () => ({
  useChatLayout: vi.fn(),
}));

vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('ChatContainer stream fallback cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      isStreaming: false,
      isThinking: false,
      streamingSessionId: null,
      streamingContent: '',
      messages: new Map(),
      selectedMessageId: null,
    });
  });

  it('stops streaming when stream ends without message.complete', async () => {
    vi.spyOn(apiClient.chat, 'sendAndStream').mockImplementation(
      async function* () {
        yield {
          type: 'message.start',
          sessionId: 'session-1',
          timestamp: Date.now(),
          data: {},
        } as any;
        yield {
          type: 'thinking.start',
          sessionId: 'session-1',
          timestamp: Date.now(),
          data: {},
        } as any;
      }
    );

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ChatContainer sessionId="session-1" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByText('send'));

    await waitFor(() => {
      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.isThinking).toBe(false);
      expect(state.streamingSessionId).toBe(null);
    });
  });

  it('ignores trailing events after message.complete', async () => {
    vi.spyOn(apiClient.chat, 'sendAndStream').mockImplementation(
      async function* () {
        yield {
          type: 'message.start',
          sessionId: 'session-1',
          timestamp: Date.now(),
          data: {},
        } as any;
        yield {
          type: 'message.complete',
          sessionId: 'session-1',
          timestamp: Date.now(),
          data: { assistantMessageId: null },
        } as any;
        // Should never be processed because ChatContainer exits on terminal events.
        yield {
          type: 'message.start',
          sessionId: 'session-1',
          timestamp: Date.now(),
          data: {},
        } as any;
      }
    );

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ChatContainer sessionId="session-1" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByText('send'));

    await waitFor(() => {
      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.isThinking).toBe(false);
      expect(state.streamingSessionId).toBe(null);
    });
  });

  it('resets run start index on every new message.start event', async () => {
    const now = Date.now();
    useChatStore.setState({
      agentRunStartIndex: new Map([['session-1', 0]]),
      agentSteps: new Map([
        [
          'session-1',
          {
            currentStepIndex: 2,
            steps: [
              { stepIndex: 0, type: 'browse', output: 'old-1' },
              { stepIndex: 1, type: 'browse', output: 'old-2' },
              { stepIndex: 2, type: 'browse', output: 'old-3' },
            ],
          },
        ],
      ]),
    });

    vi.spyOn(apiClient.chat, 'sendAndStream').mockImplementation(
      async function* () {
        yield {
          type: 'message.start',
          sessionId: 'session-1',
          timestamp: now,
          data: {},
        } as any;
        yield {
          type: 'message.complete',
          sessionId: 'session-1',
          timestamp: now + 1,
          data: { assistantMessageId: null },
        } as any;
      }
    );

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ChatContainer sessionId="session-1" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByText('send'));

    await waitFor(() => {
      const runStart = useChatStore.getState().agentRunStartIndex.get('session-1');
      expect(runStart).toBe(3);
    });
  });
});
