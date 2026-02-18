import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useChatStore } from '../../../stores/chatStore';
import { ReasoningTrace } from '../ReasoningTrace';

describe('ReasoningTrace (Inspector)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useChatStore.setState({
      messages: new Map(),
      reasoningSteps: new Map(),
      toolCalls: new Map(),
      isStreaming: false,
      streamingSessionId: null,
    });
  });

  it('renders a normalized step timeline with user/debug modes and merged semantic phases', async () => {
    const sessionId = 'session-1';
    const now = Date.now();

    useChatStore.setState({
      messages: new Map([
        [
          sessionId,
          [
            {
              id: 'assistant-1',
              sessionId,
              role: 'assistant',
              content: 'answer',
              createdAt: new Date(now),
              metadata: {
                tokens: 321,
                duration: 1800,
                model: 'gpt-test',
              },
            },
          ],
        ],
      ]),
      reasoningSteps: new Map([
        [
          sessionId,
          [
            {
              stepId: 'r-1',
              label: 'Thinking',
              status: 'completed',
              startedAt: now - 5000,
              completedAt: now - 4000,
              durationMs: 1000,
              message: 'Planning approach.',
              thinkingContent: 'Draft internal reasoning.',
            },
            {
              stepId: 'r-2',
              label: 'Generating response',
              status: 'completed',
              startedAt: now - 3800,
              completedAt: now - 3300,
              durationMs: 500,
            },
            {
              stepId: 'r-3',
              label: 'Generating response',
              status: 'completed',
              startedAt: now - 3200,
              completedAt: now - 3000,
              durationMs: 200,
            },
            {
              stepId: 'tool-tc-1',
              label: 'Searching',
              status: 'completed',
              startedAt: now - 2800,
              completedAt: now - 2200,
              durationMs: 600,
              message: 'Looking up sources.',
            },
          ],
        ],
      ]),
      toolCalls: new Map([
        [
          'tc-1',
          {
            sessionId,
            toolCallId: 'tc-1',
            toolName: 'web_search',
            status: 'completed',
            params: { query: 'ai news', topic: 'news' },
            result: {
              success: true,
              output: 'Top result: https://example.com/article',
              duration: 12,
              artifacts: [
                {
                  type: 'data',
                  name: 'search-results.json',
                  content: JSON.stringify({
                    results: [
                      {
                        title: 'Example source',
                        url: 'https://example.com/article',
                        publishedAt: '2025-01-15T12:00:00Z',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
        [
          'tc-1-dup',
          {
            sessionId,
            toolCallId: 'tc-1-dup',
            toolName: 'web_search',
            status: 'completed',
            params: { query: 'ai news', topic: 'news' },
            result: {
              success: true,
              output: 'Top result: https://example.com/article',
              duration: 12,
              artifacts: [
                {
                  type: 'data',
                  name: 'search-results.json',
                  content: JSON.stringify({
                    results: [
                      {
                        title: 'Example source',
                        url: 'https://example.com/article',
                        publishedAt: '2025-01-15T12:00:00Z',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      ]),
    });

    render(<ReasoningTrace sessionId={sessionId} />);

    expect(screen.getByTestId('reasoning-trace-timeline')).toBeInTheDocument();
    expect(screen.getByText('Step 1: Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Step 2: Generate Answer')).toBeInTheDocument();
    expect(screen.getByText('Step 3: Tool Step')).toBeInTheDocument();
    const toolStepButton = screen.getByRole('button', { name: /Step 3: Tool Step/i });
    const durationColumn = toolStepButton.parentElement?.querySelector('.w-20') as HTMLElement | null;
    expect(durationColumn).toBeTruthy();
    expect(durationColumn?.querySelector('svg')).toBeNull();
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Query/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Sources (1)')).not.toBeInTheDocument();
    await userEvent.click(toolStepButton);

    expect(screen.getByRole('button', { name: /Query/i })).toBeInTheDocument();
    expect(screen.queryByText('ai news')).not.toBeInTheDocument();
    expect(screen.getByText('Sources (1)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Example source/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Query/i }));
    expect(screen.getByText('ai news')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Sources \(1\)/i }));
    expect(screen.getByRole('link', { name: /Example source/i })).toHaveAttribute(
      'href',
      'https://example.com/article'
    );

    expect(screen.queryByText('Response Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Request Params')).not.toBeInTheDocument();
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(screen.getByText('Draft internal reasoning.')).not.toBeVisible();

    await userEvent.click(screen.getByText('Thinking'));
    expect(screen.getByText('Draft internal reasoning.')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /Debug/i }));

    expect(screen.getByTestId('reasoning-debug-summary')).toHaveTextContent('Tokens: 321');
    expect(screen.getByText('Internal Reasoning')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Debug Details'));
    expect(screen.getByText('Request Params')).toBeInTheDocument();
    expect(screen.getByText('Raw Output')).toBeInTheDocument();
    expect(screen.getByText('Latency 0.01s')).toBeInTheDocument();
  });

  it('keeps sources on the referenced tool step even when duplicate signatures exist', async () => {
    const sessionId = 'session-dedup-order';
    const now = Date.now();

    useChatStore.setState({
      messages: new Map([
        [
          sessionId,
          [
            {
              id: 'assistant-dedup',
              sessionId,
              role: 'assistant',
              content: 'answer',
              createdAt: new Date(now),
            },
          ],
        ],
      ]),
      reasoningSteps: new Map([
        [
          sessionId,
          [
            {
              stepId: 'tool-tc-1',
              label: 'Searching',
              status: 'completed',
              startedAt: now - 1000,
              completedAt: now - 500,
              durationMs: 500,
            },
          ],
        ],
      ]),
      toolCalls: new Map([
        [
          'tc-1-dup',
          {
            sessionId,
            toolCallId: 'tc-1-dup',
            toolName: 'web_search',
            status: 'completed',
            params: { query: 'agent news' },
            result: {
              success: true,
              output: 'Top result: https://example.com/article',
              duration: 10,
              artifacts: [
                {
                  type: 'data',
                  name: 'search-results.json',
                  content: JSON.stringify({
                    results: [{ title: 'Example source', url: 'https://example.com/article' }],
                  }),
                },
              ],
            },
          },
        ],
        [
          'tc-1',
          {
            sessionId,
            toolCallId: 'tc-1',
            toolName: 'web_search',
            status: 'completed',
            params: { query: 'agent news' },
            result: {
              success: true,
              output: 'Top result: https://example.com/article',
              duration: 10,
              artifacts: [
                {
                  type: 'data',
                  name: 'search-results.json',
                  content: JSON.stringify({
                    results: [{ title: 'Example source', url: 'https://example.com/article' }],
                  }),
                },
              ],
            },
          },
        ],
      ]),
    });

    render(<ReasoningTrace sessionId={sessionId} />);

    expect(screen.queryByText('Step 2: Tool Step')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Step 1: Tool Step/i }));
    await userEvent.click(screen.getByRole('button', { name: /Sources \(1\)/i }));
    expect(screen.getByRole('link', { name: /Example source/i })).toBeInTheDocument();
  });

  it('attaches orphan tool data to unresolved tool step instead of rendering duplicate tool steps', async () => {
    const sessionId = 'session-unresolved-tool-step';
    const now = Date.now();

    useChatStore.setState({
      messages: new Map([
        [
          sessionId,
          [
            {
              id: 'assistant-unresolved',
              sessionId,
              role: 'assistant',
              content: 'answer',
              createdAt: new Date(now),
            },
          ],
        ],
      ]),
      reasoningSteps: new Map([
        [
          sessionId,
          [
            {
              stepId: 'r-1',
              label: 'Generating response',
              status: 'completed',
              startedAt: now - 4000,
              completedAt: now - 3500,
              durationMs: 500,
              message: 'Switching to tools...',
            },
            {
              stepId: 'tool-missing-id',
              label: 'Searching',
              status: 'completed',
              startedAt: now - 3000,
              completedAt: now - 2000,
              durationMs: 1000,
            },
            {
              stepId: 'r-2',
              label: 'Thinking',
              status: 'completed',
              startedAt: now - 1900,
              completedAt: now - 1600,
              durationMs: 300,
            },
          ],
        ],
      ]),
      toolCalls: new Map([
        [
          'tc-real',
          {
            sessionId,
            toolCallId: 'tc-real',
            toolName: 'web_search',
            status: 'completed',
            params: { query: 'ai machine learning industry news' },
            result: {
              success: true,
              output: 'Top result: https://example.com/article',
              duration: 1310,
              artifacts: [
                {
                  type: 'data',
                  name: 'search-results.json',
                  content: JSON.stringify({
                    results: [
                      { title: 'Example source', url: 'https://example.com/article' },
                      { title: 'Example source 2', url: 'https://example.org/article' },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      ]),
    });

    render(<ReasoningTrace sessionId={sessionId} />);

    const toolSteps = screen.getAllByText(/Step \d+: Tool Step/i);
    expect(toolSteps).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /Step 2: Tool Step/i }));
    await userEvent.click(screen.getByRole('button', { name: /Sources \(2\)/i }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('removes duplicate tool phases with identical tool signatures from the timeline', () => {
    const sessionId = 'session-duplicate-tool-phases';
    const now = Date.now();

    useChatStore.setState({
      messages: new Map([
        [
          sessionId,
          [
            {
              id: 'assistant-duplicate-tools',
              sessionId,
              role: 'assistant',
              content: 'answer',
              createdAt: new Date(now),
            },
          ],
        ],
      ]),
      reasoningSteps: new Map([
        [
          sessionId,
          [
            {
              stepId: 'tool-missing-1',
              label: 'Searching',
              status: 'completed',
              startedAt: now - 2000,
              completedAt: now - 1500,
              durationMs: 500,
            },
            {
              stepId: 'tool-missing-2',
              label: 'Searching',
              status: 'completed',
              startedAt: now - 1400,
              completedAt: now - 900,
              durationMs: 500,
            },
          ],
        ],
      ]),
      toolCalls: new Map([
        [
          'tc-dupe-1',
          {
            sessionId,
            toolCallId: 'tc-dupe-1',
            toolName: 'web_search',
            status: 'completed',
            params: { query: 'duplicate tool trace' },
            result: {
              success: true,
              output: 'https://example.com/a',
              duration: 15,
              artifacts: [],
            },
          },
        ],
        [
          'tc-dupe-2',
          {
            sessionId,
            toolCallId: 'tc-dupe-2',
            toolName: 'web_search',
            status: 'completed',
            params: { query: 'duplicate tool trace' },
            result: {
              success: true,
              output: 'https://example.com/a',
              duration: 15,
              artifacts: [],
            },
          },
        ],
      ]),
    });

    render(<ReasoningTrace sessionId={sessionId} />);

    const toolSteps = screen.getAllByText(/Step \d+: Tool Step/i);
    expect(toolSteps).toHaveLength(1);
  });

  it('collapses repeated blocked search retries into a single tool step', () => {
    const sessionId = 'session-redundant-search-blocks';
    const now = Date.now();
    const blockedReason =
      'Search already completed for this query. Synthesize your answer from the results already retrieved. Do not explain tool limitations to the user.';

    useChatStore.setState({
      messages: new Map([
        [
          sessionId,
          [
            {
              id: 'assistant-redundant-search',
              sessionId,
              role: 'assistant',
              content: 'answer',
              createdAt: new Date(now),
            },
          ],
        ],
      ]),
      reasoningSteps: new Map([
        [
          sessionId,
          [
            {
              stepId: 'tool-missing-1',
              label: 'Searching',
              status: 'completed',
              startedAt: now - 2000,
              completedAt: now - 1700,
              durationMs: 300,
            },
            {
              stepId: 'tool-missing-2',
              label: 'Searching',
              status: 'completed',
              startedAt: now - 1600,
              completedAt: now - 1300,
              durationMs: 300,
            },
          ],
        ],
      ]),
      toolCalls: new Map([
        [
          'tc-block-1',
          {
            sessionId,
            toolCallId: 'tc-block-1',
            toolName: 'web_search',
            status: 'failed',
            params: { query: 'ai threat insurance jobs' },
            error: blockedReason,
          },
        ],
        [
          'tc-block-2',
          {
            sessionId,
            toolCallId: 'tc-block-2',
            toolName: 'web_search',
            status: 'failed',
            params: { query: 'insurance ai jobs impact' },
            error: blockedReason,
          },
        ],
      ]),
    });

    render(<ReasoningTrace sessionId={sessionId} />);

    const toolSteps = screen.getAllByText(/Step \d+: Tool Step/i);
    expect(toolSteps).toHaveLength(1);
  });

  it('renders in deterministic step_index order regardless of insertion order', () => {
    const sessionId = 'session-step-index-order';
    const now = Date.now();

    useChatStore.setState({
      messages: new Map([
        [
          sessionId,
          [
            {
              id: 'assistant-order',
              sessionId,
              role: 'assistant',
              content: 'answer',
              createdAt: new Date(now),
            },
          ],
        ],
      ]),
      reasoningSteps: new Map([
        [
          sessionId,
          [
            {
              stepId: 'step-2',
              stepIndex: 2,
              label: 'Searching',
              status: 'completed',
              startedAt: now - 1500,
              completedAt: now - 1200,
              durationMs: 300,
            },
            {
              stepId: 'step-1',
              stepIndex: 1,
              label: 'Analyzing',
              status: 'completed',
              startedAt: now - 2000,
              completedAt: now - 1700,
              durationMs: 300,
            },
          ],
        ],
      ]),
      toolCalls: new Map([
        [
          'tool-2',
          {
            sessionId,
            toolCallId: 'tool-2',
            toolName: 'web_search',
            status: 'completed',
            params: { query: 'ordering test' },
            result: {
              success: true,
              output: 'https://example.com',
              duration: 10,
              artifacts: [],
            },
          },
        ],
      ]),
    });

    render(<ReasoningTrace sessionId={sessionId} />);
    const titles = screen.getAllByText(/Step \d+:/i).map((el) => el.textContent);
    expect(titles[0]).toContain('Step 1: Reasoning');
    expect(titles[1]).toContain('Step 2: Tool Step');
  });

  it('uses reasoning-step lifecycle as source-of-truth for tool step status', () => {
    const sessionId = 'session-tool-status-source';
    const now = Date.now();

    useChatStore.setState({
      messages: new Map([
        [
          sessionId,
          [
            {
              id: 'assistant-tool-status',
              sessionId,
              role: 'assistant',
              content: 'answer',
              createdAt: new Date(now),
            },
          ],
        ],
      ]),
      reasoningSteps: new Map([
        [
          sessionId,
          [
            {
              stepId: 'tool-tc-1',
              stepIndex: 1,
              label: 'Searching',
              status: 'completed',
              startedAt: now - 1000,
              completedAt: now - 500,
              durationMs: 500,
            },
          ],
        ],
      ]),
      toolCalls: new Map([
        [
          'tc-1',
          {
            sessionId,
            toolCallId: 'tc-1',
            toolName: 'web_search',
            status: 'running',
            params: { query: 'state machine status' },
          },
        ],
      ]),
    });

    render(<ReasoningTrace sessionId={sessionId} />);
    const toolStepButton = screen.getByRole('button', { name: /Step 1: Tool Step/i });
    const durationColumn = toolStepButton.parentElement?.querySelector('.w-20') as HTMLElement | null;
    expect(durationColumn?.querySelector('svg')).toBeNull();
  });

  it('shows elapsed timer for running orphan tool step using tool startedAt', () => {
    const sessionId = 'session-running-orphan';
    const now = Date.now();

    useChatStore.setState({
      messages: new Map([
        [
          sessionId,
          [
            {
              id: 'assistant-running',
              sessionId,
              role: 'assistant',
              content: 'working...',
              createdAt: new Date(now),
            },
          ],
        ],
      ]),
      reasoningSteps: new Map(),
      toolCalls: new Map([
        [
          'run-1',
          {
            sessionId,
            toolCallId: 'run-1',
            toolName: 'video_transcript',
            status: 'running',
            startedAt: now - 4300,
            params: { url: 'https://example.com/video' },
          },
        ],
      ]),
      isStreaming: true,
      streamingSessionId: sessionId,
    });

    render(<ReasoningTrace sessionId={sessionId} />);
    const toolStepButton = screen.getByRole('button', { name: /Step 1: Tool Step/i });
    const durationColumn = toolStepButton.parentElement?.querySelector('.w-20') as HTMLElement | null;
    expect(durationColumn).toBeTruthy();
    expect(durationColumn?.textContent).toContain('s');
    expect(durationColumn?.textContent).not.toContain('0.00s');
  });

  it('ui e2e simulation keeps at most one running step through a full trace', () => {
    const sessionId = 'session-ui-e2e-linear';
    const traceId = 'trace-ui-linear';
    const base = Date.now();
    let ts = base;
    const tick = () => {
      ts += 100;
      return ts;
    };

    useChatStore.setState({
      messages: new Map([
        [
          sessionId,
          [
            {
              id: 'assistant-ui-e2e',
              sessionId,
              role: 'assistant',
              content: 'answer',
              createdAt: new Date(base),
            },
          ],
        ],
      ]),
      reasoningSteps: new Map(),
      toolCalls: new Map(),
      isStreaming: true,
      streamingSessionId: sessionId,
    });

    render(<ReasoningTrace sessionId={sessionId} />);

    const apply = (event: {
      eventId: string;
      stepId: string;
      stepIndex: number;
      eventSeq: number;
      lifecycle: 'STARTED' | 'UPDATED' | 'FINISHED';
      label: string;
      finalStatus?: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
    }) =>
      act(() => {
        useChatStore.getState().applyReasoningEvent(sessionId, {
          eventId: event.eventId,
          traceId,
          stepId: event.stepId,
          stepIndex: event.stepIndex,
          eventSeq: event.eventSeq,
          lifecycle: event.lifecycle,
          timestamp: tick(),
          label: event.label,
          finalStatus: event.finalStatus,
        });
      });

    const assertSingleRunning = () => {
      expect(document.querySelectorAll('.animate-spin').length).toBeLessThanOrEqual(1);
    };

    apply({
      eventId: 'e1',
      stepId: 's1',
      stepIndex: 1,
      eventSeq: 1,
      lifecycle: 'STARTED',
      label: 'Generating response',
    });
    assertSingleRunning();

    apply({
      eventId: 'e2',
      stepId: 's2',
      stepIndex: 2,
      eventSeq: 1,
      lifecycle: 'STARTED',
      label: 'Reasoning',
    });
    assertSingleRunning();

    apply({
      eventId: 'e3',
      stepId: 's1',
      stepIndex: 1,
      eventSeq: 2,
      lifecycle: 'FINISHED',
      label: 'Generating response',
      finalStatus: 'SUCCEEDED',
    });
    assertSingleRunning();

    // Simulate tool call row while reasoning step is active.
    act(() => {
      useChatStore.setState((state) => ({
        toolCalls: new Map(state.toolCalls).set('tool-1', {
          sessionId,
          toolCallId: 'tool-1',
          toolName: 'video_probe',
          status: 'running',
          params: { url: 'https://www.bilibili.com/video/BV1GqcWzuELB' },
        } as any),
      }));
    });
    assertSingleRunning();

    apply({
      eventId: 'e4',
      stepId: 's2',
      stepIndex: 2,
      eventSeq: 2,
      lifecycle: 'FINISHED',
      label: 'Reasoning',
      finalStatus: 'SUCCEEDED',
    });
    assertSingleRunning();

    apply({
      eventId: 'e5',
      stepId: 'tool-tool-1',
      stepIndex: 3,
      eventSeq: 1,
      lifecycle: 'STARTED',
      label: 'Executing tool',
    });
    assertSingleRunning();

    apply({
      eventId: 'e6',
      stepId: 'tool-tool-1',
      stepIndex: 3,
      eventSeq: 2,
      lifecycle: 'FINISHED',
      label: 'Executing tool',
      finalStatus: 'SUCCEEDED',
    });
    assertSingleRunning();

    act(() => {
      useChatStore.getState().finalizeReasoningTrace(sessionId, tick());
      useChatStore.setState({ isStreaming: false, streamingSessionId: null });
    });
    assertSingleRunning();

    expect(screen.getByText('Step 1: Generate Answer')).toBeInTheDocument();
    expect(screen.getByText('Step 2: Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Step 3: Tool Step')).toBeInTheDocument();
    expect(document.querySelectorAll('.animate-spin').length).toBe(0);
  });
});
