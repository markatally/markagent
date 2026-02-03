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

// ============ Table Types ============

/**
 * Cell value in a table - supports text, numbers, and booleans
 */
export type TableCellValue = string | number | boolean | null;

/**
 * Column definition for a table schema
 * @deprecated Use TableIRColumn for new Table IR implementations
 */
export interface TableColumn {
  /** Column identifier (used internally) */
  id: string;
  /** Display header text */
  header: string;
  /** Text alignment for the column */
  align?: 'left' | 'center' | 'right';
  /** Minimum width hint (optional) */
  minWidth?: number;
}

/**
 * Table schema defining the structure
 * @deprecated Use TableIRSchema for new Table IR implementations
 */
export interface TableSchema {
  /** Ordered list of column definitions */
  columns: TableColumn[];
}

/**
 * A single row of data matching the schema
 * @deprecated Use TableIRRow for new Table IR implementations
 */
export type TableRow = TableCellValue[];

/**
 * Complete table data structure
 * LLMs output this structured format; the renderer converts to Markdown
 * @deprecated Use TableIR for new Table IR implementations
 */
export interface TableData {
  /** Table schema with column definitions */
  schema: TableSchema;
  /** Array of rows, each row must have exactly schema.columns.length cells */
  rows: TableRow[];
  /** Optional table caption/title */
  caption?: string;
}

// ============ Table IR Types (Schema-First Contract) ============
// These types implement the Table IR contract defined in .cursor/rules/table-ir-contract.mdc
// All tabular data from the LLM should use this format for interactive rendering.

/**
 * Supported data types for Table IR columns.
 * Determines sorting behavior and potential UI treatment.
 */
export type TableIRDataType =
  | 'number'
  | 'string'
  | 'text'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'url'
  | 'enum'
  | 'array'
  | 'object'
  | 'json';

/**
 * Column definition for Table IR schema.
 * Implements the schema-first contract for interactive tables.
 */
export interface TableIRColumn {
  /** Unique field identifier (used as key in row data) */
  key: string;
  /** Human-readable column name */
  label: string;
  /** Semantic type of the column (determines sorting behavior) */
  dataType: TableIRDataType;
  /** Whether the renderer may enable sorting for this column */
  sortable: boolean;
  /** Whether the renderer may enable filtering for this column */
  filterable: boolean;
}

/**
 * Table IR schema defining the column structure.
 */
export interface TableIRSchema {
  /** Ordered list of column definitions */
  columns: TableIRColumn[];
}

/**
 * A single row of data as a key-value object.
 * Keys must match column `key` values in the schema.
 */
export type TableIRRow = Record<string, TableCellValue>;

/**
 * Complete Table IR data structure.
 * Implements the schema-first contract: schema + data separation,
 * with all sorting/filtering/pagination delegated to the renderer.
 *
 * @see .cursor/rules/table-ir-contract.mdc
 */
export interface TableIR {
  /** Table schema with column definitions */
  schema: TableIRSchema;
  /** Array of row objects (keys match schema column keys) */
  data: TableIRRow[];
  /** Optional table caption/title */
  caption?: string;
}

// ============ Content Block Types ============
// Structured content blocks allow messages to contain mixed content types
// (text, tables, code, etc.) instead of just plain strings.

/**
 * Text content block - plain markdown text
 */
export interface TextContentBlock {
  type: 'text';
  content: string;
}

/**
 * Table content block - structured Table IR data
 */
export interface TableContentBlock {
  type: 'table';
  /** Unique identifier for this table block */
  id: string;
  /** The Table IR data */
  table: TableIR;
  /** Whether the table is still being streamed (incomplete) */
  isStreaming?: boolean;
}

/**
 * Union type for all content block types
 */
export type ContentBlock = TextContentBlock | TableContentBlock;

/**
 * Extended message content that can be either a simple string
 * or an array of structured content blocks.
 */
export type MessageContent = string | ContentBlock[];

/**
 * Result of table validation
 */
export interface TableValidationResult {
  /** Whether the table is valid */
  valid: boolean;
  /** Error messages if invalid */
  errors: string[];
  /** Warnings (valid but potentially problematic) */
  warnings: string[];
}

/**
 * Options for table rendering
 */
export interface TableRenderOptions {
  /** Output format (currently only markdown supported) */
  format?: 'markdown';
  /** Include caption above table */
  includeCaption?: boolean;
  /** Escape pipe characters in cell content */
  escapePipes?: boolean;
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
  | 'table.start'
  | 'table.complete'
  | 'error'
  | 'session.end';

export interface StreamEvent {
  type: StreamEventType;
  sessionId: string;
  timestamp: number;
  data: any;
}

/**
 * Data payload for table.start event
 */
export interface TableStartEventData {
  /** Unique identifier for this table block */
  tableId: string;
  /** The Table IR schema (columns are known upfront) */
  schema: TableIRSchema;
  /** Optional caption */
  caption?: string;
}

/**
 * Data payload for table.complete event
 */
export interface TableCompleteEventData {
  /** Unique identifier for this table block */
  tableId: string;
  /** Complete Table IR data */
  table: TableIR;
}
