---
name: react-components
description: Guide for building React components with TypeScript, Tailwind CSS, and shadcn/ui in the Mark Agent frontend. Use when creating UI components, implementing state management, handling real-time updates, or styling interfaces.
---

# React Component Development

This skill provides guidance for building frontend components in the Mark Agent.

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui
- **State**: Zustand
- **Server State**: TanStack Query
- **Icons**: Lucide React

## Project Structure

```
apps/web/src/
├── components/
│   ├── chat/              # Chat interface components
│   │   ├── ChatInput.tsx
│   │   ├── ChatMessage.tsx
│   │   └── ChatContainer.tsx
│   ├── progress/          # Progress display
│   │   ├── StepIndicator.tsx
│   │   └── ToolExecution.tsx
│   ├── session/           # Session management
│   │   ├── SessionList.tsx
│   │   └── SessionCard.tsx
│   └── ui/                # shadcn/ui components
├── hooks/                 # Custom hooks
├── stores/                # Zustand stores
├── lib/                   # Utilities
└── types/                 # TypeScript types
```

## Component Patterns

### Basic Component Structure

```typescript
// apps/web/src/components/chat/ChatMessage.tsx
import { cn } from '@/lib/utils';
import { Message } from '@/types';
import { User, Bot } from 'lucide-react';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex gap-3 p-4 rounded-lg',
        isUser ? 'bg-muted' : 'bg-background'
      )}
    >
      <div className="flex-shrink-0">
        {isUser ? (
          <User className="h-6 w-6 text-muted-foreground" />
        ) : (
          <Bot className="h-6 w-6 text-primary" />
        )}
      </div>
      <div className="flex-1 space-y-2">
        <p className={cn('text-sm', isStreaming && 'animate-pulse')}>
          {message.content}
        </p>
        {message.toolCalls?.map((tool) => (
          <ToolExecution key={tool.id} toolCall={tool} />
        ))}
      </div>
    </div>
  );
}
```

### Form Component with Validation

```typescript
// apps/web/src/components/chat/ChatInput.tsx
import { useState, useCallback, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, Paperclip } from 'lucide-react';

interface ChatInputProps {
  onSubmit: (message: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSubmit, isLoading, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && !isLoading) {
      onSubmit(trimmed);
      setValue('');
    }
  }, [value, isLoading, onSubmit]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex gap-2 p-4 border-t">
      <Button variant="ghost" size="icon" disabled={disabled}>
        <Paperclip className="h-4 w-4" />
      </Button>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={disabled || isLoading}
        className="min-h-[60px] resize-none"
        rows={1}
      />
      <Button
        onClick={handleSubmit}
        disabled={!value.trim() || isLoading || disabled}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
```

## State Management (Zustand)

### Store Definition

```typescript
// apps/web/src/stores/sessionStore.ts
import { create } from 'zustand';
import { Message, Session } from '@/types';

interface SessionState {
  currentSession: Session | null;
  messages: Message[];
  isLoading: boolean;
  streamingContent: string;

  // Actions
  setSession: (session: Session) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, content: Partial<Message>) => void;
  appendStreamingContent: (content: string) => void;
  clearStreamingContent: () => void;
  setLoading: (loading: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  currentSession: null,
  messages: [],
  isLoading: false,
  streamingContent: '',

  setSession: (session) => set({ currentSession: session }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateMessage: (id, content) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...content } : m
      ),
    })),

  appendStreamingContent: (content) =>
    set((state) => ({ streamingContent: state.streamingContent + content })),

  clearStreamingContent: () => set({ streamingContent: '' }),

  setLoading: (isLoading) => set({ isLoading }),
}));
```

### Using Store in Components

```typescript
// apps/web/src/components/chat/ChatContainer.tsx
import { useSessionStore } from '@/stores/sessionStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';

export function ChatContainer() {
  const {
    messages,
    isLoading,
    streamingContent,
    addMessage,
    setLoading,
  } = useSessionStore();

  const handleSubmit = async (content: string) => {
    addMessage({ id: crypto.randomUUID(), role: 'user', content });
    setLoading(true);
    // Send to API...
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        {streamingContent && (
          <ChatMessage
            message={{ id: 'streaming', role: 'assistant', content: streamingContent }}
            isStreaming
          />
        )}
      </div>
      <ChatInput onSubmit={handleSubmit} isLoading={isLoading} />
    </div>
  );
}
```

## Server State (TanStack Query)

### Query Hook

```typescript
// apps/web/src/hooks/useSession.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Session } from '@/types';

export function useSession(sessionId: string) {
  return useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.get<Session>(`/sessions/${sessionId}`),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<Session[]>('/sessions'),
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name?: string) => api.post<Session>('/sessions', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
```

## SSE Streaming Hook

```typescript
// apps/web/src/hooks/useSSE.ts
import { useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '@/stores/sessionStore';

interface SSEEvent {
  type: string;
  data: any;
}

export function useSSE(sessionId: string | null) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const { appendStreamingContent, addMessage, clearStreamingContent } = useSessionStore();

  const connect = useCallback(() => {
    if (!sessionId) return;

    const url = `${import.meta.env.VITE_API_URL}/sessions/${sessionId}/stream`;
    const eventSource = new EventSource(url, { withCredentials: true });

    eventSource.addEventListener('message.delta', (e) => {
      const data = JSON.parse(e.data);
      appendStreamingContent(data.content);
    });

    eventSource.addEventListener('message.complete', (e) => {
      const data = JSON.parse(e.data);
      addMessage({ id: data.messageId, role: 'assistant', content: data.content });
      clearStreamingContent();
    });

    eventSource.addEventListener('tool.start', (e) => {
      const data = JSON.parse(e.data);
      // Handle tool start
    });

    eventSource.addEventListener('error', () => {
      eventSource.close();
      // Reconnect after delay
      setTimeout(connect, 3000);
    });

    eventSourceRef.current = eventSource;
  }, [sessionId, appendStreamingContent, addMessage, clearStreamingContent]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);
}
```

## Styling with Tailwind

### Common Patterns

```typescript
// Conditional classes with cn()
import { cn } from '@/lib/utils';

<div className={cn(
  'base-classes',
  isActive && 'active-classes',
  variant === 'primary' ? 'primary-classes' : 'secondary-classes'
)} />

// Responsive design
<div className="p-2 md:p-4 lg:p-6" />

// Dark mode support (automatic with shadcn)
<div className="bg-white dark:bg-slate-900" />
```

### Animation Classes

```typescript
// Loading spinner
<Loader2 className="h-4 w-4 animate-spin" />

// Pulse for streaming
<p className="animate-pulse">Typing...</p>

// Fade in
<div className="animate-in fade-in duration-300" />
```

## shadcn/ui Components

### Installation

```bash
# Add component
bunx shadcn-ui@latest add button
bunx shadcn-ui@latest add input
bunx shadcn-ui@latest add textarea
bunx shadcn-ui@latest add dialog
bunx shadcn-ui@latest add dropdown-menu
```

### Usage Example

```typescript
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function CreateSessionDialog() {
  const [name, setName] = useState('');
  const createSession = useCreateSession();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>New Session</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Session</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Session name"
        />
        <Button
          onClick={() => createSession.mutate(name)}
          disabled={createSession.isPending}
        >
          Create
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

## Best Practices

### Component Design
- Keep components small and focused
- Use composition over inheritance
- Extract reusable logic into hooks
- Memoize expensive computations

### Performance
- Use `React.memo` for pure components
- Use `useMemo` and `useCallback` appropriately
- Virtualize long lists with `@tanstack/react-virtual`
- Lazy load heavy components with `React.lazy`

### Accessibility
- Use semantic HTML elements
- Include ARIA labels where needed
- Ensure keyboard navigation works
- Test with screen readers

### TypeScript
- Define explicit prop interfaces
- Use discriminated unions for variant props
- Avoid `any` - use `unknown` if needed
- Export types alongside components
