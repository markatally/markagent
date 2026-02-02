import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageItem } from '../components/chat/MessageItem';
import type { Message } from '@mark/shared';

describe('MessageItem', () => {
  const mockUserMessage: Message = {
    id: '1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello, world!',
    createdAt: new Date('2024-01-01'),
  };

  const mockAssistantMessage: Message = {
    id: '2',
    sessionId: 'session-1',
    role: 'assistant',
    content: 'Hi there! How can I help you?',
    createdAt: new Date('2024-01-01'),
  };

  it('renders user message correctly', () => {
    render(<MessageItem message={mockUserMessage} />);

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  it('renders assistant message correctly', () => {
    render(<MessageItem message={mockAssistantMessage} />);

    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByText('Hi there! How can I help you?')).toBeInTheDocument();
  });

  it('shows streaming indicator when isStreaming is true', () => {
    render(<MessageItem message={mockAssistantMessage} isStreaming={true} />);

    const streamingIndicator = screen.getByText('●');
    expect(streamingIndicator).toBeInTheDocument();
  });

  it('does not show streaming indicator when isStreaming is false', () => {
    render(<MessageItem message={mockAssistantMessage} isStreaming={false} />);

    const streamingIndicator = screen.queryByText('●');
    expect(streamingIndicator).not.toBeInTheDocument();
  });
});
