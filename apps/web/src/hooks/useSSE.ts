import { useEffect, useRef } from 'react';
import { SSEClient, type StreamEvent } from '../lib/sse';
import { useChatStore } from '../stores/chatStore';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

interface UseSSEOptions {
  sessionId: string;
  enabled: boolean;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Hook to handle SSE streaming for a session
 */
export function useSSE({ sessionId, enabled, onComplete, onError }: UseSSEOptions) {
  const clientRef = useRef<SSEClient | null>(null);
  const queryClient = useQueryClient();
  const startStreaming = useChatStore((state) => state.startStreaming);
  const appendStreamingContent = useChatStore((state) => state.appendStreamingContent);
  const startToolCall = useChatStore((state) => state.startToolCall);
  const updateToolCallProgress = useChatStore((state) => state.updateToolCallProgress);
  const completeToolCall = useChatStore((state) => state.completeToolCall);
  const addFileArtifact = useChatStore((state) => state.addFileArtifact);
  const stopStreaming = useChatStore((state) => state.stopStreaming);
  const finalizeStreamingMessage = useChatStore((state) => state.finalizeStreamingMessage);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    // Create SSE client
    const client = new SSEClient();
    clientRef.current = client;

    // Get stream URL with auth token
    const streamUrl = apiClient.chat.getStreamUrl(sessionId);

    // Connect to SSE stream
    const cleanup = client.connect(streamUrl, {
      onEvent: (event: StreamEvent) => {
        switch (event.type) {
          case 'message.start':
            startStreaming(sessionId);
            break;

          case 'message.delta':
            if (event.data?.content) {
              appendStreamingContent(event.data.content);
            }
            break;

          case 'message.complete':
            if (event.data?.message) {
              finalizeStreamingMessage(event.data.message.id, event.data.message);
            }
            // Refetch messages to ensure we have the latest
            queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });
            onComplete?.();
            break;

          case 'tool.start':
            if (event.data) {
              startToolCall(
                event.data.toolCallId,
                event.data.toolName,
                event.data.params || event.data.parameters
              );
            }
            break;

          case 'tool.progress':
            if (event.data) {
              updateToolCallProgress(
                event.data.toolCallId,
                event.data.current || 0,
                event.data.total || 100,
                event.data.message
              );
            }
            break;

          case 'tool.complete':
            if (event.data) {
              const toolResult: import('@manus/shared').ToolResult = {
                success: true,
                output: event.data.result || '',
                duration: event.data.duration || 0,
                artifacts: event.data.artifacts,
              };
              completeToolCall(event.data.toolCallId, toolResult);
            }
            break;

          case 'tool.error':
            if (event.data) {
              const toolResult: import('@manus/shared').ToolResult = {
                success: false,
                output: '',
                error: event.data.error || 'Unknown error',
                duration: event.data.duration || 0,
              };
              completeToolCall(event.data.toolCallId, toolResult);
            }
            break;

          case 'file.created':
            // File artifact created - add to store for independent display
            if (event.data?.fileId && event.data?.filename) {
              const artifact: import('@manus/shared').Artifact = {
                fileId: event.data.fileId,
                name: event.data.filename,
                type: event.data.type || 'file',
                mimeType: event.data.mimeType,
                size: event.data.size,
                content: '',
              };
              addFileArtifact(sessionId, artifact);
            }
            break;

          case 'error':
            console.error('SSE error:', event.data);
            stopStreaming();
            onError?.(new Error(event.data?.message || 'Stream error'));
            break;
        }
      },
      onError: (error) => {
        console.error('SSE connection error:', error);
        stopStreaming();
        onError?.(error);
      },
      onOpen: () => {
        console.log('SSE connection opened');
      },
      onClose: () => {
        console.log('SSE connection closed');
        stopStreaming();
      },
      reconnect: true,
      maxReconnectAttempts: 3,
    });

    return () => {
      cleanup();
      clientRef.current = null;
    };
  }, [
    sessionId,
    enabled,
    startStreaming,
    appendStreamingContent,
    startToolCall,
    updateToolCallProgress,
    completeToolCall,
    addFileArtifact,
    stopStreaming,
    finalizeStreamingMessage,
    queryClient,
    onComplete,
    onError,
  ]);

  return {
    disconnect: () => {
      if (clientRef.current) {
        clientRef.current.close();
      }
    },
  };
}
