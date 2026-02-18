import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocumentRenderer } from '../DocumentRenderer';
import { useChatStore } from '../../../stores/chatStore';

vi.mock('../../../hooks/useChat', () => ({
  useSessionMessages: vi.fn(),
}));

import { useSessionMessages } from '../../../hooks/useChat';

describe('DocumentRenderer artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      messages: new Map(),
      streamingContent: '',
      isStreaming: false,
      isThinking: false,
      streamingSessionId: null,
      toolCalls: new Map(),
      selectedMessageId: null,
      inspectorOpen: false,
    });
  });

  it('does not render stale file artifact from a different assistant message', () => {
    vi.mocked(useSessionMessages).mockReturnValue({
      data: [
        {
          id: 'assistant-new',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Hi! How can I help today?',
          createdAt: new Date(),
        },
      ],
      isLoading: false,
      error: null,
    } as any);

    useChatStore.setState({
      toolCalls: new Map([
        [
          'tool-old',
          {
            sessionId: 'session-1',
            messageId: 'assistant-old',
            toolCallId: 'tool-old',
            toolName: 'ppt_generator',
            params: {},
            status: 'completed',
            result: {
              success: true,
              output: 'done',
              duration: 10,
              artifacts: [
                {
                  type: 'file',
                  name: 'ai_ml_time_series_forecasting_papers.pptx',
                  fileId: 'file-old',
                  mimeType:
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                  size: 200240,
                  content: '',
                },
              ],
            },
          },
        ],
      ]),
    });

    render(<DocumentRenderer sessionId="session-1" />);

    expect(screen.queryByText('ai_ml_time_series_forecasting_papers.pptx')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });

  it('renders artifact only when tool call belongs to the same assistant message', () => {
    vi.mocked(useSessionMessages).mockReturnValue({
      data: [
        {
          id: 'assistant-new',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Presentation is ready.',
          createdAt: new Date(),
        },
      ],
      isLoading: false,
      error: null,
    } as any);

    useChatStore.setState({
      toolCalls: new Map([
        [
          'tool-new',
          {
            sessionId: 'session-1',
            messageId: 'assistant-new',
            toolCallId: 'tool-new',
            toolName: 'ppt_generator',
            params: {},
            status: 'completed',
            result: {
              success: true,
              output: 'done',
              duration: 10,
              artifacts: [
                {
                  type: 'file',
                  name: 'deck.pptx',
                  fileId: 'file-new',
                  mimeType:
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                  size: 1234,
                  content: '',
                },
              ],
            },
          },
        ],
      ]),
    });

    render(<DocumentRenderer sessionId="session-1" />);

    expect(screen.getByText('deck.pptx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('hides internal search-results.json artifacts from message output', () => {
    vi.mocked(useSessionMessages).mockReturnValue({
      data: [
        {
          id: 'assistant-search',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Here are the results.',
          createdAt: new Date(),
        },
      ],
      isLoading: false,
      error: null,
    } as any);

    useChatStore.setState({
      toolCalls: new Map([
        [
          'tool-search',
          {
            sessionId: 'session-1',
            messageId: 'assistant-search',
            toolCallId: 'tool-search',
            toolName: 'web_search',
            params: {},
            status: 'completed',
            result: {
              success: true,
              output: 'done',
              duration: 10,
              artifacts: [
                {
                  type: 'file',
                  name: 'search-results.json',
                  fileId: 'file-search',
                  mimeType: 'application/json',
                  size: 1200,
                  content: '{}',
                },
              ],
            },
          },
        ],
      ]),
    });

    render(<DocumentRenderer sessionId="session-1" />);

    expect(screen.queryByText('search-results.json')).not.toBeInTheDocument();
  });

  it('hides internal video-probe.json artifacts from message output', () => {
    vi.mocked(useSessionMessages).mockReturnValue({
      data: [
        {
          id: 'assistant-video',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Video analysis done.',
          createdAt: new Date(),
        },
      ],
      isLoading: false,
      error: null,
    } as any);

    useChatStore.setState({
      toolCalls: new Map([
        [
          'tool-video-probe',
          {
            sessionId: 'session-1',
            messageId: 'assistant-video',
            toolCallId: 'tool-video-probe',
            toolName: 'video_probe',
            params: {},
            status: 'completed',
            result: {
              success: true,
              output: 'done',
              duration: 10,
              artifacts: [
                {
                  type: 'data',
                  name: 'video-probe.json',
                  mimeType: 'application/json',
                  content: '{}',
                },
              ],
            },
          },
        ],
      ]),
    });

    render(<DocumentRenderer sessionId="session-1" />);

    expect(screen.queryByText('video-probe.json')).not.toBeInTheDocument();
  });

  it('does not render thinking indicator when stream is already complete', () => {
    vi.mocked(useSessionMessages).mockReturnValue({
      data: [
        {
          id: 'assistant-done',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'All done.',
          createdAt: new Date(),
        },
      ],
      isLoading: false,
      error: null,
    } as any);

    useChatStore.setState({
      isStreaming: false,
      isThinking: true,
      streamingSessionId: 'session-1',
    });

    render(<DocumentRenderer sessionId="session-1" />);

    expect(screen.queryByText('thinking...')).not.toBeInTheDocument();
  });
});
