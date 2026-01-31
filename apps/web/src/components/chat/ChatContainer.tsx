import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ToolCallDisplay } from './ToolCallDisplay';
import { ArtifactDisplay } from './ArtifactDisplay';
import { apiClient, type SSEEvent } from '../../lib/api';
import { useChatStore } from '../../stores/chatStore';
import { useToast } from '../../hooks/use-toast';

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const [isSending, setIsSending] = useState(false);
  const [files, setFiles] = useState<import('@manus/shared').Artifact[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const addMessage = useChatStore((state) => state.addMessage);
  const startStreaming = useChatStore((state) => state.startStreaming);
  const appendStreamingContent = useChatStore((state) => state.appendStreamingContent);
  const stopStreaming = useChatStore((state) => state.stopStreaming);
  const startToolCall = useChatStore((state) => state.startToolCall);
  const completeToolCall = useChatStore((state) => state.completeToolCall);

  const handleSSEEvent = (event: SSEEvent) => {
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
        stopStreaming();
        // Refetch messages to ensure we have the latest
        queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });
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

      case 'tool.complete':
        if (event.data) {
          const toolResult: import('@manus/shared').ToolResult = {
            success: true,
            output: event.data.result || '',
            duration: event.data.duration || 0,
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
        // File artifact created - add to local state for display
        if (event.data?.fileId && event.data?.filename) {
          const artifact: import('@manus/shared').Artifact = {
            fileId: event.data.fileId,
            name: event.data.filename,
            type: event.data.type || 'file',
            mimeType: event.data.mimeType,
            size: event.data.size,
            content: '',
          };
          setFiles((prev) => [...prev, artifact]);
        }
        break;

      case 'error':
        console.error('Stream error:', event.data);
        stopStreaming();
        toast({
          title: 'Stream error',
          description: event.data?.message || 'Unknown error',
          variant: 'destructive',
        });
        break;
    }
  };

  const handleSendMessage = async (content: string) => {
    setIsSending(true);

    try {
      // Add optimistic user message
      const tempUserMessage = {
        id: `temp-${Date.now()}`,
        sessionId,
        role: 'user' as const,
        content,
        createdAt: new Date(),
      };

      addMessage(sessionId, tempUserMessage as any);

      // Stream response from backend
      for await (const event of apiClient.chat.sendAndStream(sessionId, content)) {
        handleSSEEvent(event);
      }

      // Refetch messages after stream completes
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });
    } catch (error: any) {
      stopStreaming();
      toast({
        title: 'Failed to send message',
        description: error.message || 'Could not send message',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <MessageList sessionId={sessionId} />
      <ToolCallDisplay sessionId={sessionId} />
      <ChatInput onSend={handleSendMessage} disabled={isSending} />

      {/* Display generated files independently */}
      {files.length > 0 && (
        <div className="p-4 border-t bg-muted/20">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Generated Files ({files.length})
          </div>
          {files.map((file, idx) => (
            <ArtifactDisplay key={idx} artifact={file} sessionId={sessionId} />
          ))}
        </div>
      )}
    </div>
  );
}
