import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chatStore';
import type { Message } from '@mark/shared';

describe('chatStore', () => {
  const getToolCallBySessionAndId = (sessionId: string, toolCallId: string) =>
    Array.from(useChatStore.getState().toolCalls.values()).find(
      (call) => call.sessionId === sessionId && call.toolCallId === toolCallId
    );

  beforeEach(() => {
    window.localStorage.clear();
    // Reset store state before each test
    useChatStore.setState({
      messages: new Map(),
      streamingSessionId: null,
      streamingContent: '',
      isStreaming: false,
      toolCalls: new Map(),
      reasoningSteps: new Map(),
      reasoningActiveStepId: new Map(),
      reasoningLastStepIndex: new Map(),
      reasoningSeenEventIds: new Map(),
      reasoningPendingEvents: new Map(),
      reasoningLateEventLog: new Map(),
      reasoningLastTimestamp: new Map(),
      agentRunStartIndex: new Map(),
    });
  });

  describe('setMessages', () => {
    it('should set messages for a session', () => {
      const mockMessages: Message[] = [
        {
          id: '1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello',
          createdAt: new Date(),
        },
        {
          id: '2',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Hi there!',
          createdAt: new Date(),
        },
      ];

      const { setMessages } = useChatStore.getState();
      setMessages('session-1', mockMessages);

      const state = useChatStore.getState();
      expect(state.messages.get('session-1')).toEqual(mockMessages);
    });

    it('should replace existing messages for a session', () => {
      const oldMessages: Message[] = [
        {
          id: '1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Old message',
          createdAt: new Date(),
        },
      ];

      const newMessages: Message[] = [
        {
          id: '2',
          sessionId: 'session-1',
          role: 'user',
          content: 'New message',
          createdAt: new Date(),
        },
      ];

      const { setMessages } = useChatStore.getState();
      setMessages('session-1', oldMessages);
      setMessages('session-1', newMessages);

      const state = useChatStore.getState();
      expect(state.messages.get('session-1')).toEqual(newMessages);
      expect(state.messages.get('session-1')).toHaveLength(1);
    });
  });

  describe('addMessage', () => {
    it('should add a message to a session', () => {
      const message: Message = {
        id: '1',
        sessionId: 'session-1',
        role: 'user',
        content: 'Hello',
        createdAt: new Date(),
      };

      const { addMessage } = useChatStore.getState();
      addMessage('session-1', message);

      const state = useChatStore.getState();
      const sessionMessages = state.messages.get('session-1');
      expect(sessionMessages).toHaveLength(1);
      expect(sessionMessages![0]).toEqual(message);
    });

    it('should append message to existing messages', () => {
      const message1: Message = {
        id: '1',
        sessionId: 'session-1',
        role: 'user',
        content: 'First',
        createdAt: new Date(),
      };

      const message2: Message = {
        id: '2',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Second',
        createdAt: new Date(),
      };

      const { addMessage } = useChatStore.getState();
      addMessage('session-1', message1);
      addMessage('session-1', message2);

      const state = useChatStore.getState();
      const sessionMessages = state.messages.get('session-1');
      expect(sessionMessages).toHaveLength(2);
      expect(sessionMessages![1]).toEqual(message2);
    });

    it('should initialize messages array if session does not exist', () => {
      const message: Message = {
        id: '1',
        sessionId: 'new-session',
        role: 'user',
        content: 'Hello',
        createdAt: new Date(),
      };

      const { addMessage } = useChatStore.getState();
      addMessage('new-session', message);

      const state = useChatStore.getState();
      expect(state.messages.has('new-session')).toBe(true);
      expect(state.messages.get('new-session')).toHaveLength(1);
    });
  });

  describe('streaming', () => {
    it('should start streaming with a new message', () => {
      const { startStreaming } = useChatStore.getState();
      startStreaming('session-1');

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(true);
      expect(state.streamingSessionId).toBe('session-1');
      expect(state.streamingContent).toBe('');
    });

    it('should append content during streaming', () => {
      const { startStreaming, appendStreamingContent } = useChatStore.getState();
      startStreaming('session-1');
      appendStreamingContent('Hello');
      appendStreamingContent(' world');

      const state = useChatStore.getState();
      expect(state.streamingContent).toBe('Hello world');
    });

    it('should append content even if not streaming', () => {
      const { appendStreamingContent } = useChatStore.getState();
      appendStreamingContent('Hello');

      const state = useChatStore.getState();
      expect(state.streamingContent).toBe('Hello');
    });

    it('should finalize streaming message', () => {
      const finalMessage: Message = {
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Complete message',
        createdAt: new Date(),
      };

      const { startStreaming, appendStreamingContent, finalizeStreamingMessage } =
        useChatStore.getState();

      startStreaming('session-1');
      appendStreamingContent('Complete message');
      finalizeStreamingMessage('msg-1', finalMessage);

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.streamingSessionId).toBeNull();
      expect(state.streamingContent).toBe('');
      expect(state.messages.get('session-1')).toHaveLength(1);
      expect(state.messages.get('session-1')![0]).toEqual(finalMessage);
    });

    it('should stop streaming', () => {
      const { startStreaming, appendStreamingContent, stopStreaming } =
        useChatStore.getState();

      startStreaming('session-1');
      appendStreamingContent('Incomplete');
      stopStreaming();

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.streamingSessionId).toBeNull();
      expect(state.streamingContent).toBe('');
    });
  });

  describe('tool calls', () => {
    it('should start a tool call', () => {
      const { startToolCall } = useChatStore.getState();
      startToolCall('session-1', 'tool-1', 'read_file', { path: '/test.txt' });

      const toolCall = getToolCallBySessionAndId('session-1', 'tool-1');
      expect(toolCall?.sessionId).toBe('session-1');
      expect(toolCall?.toolCallId).toBe('tool-1');
      expect(toolCall?.toolName).toBe('read_file');
      expect(toolCall?.params).toEqual({ path: '/test.txt' });
      expect(toolCall?.status).toBe('running');
      expect(typeof toolCall?.startedAt).toBe('number');
    });

    it('should update tool call', () => {
      const { startToolCall, updateToolCall } = useChatStore.getState();
      startToolCall('session-1', 'tool-1', 'read_file', { path: '/test.txt' });
      updateToolCall('session-1', 'tool-1', {
        status: 'completed',
        result: { success: true, output: 'File contents', duration: 0 },
      });

      const toolCall = getToolCallBySessionAndId('session-1', 'tool-1');
      expect(toolCall?.status).toBe('completed');
      expect(toolCall?.result?.output).toBe('File contents');
    });

    it('should complete a tool call successfully', () => {
      const { startToolCall, completeToolCall } = useChatStore.getState();
      startToolCall('session-1', 'tool-1', 'read_file', { path: '/test.txt' });
      const startedAt = getToolCallBySessionAndId('session-1', 'tool-1')?.startedAt ?? 0;
      completeToolCall('session-1', 'tool-1', {
        success: true,
        output: 'File contents here',
        duration: 100,
      });

      const toolCall = getToolCallBySessionAndId('session-1', 'tool-1');
      expect(toolCall?.status).toBe('completed');
      expect(toolCall?.result?.output).toBe('File contents here');
      expect(toolCall?.error).toBeUndefined();
      expect(typeof toolCall?.completedAt).toBe('number');
      expect((toolCall?.completedAt ?? 0) >= startedAt).toBe(true);
    });

    it('should handle tool call error', () => {
      const { startToolCall, completeToolCall } = useChatStore.getState();
      startToolCall('session-1', 'tool-1', 'read_file', { path: '/missing.txt' });
      completeToolCall('session-1', 'tool-1', {
        success: false,
        output: '',
        error: 'File not found',
        duration: 50,
      });

      const toolCall = getToolCallBySessionAndId('session-1', 'tool-1');
      expect(toolCall?.status).toBe('failed');
      expect(toolCall?.error).toBe('File not found');
      expect(toolCall?.result).toBeUndefined();
    });

    it('should clear all tool calls', () => {
      const { startToolCall, clearToolCalls } = useChatStore.getState();
      startToolCall('session-1', 'tool-1', 'read_file', { path: '/test1.txt' });
      startToolCall('session-1', 'tool-2', 'write_file', { path: '/test2.txt' });

      expect(useChatStore.getState().toolCalls.size).toBe(2);

      clearToolCalls();

      const state = useChatStore.getState();
      expect(state.toolCalls.size).toBe(0);
    });

    it('should upsert a tool call (hydrate persisted)', () => {
      const { upsertToolCall } = useChatStore.getState();

      upsertToolCall({
        sessionId: 'session-1',
        messageId: 'msg-1',
        toolCallId: 'tool-1',
        toolName: 'web_search',
        params: { query: 'test' },
        status: 'completed',
        result: { success: true, output: 'ok', duration: 12 },
      });

      let toolCall = getToolCallBySessionAndId('session-1', 'tool-1');
      expect(toolCall?.status).toBe('completed');
      expect(toolCall?.messageId).toBe('msg-1');
      expect(toolCall?.result?.output).toBe('ok');

      // Update same tool call id should merge/override fields
      upsertToolCall({
        sessionId: 'session-1',
        messageId: 'msg-1',
        toolCallId: 'tool-1',
        toolName: 'web_search',
        params: { query: 'test2' },
        status: 'failed',
        error: 'boom',
      });

      toolCall = getToolCallBySessionAndId('session-1', 'tool-1');
      expect(toolCall?.status).toBe('failed');
      expect(toolCall?.params?.query).toBe('test2');
      expect(toolCall?.error).toBe('boom');
    });

    it('should keep tool calls isolated when toolCallId is reused across sessions', () => {
      const { startToolCall, completeToolCall } = useChatStore.getState();

      startToolCall('session-1', 'tool-1', 'web_search', { query: 'first' });
      startToolCall('session-2', 'tool-1', 'web_search', { query: 'second' });
      completeToolCall('session-2', 'tool-1', {
        success: true,
        output: 'session-2 result',
        duration: 10,
      });

      const session1Call = getToolCallBySessionAndId('session-1', 'tool-1');
      const session2Call = getToolCallBySessionAndId('session-2', 'tool-1');

      expect(session1Call?.status).toBe('running');
      expect(session2Call?.status).toBe('completed');
      expect(session2Call?.result?.output).toBe('session-2 result');
    });
  });

  describe('runtime state hydration', () => {
    it('restores running tool calls and reasoning steps from localStorage', () => {
      const sessionId = 'session-runtime-1';
      const runtimeKey = `mark-agent-runtime-${sessionId}`;
      localStorage.setItem(
        runtimeKey,
        JSON.stringify({
          toolCalls: [
            {
              sessionId,
              toolCallId: 'tool-1',
              toolName: 'video_transcript',
              params: { url: 'https://example.com/v' },
              status: 'running',
              startedAt: 1700000000000,
            },
          ],
          reasoningSteps: [
            {
              stepId: 'tool-tool-1',
              label: 'Tool execution',
              status: 'running',
              startedAt: 1700000000000,
            },
          ],
          isStreaming: true,
          streamingContent: 'partial',
          isThinking: false,
        })
      );

      useChatStore.getState().loadRuntimeStateFromStorage(sessionId);
      const state = useChatStore.getState();
      const toolCall = getToolCallBySessionAndId(sessionId, 'tool-1');
      const steps = state.reasoningSteps.get(sessionId) || [];

      expect(toolCall?.status).toBe('running');
      expect(toolCall?.toolName).toBe('video_transcript');
      expect(steps).toHaveLength(1);
      expect(steps[0]?.status).toBe('running');
      expect(state.isStreaming).toBe(true);
      expect(state.streamingSessionId).toBe(sessionId);
      expect(state.streamingContent).toBe('partial');
    });
  });

  describe('clearMessages', () => {
    it('should clear messages for a specific session', () => {
      const message1: Message = {
        id: '1',
        sessionId: 'session-1',
        role: 'user',
        content: 'Message 1',
        createdAt: new Date(),
      };

      const message2: Message = {
        id: '2',
        sessionId: 'session-2',
        role: 'user',
        content: 'Message 2',
        createdAt: new Date(),
      };

      const { addMessage, clearMessages } = useChatStore.getState();
      addMessage('session-1', message1);
      addMessage('session-2', message2);

      clearMessages('session-1');

      const state = useChatStore.getState();
      expect(state.messages.has('session-1')).toBe(false);
      expect(state.messages.get('session-2')).toHaveLength(1);
    });
  });

  describe('updateMessage', () => {
    it('should update a specific message', () => {
      const message: Message = {
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Original content',
        createdAt: new Date(),
      };

      const { addMessage, updateMessage } = useChatStore.getState();
      addMessage('session-1', message);
      updateMessage('session-1', 'msg-1', { content: 'Updated content' });

      const state = useChatStore.getState();
      const updatedMessage = state.messages.get('session-1')![0];
      expect(updatedMessage.content).toBe('Updated content');
    });
  });

  describe('computer state hydration', () => {
    it('drops legacy reconstructed SVG placeholder screenshots on load', () => {
      const sessionId = 'session-legacy';
      const legacySvg =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg"><text>Snapshot unavailable (reconstructed from history)</text></svg>'
        );

      localStorage.setItem(
        `mark-agent-computer-${sessionId}`,
        JSON.stringify({
          agentSteps: {
            currentStepIndex: 0,
            steps: [
              {
                stepIndex: 0,
                type: 'browse',
                snapshot: {
                  stepIndex: 0,
                  timestamp: Date.now(),
                  url: 'https://example.com',
                  screenshot: legacySvg,
                },
              },
            ],
          },
        })
      );

      useChatStore.getState().loadComputerStateFromStorage(sessionId);
      const state = useChatStore.getState();
      expect(state.agentSteps.get(sessionId)?.steps[0]?.snapshot?.screenshot).toBeUndefined();
    });
  });

  describe('agent step message association', () => {
    it('associates only unassigned agent steps to completed assistant message', () => {
      const sessionId = 'session-associate';
      useChatStore.setState({
        agentSteps: new Map([
          [
            sessionId,
            {
              currentStepIndex: 2,
              steps: [
                { stepIndex: 0, type: 'search', output: 'old', messageId: 'msg-old' },
                { stepIndex: 1, type: 'browse', output: 'current-1' },
                { stepIndex: 2, type: 'browse', output: 'current-2' },
              ],
            },
          ],
        ]),
      });

      useChatStore.getState().associateAgentStepsWithMessage(sessionId, 'msg-new');

      const steps = useChatStore.getState().agentSteps.get(sessionId)?.steps ?? [];
      expect(steps[0]?.messageId).toBe('msg-old');
      expect(steps[1]?.messageId).toBe('msg-new');
      expect(steps[2]?.messageId).toBe('msg-new');
    });

    it('associates only steps from current run start index', () => {
      const sessionId = 'session-associate-run-start';
      useChatStore.setState({
        agentSteps: new Map([
          [
            sessionId,
            {
              currentStepIndex: 3,
              steps: [
                { stepIndex: 0, type: 'search', output: 'old-1' },
                { stepIndex: 1, type: 'browse', output: 'old-2' },
                { stepIndex: 2, type: 'search', output: 'new-1' },
                { stepIndex: 3, type: 'browse', output: 'new-2' },
              ],
            },
          ],
        ]),
        agentRunStartIndex: new Map([[sessionId, 2]]),
      });

      useChatStore.getState().associateAgentStepsWithMessage(sessionId, 'msg-new');

      const state = useChatStore.getState();
      const steps = state.agentSteps.get(sessionId)?.steps ?? [];
      expect(steps[0]?.messageId).toBeUndefined();
      expect(steps[1]?.messageId).toBeUndefined();
      expect(steps[2]?.messageId).toBe('msg-new');
      expect(steps[3]?.messageId).toBe('msg-new');
      expect(state.agentRunStartIndex.has(sessionId)).toBe(false);
    });
  });

  describe('agent run start index', () => {
    it('marks run start at current step count for a session', () => {
      const sessionId = 'session-run-start';
      useChatStore.setState({
        agentSteps: new Map([
          [
            sessionId,
            {
              currentStepIndex: 1,
              steps: [
                { stepIndex: 0, type: 'search', output: 'a' },
                { stepIndex: 1, type: 'browse', output: 'b' },
              ],
            },
          ],
        ]),
      });

      useChatStore.getState().setAgentRunStartIndex(sessionId);
      expect(useChatStore.getState().agentRunStartIndex.get(sessionId)).toBe(2);
    });
  });

  describe('reasoning trace state machine', () => {
    const sessionId = 'session-reasoning-sm';
    const traceId = 'trace-1';
    let ts = 1_000;
    const nextTs = () => {
      ts += 10;
      return ts;
    };

    const apply = (event: {
      eventId: string;
      stepId: string;
      stepIndex: number;
      eventSeq: number;
      lifecycle: 'STARTED' | 'UPDATED' | 'FINISHED';
      label?: string;
      finalStatus?: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
    }) => {
      useChatStore.getState().applyReasoningEvent(sessionId, {
        eventId: event.eventId,
        traceId,
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        eventSeq: event.eventSeq,
        lifecycle: event.lifecycle,
        timestamp: nextTs(),
        label: event.label || `Step ${event.stepIndex}`,
        finalStatus: event.finalStatus,
      });
    };

    it('enforces single active step and strict step sequencing', () => {
      apply({
        eventId: 'e1',
        stepId: 's1',
        stepIndex: 1,
        eventSeq: 1,
        lifecycle: 'STARTED',
      });
      apply({
        eventId: 'e2',
        stepId: 's2',
        stepIndex: 2,
        eventSeq: 1,
        lifecycle: 'STARTED',
      });

      let steps = useChatStore.getState().reasoningSteps.get(sessionId) || [];
      expect(steps).toHaveLength(1);
      expect(steps[0]?.stepId).toBe('s1');
      expect(steps[0]?.status).toBe('running');

      apply({
        eventId: 'e3',
        stepId: 's1',
        stepIndex: 1,
        eventSeq: 2,
        lifecycle: 'FINISHED',
      });

      steps = useChatStore.getState().reasoningSteps.get(sessionId) || [];
      expect(steps.map((step) => step.stepId)).toEqual(['s1', 's2']);
      expect(steps[0]?.status).toBe('completed');
      expect(steps[1]?.status).toBe('running');
      expect(steps.filter((step) => step.status === 'running')).toHaveLength(1);
    });

    it('does not mutate terminal steps and logs late events', () => {
      apply({
        eventId: 't1',
        stepId: 'term-1',
        stepIndex: 1,
        eventSeq: 1,
        lifecycle: 'STARTED',
      });
      apply({
        eventId: 't2',
        stepId: 'term-1',
        stepIndex: 1,
        eventSeq: 2,
        lifecycle: 'FINISHED',
        finalStatus: 'SUCCEEDED',
      });

      const completedStep = (useChatStore.getState().reasoningSteps.get(sessionId) || [])[0];
      apply({
        eventId: 't3',
        stepId: 'term-1',
        stepIndex: 1,
        eventSeq: 3,
        lifecycle: 'UPDATED',
      });

      const stepAfterLate = (useChatStore.getState().reasoningSteps.get(sessionId) || [])[0];
      const lateEvents = useChatStore.getState().reasoningLateEventLog.get(sessionId) || [];
      expect(stepAfterLate).toEqual(completedStep);
      expect(lateEvents.some((entry) => entry.eventId === 't3')).toBe(true);
    });

    it('reorders out-of-order lifecycle events and dedupes by event id', () => {
      apply({
        eventId: 'o2',
        stepId: 'out-1',
        stepIndex: 1,
        eventSeq: 2,
        lifecycle: 'FINISHED',
      });
      apply({
        eventId: 'o1',
        stepId: 'out-1',
        stepIndex: 1,
        eventSeq: 1,
        lifecycle: 'STARTED',
      });
      apply({
        eventId: 'o1',
        stepId: 'out-1',
        stepIndex: 1,
        eventSeq: 1,
        lifecycle: 'STARTED',
      });

      const steps = useChatStore.getState().reasoningSteps.get(sessionId) || [];
      expect(steps).toHaveLength(1);
      expect(steps[0]?.status).toBe('completed');
      expect(steps[0]?.lastEventSeq).toBe(2);
    });

    it('e2e simulation preserves invariants across shuffled events', () => {
      const events = [
        { eventId: 'a1', stepId: 'a', stepIndex: 1, eventSeq: 1, lifecycle: 'STARTED' as const },
        { eventId: 'b1', stepId: 'b', stepIndex: 2, eventSeq: 1, lifecycle: 'STARTED' as const },
        { eventId: 'a2', stepId: 'a', stepIndex: 1, eventSeq: 2, lifecycle: 'FINISHED' as const },
        { eventId: 'c1', stepId: 'c', stepIndex: 3, eventSeq: 1, lifecycle: 'STARTED' as const },
        { eventId: 'b2', stepId: 'b', stepIndex: 2, eventSeq: 2, lifecycle: 'FINISHED' as const },
        { eventId: 'c2', stepId: 'c', stepIndex: 3, eventSeq: 2, lifecycle: 'FINISHED' as const, finalStatus: 'FAILED' as const },
      ];

      // Intentionally shuffled delivery order
      const shuffled = [events[1], events[0], events[3], events[2], events[5], events[4]];
      for (const event of shuffled) {
        apply(event);
        const steps = useChatStore.getState().reasoningSteps.get(sessionId) || [];
        expect(steps.filter((step) => step.status === 'running').length).toBeLessThanOrEqual(1);
        const indices = steps.map((step) => step.stepIndex ?? 0);
        expect(indices).toEqual([...indices].sort((a, b) => a - b));
      }

      const finalSteps = useChatStore.getState().reasoningSteps.get(sessionId) || [];
      expect(finalSteps.map((step) => step.stepIndex)).toEqual([1, 2, 3]);
      expect(finalSteps.map((step) => step.status)).toEqual(['completed', 'completed', 'failed']);
      expect(finalSteps.every((step) => step.completedAt && step.durationMs !== undefined)).toBe(true);
    });

    it('finalizes lingering running step when task completes', () => {
      apply({
        eventId: 'f1',
        stepId: 'fin-1',
        stepIndex: 1,
        eventSeq: 1,
        lifecycle: 'STARTED',
      });

      useChatStore.getState().finalizeReasoningTrace(sessionId, nextTs());

      const state = useChatStore.getState();
      const steps = state.reasoningSteps.get(sessionId) || [];
      expect(steps).toHaveLength(1);
      expect(steps[0]?.status).toBe('completed');
      expect(steps[0]?.completedAt).toBeDefined();
      expect(state.reasoningActiveStepId.get(sessionId)).toBeNull();
      expect((state.reasoningPendingEvents.get(sessionId) || []).length).toBe(0);
    });
  });
});
