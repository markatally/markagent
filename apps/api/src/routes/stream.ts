import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { prisma } from '../services/prisma';
import { requireAuth, AuthContext } from '../middleware/auth';
import { getLLMClient, LLMMessage, ExtendedLLMMessage } from '../services/llm';
import { getTokenCounter } from '../services/tokens';
import { getConfig } from '../services/config';
import { getToolRegistry, getToolExecutor, type ToolContext } from '../services/tools';
import { getSkillProcessor } from '../services/skills/processor';
import { getDynamicSkillRegistry } from '../services/skills/dynamic-registry';
import { getTaskManager, PptPipelineController } from '../services/tasks';
import { processAgentOutput } from '../services/table';
import path from 'path';
import { getExternalSkillLoader } from '../services/external-skills/loader';
import { getSandboxManager, SandboxOrchestrator } from '../services/sandbox';
import { getBrowserManager, wrapExecutorWithBrowserEvents } from '../services/browser';
import type { ExecutionMode, InspectorTab } from '@mark/shared';

/** Prisma P2003 = foreign key constraint violated (e.g. session deleted during stream) */
function isPrismaForeignKeyError(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2003';
}

// LangGraph imports (optional - for graph-based agent execution)
import {
  createAgentRouter,
  createDefaultSkillRegistry,
  type AgentState,
  type ResearchState,
} from '../services/langgraph';

const stream = new Hono<AuthContext>();
const externalSkillLoader = getExternalSkillLoader();

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
  | 'reasoning.step'
  | 'thinking.start'
  | 'thinking.delta'
  | 'thinking.complete'
  | 'tool.start'
  | 'tool.progress'
  | 'tool.complete'
  | 'tool.error'
  | 'inspector.focus'
  | 'sandbox.provisioning'
  | 'sandbox.ready'
  | 'sandbox.teardown'
  | 'sandbox.fallback'
  | 'execution.step.start'
  | 'execution.step.update'
  | 'execution.step.end'
  | 'terminal.command'
  | 'terminal.stdout'
  | 'terminal.stderr'
  | 'fs.file.created'
  | 'fs.file.modified'
  | 'fs.tree.snapshot'
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

const inferFocusTab = (
  goal: { requiresPPT?: boolean; requiresSearch?: boolean } | null,
  executionMode: ExecutionMode
): { tab: InspectorTab; reason: string } => {
  if (executionMode === 'sandbox') {
    return { tab: 'computer', reason: 'Sandbox execution enabled' };
  }
  if (goal?.requiresPPT) {
    return { tab: 'computer', reason: 'Presentation generation uses Computer view' };
  }
  if (goal?.requiresSearch) {
    return { tab: 'computer', reason: 'Search workflows are tracked in Computer view' };
  }
  return { tab: 'reasoning', reason: 'Default reasoning trace' };
};

/**
 * Process a single agent turn with continuation loop support
 *
 * This implements the correct tool-calling flow:
 * 1. LLM generates response (with or without tool calls)
 * 2. If tool calls: execute tools, add results to history, RECALL LLM
 * 3. If no tool calls: final answer, save and return
 *
 * When PPT pipeline is enabled, callers pass activeStream (PptPipelineController.wrapStream(sseStream))
 * so that tool.complete and other events are seen by the pipeline and can trigger navigateToResults.
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
): Promise<{
  content: string;
  finishReason: string;
  stepsTaken: number;
  reasoningSteps: typeof completedReasoningSteps;
}> {
  let currentMessages = [...messages];
  let steps = 0;
  let finalContent = '';

  const reasoningTimers = new Map<string, number>();
  const searchToolNames = new Set(['web_search', 'paper_search']);
  let reasoningStepCounter = 0;
  let pendingThinkingStepId: string | null = null;
  let generatingStepId: string | null = null;
  let planningStepId: string | null = null;

  // Collector array for completed reasoning steps to persist in message metadata
  const completedReasoningSteps: Array<{
    stepId: string;
    label: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    message?: string;
    details?: { queries?: string[]; sources?: string[]; toolName?: string };
    thinkingContent?: string;
  }> = [];

  const emitReasoningStep = async ({
    stepId,
    label,
    status,
    message,
    details,
    thinkingContent,
  }: {
    stepId: string;
    label: string;
    status: 'running' | 'completed';
    message?: string;
    details?: { queries?: string[]; sources?: string[]; toolName?: string };
    thinkingContent?: string;
  }) => {
    const now = Date.now();
    if (status === 'running') {
      reasoningTimers.set(stepId, now);
    }
    const startedAt = reasoningTimers.get(stepId);
    const durationMs = status === 'completed' && startedAt ? now - startedAt : undefined;

    // Collect completed steps for persistence
    if (status === 'completed' && startedAt && durationMs !== undefined) {
      completedReasoningSteps.push({
        stepId,
        label,
        startedAt,
        completedAt: now,
        durationMs,
        message,
        details,
        thinkingContent,
      });
    }

    await sseStream.writeSSE({
      data: JSON.stringify({
        type: 'reasoning.step',
        sessionId,
        timestamp: now,
        data: {
          stepId,
          label,
          status,
          message,
          durationMs,
          details,
          thinkingContent,
        },
      }),
    });
  };

  // Emit initial step (will be relabeled based on whether tools are used)
  planningStepId = `planning-${Date.now()}-${reasoningStepCounter++}`;
  await emitReasoningStep({
    stepId: planningStepId,
    label: 'Analyzing',
    status: 'running',
    message: 'Processing query...',
  });

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
    let thinkingContentEmitted = false;

    // === Step 1: Stream from LLM ===
    for await (const chunk of llmClient.streamChat(currentMessages, tools)) {
      if (chunk.type === 'content' && chunk.content) {
        stepContent += chunk.content;

        // Update planning step to "Generating response" when first token arrives
        if (planningStepId) {
          await emitReasoningStep({
            stepId: planningStepId,
            label: 'Generating response',
            status: 'running',
            message: 'Streaming response...',
          });
          generatingStepId = planningStepId;
          planningStepId = null;
        }
        if (pendingThinkingStepId) {
          await emitReasoningStep({
            stepId: pendingThinkingStepId,
            label: 'Thinking',
            status: 'completed',
            message: 'Thought through results.',
          });
          pendingThinkingStepId = null;
          
          // Start generating step after thinking
          if (!generatingStepId) {
            generatingStepId = `generating-${steps + 1}-${reasoningStepCounter++}`;
            await emitReasoningStep({
              stepId: generatingStepId,
              label: 'Generating response',
              status: 'running',
              message: 'Drafting response...',
            });
          }
        }

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

        if (!thinkingContentEmitted && stepContent.trim().length > 0) {
          thinkingContentEmitted = true;
          await emitReasoningStep({
            stepId: `reasoning-${steps + 1}-${reasoningStepCounter++}`,
            label: 'Reasoning',
            status: 'completed',
            message: 'Drafted approach before tools.',
            thinkingContent: stepContent.trim(),
          });
        }

        // Complete analyzing/planning or thinking when tool calls begin
        if (planningStepId) {
          await emitReasoningStep({
            stepId: planningStepId,
            label: 'Analyzing',
            status: 'completed',
            message: 'Analysis complete, calling tools.',
          });
          planningStepId = null;
        }
        if (pendingThinkingStepId) {
          await emitReasoningStep({
            stepId: pendingThinkingStepId,
            label: 'Thinking',
            status: 'completed',
            message: 'Thought through results.',
          });
          pendingThinkingStepId = null;
        }
        if (generatingStepId) {
          await emitReasoningStep({
            stepId: generatingStepId,
            label: 'Generating response',
            status: 'completed',
            message: 'Switching to tools...',
          });
          generatingStepId = null;
        }

        // Parse params for the tool.start event so frontend can display them
        let params = {};
        try {
          params = JSON.parse(chunk.toolCall.arguments || '{}');
        } catch {
          // Keep empty params if JSON parsing fails
        }

        const toolReasoningStepId = `tool-${chunk.toolCall.id}`;
        const isSearch = searchToolNames.has(chunk.toolCall.name);
        const queries = Array.isArray((params as any).queries)
          ? (params as any).queries
          : (params as any).query
          ? [(params as any).query]
          : undefined;

        await emitReasoningStep({
          stepId: toolReasoningStepId,
          label: isSearch ? 'Searching' : 'Executing tool',
          status: 'running',
          message: isSearch
            ? `Executing ${queries?.length || 1} search quer${queries?.length === 1 ? 'y' : 'ies'}...`
            : `Running ${chunk.toolCall.name}...`,
          details: {
            queries,
            toolName: chunk.toolCall.name,
          },
        });

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'tool.start',
            sessionId,
            timestamp: Date.now(),
            data: {
              toolCallId: chunk.toolCall.id,
              toolName: chunk.toolCall.name,
              params,
              step: steps + 1,
            },
          }),
        });

        if (chunk.toolCall.name === 'web_search') {
          await sseStream.writeSSE({
            data: JSON.stringify({
              type: 'inspector.focus',
              sessionId,
              timestamp: Date.now(),
              data: {
                tab: 'computer',
                reason: 'Web search is tracked in Computer view',
              },
            }),
          });
        }
      }
      else if (chunk.type === 'done') {
        // No more chunks
      }
    }

    // === Step 2: Process based on what LLM returned ===
    if (!hasToolCalls) {
      // No tool calls = final answer
      // Process any structured table JSON blocks into rendered markdown
      finalContent = processAgentOutput(stepContent);

      if (generatingStepId) {
        await emitReasoningStep({
          stepId: generatingStepId,
          label: 'Generating response',
          status: 'completed',
          message: 'Response ready.',
        });
        generatingStepId = null;
      }

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

      return {
        content: finalContent,
        finishReason: 'stop',
        stepsTaken: steps,
        reasoningSteps: completedReasoningSteps,
      };
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
      const toolCheck = taskManager.getToolCallDecision(
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

        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: searchToolNames.has(toolCall.name) ? 'Searching' : 'Executing tool',
          status: 'completed',
          message: toolCheck.reason || 'Tool call not allowed.',
          details: {
            toolName: toolCall.name,
          },
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
        taskManager.recordToolCall(sessionId, toolCall.name, params, result, result.success);

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
              artifacts: result.artifacts,
              step: steps + 1,
            },
          }),
        });

        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: searchToolNames.has(toolCall.name) ? 'Searching' : 'Executing tool',
          status: 'completed',
          message: result.success ? undefined : 'Failed.',
          details: {
            toolName: toolCall.name,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Tool execution failed';

        taskManager.recordToolCall(sessionId, toolCall.name, params, undefined, false);

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

        await emitReasoningStep({
          stepId: `tool-${toolCall.id}`,
          label: searchToolNames.has(toolCall.name) ? 'Searching' : 'Executing tool',
          status: 'completed',
          message: errorMsg,
          details: {
            toolName: toolCall.name,
          },
        });
      }
    }

    steps++;
    finalContent += stepContent; // Accumulate content across steps

    // Emit thinking.start before next LLM call so frontend shows progress
    // This prevents the UI from appearing "stuck" between tool execution steps
    const toolCount = toolCallsCollected.length;
    const searchCount = toolCallsCollected.filter((toolCall) =>
      searchToolNames.has(toolCall.name)
    ).length;
    const thinkingMessage = searchCount > 0
      ? `Reviewing ${searchCount} search result${searchCount === 1 ? '' : 's'}...`
      : `Reviewing ${toolCount || 1} tool result${toolCount === 1 ? '' : 's'}...`;

    pendingThinkingStepId = `thinking-${steps + 1}-${reasoningStepCounter++}`;
    await emitReasoningStep({
      stepId: pendingThinkingStepId,
      label: 'Thinking',
      status: 'running',
      message: thinkingMessage,
    });

    await sseStream.writeSSE({
      data: JSON.stringify({
        type: 'thinking.start',
        sessionId,
        timestamp: Date.now(),
        data: {
          step: steps + 1,
          message: 'Processing results...',
        },
      }),
    });
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

  return {
    content: finalContent,
    finishReason: 'max_steps',
    stepsTaken: steps,
    reasoningSteps: completedReasoningSteps,
  };
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

  // === USER SKILL FILTERING (GET stream endpoint) ===
  const registryGet = getDynamicSkillRegistry();
  const traceIdGet = `trace-get-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const userEnabledSkillsGet = await registryGet.getEnabledSkillsForUser(user.userId, traceIdGet);
  
  // DEBUG: Log enabled skills for this request
  console.log(`[SKILL_DEBUG] GET /stream - User ${user.userId} has ${userEnabledSkillsGet.length} enabled skills:`, 
    userEnabledSkillsGet.map(s => s.name).join(', ') || 'NONE');

  // Build system prompt with enabled skill capabilities
  let systemPromptContentGet = 'You are a helpful AI assistant. Be concise and helpful.';
  
  if (userEnabledSkillsGet.length > 0) {
    const skillDescriptionsGet = userEnabledSkillsGet
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n');
    
    systemPromptContentGet += `

## CRITICAL: Your Available Skills

The user has enabled ONLY these skills:

${skillDescriptionsGet}

IMPORTANT RULES:
1. When the user asks "what can you do", "what skills do you have", or similar questions about your capabilities, you MUST list ONLY the skills shown above.
2. Do NOT mention internal tools (like file_reader, file_writer, bash_executor, web_search, paper_search, ppt_generator, etc.) - these are internal implementation details.
3. Do NOT make up or invent capabilities beyond the enabled skills listed above.
4. Do NOT list generic AI capabilities like "programming", "data analysis", "writing", etc. unless they are explicitly in the enabled skills list.
5. If a skill is not in the list above, you do NOT have that capability.`;
  } else {
    systemPromptContentGet += `

## CRITICAL: No Skills Enabled

The user has not enabled any skills.

IMPORTANT RULES:
1. When the user asks "what can you do" or similar, explain that you are a general AI assistant but no specialized skills are currently enabled.
2. Suggest they enable skills in the Skills settings (gear icon) to unlock specialized capabilities.
3. Do NOT mention internal tools or make up capabilities.
4. Do NOT list generic AI capabilities - you have no specialized skills enabled.`;
  }

  // Always use fresh system prompt with current skill list (skills may change mid-conversation)
  const sysIdx = llmMessages.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    // REPLACE existing system prompt entirely with fresh skill-enhanced one
    llmMessages[sysIdx].content = systemPromptContentGet;
  } else {
    llmMessages.unshift({
      role: 'system',
      content: systemPromptContentGet,
    });
  }

  // Truncate to fit context window
  const tokenCounter = getTokenCounter();
  const truncatedMessages = tokenCounter.truncateToFit(
    llmMessages,
    config.session.contextWindowTokens
  );

  // Set up tool context
  const workspaceDir = session.workspacePath || path.join(process.env.WORKSPACE_ROOT || '/tmp/mark-workspaces', sessionId);
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

  // Always initialize fresh task per user message (one task per request-response cycle)
  taskManager.clearTask(sessionId);
  const taskState = taskManager.initializeTask(sessionId, user.userId, latestUserMessage.content);
  const executionMode: ExecutionMode = 'direct';

  return streamSSE(c, async (sseStream) => {
    const llmClient = getLLMClient();
    const baseToolExecutor = getToolExecutor(toolContext);
    const startTime = Date.now();
    const pipelineEnabled = config.execution?.pptPipeline?.enabled !== false;
    const pipelineController =
      pipelineEnabled && taskState?.goal?.requiresPPT
        ? new PptPipelineController(sessionId, sseStream.writeSSE.bind(sseStream))
        : null;
    const activeStream = pipelineController ? pipelineController.wrapStream(sseStream) : sseStream;
    const toolExecutor =
      getBrowserManager().isEnabled() && activeStream
        ? wrapExecutorWithBrowserEvents({ sessionId, toolExecutor: baseToolExecutor, sseStream: activeStream })
        : baseToolExecutor;

    try {
      // Send message.start event
      await activeStream.writeSSE({
        data: JSON.stringify({
          type: 'message.start',
          sessionId,
          timestamp: Date.now(),
          data: { messageId: null },
        }),
      });

      const focus = inferFocusTab(taskState?.goal || null, executionMode);
      await activeStream.writeSSE({
        data: JSON.stringify({
          type: 'inspector.focus',
          sessionId,
          timestamp: Date.now(),
          data: focus,
        }),
      });

      // Build messages with task context
      const taskContext = taskManager.getSystemPromptContext(sessionId);
      const baseMessages: ExtendedLLMMessage[] = truncatedMessages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

      // Add task context to existing system prompt (preserve skill info that was added earlier)
      const systemIndex = baseMessages.findIndex((m) => m.role === 'system');
      
      if (systemIndex >= 0 && taskContext) {
        // Append task context to existing system prompt (which already has skill info)
        baseMessages[systemIndex].content += `\n\n${taskContext}`;
      } else if (systemIndex < 0) {
        // No system prompt exists - use the skill-enhanced one we built earlier
        baseMessages.unshift({
          role: 'system',
          content: systemPromptContentGet + (taskContext ? `\n\n${taskContext}` : ''),
        });
      }

      // Process agent turn with continuation loop
      let result: any;
      if (executionMode === 'sandbox') {
        const sandboxManager = getSandboxManager();
        if (!sandboxManager.isEnabled()) {
          await activeStream.writeSSE({
            data: JSON.stringify({
              type: 'sandbox.fallback',
              sessionId,
              timestamp: Date.now(),
              data: { reason: 'Sandbox is disabled' },
            }),
          });
          result = await processAgentTurn(
            sessionId,
            baseMessages,
            tools,
            toolContext,
            taskManager,
            prisma,
            llmClient,
            toolExecutor,
            activeStream,
            startTime
          );
        } else {
          try {
            const orchestrator = new SandboxOrchestrator(sandboxManager);
            result = await orchestrator.execute({
              sessionId,
              messages: baseMessages,
              tools,
              toolContext,
              taskManager,
              prisma,
              llmClient,
              startTime,
              toolExecutor,
              sseStream: activeStream,
              processAgentTurn,
            });
          } catch (error: any) {
            await activeStream.writeSSE({
              data: JSON.stringify({
                type: 'sandbox.fallback',
                sessionId,
                timestamp: Date.now(),
                data: { reason: error?.message || 'Sandbox execution failed' },
              }),
            });
            result = await processAgentTurn(
              sessionId,
              baseMessages,
              tools,
              toolContext,
              taskManager,
              prisma,
              llmClient,
              toolExecutor,
              activeStream,
              startTime
            );
          }
        }
      } else {
        result = await processAgentTurn(
          sessionId,
          baseMessages,
          tools,
          toolContext,
          taskManager,
          prisma,
          llmClient,
          toolExecutor,
          activeStream,
          startTime
        );
      }

      // Save final assistant message to database
      try {
        const assistantMessage = await prisma.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: result.content,
            metadata: {
              finishReason: result.finishReason,
              model: llmClient.getModel(),
              stepsTaken: result.stepsTaken,
              reasoningSteps: result.reasoningSteps,
            },
          },
        });

        await prisma.toolCall.updateMany({
          where: { sessionId, messageId: null },
          data: { messageId: assistantMessage.id },
        });

        await prisma.session.update({
          where: { id: sessionId },
          data: { lastActiveAt: new Date() },
        });
      } catch (persistError) {
        if (isPrismaForeignKeyError(persistError)) {
          console.warn('Session no longer exists, skipping assistant message persistence (GET /stream)');
        } else {
          throw persistError;
        }
      }
    } catch (error) {
      console.error('Stream error:', error);

      // Send error event
      await activeStream.writeSSE({
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
  
  // DEBUG: Confirm handler is executing
  console.log(`\n${'='.repeat(60)}\n[SKILL_DEBUG] POST /chat HANDLER CALLED\n${'='.repeat(60)}`);

  // Parse request body
  let content: string;
  let executionMode: ExecutionMode = 'direct';
  try {
    const body = await c.req.json();
    content = body.content;
    if (body.execution_mode === 'sandbox') {
      executionMode = 'sandbox';
    }
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

  await externalSkillLoader.getSkillSnapshot(sessionId);

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

  // === USER SKILL FILTERING ===
  // Load user's enabled external skills (CRITICAL: Use registry method, do NOT query DB directly)
  const registry = getDynamicSkillRegistry();
  const traceId = `trace-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const userEnabledSkills = await registry.getEnabledSkillsForUser(user.userId, traceId);
  
  // DEBUG: Log enabled skills for this request
  console.log(`[SKILL_DEBUG] POST /chat - User ${user.userId} has ${userEnabledSkills.length} enabled skills:`, 
    userEnabledSkills.map(s => s.name).join(', ') || 'NONE');

  // Guardrail: If no skills enabled, agent operates in LLM-only mode
  if (userEnabledSkills.length === 0) {
    console.info({
      event: 'no_skills_enabled',
      userId: user.userId,
      sessionId,
      traceId,
      message: 'User has no enabled skills - operating in LLM-only mode',
    });
  }

  // Check for skill invocation (slash command)
  const skillProcessor = getSkillProcessor();
  const skillInvocation = skillProcessor.parseCommand(content);
  let skillTools: string[] | undefined;

  if (skillInvocation) {
    // Verify user has access to this skill (if it's an external skill)
    const requestedSkillName = skillInvocation.skillName.toLowerCase();
    const hasAccess = userEnabledSkills.some(
      (skill) =>
        skill.name.toLowerCase() === requestedSkillName ||
        skill.aliases.some((alias) => alias.toLowerCase() === requestedSkillName)
    );

    // If external skill and user doesn't have access, block execution
    if (!hasAccess && skillInvocation.skill.isExternal) {
      throw new Error(
        `Access denied: Skill '${skillInvocation.skillName}' is not enabled for your account. Please enable it in Skills settings.`
      );
    }

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
  }
  
  // Build system prompt with enabled skill capabilities (always build for fallback)
  let systemPromptContent = 'You are a helpful AI assistant. Be concise and helpful.';
  
  // Add skill info to systemPromptContent (always, for fallback use)
  if (userEnabledSkills.length > 0) {
    const skillDescriptions = userEnabledSkills
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n');
    
    systemPromptContent += `

## CRITICAL: Your Available Skills

The user has enabled ONLY these skills:

${skillDescriptions}

IMPORTANT RULES:
1. When the user asks "what can you do", "what skills do you have", or similar questions about your capabilities, you MUST list ONLY the skills shown above.
2. Do NOT mention internal tools (like file_reader, file_writer, bash_executor, web_search, paper_search, ppt_generator, etc.) - these are internal implementation details.
3. Do NOT make up or invent capabilities beyond the enabled skills listed above.
4. Do NOT list generic AI capabilities like "programming", "data analysis", "writing", etc. unless they are explicitly in the enabled skills list.
5. If a skill is not in the list above, you do NOT have that capability.`;
  } else {
    systemPromptContent += `

## CRITICAL: No Skills Enabled

The user has not enabled any skills.

IMPORTANT RULES:
1. When the user asks "what can you do" or similar, explain that you are a general AI assistant but no specialized skills are currently enabled.
2. Suggest they enable skills in the Skills settings (gear icon) to unlock specialized capabilities.
3. Do NOT mention internal tools or make up capabilities.
4. Do NOT list generic AI capabilities - you have no specialized skills enabled.`;
  }
  
  // Only add to llmMessages if not using a skill invocation (skill invocation sets its own prompt)
  if (!skillInvocation) {
    // Always use fresh system prompt with current skill list (skills may change mid-conversation)
    const systemIndex = llmMessages.findIndex((m) => m.role === 'system');
    if (systemIndex >= 0) {
      // REPLACE existing system prompt entirely with fresh skill-enhanced one
      llmMessages[systemIndex].content = systemPromptContent;
      console.log(`[SKILL_DEBUG] REPLACED system prompt at index ${systemIndex}`);
    } else {
      llmMessages.unshift({
        role: 'system',
        content: systemPromptContent,
      });
      console.log(`[SKILL_DEBUG] ADDED new system prompt`);
    }
    // Log first 500 chars of system prompt
    console.log(`[SKILL_DEBUG] System prompt (first 500 chars):\n${systemPromptContent.substring(0, 500)}...`);
  }

  // Truncate to fit context window
  const tokenCounter = getTokenCounter();
  const truncatedMessages = tokenCounter.truncateToFit(
    llmMessages,
    config.session.contextWindowTokens
  );

  // Set up tool context
  const workspaceDir = session.workspacePath || path.join(process.env.WORKSPACE_ROOT || '/tmp/mark-workspaces', sessionId);
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

  // Always initialize fresh task per user message (one task per request-response cycle)
  const taskManager = getTaskManager();
  taskManager.clearTask(sessionId);
  const taskState = taskManager.initializeTask(sessionId, user.userId, content);

  return streamSSE(c, async (sseStream) => {
    const llmClient = getLLMClient();
    const baseToolExecutor = getToolExecutor(toolContext);
    const startTime = Date.now();
    const pipelineEnabled = config.execution?.pptPipeline?.enabled !== false;
    const pipelineController =
      pipelineEnabled && taskState?.goal?.requiresPPT
        ? new PptPipelineController(sessionId, sseStream.writeSSE.bind(sseStream))
        : null;
    const activeStream = pipelineController ? pipelineController.wrapStream(sseStream) : sseStream;
    const toolExecutor =
      getBrowserManager().isEnabled() && activeStream
        ? wrapExecutorWithBrowserEvents({ sessionId, toolExecutor: baseToolExecutor, sseStream: activeStream })
        : baseToolExecutor;

    try {
      // Send message.start event with user message ID
      await activeStream.writeSSE({
        data: JSON.stringify({
          type: 'message.start',
          sessionId,
          timestamp: Date.now(),
          data: { userMessageId: userMessage.id },
        }),
      });

      const focus = inferFocusTab(taskState?.goal || null, executionMode);
      await activeStream.writeSSE({
        data: JSON.stringify({
          type: 'inspector.focus',
          sessionId,
          timestamp: Date.now(),
          data: focus,
        }),
      });

      // Build messages with task context
      const taskContext = taskManager.getSystemPromptContext(sessionId);
      const baseMessages: ExtendedLLMMessage[] = truncatedMessages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

      // Add task context to existing system prompt (preserve skill info that was added earlier)
      const systemIndexChat = baseMessages.findIndex((m) => m.role === 'system');
      
      if (systemIndexChat >= 0 && taskContext) {
        // Append task context to existing system prompt (which already has skill info)
        baseMessages[systemIndexChat].content += `\n\n${taskContext}`;
      } else if (systemIndexChat < 0) {
        // No system prompt exists - use the skill-enhanced one we built earlier
        baseMessages.unshift({
          role: 'system',
          content: systemPromptContent + (taskContext ? `\n\n${taskContext}` : ''),
        });
      }

      // DEBUG: Log all messages being sent to LLM
      console.log(`[SKILL_DEBUG] Messages being sent to LLM (${baseMessages.length} total):`);
      baseMessages.forEach((m, i) => {
        const preview = m.content.substring(0, 200).replace(/\n/g, '\\n');
        console.log(`  [${i}] ${m.role}: ${preview}...`);
      });

      // Process agent turn with continuation loop
      const result = await processAgentTurn(
        sessionId,
        baseMessages,
        tools,
        toolContext,
        taskManager,
        prisma,
        llmClient,
        toolExecutor,
        activeStream,
        startTime
      );

      // Save final assistant message to database
      let assistantMessage: { id: string } | null = null;
      try {
        assistantMessage = await prisma.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: result.content,
            metadata: {
              finishReason: result.finishReason,
              model: llmClient.getModel(),
              stepsTaken: result.stepsTaken,
              reasoningSteps: result.reasoningSteps,
            },
          },
        });

        await prisma.toolCall.updateMany({
          where: { sessionId, messageId: null },
          data: { messageId: assistantMessage.id },
        });

        await prisma.session.update({
          where: { id: sessionId },
          data: { lastActiveAt: new Date() },
        });
      } catch (persistError) {
        if (isPrismaForeignKeyError(persistError)) {
          console.warn('Session no longer exists, skipping assistant message persistence (POST /chat)');
        } else {
          throw persistError;
        }
      }

      // Send message.complete event (assistantMessageId null if persistence skipped)
      await activeStream.writeSSE({
        data: JSON.stringify({
          type: 'message.complete',
          sessionId,
          timestamp: Date.now(),
          data: {
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage?.id ?? null,
            finishReason: result.finishReason,
          },
        }),
      });
    } catch (error) {
      console.error('Stream error:', error);

      // Send error event
      await activeStream.writeSSE({
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
 * POST /api/sessions/:sessionId/agent
 * 
 * NEW: Graph-based agent execution using LangGraph orchestration.
 * This endpoint provides deterministic, scenario-based execution with:
 * - Explicit DAG-based workflow
 * - Evidence-backed claims with citations
 * - Validation gates and hard constraints
 * 
 * Currently supports scenarios: research, ppt, summary, general_chat
 * 
 * BACKWARD COMPATIBLE: This is a NEW endpoint that runs alongside
 * the existing /chat endpoint. Use /chat for standard LLM interactions,
 * use /agent for structured, graph-based tasks.
 */
stream.post('/sessions/:sessionId/agent', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Parse request body
  let content: string;
  let forceScenario: string | undefined;
  
  try {
    const body = await c.req.json();
    content = body.content;
    forceScenario = body.scenario; // Optional: force a specific scenario
    
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

  await externalSkillLoader.getSkillSnapshot(sessionId);

  // Create user message
  const userMessage = await prisma.message.create({
    data: {
      sessionId,
      role: 'user',
      content,
    },
  });

  // Set up context
  const workspaceDir = session.workspacePath || path.join(process.env.WORKSPACE_ROOT || '/tmp/mark-workspaces', sessionId);
  const toolContext: ToolContext = {
    sessionId,
    userId: user.userId,
    workspaceDir,
  };

  // Get dependencies for LangGraph
  const toolRegistry = getToolRegistry(toolContext);
  const llmClient = getLLMClient();
  const skillRegistry = createDefaultSkillRegistry();

  // Create agent router
  const agentRouter = createAgentRouter(skillRegistry, toolRegistry, llmClient);

  return streamSSE(c, async (sseStream) => {
    const startTime = Date.now();

    try {
      // Send agent.start event
      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'agent.start',
          sessionId,
          timestamp: Date.now(),
          data: {
            userMessageId: userMessage.id,
            mode: 'langgraph',
          },
        }),
      });

      // Run the agent graph
      const result = await agentRouter.run(sessionId, user.userId, content);

      // Stream execution path as events
      for (const nodeId of result.executionPath) {
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'agent.node',
            sessionId,
            timestamp: Date.now(),
            data: {
              nodeId,
              status: 'completed',
            },
          }),
        });
      }

      // Handle success/failure
      if (result.success) {
        // Extract final content based on scenario
        let finalContent = '';
        const finalState = result.finalState;
        
        if ('finalReport' in finalState && finalState.finalReport) {
          // Research scenario - format report
          const report = (finalState as ResearchState).finalReport;
          finalContent = formatResearchReport(report);
        } else if (finalState.finalOutput) {
          // Generic output
          finalContent = typeof finalState.finalOutput === 'string' 
            ? finalState.finalOutput 
            : JSON.stringify(finalState.finalOutput, null, 2);
        } else {
          finalContent = 'Agent completed successfully but produced no output.';
        }
        
        // Process any structured table JSON blocks into rendered markdown
        finalContent = processAgentOutput(finalContent);

        // Save assistant message
        let assistantMessage: { id: string } | null = null;
        try {
          assistantMessage = await prisma.message.create({
            data: {
              sessionId,
              role: 'assistant',
              content: finalContent,
              metadata: {
                source: 'langgraph',
                scenario: finalState.parsedIntent?.scenario,
                executionPath: result.executionPath,
                duration: result.totalDuration,
                reasoningSteps: [],
              },
            },
          });

          await prisma.toolCall.updateMany({
            where: { sessionId, messageId: null },
            data: { messageId: assistantMessage.id },
          });
        } catch (persistError) {
          if (isPrismaForeignKeyError(persistError)) {
            console.warn('Session no longer exists, skipping assistant message persistence (POST /agent success)');
          } else {
            throw persistError;
          }
        }

        // Send completion events
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'message.delta',
            sessionId,
            timestamp: Date.now(),
            data: { content: finalContent },
          }),
        });

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'message.complete',
            sessionId,
            timestamp: Date.now(),
            data: {
              userMessageId: userMessage.id,
              assistantMessageId: assistantMessage?.id ?? null,
              scenario: finalState.parsedIntent?.scenario,
              finishReason: 'stop',
            },
          }),
        });

      } else {
        // Handle failure
        const errors = result.finalState.errors || [];
        const errorMessages = errors.map(e => e.message).join('; ');
        
        // Save error response
        try {
          await prisma.message.create({
            data: {
              sessionId,
              role: 'assistant',
              content: `Agent execution failed: ${errorMessages}`,
              metadata: {
                source: 'langgraph',
                status: 'failed',
                errors: errors.map(e => ({ code: e.code, message: e.message })),
                executionPath: result.executionPath,
              },
            },
          });
        } catch (persistError) {
          if (isPrismaForeignKeyError(persistError)) {
            console.warn('Session no longer exists, skipping assistant message persistence (POST /agent failure)');
          } else {
            throw persistError;
          }
        }

        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'agent.error',
            sessionId,
            timestamp: Date.now(),
            data: {
              code: 'AGENT_FAILED',
              message: errorMessages,
              errors: errors,
              executionPath: result.executionPath,
            },
          }),
        });
      }

      // Update session lastActiveAt
      try {
        await prisma.session.update({
          where: { id: sessionId },
          data: { lastActiveAt: new Date() },
        });
      } catch (persistError) {
        if (isPrismaForeignKeyError(persistError)) {
          console.warn('Session no longer exists, skipping session lastActiveAt update');
        } else {
          throw persistError;
        }
      }

    } catch (error) {
      console.error('Agent error:', error);

      await sseStream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          sessionId,
          timestamp: Date.now(),
          data: {
            code: 'AGENT_ERROR',
            message: error instanceof Error ? error.message : 'Unknown agent error',
          },
        }),
      });
    }
  });
});

/**
 * Format research report for display
 */
function formatResearchReport(report: any): string {
  if (!report) return 'No report generated.';
  
  let content = `# ${report.title || 'Research Report'}\n\n`;
  
  if (report.abstract) {
    content += `## Abstract\n\n${report.abstract}\n\n`;
  }
  
  if (report.sections && Array.isArray(report.sections)) {
    for (const section of report.sections) {
      content += `## ${section.heading}\n\n${section.content}\n\n`;
      
      if (section.citations && section.citations.length > 0) {
        content += `*Sources: ${section.citations.join(', ')}*\n\n`;
      }
    }
  }
  
  if (report.bibliography && Array.isArray(report.bibliography)) {
    content += `## References\n\n`;
    for (const ref of report.bibliography) {
      content += `- ${ref.citation || ref.paperId}\n`;
    }
  }
  
  return content;
}

export { stream as streamRoutes };
