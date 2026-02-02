# AI Engineering Prompt: Build a Mark-Like Agentic System

## Project Overview
Design and implement a complete full-stack web application that replicates Mark agent capabilities - an AI-powered autonomous agent that can execute complex tasks through natural language interaction, tool usage, and code execution.

## Tech Stack Requirements

### Frontend
- **Framework**: React 18+ with TypeScript
- **UI Library**: shadcn/ui + Tailwind CSS
- **State Management**: Zustand or React Context
- **Real-time Updates**: WebSocket or Server-Sent Events (SSE)
- **Code Editor**: Monaco Editor for code display
- **File Handling**: react-dropzone for uploads

### Backend
- **Runtime**: Node.js with Express or Bun with Hono
- **Language**: TypeScript
- **API**: RESTful + WebSocket/SSE for streaming
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis for session/state management
- **Queue**: BullMQ for async task processing

### AI/Agent Layer
- **LLM Provider**: OpenAI-compatible API (GLM-4.7 via jiekou.ai) - supports streaming & function calling
- **Tool Framework**: Custom tool registry + MCP (Model Context Protocol)
- **Sandbox**: Docker containers or isolated Node.js VM
- **File System**: Isolated per-session workspace
- **Configuration**: JSON-based config file (see `config/default.json`)

## LLM Client Configuration

The system uses an OpenAI-compatible API that supports streaming and function calling.

**Configuration File**: `config/default.json`

```typescript
// LLM Client Setup
import { OpenAI } from 'openai';
import config from '../config/default.json';

interface LLMConfig {
  provider: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
  streaming: boolean;
}

class LLMClient {
  private client: OpenAI;
  private config: LLMConfig;

  constructor() {
    this.config = config.llm;
    this.client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: this.config.baseUrl,
    });
  }

  async chat(messages: Message[], tools?: Tool[]): Promise<ChatResponse> {
    return this.client.chat.completions.create({
      model: this.config.model,
      messages,
      tools,
      tool_choice: tools ? 'auto' : undefined,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: this.config.streaming,
    });
  }

  async *streamChat(messages: Message[], tools?: Tool[]): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages,
      tools,
      tool_choice: tools ? 'auto' : undefined,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        yield chunk.choices[0].delta.content;
      }
    }
  }
}
```

**Environment Variables**:
```bash
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.jiekou.ai/openai  # Optional, overrides config
LLM_MODEL=zai-org/glm-4.7                   # Optional, overrides config
```

## Project Structure

```
mark-agent/
├── apps/
│   ├── web/                    # Frontend React application
│   │   ├── src/
│   │   │   ├── components/     # React components
│   │   │   │   ├── chat/       # Chat interface components
│   │   │   │   ├── progress/   # Progress display components
│   │   │   │   ├── session/    # Session management components
│   │   │   │   └── ui/         # shadcn/ui components
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── lib/            # Utility functions
│   │   │   ├── stores/         # Zustand stores
│   │   │   ├── types/          # TypeScript types
│   │   │   └── App.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── api/                    # Backend API server
│       ├── src/
│       │   ├── routes/         # API route handlers
│       │   ├── services/       # Business logic
│       │   │   ├── llm/        # LLM client and prompts
│       │   │   ├── tools/      # Tool implementations
│       │   │   ├── sandbox/    # Docker sandbox manager
│       │   │   ├── mcp/        # MCP client
│       │   │   └── memory/     # Context management
│       │   ├── middleware/     # Auth, rate limiting, etc.
│       │   ├── types/          # Shared TypeScript types
│       │   ├── utils/          # Utility functions
│       │   ├── worker.ts       # Background job processor
│       │   └── index.ts        # Entry point
│       ├── prisma/
│       │   └── schema.prisma   # Database schema
│       └── package.json
│
├── packages/
│   └── shared/                 # Shared types and utilities
│       ├── src/
│       │   ├── types/          # Shared TypeScript interfaces
│       │   └── utils/          # Shared utility functions
│       └── package.json
│
├── skills/                     # Predefined agent skills (31 total)
│   ├── index.ts                # Skill registry
│   ├── development/            # /code, /refactor, /review, /api, /prompt, /tool, /auth, /component
│   ├── debugging/              # /debug, /fix
│   ├── testing/                # /test, /coverage
│   ├── devops/                 # /deploy, /docker, /git, /migrate, /ci, /env, /monitor
│   ├── documentation/          # /docs, /api-docs, /changelog
│   ├── analysis/               # /analyze, /security
│   ├── web/                    # /scrape, /search
│   ├── data/                   # /data, /sql
│   ├── integration/            # /mcp
│   └── planning/               # /plan, /architect
│
├── config/
│   ├── default.json            # Default configuration
│   └── production.json         # Production overrides
│
├── docker/
│   ├── Dockerfile.web
│   ├── Dockerfile.api
│   └── sandbox/                # Sandbox container images
│
├── docker-compose.yml
├── package.json                # Root package.json (workspaces)
├── turbo.json                  # Turborepo config
└── .env.example
```

## Shared Type Definitions

```typescript
// packages/shared/src/types/index.ts

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
}

export interface Artifact {
  type: 'file' | 'image' | 'code' | 'data';
  name: string;
  content: string | Buffer;
  mimeType?: string;
}

// ============ Execution Types ============

export interface ExecutionStep {
  id: string;
  type: 'think' | 'tool_call' | 'code_execution' | 'user_input';
  description: string;
  toolName?: string;
  parameters?: Record<string, any>;
  dependsOn?: string[];  // Step IDs this depends on
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
  variables: Record<string, any>;  // Runtime variables
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

// ============ MCP Types ============

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'websocket';
  command?: string;           // For stdio transport
  args?: string[];
  url?: string;               // For http/websocket transport
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

// Error codes
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
```

## Core Functional Requirements

### 1. User Interface Components

**Main Chat Interface**
- Text input box with multi-line support (textarea, Shift+Enter for newline)
- Message history display with user/assistant distinction
- Streaming response rendering (word-by-word or chunk-by-chunk)
- Collapsible sections for verbose output (thinking, tool calls, code)
- File attachment button with drag-and-drop support
- Cancel/stop button for ongoing operations
- Copy button for code blocks and responses
- Markdown rendering with syntax highlighting

**Progress Display Panel**
- Current step indicator (e.g., "Step 2/5: Running tests...")
- Tool call visualization (which tool, parameters, status)
- Code execution output (stdout/stderr streaming)
- File operations log (created/modified/deleted files)
- Nested sub-task tracking with indentation
- Success/failure/warning indicators with icons
- Expandable details for each step

**Session Management**
- New session button
- Session history sidebar (last 20 sessions)
- Session search/filter by date and content
- Export conversation to markdown/JSON
- Session deletion with confirmation
- Session rename functionality

### 2. Query Processing Pipeline

**Query Rewriting Module**
```typescript
interface QueryRewriter {
  // Analyzes user intent and rewrites for clarity
  analyzeIntent(userQuery: string): Promise<{
    originalQuery: string;
    rewrittenQuery: string;
    detectedIntent: 'code_generation' | 'data_analysis' | 'research' | 'file_operation' | 'general';
    suggestedTools: string[];
    clarificationNeeded: boolean;
  }>;
  
  // Asks follow-up questions if ambiguous
  requestClarification(query: string): Promise<string[]>;
}
```

### 3. LLM Chain of Thought (CoT) System

**Thinking Engine**
```typescript
interface ThinkingEngine {
  // Structured reasoning before action
  generatePlan(query: string, context: Context): Promise<{
    reasoning: string;           // CoT explanation
    steps: ExecutionStep[];      // Ordered action plan
    toolsRequired: string[];     // Tools needed
    estimatedTime: number;       // Seconds
    risks: string[];             // Potential issues
  }>;
  
  // Continuous reflection during execution
  reflect(currentState: State, progress: Progress): Promise<{
    shouldContinue: boolean;
    adjustments: string;         // Plan modifications
    nextAction: Action;
  }>;
}
```

### 4. Tool Calling System

**Tool Registry**
```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(params: Record<string, any>): Promise<ToolResult>;
  requiresConfirmation: boolean;
  timeout: number;
}
```

**Built-in Tool Definitions**
```typescript
// Tool schemas for LLM function calling

const toolDefinitions = [
  {
    name: 'bash_executor',
    description: 'Execute a bash/shell command in the sandbox environment',
    requiresConfirmation: true,
    timeout: 60000,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute'
        },
        workingDir: {
          type: 'string',
          description: 'Working directory (default: /workspace)'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'python_executor',
    description: 'Execute Python code in an isolated environment',
    requiresConfirmation: false,
    timeout: 120000,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Python code to execute'
        },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'pip packages to install before execution'
        }
      },
      required: ['code']
    }
  },
  {
    name: 'file_reader',
    description: 'Read contents of a file from the workspace',
    requiresConfirmation: false,
    timeout: 5000,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace'
        },
        encoding: {
          type: 'string',
          enum: ['utf-8', 'base64'],
          description: 'Encoding for reading (default: utf-8)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'file_writer',
    description: 'Write or modify a file in the workspace',
    requiresConfirmation: true,
    timeout: 5000,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace'
        },
        content: {
          type: 'string',
          description: 'Content to write'
        },
        mode: {
          type: 'string',
          enum: ['write', 'append'],
          description: 'Write mode (default: write)'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'web_search',
    description: 'Search the internet for information',
    requiresConfirmation: false,
    timeout: 30000,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        numResults: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 10)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'web_scraper',
    description: 'Fetch and extract content from a webpage',
    requiresConfirmation: false,
    timeout: 30000,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch'
        },
        selector: {
          type: 'string',
          description: 'CSS selector to extract specific content (optional)'
        },
        format: {
          type: 'string',
          enum: ['text', 'html', 'markdown'],
          description: 'Output format (default: markdown)'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'code_analyzer',
    description: 'Analyze code for issues, complexity, and suggestions',
    requiresConfirmation: false,
    timeout: 30000,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File or directory path to analyze'
        },
        language: {
          type: 'string',
          description: 'Programming language (auto-detected if not specified)'
        },
        checks: {
          type: 'array',
          items: { type: 'string', enum: ['lint', 'security', 'complexity', 'types'] },
          description: 'Types of analysis to perform'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'test_runner',
    description: 'Run tests in the workspace',
    requiresConfirmation: false,
    timeout: 300000,
    inputSchema: {
      type: 'object',
      properties: {
        framework: {
          type: 'string',
          enum: ['jest', 'pytest', 'mocha', 'vitest', 'auto'],
          description: 'Test framework (auto-detected if not specified)'
        },
        path: {
          type: 'string',
          description: 'Test file or directory path'
        },
        filter: {
          type: 'string',
          description: 'Filter tests by name pattern'
        }
      },
      required: []
    }
  },
  {
    name: 'git_operations',
    description: 'Perform git operations in the workspace',
    requiresConfirmation: true,
    timeout: 60000,
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['clone', 'status', 'add', 'commit', 'push', 'pull', 'diff', 'log', 'branch', 'checkout'],
          description: 'Git operation to perform'
        },
        args: {
          type: 'object',
          description: 'Operation-specific arguments',
          properties: {
            url: { type: 'string', description: 'Repository URL (for clone)' },
            message: { type: 'string', description: 'Commit message (for commit)' },
            files: { type: 'array', items: { type: 'string' }, description: 'Files to add (for add)' },
            branch: { type: 'string', description: 'Branch name (for branch/checkout)' }
          }
        }
      },
      required: ['operation']
    }
  }
];
```

**Tool Execution Manager**
```typescript
interface ToolExecutor {
  // Execute with timeout and retry
  execute(tool: string, params: any): Promise<{
    success: boolean;
    output: string;
    duration: number;
    error?: string;
  }>;
  
  // Parallel execution for independent tools
  executeParallel(tools: ToolCall[]): Promise<ToolResult[]>;
  
  // Sequential with dependency checking
  executeSequential(tools: ToolCall[]): Promise<ToolResult[]>;
}
```

### 5. MCP (Model Context Protocol) Integration

**MCP Client**
```typescript
interface MCPClient {
  // Connect to MCP servers
  connect(serverConfig: MCPServerConfig): Promise<void>;
  
  // List available resources
  listResources(): Promise<Resource[]>;
  
  // Read resource content
  readResource(uri: string): Promise<string>;
  
  // List available tools from MCP server
  listTools(): Promise<MCPTool[]>;
  
  // Call MCP tool
  callTool(name: string, args: any): Promise<any>;
  
  // Subscribe to resource changes
  subscribe(uri: string, callback: (content: string) => void): void;
}

// Example MCP servers to support:
const mcpServers = [
  'filesystem',      // Local file access
  'github',          // GitHub API integration
  'slack',           // Slack messaging
  'database',        // SQL database access
  'google-drive',    // Google Drive files
];
```

### 6. Sandbox Execution Environment

**Isolated Sandbox**
```typescript
interface Sandbox {
  // Create isolated workspace
  create(sessionId: string): Promise<{
    workspaceId: string;
    filesystemPath: string;
    networkAccess: boolean;
  }>;
  
  // Execute code safely
  executeCode(code: string, language: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    executionTime: number;
  }>;
  
  // Stream output in real-time
  executeStream(code: string, onData: (chunk: string) => void): Promise<void>;
  
  // Resource limits
  limits: {
    memory: '512MB';
    cpu: '1 core';
    timeout: 300;      // seconds
    diskSpace: '1GB';
  };
  
  // Cleanup
  destroy(): Promise<void>;
}
```

**Real-time Progress Streaming**
```typescript
interface ProgressStream {
  // Emit progress updates via WebSocket/SSE
  emit(event: {
    type: 'thinking' | 'tool_call' | 'code_execution' | 'file_operation';
    status: 'started' | 'running' | 'completed' | 'failed';
    message: string;
    data?: any;
    timestamp: number;
  }): void;
  
  // Nested progress for sub-tasks
  createSubProgress(parentId: string): ProgressStream;
}
```

### 7. Memory & Context Management

**Conversation Memory**
```typescript
interface MemoryManager {
  // Store conversation history
  save(sessionId: string, message: Message): Promise<void>;
  
  // Retrieve with context window management
  retrieve(sessionId: string, limit?: number): Promise<Message[]>;
  
  // Summarize old messages to save tokens
  summarize(messages: Message[]): Promise<string>;
  
  // Context window management (configurable, default 128K tokens for GLM-4.7)
  manageContextWindow(messages: Message[]): Promise<{
    included: Message[];
    summary: string;
    tokenCount: number;
  }>;
}
```

**Session State**
```typescript
interface SessionState {
  sessionId: string;
  userId: string;
  workspaceFiles: FileMetadata[];
  executionHistory: ExecutionLog[];
  toolCallHistory: ToolCall[];
  currentPlan: ExecutionPlan | null;
  createdAt: Date;
  lastActiveAt: Date;
}
```

### 8. Error Handling & Recovery

**Error Handler**
```typescript
interface ErrorHandler {
  // Retry failed operations with exponential backoff
  retry<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries: number;
      backoffMs: number;
      shouldRetry: (error: Error) => boolean;
    }
  ): Promise<T>;
  
  // Graceful degradation
  fallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T>;
  
  // User-friendly error messages
  formatError(error: Error): {
    userMessage: string;
    technicalDetails: string;
    suggestedActions: string[];
  };
  
  // Auto-recovery strategies
  recover(error: Error, context: Context): Promise<RecoveryAction>;
}
```

### 9. Feedback Loop & User Control

**User Interaction Manager**
```typescript
interface UserInteraction {
  // Request user approval before dangerous operations
  requestApproval(action: {
    type: 'file_delete' | 'api_call' | 'code_execution';
    description: string;
    risks: string[];
  }): Promise<boolean>;
  
  // Allow user to edit agent's plan
  requestPlanReview(plan: ExecutionPlan): Promise<{
    approved: boolean;
    modifications?: ExecutionPlan;
  }>;
  
  // Collect feedback on outputs
  collectFeedback(outputId: string): Promise<{
    rating: 1 | 2 | 3 | 4 | 5;
    comment?: string;
  }>;
  
  // Allow mid-execution adjustments
  allowInterruption(): Promise<{
    action: 'continue' | 'pause' | 'cancel' | 'modify';
    instructions?: string;
  }>;
}
```

### 10. Multi-turn Task Orchestration

**Task Orchestrator**
```typescript
interface TaskOrchestrator {
  // Decompose complex tasks
  decompose(task: string): Promise<{
    subtasks: Task[];
    dependencies: Map<string, string[]>;
    estimatedTime: number;
  }>;
  
  // Execute with dependency resolution
  execute(tasks: Task[]): Promise<{
    results: Map<string, TaskResult>;
    completionOrder: string[];
    totalTime: number;
  }>;
  
  // Dynamic replanning
  replan(
    currentPlan: ExecutionPlan,
    newInformation: string
  ): Promise<ExecutionPlan>;
  
  // Checkpoint and resume
  checkpoint(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
}
```

### 11. Authentication & Security

**Auth System**
```typescript
interface AuthManager {
  // User authentication
  login(email: string, password: string): Promise<AuthToken>;
  
  // API key management for external services
  storeAPIKey(service: string, key: string, userId: string): Promise<void>;
  getAPIKey(service: string, userId: string): Promise<string | null>;
  
  // Permission control
  checkPermission(userId: string, action: string): Promise<boolean>;
  
  // Rate limiting (configurable via config/default.json)
  rateLimit: {
    enabled: boolean;
    requests: {
      perMinute: number;
      perHour: number;
      perDay: number;
    };
    tokens: {
      perMinute: number;
      perHour: number;
      perDay: number;
    };
    concurrent: {
      maxSessions: number;
      maxRequestsPerSession: number;
    };
  };
  
  // Sandbox isolation
  ensureIsolation(sessionId: string): Promise<boolean>;
}
```

### 12. Output Delivery System

**Output Handler**
```typescript
interface OutputHandler {
  // Format different output types
  format(output: any, type: 'text' | 'code' | 'image' | 'file' | 'json'): string;
  
  // Download generated files
  prepareDownload(fileId: string): Promise<{
    url: string;
    filename: string;
    size: number;
    expiresAt: Date;
  }>;
  
  // Copy to clipboard
  copyToClipboard(content: string): Promise<void>;
  
  // Share outputs
  share(outputId: string): Promise<{
    shareUrl: string;
    expiresAt: Date;
  }>;
  
  // Export formats
  export(sessionId: string, format: 'markdown' | 'json' | 'html'): Promise<Blob>;
}
```

### 13. Logging & Monitoring

**Logger**
```typescript
interface Logger {
  // Structured logging
  log(level: 'debug' | 'info' | 'warn' | 'error', event: {
    userId: string;
    sessionId: string;
    action: string;
    duration?: number;
    metadata?: Record<string, any>;
  }): void;
  
  // Performance metrics
  metrics: {
    trackLatency(operation: string, ms: number): void;
    trackTokenUsage(tokens: number, cost: number): void;
    trackToolCalls(tool: string, success: boolean): void;
  };
  
  // Debug mode
  enableDebugMode(sessionId: string): void;
  getDebugLogs(sessionId: string): Promise<LogEntry[]>;
}
```

## Architecture Design

### System Flow
```
User Input → Query Rewriter → LLM (CoT) → Task Orchestrator
                                            ↓
                            ┌───────────────┴───────────────┐
                            ↓                               ↓
                      Tool Executor                   MCP Client
                            ↓                               ↓
                      Sandbox (Docker)              External Resources
                            ↓                               ↓
                      Progress Stream ←─────────────────────┘
                            ↓
                      Output Handler → User
```

### REST API Endpoints

```typescript
// ============ Health ============

GET    /api/health                 // Health check endpoint

// ============ Authentication ============

POST   /api/auth/register          // Create new user account
POST   /api/auth/login             // Login and get tokens
POST   /api/auth/refresh           // Refresh access token
POST   /api/auth/logout            // Invalidate tokens

// ============ Sessions ============

GET    /api/sessions               // List user's sessions (paginated)
POST   /api/sessions               // Create new session
GET    /api/sessions/:id           // Get session details
DELETE /api/sessions/:id           // Delete session
PATCH  /api/sessions/:id           // Update session (rename, etc.)

// ============ Chat ============

POST   /api/sessions/:id/messages  // Send message (returns stream or JSON)
GET    /api/sessions/:id/messages  // Get message history (paginated)
DELETE /api/sessions/:id/messages/:msgId  // Delete specific message

// ============ Streaming ============

GET    /api/sessions/:id/stream    // SSE endpoint for real-time updates

// ============ Files ============

POST   /api/sessions/:id/files     // Upload file to session workspace
GET    /api/sessions/:id/files     // List files in session workspace
GET    /api/sessions/:id/files/:fileId  // Download file
DELETE /api/sessions/:id/files/:fileId  // Delete file

// ============ Tools ============

GET    /api/tools                  // List available tools
POST   /api/tools/:name/execute    // Execute tool directly (admin)

// ============ Execution Control ============

POST   /api/sessions/:id/cancel    // Cancel ongoing execution
POST   /api/sessions/:id/approve   // Approve pending action
POST   /api/sessions/:id/reject    // Reject pending action

// ============ Export ============

GET    /api/sessions/:id/export    // Export session (format=markdown|json|html)

// ============ User Settings ============

GET    /api/user/settings          // Get user settings
PATCH  /api/user/settings          // Update user settings
POST   /api/user/api-keys          // Store external API key
DELETE /api/user/api-keys/:service // Remove external API key
```

### WebSocket/SSE Events

```typescript
// Events sent from server to client via SSE

interface StreamEvent {
  type: EventType;
  sessionId: string;
  timestamp: number;
  data: any;
}

type EventType =
  | 'message.start'        // Assistant started responding
  | 'message.delta'        // Streaming text chunk
  | 'message.complete'     // Assistant finished responding
  | 'thinking.start'       // CoT reasoning started
  | 'thinking.delta'       // Streaming thinking content
  | 'thinking.complete'    // CoT reasoning finished
  | 'tool.start'           // Tool execution started
  | 'tool.progress'        // Tool execution progress update
  | 'tool.complete'        // Tool execution finished
  | 'tool.error'           // Tool execution failed
  | 'plan.created'         // Execution plan generated
  | 'plan.step.start'      // Plan step started
  | 'plan.step.complete'   // Plan step finished
  | 'approval.required'    // User approval needed
  | 'file.created'         // File created in workspace
  | 'file.modified'        // File modified
  | 'file.deleted'         // File deleted
  | 'error'                // Error occurred
  | 'session.end';         // Session ended

// Example events:

// Text streaming
{ type: 'message.delta', data: { content: 'Hello, ' } }
{ type: 'message.delta', data: { content: 'how can I ' } }
{ type: 'message.delta', data: { content: 'help you?' } }
{ type: 'message.complete', data: { messageId: '...', totalTokens: 150 } }

// Tool execution
{ type: 'tool.start', data: { toolName: 'bash_executor', params: { command: 'ls -la' } } }
{ type: 'tool.progress', data: { output: 'file1.txt\nfile2.txt\n' } }
{ type: 'tool.complete', data: { success: true, duration: 150 } }

// Approval request
{ type: 'approval.required', data: {
  action: 'file_delete',
  description: 'Delete /workspace/temp.txt',
  risks: ['File will be permanently removed']
}}
```

### Database Schema

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name VARCHAR(100),
  workspace_path VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'active'
);

-- Messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id),
  role VARCHAR(20) NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tool calls table
CREATE TABLE tool_calls (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id),
  message_id UUID REFERENCES messages(id),
  tool_name VARCHAR(100) NOT NULL,
  parameters JSONB NOT NULL,
  result JSONB,
  status VARCHAR(20) NOT NULL,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Files table
CREATE TABLE files (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id),
  filename VARCHAR(255) NOT NULL,
  filepath VARCHAR(500) NOT NULL,
  size_bytes BIGINT,
  mime_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- API keys table (encrypted)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  service VARCHAR(100) NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Feedback table
CREATE TABLE feedback (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  message_id UUID REFERENCES messages(id),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============ Indexes for Performance ============

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_last_active ON sessions(last_active_at DESC);

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

CREATE INDEX idx_tool_calls_session_id ON tool_calls(session_id);
CREATE INDEX idx_tool_calls_message_id ON tool_calls(message_id);
CREATE INDEX idx_tool_calls_status ON tool_calls(status);

CREATE INDEX idx_files_session_id ON files(session_id);

CREATE INDEX idx_api_keys_user_service ON api_keys(user_id, service);

-- Full-text search on messages (PostgreSQL)
CREATE INDEX idx_messages_content_search ON messages USING gin(to_tsvector('english', content));
```

## Package Dependencies

### Root package.json
```json
{
  "name": "mark-agent",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "dev:web": "turbo run dev --filter=web",
    "dev:api": "turbo run dev --filter=api",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "worker": "cd apps/api && bun run worker"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.3.0"
  }
}
```

### Frontend Dependencies (apps/web/package.json)
```json
{
  "name": "web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src/"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.4.0",
    "tailwindcss": "^3.4.0",
    "lucide-react": "^0.300.0",
    "monaco-editor": "^0.45.0",
    "@monaco-editor/react": "^4.6.0",
    "react-dropzone": "^14.2.0",
    "react-markdown": "^9.0.0",
    "react-syntax-highlighter": "^15.5.0",
    "date-fns": "^3.0.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

### Backend Dependencies (apps/api/package.json)
```json
{
  "name": "api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target node",
    "start": "bun run dist/index.js",
    "worker": "bun run --watch src/worker.ts",
    "lint": "eslint src/",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.4.0",
    "openai": "^4.20.0",
    "@prisma/client": "^5.7.0",
    "ioredis": "^5.3.0",
    "bullmq": "^5.0.0",
    "dockerode": "^4.0.0",
    "zod": "^3.22.0",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3",
    "tiktoken": "^1.0.0",
    "uuid": "^9.0.0",
    "pino": "^8.17.0",
    "pino-pretty": "^10.3.0"
  },
  "devDependencies": {
    "prisma": "^5.7.0",
    "@types/node": "^20.10.0",
    "@types/dockerode": "^3.3.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/bcryptjs": "^2.4.0",
    "@types/uuid": "^9.0.0"
  }
}
```

### Shared Package (packages/shared/package.json)
```json
{
  "name": "@mark/shared",
  "version": "0.0.1",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "lint": "eslint src/"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

### Turborepo Config (turbo.json)
```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "test": {
      "dependsOn": ["build"]
    }
  }
}
```

### Dockerfiles

**Frontend (docker/Dockerfile.web)**
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json bun.lockb ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN npm install
COPY . .
RUN npm run build --filter=web

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

**Backend (docker/Dockerfile.api)**
```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN bun install
COPY . .
RUN bun run build --filter=api

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/prisma ./prisma
EXPOSE 4000
CMD ["bun", "run", "dist/index.js"]
```

**Nginx Config (docker/nginx.conf)**
```nginx
server {
    listen 3000;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # SPA routing - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy (if needed for same-origin)
    location /api/ {
        proxy_pass http://backend:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # SSE endpoint - disable buffering
    location /api/sessions/ {
        proxy_pass http://backend:4000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

## Prisma Schema

```prisma
// apps/api/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String    @id @default(uuid())
  email        String    @unique
  passwordHash String    @map("password_hash")
  createdAt    DateTime  @default(now()) @map("created_at")

  sessions     Session[]
  apiKeys      ApiKey[]
  feedback     Feedback[]

  @@map("users")
}

model Session {
  id            String    @id @default(uuid())
  userId        String    @map("user_id")
  name          String?
  workspacePath String?   @map("workspace_path")
  createdAt     DateTime  @default(now()) @map("created_at")
  lastActiveAt  DateTime  @default(now()) @map("last_active_at")
  status        String    @default("active")

  user          User      @relation(fields: [userId], references: [id])
  messages      Message[]
  toolCalls     ToolCall[]
  files         File[]

  @@index([userId])
  @@index([status])
  @@index([lastActiveAt(sort: Desc)])
  @@map("sessions")
}

model Message {
  id        String    @id @default(uuid())
  sessionId String    @map("session_id")
  role      String
  content   String
  metadata  Json?
  createdAt DateTime  @default(now()) @map("created_at")

  session   Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  toolCalls ToolCall[]
  feedback  Feedback[]

  @@index([sessionId])
  @@index([createdAt(sort: Desc)])
  @@map("messages")
}

model ToolCall {
  id         String    @id @default(uuid())
  sessionId  String    @map("session_id")
  messageId  String?   @map("message_id")
  toolName   String    @map("tool_name")
  parameters Json
  result     Json?
  status     String
  durationMs Int?      @map("duration_ms")
  createdAt  DateTime  @default(now()) @map("created_at")

  session    Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  message    Message?  @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([messageId])
  @@index([status])
  @@map("tool_calls")
}

model File {
  id        String    @id @default(uuid())
  sessionId String    @map("session_id")
  filename  String
  filepath  String
  sizeBytes BigInt?   @map("size_bytes")
  mimeType  String?   @map("mime_type")
  createdAt DateTime  @default(now()) @map("created_at")

  session   Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("files")
}

model ApiKey {
  id           String    @id @default(uuid())
  userId       String    @map("user_id")
  service      String
  encryptedKey String    @map("encrypted_key")
  createdAt    DateTime  @default(now()) @map("created_at")

  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, service])
  @@map("api_keys")
}

model Feedback {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  messageId String    @map("message_id")
  rating    Int
  comment   String?
  createdAt DateTime  @default(now()) @map("created_at")

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  message   Message   @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@map("feedback")
}
```

## Configuration System

All runtime configuration is managed via `config/default.json`. This allows:
- Easy adjustment of LLM settings without code changes
- Rate limiting controls that can be enabled/disabled
- Tool permissions and timeouts
- Security policies

**Configuration Schema**:
```typescript
interface AppConfig {
  llm: {
    provider: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
    temperature: number;
    timeout: number;
    streaming: boolean;
  };
  rateLimits: {
    enabled: boolean;
    requests: { perMinute: number; perHour: number; perDay: number };
    tokens: { perMinute: number; perHour: number; perDay: number };
    concurrent: { maxSessions: number; maxRequestsPerSession: number };
  };
  sandbox: {
    enabled: boolean;
    memory: string;
    cpu: string;
    timeout: number;
    diskSpace: string;
    networkAccess: boolean;
  };
  session: {
    maxIdleTime: number;
    maxDuration: number;
    maxHistoryMessages: number;
    contextWindowTokens: number;
  };
  tools: {
    enabled: string[];
    requireApproval: string[];
    timeout: Record<string, number>;
  };
  security: {
    maxFileUploadSize: string;
    allowedFileTypes: string[];
    blockedCommands: string[];
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableDebugMode: boolean;
    retentionDays: number;
  };
}
```

**Loading Configuration**:
```typescript
import fs from 'fs';
import path from 'path';

function loadConfig(): AppConfig {
  const configPath = process.env.CONFIG_PATH || './config/default.json';
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Override with environment variables if present
  if (process.env.LLM_API_KEY) config.llm.apiKey = process.env.LLM_API_KEY;
  if (process.env.LLM_BASE_URL) config.llm.baseUrl = process.env.LLM_BASE_URL;
  if (process.env.LLM_MODEL) config.llm.model = process.env.LLM_MODEL;

  return config;
}
```

## Implementation Guidelines

### Phase 1: Core Infrastructure (Week 1-2)
1. Set up monorepo with frontend and backend
2. Implement authentication system
3. Create database schema and migrations
4. Build WebSocket/SSE streaming infrastructure
5. Set up sandbox environment (Docker)

### Phase 2: LLM Integration (Week 2-3)
1. Implement LLM client with streaming (OpenAI-compatible API)
2. Build CoT thinking engine
3. Create query rewriting module
4. Implement context window management
5. Add conversation memory system

### Phase 3: Tool System (Week 3-4)
1. Build tool registry and executor
2. Implement core tools (bash, Python, file operations)
3. Add error handling and retry logic
4. Create tool call visualization
5. Implement parallel execution

### Phase 4: MCP Integration (Week 4-5)
1. Build MCP client
2. Integrate filesystem MCP server
3. Add GitHub MCP integration
4. Implement resource subscription
5. Test tool + MCP combination

### Phase 5: UI/UX (Week 5-6)
1. Build main chat interface with streaming
2. Create progress display panel
3. Implement session management UI
4. Add file upload/download
5. Build code editor for output display

### Phase 6: Advanced Features (Week 6-7)
1. Multi-turn task orchestration
2. Dynamic replanning
3. User approval workflows
4. Checkpoint/resume functionality
5. Export and sharing

### Phase 7: Testing & Polish (Week 7-8)
1. End-to-end testing
2. Performance optimization
3. Security audit
4. Documentation
5. Deployment setup

## Key Technical Decisions

### 1. Streaming Architecture
Use Server-Sent Events (SSE) for unidirectional streaming:
```typescript
// Backend
app.get('/api/stream/:sessionId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const stream = progressEmitter.subscribe(req.params.sessionId);
  stream.on('data', (chunk) => {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  });
});

// Frontend
const eventSource = new EventSource(`/api/stream/${sessionId}`);
eventSource.onmessage = (event) => {
  const update = JSON.parse(event.data);
  updateUI(update);
};
```

### 2. Sandbox Implementation
Use Docker containers with resource limits:
```typescript
import Docker from 'dockerode';

const docker = new Docker();

async function createSandbox(sessionId: string) {
  const container = await docker.createContainer({
    Image: 'python:3.11-slim',
    Cmd: ['/bin/bash'],
    Tty: true,
    WorkingDir: '/workspace',
    HostConfig: {
      Memory: 512 * 1024 * 1024, // 512MB
      CpuQuota: 100000, // 1 CPU
      NetworkMode: 'none', // Disable network
      Binds: [`/tmp/workspaces/${sessionId}:/workspace`],
    },
  });
  
  await container.start();
  return container;
}
```

### 3. LLM Prompt Structure
```typescript
const systemPrompt = `You are an autonomous AI agent with access to tools and code execution.

Your workflow:
1. THINK: Reason through the task step-by-step
2. PLAN: Break down into executable steps
3. ACT: Call tools or write code
4. REFLECT: Review results and adjust plan
5. DELIVER: Provide final output

Available tools: ${JSON.stringify(tools)}

Always explain your reasoning before taking action.`;

const userPrompt = `${userQuery}

Current workspace files: ${files}
Previous steps: ${history}`;
```

### 4. Token Counting Utility
```typescript
// Approximate token counting for context management
// Use tiktoken for accurate OpenAI-compatible tokenization

import { encoding_for_model } from 'tiktoken';

class TokenCounter {
  private encoder: any;

  constructor() {
    // Use cl100k_base encoding (GPT-4/ChatGPT compatible)
    this.encoder = encoding_for_model('gpt-4');
  }

  count(text: string): number {
    return this.encoder.encode(text).length;
  }

  countMessages(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      // Each message has overhead: role tokens + content + separators
      total += 4; // message overhead
      total += this.count(msg.role);
      total += this.count(msg.content);
      if (msg.toolCalls) {
        total += this.count(JSON.stringify(msg.toolCalls));
      }
    }
    total += 2; // conversation overhead
    return total;
  }

  truncateToFit(messages: Message[], maxTokens: number): Message[] {
    const result: Message[] = [];
    let currentTokens = 0;

    // Always include system message if present
    const systemMsg = messages.find(m => m.role === 'system');
    if (systemMsg) {
      currentTokens += this.countMessages([systemMsg]);
      result.push(systemMsg);
    }

    // Add messages from newest to oldest until limit
    const nonSystemMessages = messages.filter(m => m.role !== 'system').reverse();
    for (const msg of nonSystemMessages) {
      const msgTokens = this.countMessages([msg]);
      if (currentTokens + msgTokens > maxTokens) break;
      currentTokens += msgTokens;
      result.unshift(msg);
    }

    return result;
  }
}
```

### 5. Error Recovery Strategy
```typescript
async function executeWithRecovery(operation: () => Promise<any>) {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Try to recover
      const recovery = await llm.generateRecovery(error, attempt);
      
      if (recovery.canRecover) {
        await applyRecovery(recovery.action);
        continue;
      }
      
      if (attempt === 3) break;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
  
  throw new RecoverableError(lastError, 'Failed after 3 attempts');
}
```

## Success Metrics

1. **Performance**: Response latency < 2s for simple queries, < 30s for complex tasks
2. **Reliability**: 99% success rate for tool executions, < 0.1% sandbox escape rate
3. **User Experience**: < 5 clicks to complete common tasks, real-time progress visible
4. **Cost**: < $0.50 per complex task execution (LLM + compute)
5. **Security**: Zero unauthorized file access, all sandboxes properly isolated

## Security Requirements

### Input Validation
```typescript
// All user inputs must be validated using Zod schemas

import { z } from 'zod';

const MessageInputSchema = z.object({
  content: z.string().min(1).max(100000),
  attachments: z.array(z.object({
    filename: z.string().max(255),
    mimeType: z.string(),
    size: z.number().max(10 * 1024 * 1024), // 10MB max
  })).max(5).optional(),
});

const SessionCreateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});
```

### Security Headers
```typescript
// Required security headers for all responses

const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",  // For React
    "style-src 'self' 'unsafe-inline'",   // For Tailwind
    "img-src 'self' data: blob:",
    "connect-src 'self' wss:",            // For WebSocket
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
```

### CORS Configuration
```typescript
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 hours
};
```

### Sandbox Security Checklist
- [ ] Network disabled by default (NetworkMode: 'none')
- [ ] Resource limits enforced (memory, CPU, disk)
- [ ] No privileged mode
- [ ] Read-only root filesystem where possible
- [ ] Separate user namespace
- [ ] No capability additions
- [ ] Timeout enforced on all executions
- [ ] Workspace mounted with noexec where appropriate

### JWT Token Structure
```typescript
// Access token payload
interface AccessTokenPayload {
  sub: string;        // User ID
  email: string;
  iat: number;        // Issued at
  exp: number;        // Expires (15 minutes)
  type: 'access';
}

// Refresh token payload
interface RefreshTokenPayload {
  sub: string;        // User ID
  iat: number;
  exp: number;        // Expires (7 days)
  type: 'refresh';
}

// Token generation
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;  // Must be 256+ bits

function generateTokens(user: User): AuthToken {
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, type: 'access' },
    JWT_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    userId: user.id,
  };
}
```

### API Key Encryption
```typescript
// API keys stored encrypted using AES-256-GCM

import crypto from 'crypto';

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes

function encryptApiKey(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptApiKey(ciphertext: string): string {
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, 16);
  const authTag = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

## Testing Requirements

1. **Unit Tests**: All core modules (>80% coverage)
2. **Integration Tests**: Tool execution, MCP communication, streaming
3. **E2E Tests**: Complete user workflows using Playwright
4. **Load Tests**: Handle 100 concurrent users
5. **Security Tests**: Penetration testing, sandbox escape attempts

## Deployment

```yaml
# docker-compose.yml
version: '3.8'
services:
  frontend:
    build: ./apps/web
    ports:
      - "3000:3000"
    environment:
      - VITE_API_URL=http://localhost:4000
    depends_on:
      - backend

  backend:
    build: ./apps/api
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgresql://mark:${POSTGRES_PASSWORD:-mark_password}@db:5432/mark
      - REDIS_URL=redis://redis:6379
      - LLM_API_KEY=${LLM_API_KEY}
      - LLM_BASE_URL=${LLM_BASE_URL:-https://api.jiekou.ai/openai}
      - LLM_MODEL=${LLM_MODEL:-zai-org/glm-4.7}
      - JWT_SECRET=${JWT_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:3000}
      - WORKSPACE_ROOT=/workspaces
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./config:/app/config:ro
      - workspaces:/workspaces
    depends_on:
      - db
      - redis

  db:
    image: postgres:16
    environment:
      - POSTGRES_USER=mark
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-mark_password}
      - POSTGRES_DB=mark
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mark"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  worker:
    build: ./apps/api
    command: bun run worker
    environment:
      - DATABASE_URL=postgresql://mark:${POSTGRES_PASSWORD:-mark_password}@db:5432/mark
      - REDIS_URL=redis://redis:6379
      - LLM_API_KEY=${LLM_API_KEY}
      - LLM_BASE_URL=${LLM_BASE_URL:-https://api.jiekou.ai/openai}
      - LLM_MODEL=${LLM_MODEL:-zai-org/glm-4.7}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - WORKSPACE_ROOT=/workspaces
    volumes:
      - ./config:/app/config:ro
      - workspaces:/workspaces
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
  workspaces:
```

## Documentation Requirements

1. **API Documentation**: OpenAPI/Swagger spec for all endpoints
2. **Architecture Diagrams**: System flow, database schema, component relationships
3. **User Guide**: How to use the agent, example tasks, troubleshooting
4. **Developer Guide**: How to add new tools, extend MCP, customize sandbox
5. **Deployment Guide**: Environment setup, configuration, scaling

---

## Your Task

Build this complete system with all components listed above. Ensure:
- Clean, typed TypeScript code throughout
- Comprehensive error handling
- Real-time progress feedback for all operations
- Secure sandbox execution
- Scalable architecture
- Production-ready code quality

Start with Phase 1 and work through systematically. Ask clarifying questions if any requirements are ambiguous.

---

## Skills System

The agent includes predefined skills (slash commands) that provide specialized prompts for common tasks.

### Available Skills

| Skill | Aliases | Description |
|-------|---------|-------------|
| `/code` | /generate, /create, /implement | Generate code based on requirements |
| `/refactor` | /improve, /cleanup, /optimize | Refactor existing code for better quality |
| `/review` | /cr, /code-review, /check | Review code for issues and improvements |
| `/api` | /rest, /graphql, /endpoint, /routes | Design and implement REST or GraphQL APIs |
| `/prompt` | /prompt-engineering, /system-prompt, /prompt-design | Design and optimize LLM prompts |
| `/tool` | /tool-definition, /function-calling, /agent-tool | Create custom tool definitions for agents |
| `/auth` | /authentication, /login, /jwt, /oauth | Implement authentication and authorization |
| `/component` | /ui, /react-component, /shadcn, /frontend | Create React UI components |
| `/debug` | /investigate, /diagnose, /troubleshoot | Debug issues and find root causes |
| `/fix` | /bugfix, /patch, /resolve | Fix bugs and errors in code |
| `/test` | /unittest, /spec, /tests | Write and run tests |
| `/coverage` | /cov, /test-coverage | Analyze and improve test coverage |
| `/deploy` | /ship, /release, /publish | Deploy application to environments |
| `/docker` | /container, /dockerfile, /compose | Create and manage Docker containers |
| `/git` | /commit, /branch, /merge, /pr | Git operations and version control |
| `/migrate` | /migration, /schema-change, /db-migrate | Create and run database migrations |
| `/ci` | /cicd, /pipeline, /workflow, /github-actions | Set up CI/CD pipelines |
| `/env` | /environment, /config, /dotenv, /settings | Set up environment configuration |
| `/monitor` | /observability, /logging, /metrics, /tracing | Set up monitoring and observability |
| `/docs` | /document, /readme, /documentation | Generate documentation |
| `/api-docs` | /swagger, /openapi, /api-reference | Generate API documentation |
| `/changelog` | /release-notes, /changes, /whatsnew | Generate changelogs from git history |
| `/analyze` | /audit, /inspect, /assess | Analyze code structure and quality |
| `/security` | /vuln, /security-scan, /pentest | Scan for security vulnerabilities |
| `/scrape` | /crawl, /extract, /fetch | Scrape data from websites |
| `/search` | /google, /lookup, /find-info | Search the web for information |
| `/data` | /csv, /json, /transform, /visualize | Analyze and transform data |
| `/sql` | /query, /database, /db | Write and execute SQL queries |
| `/mcp` | /mcp-server, /context-protocol, /mcp-integration | Configure MCP server integrations |
| `/plan` | /breakdown, /decompose, /taskplan, /roadmap | Break down complex tasks into steps |
| `/architect` | /design, /architecture, /system-design | Design system architecture |

### Skill Architecture

```typescript
// Skills are defined in /skills directory
interface Skill {
  name: string;
  description: string;
  aliases: string[];
  category: SkillCategory;
  systemPrompt: string;        // Expert persona and guidelines
  userPromptTemplate: string;  // Template with {placeholders}
  requiredTools: string[];     // Tools needed for this skill
  parameters?: SkillParameter[];
}

// Usage in chat:
// User types: /code Create a REST API for user management
// Agent receives the skill's system prompt + formatted user prompt
```

### Adding Custom Skills

1. Create a new file in the appropriate category folder
2. Export a Skill object following the interface
3. Import and register in `skills/index.ts`

## Quick Start Guide

### Prerequisites
- Node.js 20+ or Bun 1.0+
- Docker and Docker Compose
- PostgreSQL 16+ (or use Docker)
- Redis 7+ (or use Docker)

### Environment Variables (.env.example)
```bash
# ============ Required ============

# LLM Configuration
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.jiekou.ai/openai
LLM_MODEL=zai-org/glm-4.7

# Database
DATABASE_URL=postgresql://mark:mark_password@localhost:5432/mark

# Redis
REDIS_URL=redis://localhost:6379

# Security (generate with: openssl rand -hex 32)
JWT_SECRET=your_256_bit_secret_here
ENCRYPTION_KEY=your_32_byte_hex_key_here

# ============ Optional ============

# Config file path (defaults to ./config/default.json)
CONFIG_PATH=./config/default.json

# Frontend URL for CORS
ALLOWED_ORIGINS=http://localhost:3000

# Logging
LOG_LEVEL=info

# Docker socket (for sandbox)
DOCKER_HOST=unix:///var/run/docker.sock

# Workspace directory
WORKSPACE_ROOT=/tmp/mark-workspaces
```

### Initial Setup

```bash
# 1. Clone and install dependencies
git clone <repo-url> mark-agent
cd mark-agent
bun install  # or npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your LLM_API_KEY

# 3. Start infrastructure
docker-compose up -d db redis

# 4. Run database migrations
cd apps/api
bunx prisma migrate dev

# 5. Start development servers
cd ../..
bun run dev  # Starts both frontend and backend
```

### Development Commands

```bash
# Run all services
bun run dev

# Run frontend only
bun run dev:web

# Run backend only
bun run dev:api

# Run worker
bun run worker

# Run tests
bun run test

# Run linting
bun run lint

# Build for production
bun run build

# Database commands
bunx prisma studio          # Open Prisma Studio
bunx prisma migrate dev     # Run migrations
bunx prisma generate        # Generate Prisma client
```

### First API Call Test

```bash
# After starting the backend, test the health endpoint
curl http://localhost:4000/api/health

# Create a session and send a message
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "testpass123"}'

# Use the returned token for subsequent requests
```

### Configuration Override

For local development, create `config/local.json`:
```json
{
  "llm": {
    "model": "zai-org/glm-4.7-flash"  // Use faster model for dev
  },
  "sandbox": {
    "enabled": false  // Disable sandbox for quick testing
  },
  "logging": {
    "level": "debug"
  }
}
```

Then set: `CONFIG_PATH=./config/local.json`