/**
 * Task Manager
 * Implements goal-driven task execution to prevent infinite loops
 * and ensure proper task completion with artifact surfacing
 */

import type {
  TaskPhase,
  TaskGoal,
  TaskState,
  ExecutionStep,
  ReflectionResult,
  StepType,
  ToolCallHistory,
} from './types';
import { generateId } from '../../utils/id';

/**
 * Task Manager - Manages goal-driven task execution
 */
export class TaskManager {
  private state: Map<string, TaskState> = new Map();
  private toolCallHistory: Map<string, ToolCallHistory[]> = new Map();
  private readonly MAX_SEARCH_CALLS = 3;
  private readonly SEARCH_COOLDOWN_MS = 30000; // 30 seconds

  /**
   * Initialize a task for a session
   */
  initializeTask(
    sessionId: string,
    userId: string,
    userMessage: string
  ): TaskState {
    // Determine goal from user message
    const goal = this.inferGoal(userMessage);

    // Create execution plan
    const plan = this.createExecutionPlan(goal);

    const taskState: TaskState = {
      sessionId,
      userId,
      phase: 'planning',
      goal,
      plan,
      currentStep: 0,
      searchResults: [],
      papersSelected: [],
      contentGenerated: '',
      artifactGenerated: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.state.set(sessionId, taskState);
    this.toolCallHistory.set(sessionId, []);

    return taskState;
  }

  /**
   * Infer task goal from user message
   */
  private inferGoal(userMessage: string): TaskGoal {
    const lowerMessage = userMessage.toLowerCase();

    // Check if PPT generation is requested
    const requiresPPT =
      lowerMessage.includes('ppt') ||
      lowerMessage.includes('presentation') ||
      lowerMessage.includes('powerpoint') ||
      lowerMessage.includes('slides');

    // Check if search is requested
    const requiresSearch =
      lowerMessage.includes('search') ||
      lowerMessage.includes('find') ||
      lowerMessage.includes('papers') ||
      lowerMessage.includes('research') ||
      lowerMessage.includes('summarize');

    // Expected artifacts
    const expectedArtifacts: string[] = [];
    if (requiresPPT) expectedArtifacts.push('ppt');
    if (requiresSearch) expectedArtifacts.push('search_results');

    return {
      description: userMessage,
      requiresPPT,
      requiresSearch,
      expectedArtifacts,
    };
  }

  /**
   * Create execution plan based on goal
   */
  private createExecutionPlan(goal: TaskGoal): ExecutionStep[] {
    const plan: ExecutionStep[] = [];

    if (goal.requiresSearch) {
      plan.push({
        id: generateId(),
        type: 'web_search',
        description: 'Search for relevant papers',
        status: 'pending',
      });
    }

    if (goal.requiresPPT) {
      plan.push({
        id: generateId(),
        type: 'paper_selection',
        description: 'Select relevant papers',
        status: 'pending',
      });
      plan.push({
        id: generateId(),
        type: 'summarization',
        description: 'Summarize selected papers',
        status: 'pending',
      });
      plan.push({
        id: generateId(),
        type: 'ppt_generation',
        description: 'Generate PowerPoint presentation',
        status: 'pending',
      });
    }

    plan.push({
      id: generateId(),
      type: 'file_output',
      description: 'Finalize and output artifacts',
      status: 'pending',
    });

    return plan;
  }

  /**
   * Record a tool call
   */
  recordToolCall(
    sessionId: string,
    toolName: string,
    parameters: Record<string, any>,
    result?: any
  ): void {
    const history = this.toolCallHistory.get(sessionId) || [];
    history.push({
      toolName,
      parameters,
      timestamp: new Date(),
      result,
    });
    this.toolCallHistory.set(sessionId, history);

    // Update task state
    const state = this.state.get(sessionId);
    if (state) {
      state.updatedAt = new Date();

      // Check if this tool call completes the current step
      const currentStep = state.plan[state.currentStep];
      if (currentStep && this.isToolForStep(toolName, currentStep.type)) {
        currentStep.status = 'completed';
        currentStep.completedAt = new Date();
        currentStep.toolName = toolName;
        currentStep.result = result;
      }

      // Store search results
      if (toolName === 'web_search' && result?.artifacts) {
        try {
          const data = JSON.parse(result.artifacts[0]?.content || '{}');
          state.searchResults.push(data);
        } catch {
          // Ignore parse errors
        }
      }

      // Store generated artifact
      if (toolName === 'ppt_generator' && result?.artifacts?.[0]) {
        state.artifactGenerated = {
          type: 'ppt',
          name: result.artifacts[0].name,
          fileId: result.artifacts[0].fileId,
          size: result.artifacts[0].size,
        };
      }
    }
  }

  /**
   * Check if tool call is for given step type
   */
  private isToolForStep(toolName: string, stepType: StepType): boolean {
    const stepToolMap: Record<StepType, string[]> = {
      web_search: ['web_search'],
      paper_selection: [],
      summarization: [],
      ppt_generation: ['ppt_generator'],
      file_output: [],
    };
    return stepToolMap[stepType]?.includes(toolName) || false;
  }

  /**
   * Check if a tool call should be allowed
   * Prevents redundant tool calls
   */
  shouldAllowToolCall(
    sessionId: string,
    toolName: string,
    parameters: Record<string, any>
  ): { allowed: boolean; reason?: string } {
    const state = this.state.get(sessionId);
    const history = this.toolCallHistory.get(sessionId) || [];

    if (!state) {
      return { allowed: true };
    }

    // Check for repeated web_search calls
    if (toolName === 'web_search') {
      const recentSearchCalls = history.filter(
        (call) => call.toolName === 'web_search'
      );

      // Count calls in last minute
      const oneMinuteAgo = new Date(Date.now() - 60000);
      const callsInLastMinute = recentSearchCalls.filter(
        (call) => call.timestamp > oneMinuteAgo
      );

      if (callsInLastMinute.length >= this.MAX_SEARCH_CALLS) {
        return {
          allowed: false,
          reason: `Too many web_search calls (${callsInLastMinute.length} in last minute). Please work with existing results or ask the user for clarification.`,
        };
      }

      // Check for duplicate queries
      const query = parameters.query || '';
      const duplicateCall = recentSearchCalls.find(
        (call) => call.parameters.query === query
      );

      if (duplicateCall) {
        const timeSinceDuplicate =
          Date.now() - duplicateCall.timestamp.getTime();

        if (timeSinceDuplicate < this.SEARCH_COOLDOWN_MS) {
          return {
            allowed: false,
            reason: `Already searched for "${query}" recently (${Math.round(
              timeSinceDuplicate / 1000
            )}s ago). Please use existing results.`,
          };
        }
      }
    }

    // Check if task is already complete
    if (state.phase === 'completed') {
      return {
        allowed: false,
        reason:
          'Task is already complete. Start a new task to perform additional actions.',
      };
    }

    // Check if PPT is generated but user is asking for progress
    if (
      state.artifactGenerated &&
      toolName === 'web_search' &&
      this.isProgressQuery(parameters.query || '')
    ) {
      return {
        allowed: false,
        reason:
          'PPT has been generated. Report completion to user instead of searching again.',
      };
    }

    return { allowed: true };
  }

  /**
   * Check if query is a progress/status inquiry
   */
  private isProgressQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    const progressIndicators = [
      'progress',
      'status',
      'how are you doing',
      'what is the status',
      'are you done',
      'did you finish',
      'complete',
      'current state',
    ];
    return progressIndicators.some((indicator) =>
      lowerQuery.includes(indicator)
    );
  }

  /**
   * Reflect on task state to determine next action
   */
  reflect(sessionId: string, llmResponse?: string): ReflectionResult {
    const state = this.state.get(sessionId);

    if (!state) {
      return {
        isComplete: false,
        shouldContinue: false,
        nextAction: 'respond',
        reasoning: 'No active task found',
      };
    }

    state.updatedAt = new Date();

    // Check if all steps are completed
    const completedSteps = state.plan.filter((s) => s.status === 'completed').length;
    const allStepsCompleted = completedSteps === state.plan.length;

    // Check if PPT is generated
    const pptGenerated = !!state.artifactGenerated;

    // Check if required artifacts are generated
    const allArtifactsGenerated = state.goal.expectedArtifacts.every((artifact) => {
      if (artifact === 'ppt') return pptGenerated;
      if (artifact === 'search_results') return state.searchResults.length > 0;
      return false;
    });

    // Determine completion status
    if (allStepsCompleted && allArtifactsGenerated) {
      state.phase = 'completed';
      return {
        isComplete: true,
        shouldContinue: false,
        nextAction: 'complete',
        reasoning: `Task completed with all ${state.plan.length} steps finished.`,
      };
    }

    // If PPT is generated, task should be considered complete
    if (pptGenerated && state.goal.requiresPPT) {
      state.phase = 'completed';
      return {
        isComplete: true,
        shouldContinue: false,
        nextAction: 'complete',
        reasoning: `PPT generated at ${state.artifactGenerated?.name}. Task complete.`,
      };
    }

    // If search results are sufficient and PPT is not required
    if (state.searchResults.length > 0 && !state.goal.requiresPPT) {
      state.phase = 'completed';
      return {
        isComplete: true,
        shouldContinue: false,
        nextAction: 'respond',
        reasoning: `Search completed with ${state.searchResults.length} results.`,
      };
    }

    // Move to next step
    const nextStepIndex = state.plan.findIndex((s) => s.status === 'pending');
    if (nextStepIndex >= 0) {
      state.currentStep = nextStepIndex;
      state.phase = 'executing';
      return {
        isComplete: false,
        shouldContinue: true,
        nextAction: 'continue',
        reasoning: `Proceeding to step ${nextStepIndex + 1}: ${state.plan[nextStepIndex].description}`,
      };
    }

    // No pending steps but task not complete - need more info
    return {
      isComplete: false,
      shouldContinue: false,
      nextAction: 'need_more_info',
      reasoning: 'Task execution stuck - waiting for more information or input',
    };
  }

  /**
   * Get task state for a session
   */
  getTaskState(sessionId: string): TaskState | undefined {
    return this.state.get(sessionId);
  }

  /**
   * Update task state
   */
  updateTaskState(sessionId: string, updates: Partial<TaskState>): void {
    const state = this.state.get(sessionId);
    if (state) {
      Object.assign(state, updates);
      state.updatedAt = new Date();
    }
  }

  /**
   * Complete a task
   */
  completeTask(sessionId: string): void {
    const state = this.state.get(sessionId);
    if (state) {
      state.phase = 'completed';
      state.updatedAt = new Date();
    }
  }

  /**
   * Fail a task
   */
  failTask(sessionId: string, reason: string): void {
    const state = this.state.get(sessionId);
    if (state) {
      state.phase = 'failed';
      state.updatedAt = new Date();
    }
  }

  /**
   * Clear task state for a session
   */
  clearTask(sessionId: string): void {
    this.state.delete(sessionId);
    this.toolCallHistory.delete(sessionId);
  }

  /**
   * Get task summary for user display
   */
  getTaskSummary(sessionId: string): string {
    const state = this.state.get(sessionId);

    if (!state) {
      return 'No active task.';
    }

    const completedSteps = state.plan.filter((s) => s.status === 'completed').length;
    const totalSteps = state.plan.length;
    const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    let summary = `**Task Progress:** ${progress}% (${completedSteps}/${totalSteps} steps completed)\n\n`;

    // Add current step
    const currentStep = state.plan[state.currentStep];
    if (currentStep && currentStep.status !== 'completed') {
      summary += `**Current Step:** ${currentStep.description}\n`;
    } else if (state.phase === 'completed') {
      summary += `**Status:** Complete\n`;
    } else if (state.phase === 'failed') {
      summary += `**Status:** Failed\n`;
    }

    // Add artifacts
    if (state.artifactGenerated) {
      summary += `\n**Generated:** ${state.artifactGenerated.name} (${state.artifactGenerated.type})\n`;
    }

    return summary;
  }

  /**
   * Get context to add to system prompt
   */
  getSystemPromptContext(sessionId: string): string {
    const state = this.state.get(sessionId);

    if (!state) {
      return '';
    }

    let context = `TASK CONTEXT:\n`;
    context += `- Goal: ${state.goal.description}\n`;
    context += `- Phase: ${state.phase}\n`;
    context += `- Progress: `;

    const completedSteps = state.plan.filter((s) => s.status === 'completed').length;
    context += `${completedSteps}/${state.plan.length} steps completed\n`;

    if (state.artifactGenerated) {
      context += `- Artifact Generated: ${state.artifactGenerated.name}\n`;
    }

    if (state.searchResults.length > 0) {
      context += `- Search Results: ${state.searchResults.length} papers found\n`;
    }

    context += `\nINSTRUCTIONS:\n`;
    context += `- Complete the task efficiently without redundant tool calls\n`;
    context += `- When PPT is generated, the task is COMPLETE\n`;
    context += `- When user asks about progress, report current state WITHOUT making new tool calls\n`;
    context += `- Only call web_search if truly necessary and not recently done\n`;

    return context;
  }
}

// Singleton instance
let taskManagerInstance: TaskManager | null = null;

/**
 * Get or create TaskManager singleton
 */
export function getTaskManager(): TaskManager {
  if (!taskManagerInstance) {
    taskManagerInstance = new TaskManager();
  }
  return taskManagerInstance;
}
