import type { JSONSchema } from '@mark/shared';
import { getLLMClient, type LLMMessage, type LLMClient } from '../../llm';
import type { ExecutionContext, ExecutionErrorType, ExternalSkillContract } from '@mark/shared';
import type { RuntimeResult, SkillRuntime } from './types';

export class PromptRuntime implements SkillRuntime {
  readonly kind = 'prompt';
  private llmClient?: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient;
  }

  async run(
    skill: ExternalSkillContract,
    input: string,
    parameters: Readonly<Record<string, unknown>>,
    context: ExecutionContext
  ): Promise<RuntimeResult> {
    const startTime = Date.now();
    const policy = context.resolvedPolicy;
    const maxRetries = policy.retryCount ?? 0;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        const llm = this.llmClient || getLLMClient();
        const messages = this.buildMessages(skill, input, parameters, context);
        const timeoutMs = policy.timeoutMs ?? 30000;

        const responsePromise = llm.chat(messages, undefined, {
          maxTokens: policy.maxTokens,
        });
        const response = await this.withTimeout(responsePromise, timeoutMs);

        const { normalizedOutput, validationError } = this.validateOutput(
          response.content,
          skill.outputSchema
        );

        if (validationError) {
          return this.buildErrorResult(
            validationError,
            'VALIDATION',
            startTime,
            retryCount
          );
        }

        return {
          success: true,
          output: {
            response: response.content,
            usage: response.usage,
          },
          rawOutput: response.content ?? '',
          normalizedOutput,
          metrics: {
            executionTimeMs: Date.now() - startTime,
            tokensUsed: response.usage?.totalTokens,
            toolsUsed: [],
            retryCount,
          },
        };
      } catch (error) {
        retryCount += 1;
        if (retryCount > maxRetries) {
          const errorType = this.classifyError(error);
          return this.buildErrorResult(
            error,
            errorType,
            startTime,
            retryCount - 1
          );
        }
        await this.backoff(retryCount);
      }
    }

    return this.buildErrorResult(
      new Error('Max retries exceeded'),
      'UNKNOWN',
      startTime,
      retryCount
    );
  }

  private buildMessages(
    skill: ExternalSkillContract,
    input: string,
    parameters: Readonly<Record<string, unknown>>,
    context: ExecutionContext
  ): LLMMessage[] {
    const systemPrompt =
      skill.systemPrompt ||
      `You are executing the "${skill.name}" skill. ${skill.description}`;

    let userPrompt = skill.userPromptTemplate || '{userInput}';
    const workspaceFiles = context.workspaceFiles?.join(', ') || '(none)';

    userPrompt = userPrompt.replace('{userInput}', input).replace('{workspaceFiles}', workspaceFiles);

    for (const [key, value] of Object.entries(parameters)) {
      userPrompt = userPrompt.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value ?? ''));
    }

    userPrompt = userPrompt.replace(/\{[^}]+\}/g, '').trim();

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  private validateOutput(
    content: string | null,
    schema?: JSONSchema
  ): { normalizedOutput: unknown; validationError?: Error } {
    if (!schema) {
      return { normalizedOutput: content };
    }

    try {
      if (schema.type === 'string') {
        if (typeof content !== 'string') {
          throw new Error('Expected string output');
        }
        return { normalizedOutput: content };
      }

      const parsed = typeof content === 'string' ? JSON.parse(content) : content;

      if (schema.type === 'object') {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Expected object output');
        }
        if (Array.isArray(schema.required)) {
          for (const field of schema.required) {
            if (!(field in (parsed as Record<string, unknown>))) {
              throw new Error(`Missing required field: ${field}`);
            }
          }
        }
      }

      if (schema.type === 'array' && !Array.isArray(parsed)) {
        throw new Error('Expected array output');
      }

      if (schema.type === 'number' && typeof parsed !== 'number') {
        throw new Error('Expected number output');
      }

      if (schema.type === 'boolean' && typeof parsed !== 'boolean') {
        throw new Error('Expected boolean output');
      }

      return { normalizedOutput: parsed };
    } catch (error) {
      return {
        normalizedOutput: null,
        validationError: error instanceof Error ? error : new Error('Invalid output'),
      };
    }
  }

  private classifyError(error: unknown): ExecutionErrorType {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) return 'TIMEOUT';
      if (error.message.toLowerCase().includes('rate limit')) return 'LLM';
      if (error.message.toLowerCase().includes('validation')) return 'VALIDATION';
    }
    return 'UNKNOWN';
  }

  private async backoff(retryCount: number): Promise<void> {
    const delayMs = 1000 * retryCount;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs) as unknown as number;
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  private buildErrorResult(
    error: unknown,
    errorType: ExecutionErrorType,
    startTime: number,
    retryCount: number
  ): RuntimeResult {
    return {
      success: false,
      error: {
        type: errorType,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      metrics: {
        executionTimeMs: Date.now() - startTime,
        toolsUsed: [],
        retryCount,
      },
    };
  }
}
