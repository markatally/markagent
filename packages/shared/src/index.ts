// ============ Core Types ============

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  metadata?: {
    tokens?: number;
    duration?: number;
    model?: string;
  };
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, any>;
  result?: ToolResult;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  artifacts?: Artifact[];
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
}

export interface Artifact {
  type: 'file' | 'image' | 'code' | 'data';
  name: string;
  content: string | Buffer;
  mimeType?: string;
  fileId?: string; // Database file ID for downloadable files
  size?: number; // File size in bytes
}

// ============ Execution Types ============

export interface ExecutionStep {
  id: string;
  type: 'think' | 'tool_call' | 'code_execution' | 'user_input';
  description: string;
  toolName?: string;
  parameters?: Record<string, any>;
  dependsOn?: string[];
}

export interface ExecutionPlan {
  id: string;
  sessionId: string;
  reasoning: string;
  steps: ExecutionStep[];
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed';
  createdAt: Date;
}

export interface ExecutionLog {
  stepId: string;
  status: 'started' | 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
  timestamp: Date;
}

// ============ Context Types ============

export interface Context {
  sessionId: string;
  userId: string;
  messages: Message[];
  workspaceFiles: FileMetadata[];
  currentPlan?: ExecutionPlan;
  variables: Record<string, any>;
}

export interface State {
  currentStep: number;
  totalSteps: number;
  executionLogs: ExecutionLog[];
  errors: Error[];
}

export interface Progress {
  percentage: number;
  currentAction: string;
  remainingSteps: number;
}

export interface Action {
  type: 'tool_call' | 'respond' | 'ask_user' | 'complete';
  toolName?: string;
  parameters?: Record<string, any>;
  message?: string;
}

// ============ File Types ============

export interface FileMetadata {
  id: string;
  sessionId: string;
  filename: string;
  filepath: string;
  size: number;
  mimeType: string;
  checksum?: string;
  createdAt: Date;
  modifiedAt: Date;
}

// ============ Auth Types ============

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  userId: string;
}

export interface User {
  id: string;
  email: string;
  createdAt: Date;
}

// ============ Session Types ============

export interface Session {
  id: string;
  userId: string;
  name?: string;
  workspacePath?: string;
  status: 'active' | 'archived' | 'deleted';
  createdAt: Date;
  lastActiveAt: Date;
}

// ============ MCP Types ============

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'websocket';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// ============ Schema Types ============

export interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  description?: string;
  enum?: any[];
  default?: any;
}

// ============ Task Types ============

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];
  result?: TaskResult;
}

export interface TaskResult {
  success: boolean;
  output: any;
  error?: string;
  duration: number;
}

// ============ Error Types ============

export interface RecoveryAction {
  type: 'retry' | 'fallback' | 'skip' | 'abort';
  description: string;
  newParameters?: Record<string, any>;
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

// ============ API Response Types ============

export interface ChatResponse {
  id: string;
  message: Message;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

// ============ Error Codes ============

export const ErrorCodes = {
  // Auth errors (1xxx)
  UNAUTHORIZED: 'E1001',
  INVALID_TOKEN: 'E1002',
  SESSION_EXPIRED: 'E1003',

  // Validation errors (2xxx)
  INVALID_INPUT: 'E2001',
  MISSING_REQUIRED_FIELD: 'E2002',

  // LLM errors (3xxx)
  LLM_CONNECTION_FAILED: 'E3001',
  LLM_RATE_LIMITED: 'E3002',
  LLM_CONTEXT_TOO_LONG: 'E3003',

  // Tool errors (4xxx)
  TOOL_NOT_FOUND: 'E4001',
  TOOL_EXECUTION_FAILED: 'E4002',
  TOOL_TIMEOUT: 'E4003',

  // Sandbox errors (5xxx)
  SANDBOX_CREATE_FAILED: 'E5001',
  SANDBOX_EXECUTION_FAILED: 'E5002',
  SANDBOX_RESOURCE_EXCEEDED: 'E5003',

  // Session errors (6xxx)
  SESSION_NOT_FOUND: 'E6001',
  SESSION_LIMIT_EXCEEDED: 'E6002',
} as const;

// ============ Stream Event Types ============

export type StreamEventType =
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
  | 'plan.created'
  | 'plan.step.start'
  | 'plan.step.complete'
  | 'approval.required'
  | 'file.created'
  | 'file.modified'
  | 'file.deleted'
  | 'error'
  | 'session.end';

export interface StreamEvent {
  type: StreamEventType;
  sessionId: string;
  timestamp: number;
  data: any;
}
