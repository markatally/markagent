/**
 * Task Management Types
 * Goal-driven task execution state and planning
 */

/**
 * Task execution phase
 */
export type TaskPhase = 'planning' | 'executing' | 'reflecting' | 'completed' | 'failed';

/**
 * Step type in execution plan
 */
export type StepType = 'web_search' | 'paper_selection' | 'summarization' | 'ppt_generation' | 'file_output';

/**
 * Execution step
 */
export interface ExecutionStep {
  id: string;
  type: StepType;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  result?: any;
  toolName?: string;
}

/**
 * Task goal
 */
export interface TaskGoal {
  description: string;
  requiresPPT: boolean;
  requiresSearch: boolean;
  expectedArtifacts: string[];
}

/**
 * Task context and state
 */
export interface TaskState {
  sessionId: string;
  userId: string;
  phase: TaskPhase;
  goal: TaskGoal;
  plan: ExecutionStep[];
  currentStep: number;
  searchResults: any[];
  papersSelected: any[];
  contentGenerated: string;
  artifactGenerated?: {
    type: string;
    name: string;
    fileId?: string;
    size?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reflection result
 */
export interface ReflectionResult {
  isComplete: boolean;
  shouldContinue: boolean;
  nextAction: 'continue' | 'respond' | 'complete' | 'need_more_info';
  reasoning: string;
}

/**
 * Tool call history
 */
export interface ToolCallHistory {
  toolName: string;
  parameters: Record<string, any>;
  timestamp: Date;
  result?: any;
}
