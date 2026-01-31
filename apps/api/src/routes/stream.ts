import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { prisma } from '../services/prisma';
import { requireAuth, AuthContext } from '../middleware/auth';
import { getLLMClient, LLMMessage, ExtendedLLMMessage } from '../services/llm';
import { getTokenCounter } from '../services/tokens';
import { getConfig } from '../services/config';
import { getToolRegistry, getToolExecutor, type ToolContext } from '../services/tools';
import { getSkillProcessor } from '../services/skills/processor';
import { getTaskManager } from '../services/tasks';
import path from 'path';

const stream = new Hono<AuthContext>();

// All stream routes require authentication
stream.use('*', requireAuth);

/**
 * Agent configuration limits
 */
const AGENT_CONFIG = {
  maxToolSteps: 10,      // Maximum tool execution steps per turn
  maxExecutionTime: 5 * 60 * 1000, // 5 minutes max execution time
  idleTimeout: 30 * 1000, // 30 seconds idle timeout (frontend)
} as const;

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
  | 'session.end'
  | 'file.created'
  | 'agent.step_limit';

interface StreamEvent {
  type: StreamEventType;
  sessionId: string;
  timestamp: number;
  data: any;
}

/**
 * Process a single agent turn with continuation loop support
 *
 * This implements the correct tool-calling flow:
 * 1. LLM generates response (with or without tool calls)
 * 2. If tool calls: execute tools, add results to history, RECALL LLM
 * 3. If no tool calls: final answer, save and return
 */
async function processAgentTurn(
  sessionId: string,
  messages: ExtendedLLMMessage[],
  tools: any,
  toolContext: ToolContext,
  taskManager: any,
  prisma: any,
  llmClient: any,
  toolExecutor: any,
  sseStream: any,
  startTime: number,
  maxSteps: number = AGENT_CONFIG.maxToolSteps
): Promise<{ content: string; finishReason: string; stepsTaken: number }> {
  let currentMessages = [...messages];
  let steps = 0;
  let finalContent = '';

  // === CONTINUATION LOOP ===
  while (steps < maxSteps) {
    // Check execution timeout
    const elapsed = Date.now() - startTime;
    if (elapsed > AGENT_CONFIG.maxExecutionTime) {
      throw new Error('Agent execution timeout exceeded');
    }

    let hasToolCalls = false;
    const toolCallsCollected: Array<{ id: string; name: string; arguments: string }> = [];
    let stepContent = '';

    // === Step 1: Stream from LLM ===
    for await (const chunk of llmClient.streamChat(currentMessages, tools)) {
      if (chunk.type === 'content' && chunk.content) {
        stepContent += chunk.content;

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'message.delta',
            sessionId,
            timestamp: Date.now(),
            data: { content: chunk.content, step: steps + 1 },
          }),
        });
      }
      else if (chunk.type === 'tool_call' && chunk.toolCall) {
        hasToolCalls = true;
        toolCallsCollected.push(chunk.toolCall);

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'tool.start',
            sessionId,
            timestamp: Date.now(),
            data: {
              toolCallId: chunk.toolCall.id,
              toolName: chunk.toolCall.name,
              step: steps + 1,
            },
          }),
        });
      }
      else if (chunk.type === 'done') {
        // No more chunks
      }
    }

    // === Step 2: Process based on what LLM returned ===
    if (!hasToolCalls) {
      // No tool calls = final answer
      finalContent = stepContent;

      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'message.complete',
          sessionId,
          timestamp: Date.now(),
          data: {
            content: finalContent,
            finishReason: 'stop',
            stepsTaken: steps + 1,
          },
        }),
      });

      return { content: finalContent, finishReason: 'stop', stepsTaken: steps };
    }

    // === Step 3: Has tool calls - execute them and continue ===
    // Add assistant message with tool_calls to history
    currentMessages.push({
      role: 'assistant',
      content: stepContent || null,
      tool_calls: toolCallsCollected.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Execute each tool
    for (const toolCall of toolCallsCollected) {
      const params = JSON.parse(toolCall.arguments || '{}');

      // Check if tool call should be allowed
      const toolCheck = taskManager.shouldAllowToolCall(
        sessionId,
        toolCall.name,
        params
      );

      if (!toolCheck.allowed) {
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'tool.error',
            sessionId,
            timestamp: Date.now(),
            data: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              error: toolCheck.reason || 'Tool call not allowed',
              step: steps + 1,
            },
          }),
        });

        // Add error result to history so LLM knows
        currentMessages.push({
          role: 'tool',
          content: JSON.stringify({ success: false, error: toolCheck.reason }),
          tool_call_id: toolCall.id,
        });

        continue;
      }

      // Execute the tool
      try {
        const result = await toolExecutor.execute(toolCall.name, params, {
          onProgress: async (current: number, total: number, message?: string) => {
            await sseStream.writeSSE({
              data: JSON.stringify({
                type: 'tool.progress',
                sessionId,
                timestamp: Date.now(),
                data: {
                  toolCallId: toolCall.id,
                  toolName: toolCall.name,
                  current,
                  total,
                  message,
                  step: steps + 1,
                },
              }),
            });
          },
        });

        // Record tool call
        taskManager.recordToolCall(sessionId, toolCall.name, params, result);

        // Save to database
        await prisma.toolCall.create({
          data: {
            sessionId,
            toolName: toolCall.name,
            parameters: params,
            result: result,
            status: result.success ? 'completed' : 'failed',
            durationMs: result.duration,
          },
        });

        // Emit file.created event for artifacts
        if (result.success && result.artifacts && result.artifacts.length > 0) {
          for (const artifact of result.artifacts) {
            if (artifact.fileId) {
              await sseStream.writeSSE({
                data: JSON.stringify({
                  type: 'file.created',
                  sessionId,
                  timestamp: Date.now(),
                  data: {
                    fileId: artifact.fileId,
                    filename: artifact.name,
                    mimeType: artifact.mimeType,
                    size: artifact.size,
                    type: artifact.type,
                  },
                }),
              });
            }
          }
        }

        // CRITICAL: Add tool result to history for next LLM call
        const toolResultContent = JSON.stringify({
          success: result.success,
          output: result.output,
          error: result.error,
          artifacts: result.artifacts,
        });

        currentMessages.push({
          role: 'tool',
          content: toolResultContent,
          tool_call_id: toolCall.id,
        });

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: result.success ? 'tool.complete' : 'tool.error',
            sessionId,
            timestamp: Date.now(),
            data: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              result: result.output,
              success: result.success,
              error: result.error,
              duration: result.duration,
              step: steps + 1,
            },
          }),
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Tool execution failed';

        // Add error to history
        currentMessages.push({
          role: 'tool',
          content: JSON.stringify({ success: false, error: errorMsg }),
          tool_call_id: toolCall.id,
        });

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'tool.error',
            sessionId,
            timestamp: Date.now(),
            data: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              error: errorMsg,
              step: steps + 1,
            },
          }),
        });
      }
    }

    steps++;
    finalContent += stepContent; // Accumulate content across steps
  }

  // === Hit step limit ===
  await sseStream.writeSSE({
    data: JSON.stringify({
      type: 'agent.step_limit',
      sessionId,
      timestamp: Date.now(),
      data: {
        reason: `Exceeded maximum tool steps (${maxSteps})`,
        stepsTaken: steps,
      },
    }),
  });

  return { content: finalContent, finishReason: 'max_steps', stepsTaken: steps };
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

  // Initialize or get TaskManager
  const taskManager = getTaskManager();

  // Get tool registry and convert to OpenAI format
  const toolRegistry = getToolRegistry(toolContext);
  const tools = config.tools.enabled.length > 0 ? toolRegistry.toOpenAIFunctions(config.tools.enabled) : undefined;

  // Initialize task if not already tracking
  let taskState = taskManager.getTaskState(sessionId);
  if (!taskState) {
    taskState = taskManager.initializeTask(sessionId, user.userId, latestUserMessage.content);
  }

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

      // Build messages with task context
      const taskContext = taskManager.getSystemPromptContext(sessionId);
      let messagesWithTaskContext = [...truncatedMessages];

      // Add or update system prompt with task context
      const systemIndex = messagesWithTaskContext.findIndex((m) => m.role === 'system');
      const baseSystemPrompt = 'You are a helpful AI assistant. Be concise and helpful.';
      const enhancedSystemPrompt = taskContext
        ? `${baseSystemPrompt}\n\n${taskContext}`
        : baseSystemPrompt;

      if (systemIndex >= 0) {
        messagesWithTaskContext[systemIndex].content = enhancedSystemPrompt;
      } else {
        messagesWithTaskContext.unshift({
          role: 'system',
          content: enhancedSystemPrompt,
        });
      }

      // Stream the LLM response with tools
      for await (const chunk of llmClient.streamChat(messagesWithTaskContext, tools)) {
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
          const params = JSON.parse(chunk.toolCall.arguments || '{}');

          // Check if tool call should be allowed (prevent redundant calls)
          const toolCheck = taskManager.shouldAllowToolCall(
            sessionId,
            chunk.toolCall.name,
            params
          );

          if (!toolCheck.allowed) {
            // Send tool error with reason
            await sseStream.writeSSE({
              data: JSON.stringify({
                type: 'tool.error',
                sessionId,
                timestamp: Date.now(),
                data: {
                  toolCallId: chunk.toolCall.id,
                  toolName: chunk.toolCall.name,
                  error: toolCheck.reason || 'Tool call not allowed',
                },
              }),
            });
            continue;
          }

          toolCallsCollected.push(chunk.toolCall);

          await sseStream.writeSSE({
            data: JSON.stringify({
              type: 'tool.start',
              sessionId,
              timestamp: Date.now(),
              data: {
                toolCallId: chunk.toolCall.id,
                toolName: chunk.toolCall.name,
                params: params,
              },
            }),
          });

          // Execute the tool with progress callback
          try {
            const result = await toolExecutor.execute(chunk.toolCall.name, params, {
              onProgress: async (current: number, total: number, message?: string) => {
                // Send progress event
                await sseStream.writeSSE({
                  data: JSON.stringify({
                    type: 'tool.progress',
                    sessionId,
                    timestamp: Date.now(),
                    data: {
                      toolCallId: chunk.toolCall.id,
                      toolName: chunk.toolCall.name,
                      current,
                      total,
                      message,
                    },
                  }),
                });
              },
            });

            // Record tool call with TaskManager
            taskManager.recordToolCall(sessionId, chunk.toolCall.name, params, result);

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

            // Emit file.created event for artifacts
            if (result.success && result.artifacts && result.artifacts.length > 0) {
              for (const artifact of result.artifacts) {
                if (artifact.fileId) {
                  await sseStream.writeSSE({
                    data: JSON.stringify({
                      type: 'file.created',
                      sessionId,
                      timestamp: Date.now(),
                      data: {
                        fileId: artifact.fileId,
                        filename: artifact.name,
                        mimeType: artifact.mimeType,
                        size: artifact.size,
                        type: artifact.type,
                      },
                    }),
                  });
                }
              }
            }

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

  // Initialize or get TaskManager for this session
  const taskManager = getTaskManager();
  let taskState = taskManager.getTaskState(sessionId);

  // Clear previous task if this is a new user request (not a progress query)
  if (!taskState || !taskManager.getSystemPromptContext(sessionId)) {
    taskState = taskManager.initializeTask(sessionId, user.userId, content);
  }

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

      // Build messages with task context
      const taskContext = taskManager.getSystemPromptContext(sessionId);
      let messagesWithTaskContext = [...truncatedMessages];

      // Add or update system prompt with task context
      const systemIndex = messagesWithTaskContext.findIndex((m) => m.role === 'system');
      const baseSystemPrompt = 'You are a helpful AI assistant. Be concise and helpful.';
      const enhancedSystemPrompt = taskContext
        ? `${baseSystemPrompt}\n\n${taskContext}`
        : baseSystemPrompt;

      if (systemIndex >= 0) {
        messagesWithTaskContext[systemIndex].content = enhancedSystemPrompt;
      } else {
        messagesWithTaskContext.unshift({
          role: 'system',
          content: enhancedSystemPrompt,
        });
      }

      // Stream the LLM response with tools
      for await (const chunk of llmClient.streamChat(messagesWithTaskContext, tools)) {
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
          const params = JSON.parse(chunk.toolCall.arguments || '{}');

          // Check if tool call should be allowed (prevent redundant calls)
          const toolCheck = taskManager.shouldAllowToolCall(
            sessionId,
            chunk.toolCall.name,
            params
          );

          if (!toolCheck.allowed) {
            // Send tool error with reason
            await sseStream.writeSSE({
              data: JSON.stringify({
                type: 'tool.error',
                sessionId,
                timestamp: Date.now(),
                data: {
                  toolCallId: chunk.toolCall.id,
                  toolName: chunk.toolCall.name,
                  error: toolCheck.reason || 'Tool call not allowed',
                },
              }),
            });
            continue;
          }

          toolCallsCollected.push(chunk.toolCall);

          await sseStream.writeSSE({
            data: JSON.stringify({
              type: 'tool.start',
              sessionId,
              timestamp: Date.now(),
              data: {
                toolCallId: chunk.toolCall.id,
                toolName: chunk.toolCall.name,
                params: params,
              },
            }),
          });

          // Execute the tool with progress callback
          try {
            const result = await toolExecutor.execute(chunk.toolCall.name, params, {
              onProgress: async (current: number, total: number, message?: string) => {
                // Send progress event
                await sseStream.writeSSE({
                  data: JSON.stringify({
                    type: 'tool.progress',
                    sessionId,
                    timestamp: Date.now(),
                    data: {
                      toolCallId: chunk.toolCall.id,
                      toolName: chunk.toolCall.name,
                      current,
                      total,
                      message,
                    },
                  }),
                });
              },
            });

            // Record tool call with TaskManager
            taskManager.recordToolCall(sessionId, chunk.toolCall.name, params, result);

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

            // Emit file.created event for artifacts
            if (result.success && result.artifacts && result.artifacts.length > 0) {
              for (const artifact of result.artifacts) {
                if (artifact.fileId) {
                  await sseStream.writeSSE({
                    data: JSON.stringify({
                      type: 'file.created',
                      sessionId,
                      timestamp: Date.now(),
                      data: {
                        fileId: artifact.fileId,
                        filename: artifact.name,
                        mimeType: artifact.mimeType,
                        size: artifact.size,
                        type: artifact.type,
                      },
                    }),
                  });
                }
              }
            }

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
