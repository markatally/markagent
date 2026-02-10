import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chatStore';
import type { Message } from '@mark/shared';

describe('chatStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useChatStore.setState({
      messages: new Map(),
      streamingSessionId: null,
      streamingContent: '',
      isStreaming: false,
      toolCalls: new Map(),
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

      const state = useChatStore.getState();
      const toolCall = state.toolCalls.get('tool-1');
      expect(toolCall).toEqual({
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        toolName: 'read_file',
        params: { path: '/test.txt' },
        status: 'running',
      });
    });

    it('should update tool call', () => {
      const { startToolCall, updateToolCall } = useChatStore.getState();
      startToolCall('session-1', 'tool-1', 'read_file', { path: '/test.txt' });
      updateToolCall('tool-1', { status: 'completed', result: { success: true, output: 'File contents', duration: 0 } });

      const state = useChatStore.getState();
      const toolCall = state.toolCalls.get('tool-1');
      expect(toolCall?.status).toBe('completed');
      expect(toolCall?.result?.output).toBe('File contents');
    });

    it('should complete a tool call successfully', () => {
      const { startToolCall, completeToolCall } = useChatStore.getState();
      startToolCall('session-1', 'tool-1', 'read_file', { path: '/test.txt' });
      completeToolCall('tool-1', { success: true, output: 'File contents here', duration: 100 });

      const state = useChatStore.getState();
      const toolCall = state.toolCalls.get('tool-1');
      expect(toolCall?.status).toBe('completed');
      expect(toolCall?.result?.output).toBe('File contents here');
      expect(toolCall?.error).toBeUndefined();
    });

    it('should handle tool call error', () => {
      const { startToolCall, completeToolCall } = useChatStore.getState();
      startToolCall('session-1', 'tool-1', 'read_file', { path: '/missing.txt' });
      completeToolCall('tool-1', { success: false, output: '', error: 'File not found', duration: 50 });

      const state = useChatStore.getState();
      const toolCall = state.toolCalls.get('tool-1');
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

      let state = useChatStore.getState();
      expect(state.toolCalls.get('tool-1')?.status).toBe('completed');
      expect(state.toolCalls.get('tool-1')?.messageId).toBe('msg-1');
      expect(state.toolCalls.get('tool-1')?.result?.output).toBe('ok');

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

      state = useChatStore.getState();
      expect(state.toolCalls.get('tool-1')?.status).toBe('failed');
      expect(state.toolCalls.get('tool-1')?.params?.query).toBe('test2');
      expect(state.toolCalls.get('tool-1')?.error).toBe('boom');
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
});
