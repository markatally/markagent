import OpenAI from 'openai';
import { getConfig, LLMConfig } from './config';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

// Re-export types for convenience
export type { ChatCompletionMessageParam, ChatCompletionTool };

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Extended message type for tool-calling workflows
 * Includes support for assistant tool_calls and tool result messages
 */
export interface ExtendedLLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMResponse {
  content: string | null;
  toolCalls?: LLMToolCall[];
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamChunk {
  type: 'content' | 'tool_call' | 'done';
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  finishReason?: string;
}

/**
 * LLM Client for OpenAI-compatible APIs
 * Following SPEC.md pattern (lines 37-93)
 */
export class LLMClient {
  private client: OpenAI;
  private config: LLMConfig;
  private isTestEnv: boolean;

  constructor() {
    const appConfig = getConfig();
    this.config = appConfig.llm;
    this.isTestEnv =
      process.env.NODE_ENV === 'test' ||
      process.env.BUN_ENV === 'test' ||
      process.env.BUN_TEST === '1' ||
      process.env.VITEST === 'true';

    if (!process.env.LLM_API_KEY && !this.isTestEnv) {
      throw new Error('LLM_API_KEY environment variable is required');
    }

    this.client = new OpenAI({
      apiKey: process.env.LLM_API_KEY || 'test-key',
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
    });
  }

  /**
   * Non-streaming chat completion
   */
  async chat(
    messages: LLMMessage[],
    tools?: ChatCompletionTool[],
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<LLMResponse> {
    if (this.isTestEnv) {
      return {
        content: 'Test response',
        finishReason: 'stop',
      };
    }

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages as ChatCompletionMessageParam[],
      tools,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      temperature: options?.temperature ?? this.config.temperature,
      stream: false,
    });

    const choice = response.choices[0];
    const message = choice.message;

    return {
      content: message.content,
      toolCalls: message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
      finishReason: choice.finish_reason,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  /**
   * Streaming chat completion - yields chunks as they arrive
   */
  async *streamChat(
    messages: LLMMessage[],
    tools?: ChatCompletionTool[]
  ): AsyncGenerator<StreamChunk> {
    if (this.isTestEnv) {
      yield {
        type: 'content',
        content: 'Test response',
      };
      yield {
        type: 'done',
        finishReason: 'stop',
      };
      return;
    }

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages as ChatCompletionMessageParam[],
      tools,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    });

    // Track tool calls being built up
    const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      if (!choice) continue;

      const delta = choice.delta;

      // Handle content chunks
      if (delta?.content) {
        yield {
          type: 'content',
          content: delta.content,
        };
      }

      // Handle tool call chunks
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index;

          if (!toolCallsInProgress.has(index)) {
            toolCallsInProgress.set(index, {
              id: toolCallDelta.id || '',
              name: toolCallDelta.function?.name || '',
              arguments: '',
            });
          }

          const toolCall = toolCallsInProgress.get(index)!;

          if (toolCallDelta.id) {
            toolCall.id = toolCallDelta.id;
          }
          if (toolCallDelta.function?.name) {
            toolCall.name = toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments) {
            toolCall.arguments += toolCallDelta.function.arguments;
          }
        }
      }

      // Handle finish
      if (choice.finish_reason) {
        // Emit any completed tool calls
        for (const toolCall of toolCallsInProgress.values()) {
          if (toolCall.id && toolCall.name) {
            yield {
              type: 'tool_call',
              toolCall,
            };
          }
        }

        yield {
          type: 'done',
          finishReason: choice.finish_reason,
        };
      }
    }
  }

  /**
   * Get the current model name
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * Get max tokens setting
   */
  getMaxTokens(): number {
    return this.config.maxTokens;
  }
}

// Singleton instance
let llmClientInstance: LLMClient | null = null;

/**
 * Get or create the LLM client singleton
 */
export function getLLMClient(): LLMClient {
  if (!llmClientInstance) {
    llmClientInstance = new LLMClient();
  }
  return llmClientInstance;
}

/**
 * Reset the LLM client (useful for testing)
 */
export function resetLLMClient(): void {
  llmClientInstance = null;
}
