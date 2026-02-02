import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { Tool, ToolResult, ToolContext } from './types';
import { getConfig } from '../config';
import { getSandboxManager } from '../sandbox';

const execAsync = promisify(exec);

/**
 * Bash Executor Tool
 * Executes bash/shell commands in the workspace
 * Uses Docker sandbox when enabled for isolation
 */
export class BashExecutorTool implements Tool {
  name = 'bash_executor';
  description = 'Execute a bash/shell command in the sandbox environment';
  requiresConfirmation = true; // Requires user approval
  timeout = 60000;

  inputSchema = {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string' as const,
        description: 'The bash command to execute',
      },
      workingDir: {
        type: 'string' as const,
        description: 'Working directory (default: /workspace)',
      },
    },
    required: ['command'],
  };

  constructor(private context: ToolContext) {}

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const command = params.command as string;
      const workingDir = params.workingDir as string | undefined;

      // Validate command
      if (!command || typeof command !== 'string') {
        return {
          success: false,
          output: '',
          error: 'Command is required',
          duration: Date.now() - startTime,
        };
      }

      // Check for blocked commands
      const config = getConfig();
      for (const blocked of config.security.blockedCommands) {
        if (command.includes(blocked)) {
          return {
            success: false,
            output: '',
            error: `Blocked command detected: ${blocked}`,
            duration: Date.now() - startTime,
          };
        }
      }

      // Resolve working directory
      let cwd = this.context.workspaceDir;
      if (workingDir) {
        cwd = path.resolve(this.context.workspaceDir, workingDir);

        // Security check: ensure path is within workspace
        if (!cwd.startsWith(this.context.workspaceDir)) {
          return {
            success: false,
            output: '',
            error: 'Access denied: working directory outside workspace',
            duration: Date.now() - startTime,
          };
        }
      }

      // Check if sandbox is enabled
      const sandboxManager = getSandboxManager();
      if (sandboxManager.isEnabled()) {
        return await this.executeInSandbox(command, cwd, startTime);
      }

      // Fallback to direct execution
      return await this.executeDirect(command, cwd, startTime);
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message || 'Command execution failed',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute command in Docker sandbox
   */
  private async executeInSandbox(
    command: string,
    cwd: string,
    startTime: number
  ): Promise<ToolResult> {
    const sandboxManager = getSandboxManager();

    try {
      // Ensure sandbox exists for this session
      await sandboxManager.createSandbox({
        sessionId: this.context.sessionId,
        workspaceDir: this.context.workspaceDir,
      });

      // Convert host path to container path
      // Host: /tmp/mark-workspaces/{sessionId}/subdir
      // Container: /workspace/subdir
      let containerWorkDir = '/workspace';
      if (cwd !== this.context.workspaceDir) {
        const relativePath = path.relative(this.context.workspaceDir, cwd);
        containerWorkDir = path.join('/workspace', relativePath);
      }

      // Execute command in sandbox
      const result = await sandboxManager.executeCommand(this.context.sessionId, {
        command,
        workingDir: containerWorkDir,
        timeout: this.timeout / 1000, // Convert to seconds
      });

      if (result.timedOut) {
        return {
          success: false,
          output: result.output,
          error: 'Command timed out',
          duration: Date.now() - startTime,
        };
      }

      return {
        success: result.success,
        output: result.output || '(no output)',
        error: result.error,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      // If sandbox fails, log error but don't fallback to direct execution
      // This maintains security isolation
      console.error('Sandbox execution failed:', error);
      return {
        success: false,
        output: '',
        error: `Sandbox execution failed: ${error.message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute command directly on host (when sandbox is disabled)
   */
  private async executeDirect(
    command: string,
    cwd: string,
    startTime: number
  ): Promise<ToolResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB max output
        env: {
          ...process.env,
          HOME: this.context.workspaceDir,
          USER: 'mark',
        },
      });

      const output = stdout || stderr || '(no output)';

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      // exec throws on non-zero exit codes
      const output = error.stdout || '';
      const errorMsg = error.stderr || error.message || 'Command failed';

      return {
        success: false,
        output,
        error: errorMsg,
        duration: Date.now() - startTime,
      };
    }
  }
}
