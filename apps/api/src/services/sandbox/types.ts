/**
 * Sandbox Service Types
 * Types for Docker-based isolated code execution
 */

/**
 * Sandbox configuration from config/default.json
 */
export interface SandboxConfig {
  enabled: boolean;
  memory: string; // e.g., "512MB"
  cpu: string; // e.g., "1"
  timeout: number; // seconds
  diskSpace: string; // e.g., "1GB"
  networkAccess: boolean;
  image?: string; // Docker image name
}

/**
 * Result of a command execution in the sandbox
 */
export interface SandboxExecResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number; // milliseconds
  timedOut?: boolean;
}

/**
 * Container info for a session
 */
export interface ContainerInfo {
  containerId: string;
  sessionId: string;
  workspaceDir: string;
  createdAt: Date;
  status: 'running' | 'stopped' | 'error';
}

/**
 * Options for creating a sandbox
 */
export interface CreateSandboxOptions {
  sessionId: string;
  workspaceDir: string;
  env?: Record<string, string>;
}

/**
 * Options for executing a command
 */
export interface ExecOptions {
  command: string;
  workingDir?: string;
  timeout?: number;
  env?: Record<string, string>;
}
