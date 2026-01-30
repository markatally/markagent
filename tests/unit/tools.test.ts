import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Set CONFIG_PATH for tests - use test config with sandbox disabled
// This ensures bash_executor tests use direct execution, not Docker
process.env.CONFIG_PATH = path.join(process.cwd(), 'tests/fixtures/test-config.json');

// Clear config cache to ensure test config is loaded
import { clearConfigCache } from '../../apps/api/src/services/config';
import { clearSandboxManager } from '../../apps/api/src/services/sandbox';
clearConfigCache();
clearSandboxManager();

// Import after setting CONFIG_PATH and clearing cache
import { getToolRegistry, getToolExecutor, clearToolRegistry, type ToolContext } from '../../apps/api/src/services/tools';

describe('Phase 4: Tool System', () => {
  let testWorkspace: string;
  let toolContext: ToolContext;

  beforeAll(async () => {
    // Create temporary workspace for testing
    testWorkspace = path.join(os.tmpdir(), `manus-test-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });

    toolContext = {
      sessionId: 'test-session-id',
      userId: 'test-user-id',
      workspaceDir: testWorkspace,
    };
  });

  afterAll(async () => {
    // Cleanup test workspace
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Tool Registry', () => {
    it('should initialize registry', () => {
      const registry = getToolRegistry(toolContext);

      expect(registry).toBeDefined();
      expect(typeof registry.getTool).toBe('function');
      expect(typeof registry.getAllTools).toBe('function');
      expect(typeof registry.toOpenAIFunctions).toBe('function');
    });

    it('should have built-in tools registered', () => {
      const registry = getToolRegistry(toolContext);
      const tools = registry.getAllTools();

      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('file_reader');
      expect(toolNames).toContain('file_writer');
      expect(toolNames).toContain('bash_executor');
    });

    it('should get tool by name', () => {
      const registry = getToolRegistry(toolContext);
      const tool = registry.getTool('file_reader');

      expect(tool).toBeDefined();
      expect(tool!.name).toBe('file_reader');
      expect(tool!.description).toBeDefined();
      expect(tool!.inputSchema).toBeDefined();
      expect(typeof tool!.execute).toBe('function');
    });

    it('should return undefined for non-existent tool', () => {
      const registry = getToolRegistry(toolContext);
      const tool = registry.getTool('non_existent_tool');

      expect(tool).toBeUndefined();
    });

    it('should convert tools to OpenAI format', () => {
      const registry = getToolRegistry(toolContext);
      const openAIFunctions = registry.toOpenAIFunctions();

      expect(Array.isArray(openAIFunctions)).toBe(true);
      expect(openAIFunctions.length).toBeGreaterThan(0);

      const func = openAIFunctions[0];
      expect(func.type).toBe('function');
      expect(func.function).toBeDefined();
      expect(func.function.name).toBeDefined();
      expect(func.function.description).toBeDefined();
      expect(func.function.parameters).toBeDefined();
    });

    it('should filter tools by name list', () => {
      const registry = getToolRegistry(toolContext);
      const openAIFunctions = registry.toOpenAIFunctions(['file_reader']);

      expect(openAIFunctions.length).toBe(1);
      expect(openAIFunctions[0].function.name).toBe('file_reader');
    });
  });

  describe('File Reader Tool', () => {
    it('should read existing file', async () => {
      const testFile = path.join(testWorkspace, 'test.txt');
      const content = 'Hello, World!';
      await fs.writeFile(testFile, content);

      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_reader', {
        path: 'test.txt',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain(content);
      expect(result.error).toBeUndefined();
      expect(typeof result.duration).toBe('number');
    });

    it('should handle non-existent file', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_reader', {
        path: 'non-existent.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should block path traversal attempts', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_reader', {
        path: '../../../etc/passwd',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    });

    it('should handle subdirectories', async () => {
      const subdir = path.join(testWorkspace, 'subdir');
      await fs.mkdir(subdir, { recursive: true });

      const testFile = path.join(subdir, 'nested.txt');
      const content = 'Nested file content';
      await fs.writeFile(testFile, content);

      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_reader', {
        path: 'subdir/nested.txt',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain(content);
    });
  });

  describe('File Writer Tool', () => {
    it('should write new file', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_writer', {
        path: 'written.txt',
        content: 'Written content',
      });

      expect(result.success).toBe(true);

      // Verify file was created
      const content = await fs.readFile(
        path.join(testWorkspace, 'written.txt'),
        'utf-8'
      );
      expect(content).toBe('Written content');
    });

    it('should overwrite existing file', async () => {
      const testFile = path.join(testWorkspace, 'overwrite.txt');
      await fs.writeFile(testFile, 'Original content');

      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_writer', {
        path: 'overwrite.txt',
        content: 'New content',
        mode: 'write',
      });

      expect(result.success).toBe(true);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('New content');
    });

    it('should append to existing file', async () => {
      const testFile = path.join(testWorkspace, 'append.txt');
      await fs.writeFile(testFile, 'Original ');

      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_writer', {
        path: 'append.txt',
        content: 'Appended',
        mode: 'append',
      });

      expect(result.success).toBe(true);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('Original Appended');
    });

    it('should create nested directories', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_writer', {
        path: 'deep/nested/file.txt',
        content: 'Deep content',
      });

      expect(result.success).toBe(true);

      const content = await fs.readFile(
        path.join(testWorkspace, 'deep/nested/file.txt'),
        'utf-8'
      );
      expect(content).toBe('Deep content');
    });

    it('should block path traversal attempts', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_writer', {
        path: '../../../tmp/malicious.txt',
        content: 'Bad content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    });

    it('should require confirmation flag', () => {
      const registry = getToolRegistry(toolContext);
      const tool = registry.getTool('file_writer');

      expect(tool!.requiresConfirmation).toBe(true);
    });
  });

  describe('Bash Executor Tool', () => {
    it('should execute simple command', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('bash_executor', {
        command: 'echo "Hello from bash"',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello from bash');
    });

    it('should handle command with exit code 0', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('bash_executor', {
        command: 'true',
      });

      expect(result.success).toBe(true);
    });

    it('should handle command failure', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('bash_executor', {
        command: 'false',
      });

      expect(result.success).toBe(false);
    });

    it('should block dangerous commands', async () => {
      const executor = getToolExecutor(toolContext);
      // Use exact patterns from the actual blocked list in config/default.json
      const dangerousCommands = [
        'rm -rf /',
        'sudo something',
        'chmod 777',
      ];

      for (const cmd of dangerousCommands) {
        const result = await executor.execute('bash_executor', {
          command: cmd,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Blocked command');
      }
    });

    it('should execute in workspace directory', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('bash_executor', {
        command: 'pwd',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain(testWorkspace);
    });

    it('should support custom working directory', async () => {
      const subdir = path.join(testWorkspace, 'cmdtest');
      await fs.mkdir(subdir, { recursive: true });

      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('bash_executor', {
        command: 'pwd',
        workingDir: 'cmdtest',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('cmdtest');
    });

    it('should block working dir outside workspace', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('bash_executor', {
        command: 'pwd',
        workingDir: '../../',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace');
    });

    it('should require confirmation flag', () => {
      const registry = getToolRegistry(toolContext);
      const tool = registry.getTool('bash_executor');

      expect(tool!.requiresConfirmation).toBe(true);
    });

    it('should have timeout configured', () => {
      const registry = getToolRegistry(toolContext);
      const tool = registry.getTool('bash_executor');

      expect(tool!.timeout).toBeDefined();
      expect(tool!.timeout).toBeGreaterThan(0);
    });
  });

  describe('Tool Executor', () => {
    it('should execute tool by name', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('file_reader', {
        path: 'test.txt',
      });

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.duration).toBe('number');
    });

    it('should return error for non-existent tool', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('non_existent_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool not found');
    });

    it('should validate required parameters', () => {
      const executor = getToolExecutor(toolContext);
      const validation = executor.validateParams('file_reader', {});

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0]).toContain('path');
    });

    it('should pass validation for valid params', () => {
      const executor = getToolExecutor(toolContext);
      const validation = executor.validateParams('file_reader', {
        path: 'test.txt',
      });

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should measure execution duration', async () => {
      const executor = getToolExecutor(toolContext);
      const result = await executor.execute('bash_executor', {
        command: 'sleep 0.1',
      });

      expect(result.duration).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(100); // At least 100ms
    });
  });
});
