import type { JSONSchema } from '@manus/shared';

/**
 * Tool execution result
 */
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

/**
 * Progress callback for long-running operations
 */
export type ProgressCallback = (current: number, total: number, message?: string) => void;

/**
 * Tool execution options
 */
export interface ToolExecutionOptions {
  onProgress?: ProgressCallback;
}

/**
 * Artifact produced by tool execution
 */
export interface Artifact {
  type: 'file' | 'image' | 'code' | 'data';
  name: string;
  content: string | Buffer;
  mimeType?: string;
  fileId?: string; // Database file ID for downloadable files
  size?: number; // File size in bytes
}

/**
 * Tool interface following SPEC.md pattern (lines 504-513)
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(params: Record<string, any>, onProgress?: ProgressCallback): Promise<ToolResult>;
  requiresConfirmation: boolean;
  timeout: number;
}

/**
 * Tool execution context
 */
export interface ToolContext {
  sessionId: string;
  userId: string;
  workspaceDir: string;
}

/**
 * Tool execution error
 */
export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public toolName: string,
    public params: Record<string, any>,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}
