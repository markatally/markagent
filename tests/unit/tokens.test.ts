import { describe, it, expect, beforeAll } from 'bun:test';
import { getTokenCounter, TokenCounter } from '../../apps/api/src/services/tokens';
import type { LLMMessage } from '../../apps/api/src/services/llm';

describe('Phase 3: Token Counter', () => {
  let tokenCounter: TokenCounter;

  beforeAll(() => {
    tokenCounter = getTokenCounter();
  });

  describe('Token Counting', () => {
    it('should count tokens in simple text', () => {
      const text = 'Hello, world!';
      const count = tokenCounter.count(text);

      expect(count).toBeGreaterThan(0);
      expect(typeof count).toBe('number');
    });

    it('should count tokens in longer text', () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
      const count = tokenCounter.count(text);

      expect(count).toBeGreaterThan(10);
    });

    it('should count tokens in messages', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there! How can I help you?' },
      ];

      const count = tokenCounter.countMessages(messages);

      expect(count).toBeGreaterThan(0);
      expect(typeof count).toBe('number');
    });

    it('should count more tokens for longer messages', () => {
      const shortMessages: LLMMessage[] = [
        { role: 'user', content: 'Hi' },
      ];

      const longMessages: LLMMessage[] = [
        { role: 'user', content: 'Hello '.repeat(100) },
      ];

      const shortCount = tokenCounter.countMessages(shortMessages);
      const longCount = tokenCounter.countMessages(longMessages);

      expect(longCount).toBeGreaterThan(shortCount);
    });
  });

  describe('Message Truncation', () => {
    it('should not truncate if under limit', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi!' },
      ];

      const maxTokens = 10000;
      const truncated = tokenCounter.truncateToFit(messages, maxTokens);

      expect(truncated.length).toBe(messages.length);
    });

    it('should keep system message when truncating', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Message 1 '.repeat(100) },
        { role: 'assistant', content: 'Response 1 '.repeat(100) },
        { role: 'user', content: 'Message 2 '.repeat(100) },
        { role: 'assistant', content: 'Response 2 '.repeat(100) },
      ];

      const maxTokens = 200;
      const truncated = tokenCounter.truncateToFit(messages, maxTokens);

      // Should keep system message
      expect(truncated[0].role).toBe('system');
      expect(truncated[0].content).toBe('You are helpful.');

      // Should have fewer messages
      expect(truncated.length).toBeLessThan(messages.length);
    });

    it('should keep most recent messages', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Old message '.repeat(500) }, // Large old messages
        { role: 'assistant', content: 'Old response '.repeat(500) },
        { role: 'user', content: 'Recent message' },
        { role: 'assistant', content: 'Recent response' },
      ];

      // Use 8000 tokens - with larger old messages, truncation should occur
      const maxTokens = 8000;
      const truncated = tokenCounter.truncateToFit(messages, maxTokens);

      // Should keep system message as first message
      expect(truncated[0].role).toBe('system');

      // Should keep recent messages (check that recent content is present)
      const hasRecentMessage = truncated.some(m => m.content.includes('Recent'));
      expect(hasRecentMessage).toBe(true);

      // Truncation should respect token limits
      const finalTokenCount = tokenCounter.countMessages(truncated);
      expect(finalTokenCount).toBeLessThanOrEqual(maxTokens);
    });

    it('should respect token limit', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Message '.repeat(1000) },
        { role: 'assistant', content: 'Response '.repeat(1000) },
      ];

      const maxTokens = 500;
      const truncated = tokenCounter.truncateToFit(messages, maxTokens);

      const tokenCount = tokenCounter.countMessages(truncated);
      expect(tokenCount).toBeLessThanOrEqual(maxTokens);
    });

    it('should handle edge case of very small limit', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
      ];

      const maxTokens = 50;
      const truncated = tokenCounter.truncateToFit(messages, maxTokens);

      // Should at least keep system message or handle gracefully
      expect(truncated.length).toBeGreaterThan(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const counter1 = getTokenCounter();
      const counter2 = getTokenCounter();

      expect(counter1).toBe(counter2);
    });
  });
});
