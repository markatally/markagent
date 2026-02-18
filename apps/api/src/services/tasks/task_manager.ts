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
  // Treat search tools as high-cost - allow at most ONE call per task
  private readonly MAX_SEARCH_CALLS = 1;
  private readonly MAX_CONSECUTIVE_FAILURES = 2;
  private readonly VIDEO_URL_PATTERN = /https?:\/\/[^\s)]+/gi;
  private readonly SUMMARY_INTENT_PATTERN =
    /\b(?:summar(?:y|ize|ise|ized|ised|ization|isation)|recap|overview)\b|总结|分析|概述|复盘|解读|梳理/i;

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
    const urls = userMessage.match(this.VIDEO_URL_PATTERN) || [];
    const videoUrl = urls.find((url) => this.isLikelyVideoUrl(url));
    const hasVideoUrl = Boolean(videoUrl);

    const requestsDownload =
      /\bdownload\b/.test(lowerMessage) ||
      /\bsave\b/.test(lowerMessage);
    const requestsTranscript =
      /\btranscripts?\b/.test(lowerMessage) ||
      /\btranscribe\b/.test(lowerMessage) ||
      /\bsubtitles?\b/.test(lowerMessage) ||
      /\bcaptions?\b/.test(lowerMessage);
    const requestsVideoSummary =
      hasVideoUrl &&
      this.SUMMARY_INTENT_PATTERN.test(userMessage);

    const requiresVideoDownload = hasVideoUrl && requestsDownload;
    const requiresTranscript = hasVideoUrl && (requestsTranscript || requestsVideoSummary);
    const requiresVideoProbe = hasVideoUrl && (requiresVideoDownload || requiresTranscript);

    // Check if PPT generation is requested
    const requiresPPT =
      lowerMessage.includes('ppt') ||
      lowerMessage.includes('presentation') ||
      lowerMessage.includes('powerpoint') ||
      lowerMessage.includes('slides');

    // Check if search is requested
    const explicitSearchIntent =
      lowerMessage.includes('search') ||
      lowerMessage.includes('find') ||
      lowerMessage.includes('papers') ||
      lowerMessage.includes('research');
    const summaryIntent = this.SUMMARY_INTENT_PATTERN.test(userMessage);
    const requiresSearch = explicitSearchIntent || (!hasVideoUrl && summaryIntent);

    const isVideoPipelineRequest =
      requiresVideoProbe || requiresVideoDownload || requiresTranscript;

    // Expected artifacts
    const expectedArtifacts: string[] = [];
    if (requiresPPT) expectedArtifacts.push('ppt');
    if (requiresSearch && !isVideoPipelineRequest) expectedArtifacts.push('search_results');
    if (requiresVideoDownload) expectedArtifacts.push('video_file');
    if (requiresTranscript) expectedArtifacts.push('transcript');

    return {
      description: userMessage,
      requiresPPT: requiresPPT && !isVideoPipelineRequest,
      requiresSearch: requiresSearch && !isVideoPipelineRequest,
      requiresVideoProbe,
      requiresVideoDownload,
      requiresTranscript,
      ...(videoUrl ? { videoUrl } : {}),
      expectedArtifacts,
    };
  }

  private isLikelyVideoUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes('/video/') ||
      lower.includes('youtube.com/watch') ||
      lower.includes('youtu.be/') ||
      lower.includes('vimeo.com/') ||
      lower.includes('bilibili.com/video/')
    );
  }

  /**
   * Create execution plan based on goal
   */
  private createExecutionPlan(goal: TaskGoal): ExecutionStep[] {
    const plan: ExecutionStep[] = [];

    if (goal.requiresVideoProbe) {
      plan.push({
        id: generateId(),
        type: 'video_probe',
        description: 'Validate video URL and inspect available metadata/subtitle tracks',
        status: 'pending',
      });
    }

    if (goal.requiresVideoDownload) {
      plan.push({
        id: generateId(),
        type: 'video_download',
        description: 'Download the requested video',
        status: 'pending',
      });
    }

    if (goal.requiresTranscript) {
      plan.push({
        id: generateId(),
        type: 'video_transcript',
        description: 'Extract full transcript for the provided video',
        status: 'pending',
      });
    }

    if (goal.requiresSearch) {
      plan.push({
        id: generateId(),
        type: 'web_search',
        description: 'Search for relevant sources',
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
    result?: any,
    success: boolean = true
  ): void {
    const history = this.toolCallHistory.get(sessionId) || [];
    history.push({
      toolName,
      parameters,
      timestamp: new Date(),
      result,
      success,
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
      if ((toolName === 'web_search' || toolName === 'paper_search') && result?.artifacts) {
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
      web_search: ['web_search', 'paper_search'],
      paper_selection: [],
      summarization: [],
      ppt_generation: ['ppt_generator'],
      video_probe: ['video_probe'],
      video_download: ['video_download'],
      video_transcript: ['video_transcript'],
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
  ): boolean {
    return this.getToolCallDecision(sessionId, toolName, parameters).allowed;
  }

  /**
   * Check if a tool call should be allowed and include reason
   */
  getToolCallDecision(
    sessionId: string,
    toolName: string,
    parameters: Record<string, any>
  ): { allowed: boolean; reason?: string } {
    const state = this.state.get(sessionId);
    const history = this.toolCallHistory.get(sessionId) || [];

    if (!state) {
      return { allowed: true };
    }

    // Check for repeated search calls - allow at most ONE per task
    if (toolName === 'web_search' || toolName === 'paper_search') {
      const previousSearchCalls = history.filter(
        (call) => call.toolName === 'web_search' || call.toolName === 'paper_search'
      );

      // Block if a search tool was already called for this task
      if (previousSearchCalls.length >= this.MAX_SEARCH_CALLS) {
        return {
          allowed: false,
          reason: `Search already completed for this query. Synthesize your answer from the results already retrieved. Do not explain tool limitations to the user.`,
        };
      }
    }

    const recentCalls = history.filter((call) => call.toolName === toolName);
    let consecutiveFailures = 0;
    for (let i = recentCalls.length - 1; i >= 0; i--) {
      if (!recentCalls[i].success) {
        consecutiveFailures += 1;
      } else {
        break;
      }
    }

    if (consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" has failed ${consecutiveFailures} times in a row. Do not retry. Instead, inform the user that the operation could not be completed and suggest they try again with different input.`,
      };
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
      (toolName === 'web_search' || toolName === 'paper_search') &&
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
      if (artifact === 'video_file') {
        return history.some((call) => call.toolName === 'video_download' && call.success);
      }
      if (artifact === 'transcript') {
        return history.some((call) => call.toolName === 'video_transcript' && call.success);
      }
      return false;
    });

    // Determine completion status
    if (allStepsCompleted) {
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
      return '';
    }

    const completedSteps = state.plan.filter((s) => s.status === 'completed').length;
    const totalSteps = state.plan.length;
    const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    let summary = `Task: ${state.goal.description}\n`;
    summary += `Phase: ${state.phase}\n`;
    summary += `Progress: ${progress}% (${completedSteps}/${totalSteps} steps completed)\n\n`;

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

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    let context = `Current date: ${dateStr}. Use this date when interpreting "this year", "recent", "newly released", or publication dates. Papers and content from the current year do exist and can be found via search (e.g. arXiv has papers from ${now.getFullYear()}). Do NOT assume the current year is in the past.\n\n`;
    context += `Task Goal: ${state.goal.description}\n`;
    context += `Phase: ${state.phase}\n`;
    context += `Execution Plan:\n`;

    const completedSteps = state.plan.filter((s) => s.status === 'completed').length;
    context += `${completedSteps}/${state.plan.length} steps completed\n`;
    for (const step of state.plan) {
      context += `- ${step.description} [${step.status}]\n`;
    }

    if (state.artifactGenerated) {
      context += `Artifact Generated: ${state.artifactGenerated.name}\n`;
    }

    if (state.searchResults.length > 0) {
      context += `Search Results: ${state.searchResults.length} results found\n`;
    }

    context += `\nInstructions:\n`;
    context += `- Complete the task efficiently without redundant tool calls\n`;
    context += `- When PPT is generated, the task is COMPLETE - report completion to user\n`;
    context += `- When user asks about progress, report current state WITHOUT making new tool calls\n`;
    context += `- web_search and paper_search are high-cost tools: call them AT MOST ONCE per task\n`;
    context += `- After searching, proceed using existing results\n`;
    context += `- Never silently relax explicit user constraints (year, date range, source URL)\n`;
    context += `- If constrained search has zero results, report the evidence gap instead of changing scope\n`;
    context += `- For "last 24 hours", "today", or "yesterday": include only sources whose published timestamp is explicitly within that UTC window\n`;
    context += `- When reporting release/publish time, prefer exact UTC timestamps. If unknown, state "publication time unknown" instead of guessing\n`;
    context += `- Do NOT explain internal tool limitations to the user\n`;
    if (state.goal.requiresVideoProbe || state.goal.requiresVideoDownload || state.goal.requiresTranscript) {
      context += `- The user requested video processing; prioritize video_probe and video_transcript over unrelated tools.\n`;
      context += `- Use video_download only when the user explicitly asks to download or save the video file.\n`;
      context += `- For transcript requests, return transcript text and artifacts from video_transcript output.\n`;
      context += `- Prefer includeTimestamps=true for better downstream evidence alignment.\n`;
      const isVideoSummaryRequest = this.SUMMARY_INTENT_PATTERN.test(state.goal.description);
      if (isVideoSummaryRequest) {
        context += `- For summary questions, prefer transcript-grounded answers with relevant timeline evidence when available.\n`;
        context += `- If transcript evidence is insufficient, communicate uncertainty explicitly rather than guessing.\n`;
      }
      if (state.goal.videoUrl) {
        context += `- Target video URL: ${state.goal.videoUrl}\n`;
      }
    }

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
