import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { prisma } from '../services/prisma';
import { requireAuth, AuthContext } from '../middleware/auth';
import { getLLMClient, LLMMessage } from '../services/llm';
import { getTokenCounter } from '../services/tokens';
import { getConfig } from '../services/config';
import { getToolRegistry, getToolExecutor, type ToolContext } from '../services/tools';
import { getSkillProcessor } from '../services/skills/processor';
import path from 'path';

const stream = new Hono<AuthContext>();

// All stream routes require authentication
stream.use('*', requireAuth);

/**
 * SSE Event Types (from SPEC.md lines 1147-1199)
 */
type StreamEventType =
  | 'message.start'
  | 'message.delta'
  | 'message.complete'
  | 'thinking.start'
  | 'thinking.delta'
  | 'thinking.complete'
  | 'tool.start'
  | 'tool.progress'
  | 'tool.complete'
  | 'tool.error'
  | 'error'
  | 'session.end';

interface StreamEvent {
  type: StreamEventType;
  sessionId: string;
  timestamp: number;
  data: any;
}

/**
 * Format SSE event
 */
function formatSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * GET /api/sessions/:sessionId/stream
 * SSE endpoint for real-time chat streaming
 */
stream.get('/sessions/:sessionId/stream', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Verify session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  // Get the latest user message to respond to
  const latestUserMessage = await prisma.message.findFirst({
    where: {
      sessionId,
      role: 'user',
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!latestUserMessage) {
    return c.json(
      {
        error: {
          code: 'NO_MESSAGE',
          message: 'No user message to respond to',
        },
      },
      400
    );
  }

  // Check if there's already an assistant response for this message
  const existingResponse = await prisma.message.findFirst({
    where: {
      sessionId,
      role: 'assistant',
      createdAt: {
        gt: latestUserMessage.createdAt,
      },
    },
  });

  if (existingResponse) {
    return c.json(
      {
        error: {
          code: 'ALREADY_RESPONDED',
          message: 'Already responded to the latest message',
        },
      },
      400
    );
  }

  // Get conversation history
  const config = getConfig();
  const allMessages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: config.session.maxHistoryMessages,
  });

  // Convert to LLM message format
  const llmMessages: LLMMessage[] = allMessages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  // Add system prompt if not present
  if (!llmMessages.some((m) => m.role === 'system')) {
    llmMessages.unshift({
      role: 'system',
      content: 'You are a helpful AI assistant. Be concise and helpful.',
    });
  }

  // Truncate to fit context window
  const tokenCounter = getTokenCounter();
  const truncatedMessages = tokenCounter.truncateToFit(
    llmMessages,
    config.session.contextWindowTokens
  );

  // Set up tool context
  const workspaceDir = session.workspacePath || path.join(process.env.WORKSPACE_ROOT || '/tmp/manus-workspaces', sessionId);
  const toolContext: ToolContext = {
    sessionId,
    userId: user.userId,
    workspaceDir,
  };

  // Get tool registry and convert to OpenAI format
  const toolRegistry = getToolRegistry(toolContext);
  const tools = config.tools.enabled.length > 0 ? toolRegistry.toOpenAIFunctions(config.tools.enabled) : undefined;

  return streamSSE(c, async (sseStream) => {
    const llmClient = getLLMClient();
    const toolExecutor = getToolExecutor(toolContext);
    let fullContent = '';
    const toolCallsCollected: Array<{ id: string; name: string; arguments: string }> = [];

    try {
      // Send message.start event
      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'message.start',
          sessionId,
          timestamp: Date.now(),
          data: { messageId: null },
        }),
      });

      // Stream the LLM response with tools
      for await (const chunk of llmClient.streamChat(truncatedMessages, tools)) {
        if (chunk.type === 'content' && chunk.content) {
          fullContent += chunk.content;

          await sseStream.writeSSE({
            data: JSON.stringify({
              type: 'message.delta',
              sessionId,
              timestamp: Date.now(),
              data: { content: chunk.content },
            }),
          });
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          // LLM wants to call a tool
          toolCallsCollected.push(chunk.toolCall);

          await sseStream.writeSSE({
            data: JSON.stringify({
              type: 'tool.start',
              sessionId,
              timestamp: Date.now(),
              data: {
                toolCallId: chunk.toolCall.id,
                toolName: chunk.toolCall.name,
                params: JSON.parse(chunk.toolCall.arguments || '{}'),
              },
            }),
          });

          // Execute the tool
          try {
            const params = JSON.parse(chunk.toolCall.arguments || '{}');
            const result = await toolExecutor.execute(chunk.toolCall.name, params);

            // Save tool call to database
            await prisma.toolCall.create({
              data: {
                sessionId,
                toolName: chunk.toolCall.name,
                parameters: params,
                result: result,
                status: result.success ? 'completed' : 'failed',
                durationMs: result.duration,
              },
            });

            // Send tool completion event
            await sseStream.writeSSE({
              data: JSON.stringify({
                type: result.success ? 'tool.complete' : 'tool.error',
                sessionId,
                timestamp: Date.now(),
                data: {
                  toolCallId: chunk.toolCall.id,
                  toolName: chunk.toolCall.name,
                  result: result.output,
                  success: result.success,
                  error: result.error,
                  duration: result.duration,
                },
              }),
            });
          } catch (error) {
            await sseStream.writeSSE({
              data: JSON.stringify({
                type: 'tool.error',
                sessionId,
                timestamp: Date.now(),
                data: {
                  toolCallId: chunk.toolCall.id,
                  toolName: chunk.toolCall.name,
                  error: error instanceof Error ? error.message : 'Tool execution failed',
                },
              }),
            });
          }
        } else if (chunk.type === 'done') {
          // Save the assistant message to database
          const assistantMessage = await prisma.message.create({
            data: {
              sessionId,
              role: 'assistant',
              content: fullContent,
              metadata: {
                finishReason: chunk.finishReason,
                model: llmClient.getModel(),
              },
            },
          });

          // Update session lastActiveAt
          await prisma.session.update({
            where: { id: sessionId },
            data: { lastActiveAt: new Date() },
          });

          // Send message.complete event
          await sseStream.writeSSE({
            data: JSON.stringify({
              type: 'message.complete',
              sessionId,
              timestamp: Date.now(),
              data: {
                messageId: assistantMessage.id,
                finishReason: chunk.finishReason,
              },
            }),
          });
        }
      }
    } catch (error) {
      console.error('Stream error:', error);

      // Send error event
      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          sessionId,
          timestamp: Date.now(),
          data: {
            code: 'LLM_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        }),
      });
    }
  });
});

/**
 * POST /api/sessions/:sessionId/chat
 * Send a message and get streaming response
 * Combines message creation with streaming response
 */
stream.post('/sessions/:sessionId/chat', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Parse request body
  let content: string;
  try {
    const body = await c.req.json();
    content = body.content;
    if (!content || typeof content !== 'string') {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Content is required',
          },
        },
        400
      );
    }
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_JSON',
          message: 'Invalid JSON in request body',
        },
      },
      400
    );
  }

  // Verify session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  if (session.status !== 'active') {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_ACTIVE',
          message: 'Session is not active',
        },
      },
      400
    );
  }

  // Create user message
  const userMessage = await prisma.message.create({
    data: {
      sessionId,
      role: 'user',
      content,
    },
  });

  // Get conversation history
  const config = getConfig();
  const allMessages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: config.session.maxHistoryMessages,
  });

  // Convert to LLM message format
  const llmMessages: LLMMessage[] = allMessages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  // Check for skill invocation (slash command)
  const skillProcessor = getSkillProcessor();
  const skillInvocation = skillProcessor.parseCommand(content);
  let skillTools: string[] | undefined;

  if (skillInvocation) {
    // Format prompts using skill templates
    const formatted = skillProcessor.formatPrompts(skillInvocation);

    // Replace system prompt with skill's system prompt
    const existingSystemIndex = llmMessages.findIndex((m) => m.role === 'system');
    if (existingSystemIndex >= 0) {
      llmMessages[existingSystemIndex].content = formatted.systemPrompt;
    } else {
      llmMessages.unshift({
        role: 'system',
        content: formatted.systemPrompt,
      });
    }

    // Update the last user message with the formatted user prompt
    const lastUserIndex = llmMessages.findLastIndex((m) => m.role === 'user');
    if (lastUserIndex >= 0) {
      llmMessages[lastUserIndex].content = formatted.userPrompt;
    }

    // Restrict tools to skill's required tools
    skillTools = formatted.requiredTools;
  } else {
    // Add default system prompt if not present
    if (!llmMessages.some((m) => m.role === 'system')) {
      llmMessages.unshift({
        role: 'system',
        content: 'You are a helpful AI assistant. Be concise and helpful.',
      });
    }
  }

  // Truncate to fit context window
  const tokenCounter = getTokenCounter();
  const truncatedMessages = tokenCounter.truncateToFit(
    llmMessages,
    config.session.contextWindowTokens
  );

  // Set up tool context
  const workspaceDir = session.workspacePath || path.join(process.env.WORKSPACE_ROOT || '/tmp/manus-workspaces', sessionId);
  const toolContext: ToolContext = {
    sessionId,
    userId: user.userId,
    workspaceDir,
  };

  // Get tool registry and convert to OpenAI format
  // If skill invocation, use skill's required tools; otherwise use configured tools
  const toolRegistry = getToolRegistry(toolContext);
  const enabledTools = skillTools || config.tools.enabled;
  const tools = enabledTools.length > 0 ? toolRegistry.toOpenAIFunctions(enabledTools) : undefined;

  return streamSSE(c, async (sseStream) => {
    const llmClient = getLLMClient();
    const toolExecutor = getToolExecutor(toolContext);
    let fullContent = '';
    const toolCallsCollected: Array<{ id: string; name: string; arguments: string }> = [];

    try {
      // Send message.start event with user message ID
      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'message.start',
          sessionId,
          timestamp: Date.now(),
          data: { userMessageId: userMessage.id },
        }),
      });

      // Stream the LLM response with tools
      for await (const chunk of llmClient.streamChat(truncatedMessages, tools)) {
        if (chunk.type === 'content' && chunk.content) {
          fullContent += chunk.content;

          await sseStream.writeSSE({
            data: JSON.stringify({
              type: 'message.delta',
              sessionId,
              timestamp: Date.now(),
              data: { content: chunk.content },
            }),
          });
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          // LLM wants to call a tool
          toolCallsCollected.push(chunk.toolCall);

          await sseStream.writeSSE({
            data: JSON.stringify({
              type: 'tool.start',
              sessionId,
              timestamp: Date.now(),
              data: {
                toolCallId: chunk.toolCall.id,
                toolName: chunk.toolCall.name,
                params: JSON.parse(chunk.toolCall.arguments || '{}'),
              },
            }),
          });

          // Execute the tool
          try {
            const params = JSON.parse(chunk.toolCall.arguments || '{}');
            const result = await toolExecutor.execute(chunk.toolCall.name, params);

            // Save tool call to database
            await prisma.toolCall.create({
              data: {
                sessionId,
                toolName: chunk.toolCall.name,
                parameters: params,
                result: result,
                status: result.success ? 'completed' : 'failed',
                durationMs: result.duration,
              },
            });

            // Send tool completion event
            await sseStream.writeSSE({
              data: JSON.stringify({
                type: result.success ? 'tool.complete' : 'tool.error',
                sessionId,
                timestamp: Date.now(),
                data: {
                  toolCallId: chunk.toolCall.id,
                  toolName: chunk.toolCall.name,
                  result: result.output,
                  success: result.success,
                  error: result.error,
                  duration: result.duration,
                },
              }),
            });
          } catch (error) {
            await sseStream.writeSSE({
              data: JSON.stringify({
                type: 'tool.error',
                sessionId,
                timestamp: Date.now(),
                data: {
                  toolCallId: chunk.toolCall.id,
                  toolName: chunk.toolCall.name,
                  error: error instanceof Error ? error.message : 'Tool execution failed',
                },
              }),
            });
          }
        } else if (chunk.type === 'done') {
          // Save the assistant message to database
          const assistantMessage = await prisma.message.create({
            data: {
              sessionId,
              role: 'assistant',
              content: fullContent,
              metadata: {
                finishReason: chunk.finishReason,
                model: llmClient.getModel(),
              },
            },
          });

          // Update session lastActiveAt
          await prisma.session.update({
            where: { id: sessionId },
            data: { lastActiveAt: new Date() },
          });

          // Send message.complete event
          await sseStream.writeSSE({
            data: JSON.stringify({
              type: 'message.complete',
              sessionId,
              timestamp: Date.now(),
              data: {
                userMessageId: userMessage.id,
                assistantMessageId: assistantMessage.id,
                finishReason: chunk.finishReason,
              },
            }),
          });
        }
      }
    } catch (error) {
      console.error('Stream error:', error);

      // Send error event
      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          sessionId,
          timestamp: Date.now(),
          data: {
            code: 'LLM_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        }),
      });
    }
  });
});

export { stream as streamRoutes };
