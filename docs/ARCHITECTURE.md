# Manus Agent: Full-Stack Architecture Explained

**For beginners who want to understand the system, not just the parts.**

---

## The Big Picture: What Are We Building?

Imagine you're building a smart assistant that lives in your browser. When you talk to it:
1. It thinks about what you asked
2. It can use tools (like reading files or running code)
3. It shows you progress in real-time
4. It remembers your conversation

This requires **three major systems working together**:

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  FRONTEND   │ ◄─────► │   BACKEND   │ ◄─────► │  AI LAYER   │
│  (Browser)  │         │   (Server)  │         │    (LLM)    │
└─────────────┘         └─────────────┘         └─────────────┘
     React                 Hono + APIs            OpenAI API
     Displays UI           Processes              Thinks & Plans
     Handles input         Stores data            Uses tools
```

**Infrastructure supporting all three:**
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PostgreSQL  │  │    Redis     │  │    Docker    │
│   (Storage)  │  │   (Cache)    │  │  (Sandbox)   │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## The Three Layers

### Layer 1: Frontend (What You See)
**Problem it solves**: Users need a way to interact with the AI agent.

### Layer 2: Backend (The Coordinator)
**Problem it solves**: Coordinate between user, database, and AI. Keep everything secure and organized.

### Layer 3: AI Layer (The Brain)
**Problem it solves**: Understand requests, make decisions, generate responses.

Let's dive deep into each layer.

---

## Layer 1: Frontend Architecture

### What Problem Does the Frontend Solve?

**The Challenge**:
- Show AI responses as they're being generated (streaming)
- Display complex conversations with code, files, and tool outputs
- Let users upload files and see progress
- Make it feel fast and responsive

**The Solution**: A React-based web application that handles real-time updates.

---

### The Frontend Stack

#### 1. React: The UI Framework

**What React Solves**:
- Building complex UIs is hard. You need to update the screen when data changes.
- React makes this automatic - change data, React updates the screen.

**Analogy**: Think of React like a smart display that automatically refreshes when you change what's written on a whiteboard behind it.

**Core Concepts**:

**Components** (The Building Blocks)
```
App
├── ChatInterface
│   ├── MessageList
│   │   ├── UserMessage
│   │   └── AssistantMessage
│   ├── MessageInput
│   └── FileUpload
├── SessionSidebar
└── ProgressPanel
```

Each component is a piece of UI. Like LEGO blocks, you combine them to build the full interface.

**Props** (Passing Information Down)
```
Parent Component (ChatInterface)
    |
    | passes sessionId as prop
    ↓
Child Component (MessageList)
```

Props are like function parameters - a way to give a component the data it needs.

**State** (Remembering Things)
```
Component has state:
├── messages: []        ← List of chat messages
├── isTyping: false     ← Is AI currently responding?
└── error: null         ← Any error message?

When state changes → React re-renders → UI updates
```

State is memory inside a component. When it changes, React automatically updates what you see.

**Hooks** (Special Functions)
- `useState` - Give a component memory
- `useEffect` - Do something when component loads or updates
- `useCallback` - Remember a function
- Custom hooks - Package up reusable logic

**Example Flow**:
```
User types message → Update state → React re-renders → New message appears
```

---

#### 2. Vite: The Development Server

**What Vite Solves**:
- Waiting 30 seconds for code to reload during development is painful
- Vite makes changes appear instantly (in milliseconds)

**Analogy**: Like the difference between restarting your computer vs just refreshing a window.

**What it does**:
1. Runs a local web server (http://localhost:3000)
2. Watches your files for changes
3. Hot-reloads the browser automatically
4. Bundles code for production

---

#### 3. TypeScript: Type Safety

**What TypeScript Solves**:
- JavaScript doesn't catch errors until you run the code
- TypeScript catches errors as you type

**Example**:
```typescript
// TypeScript knows this is wrong immediately
function greet(name: string) {
  return "Hello, " + name;
}

greet(123);  // ❌ Error: Expected string, got number

// JavaScript doesn't complain until runtime
function greet(name) {
  return "Hello, " + name;
}

greet(123);  // ✓ No error, but creates "Hello, 123"
```

**In our system**: Every piece of data has a defined shape. The editor tells you when you make mistakes.

---

#### 4. Tailwind CSS: Styling

**What Tailwind Solves**:
- Writing custom CSS for every component is slow
- Tailwind provides pre-built utility classes

**Analogy**: Instead of painting a house from scratch, you have pre-mixed paint cans labeled "Sky Blue", "Grass Green", etc.

**Example**:
```jsx
// Instead of writing CSS:
<div className="message-box">...</div>

// Use utility classes:
<div className="bg-white p-4 rounded-lg shadow">...</div>
```

`bg-white` = white background
`p-4` = padding on all sides
`rounded-lg` = rounded corners
`shadow` = drop shadow

---

#### 5. Zustand: State Management

**What Zustand Solves**:
- Multiple components need to access the same data (like current session ID)
- Passing props through many layers is messy ("prop drilling")

**Analogy**: Like a shared whiteboard that all components can read and write to, instead of passing notes between them.

**Example**:
```typescript
// Create a store (shared state)
const useSessionStore = create((set) => ({
  sessionId: null,
  setSession: (id) => set({ sessionId: id })
}));

// Any component can access it
function ChatInterface() {
  const sessionId = useSessionStore(state => state.sessionId);
  const setSession = useSessionStore(state => state.setSession);

  // Use sessionId anywhere
}

function Sidebar() {
  const sessionId = useSessionStore(state => state.sessionId);

  // Same sessionId, no prop passing needed
}
```

---

#### 6. React Query: Server State

**What React Query Solves**:
- Fetching data from backend
- Caching so you don't re-fetch unnecessarily
- Handling loading and error states

**Analogy**: Like a smart assistant that remembers what you asked for and doesn't bother the backend unnecessarily.

**Example Flow**:
```
Component needs sessions list
    ↓
Check cache - do we have it?
    ├─ Yes → Use cached data
    └─ No → Fetch from backend
         ↓
    Store in cache
         ↓
    Return to component
```

---

### How Frontend Connects to Backend

#### Regular API Calls (HTTP)

**For one-time operations**: Login, create session, send message

```
Frontend                    Backend
   |                           |
   |-- POST /api/auth/login -->|
   |                           |
   |<-- {accessToken} ---------|
   |                           |
```

**The Process**:
1. Frontend calls `fetch()` with request
2. Includes auth token in headers
3. Backend processes and responds
4. Frontend updates UI with response

---

#### Streaming (SSE - Server-Sent Events)

**For real-time updates**: AI responses, progress updates

**The Problem**:
- AI takes time to generate response
- You want to see text appear as it's generated (like ChatGPT)

**The Solution**: Keep a connection open and send updates as they happen.

```
Frontend                          Backend
   |                                 |
   |-- GET /api/sessions/1/stream ->|
   |                                 |
   |                          [Connection stays open]
   |                                 |
   |<--- event: message.delta -------|
   |<--- event: message.delta -------|
   |<--- event: tool.start ----------|
   |<--- event: tool.complete -------|
   |<--- event: message.complete ----|
   |                                 |
```

**Frontend Code**:
```typescript
// Open connection
const eventSource = new EventSource('/api/sessions/1/stream');

// Listen for events
eventSource.addEventListener('message.delta', (event) => {
  const data = JSON.parse(event.data);
  // Append new text to UI
  appendText(data.content);
});

eventSource.addEventListener('tool.start', (event) => {
  const data = JSON.parse(event.data);
  // Show "Running bash_executor..."
  showToolProgress(data.toolName);
});
```

**Why SSE instead of WebSocket?**
- Simpler (one-way communication is all we need)
- Automatic reconnection
- Works through corporate proxies

---

### Frontend Data Flow

**Complete flow when user sends a message**:

```
1. User types in MessageInput component
   ↓
2. Calls sendMessage(content)
   ↓
3. fetch POST /api/sessions/1/messages
   ↓
4. Backend processes (we'll cover this next)
   ↓
5. Frontend listens to SSE stream
   ↓
6. Events arrive: message.delta, tool.start, etc.
   ↓
7. Update UI with each event
   ↓
8. Show final result
```

---

## Layer 2: Backend Architecture

### What Problem Does the Backend Solve?

**The Challenge**:
- Coordinate between frontend, database, and AI
- Keep user data secure and isolated
- Handle multiple users simultaneously
- Store conversation history
- Execute tools safely
- Stream responses in real-time

**The Solution**: A Hono-based API server with Prisma for database access.

---

### The Backend Stack

#### 1. Bun: The Runtime

**What Bun Solves**:
- JavaScript/TypeScript needs something to run it outside the browser
- Node.js is the traditional choice, but it's slow

**Analogy**: Like choosing between a regular car (Node.js) and a sports car (Bun) - both get you there, but one is 3x faster.

**What Bun Does**:
- Runs TypeScript directly (no compilation step)
- Includes package manager (like npm)
- Runs tests
- Faster startup, lower memory usage

---

#### 2. Hono: The Web Framework

**What Hono Solves**:
- You need to handle HTTP requests (GET, POST, etc.)
- Route requests to the right code
- Add middleware (auth, logging, etc.)

**Analogy**: Like a receptionist routing phone calls to the right department.

**Core Concepts**:

**Routing** (Directing Traffic)
```typescript
const app = new Hono();

// When someone visits GET /api/health
app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

// When someone visits POST /api/sessions
app.post('/api/sessions', (c) => {
  // Create new session
});

// Pattern matching
app.get('/api/sessions/:id', (c) => {
  const id = c.req.param('id');
  // Get specific session
});
```

**Middleware** (Processing Before/After)
```
Request comes in
    ↓
Logging middleware (log the request)
    ↓
Auth middleware (check if user logged in)
    ↓
Route handler (process the request)
    ↓
Response goes out
```

**Example**:
```typescript
// Middleware to check authentication
const authMiddleware = async (c, next) => {
  const token = c.req.header('Authorization');

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const user = verifyToken(token);
  c.set('userId', user.id);  // Store for next handler

  await next();  // Continue to route handler
};

// Use it
app.post('/api/sessions', authMiddleware, async (c) => {
  const userId = c.get('userId');  // From middleware
  // Create session for this user
});
```

---

#### 3. Prisma: The Database ORM

**What Prisma Solves**:
- Writing SQL is error-prone and not type-safe
- Need to convert between database rows and JavaScript objects

**Analogy**: Like having a translator who automatically converts between two languages, and catches mistakes.

**Core Concepts**:

**Schema** (Defining Your Data Structure)
```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  sessions  Session[]
}

model Session {
  id       String   @id @default(uuid())
  userId   String
  user     User     @relation(fields: [userId], references: [id])
  messages Message[]
}

model Message {
  id        String   @id @default(uuid())
  sessionId String
  session   Session  @relation(fields: [sessionId], references: [id])
  role      String
  content   String
}
```

This defines three tables and their relationships.

**Using Prisma** (Type-Safe Database Access)
```typescript
// Create a user
const user = await prisma.user.create({
  data: {
    email: 'alice@example.com'
  }
});

// Get user with all their sessions
const userWithSessions = await prisma.user.findUnique({
  where: { id: userId },
  include: { sessions: true }
});

// TypeScript knows the shape of the result!
userWithSessions.email         // ✓ Valid
userWithSessions.sessions[0]   // ✓ Valid
userWithSessions.age           // ❌ Error: doesn't exist
```

**Migrations** (Evolving Your Schema)
```bash
# You change schema.prisma
# Then run:
bunx prisma migrate dev

# Prisma creates SQL migration file
# Applies changes to database
# Regenerates TypeScript types
```

---

#### 4. PostgreSQL: The Database

**What PostgreSQL Solves**:
- Need to store data permanently (users, sessions, messages)
- Need to query data efficiently
- Need data integrity (relationships, constraints)

**Analogy**: Like a well-organized filing system with cross-references and search capabilities.

**Why PostgreSQL specifically?**
- **Reliable**: ACID compliance (data integrity guaranteed)
- **Relational**: Can express relationships (user has many sessions)
- **Powerful**: Complex queries, full-text search, JSON support
- **Mature**: 30+ years of development

**Data Structure**:
```
users table
├─ id: "abc-123"
├─ email: "alice@example.com"
└─ passwordHash: "..."

sessions table
├─ id: "xyz-789"
├─ userId: "abc-123" ← References users.id
└─ name: "Chat about React"

messages table
├─ id: "msg-001"
├─ sessionId: "xyz-789" ← References sessions.id
├─ role: "user"
└─ content: "Explain React hooks"
```

**Queries Prisma Makes**:
```typescript
// Get all messages in a session
const messages = await prisma.message.findMany({
  where: { sessionId: 'xyz-789' },
  orderBy: { createdAt: 'asc' }
});

// Behind the scenes, Prisma runs:
// SELECT * FROM messages
// WHERE session_id = 'xyz-789'
// ORDER BY created_at ASC
```

---

#### 5. Redis: The Cache

**What Redis Solves**:
- PostgreSQL is fast, but still involves disk access
- Need super-fast temporary storage for:
  - Session state
  - Rate limiting counters
  - Job queues

**Analogy**: PostgreSQL is like a filing cabinet (permanent, organized). Redis is like your desk (fast access, temporary).

**Speed Comparison**:
- PostgreSQL query: ~5-10ms
- Redis query: ~0.1ms (100x faster)

**What We Use Redis For**:

**1. Session Storage**
```typescript
// Store active session state
await redis.set(`session:${sessionId}`, JSON.stringify({
  userId,
  workspacePath,
  lastActive: Date.now()
}), 'EX', 3600);  // Expires in 1 hour
```

**2. Rate Limiting**
```typescript
// Count requests per minute
const count = await redis.incr(`rate:${userId}:${minute}`);
await redis.expire(`rate:${userId}:${minute}`, 60);

if (count > 100) {
  throw new Error('Rate limit exceeded');
}
```

**3. Job Queues** (with BullMQ)
```typescript
// Add job to queue
await queue.add('execute-tool', {
  toolName: 'bash_executor',
  params: { command: 'ls -la' }
});

// Worker picks it up
worker.process('execute-tool', async (job) => {
  return executeTool(job.data);
});
```

---

#### 6. BullMQ: Background Jobs

**What BullMQ Solves**:
- Some tasks take a long time (running code, processing files)
- Don't want to block the API response waiting for them
- Need reliable job processing (retry on failure)

**Analogy**: Like a to-do list manager. API adds tasks to the list, workers pick them up and complete them.

**Example Flow**:
```
User sends message
    ↓
API responds immediately: "Message received"
    ↓
API adds job to queue: "Process this message"
    ↓
Worker picks up job
    ↓
Worker calls LLM, executes tools
    ↓
Worker streams results via SSE
```

---

### Backend Request Flow

**Example: User sends a message**

```
1. Request arrives: POST /api/sessions/123/messages
   Body: { content: "List all files" }
   Header: Authorization: Bearer <token>

2. Logging middleware
   → Log: "POST /api/sessions/123/messages from user abc"

3. Auth middleware
   → Verify JWT token
   → Extract userId from token
   → Store in context: c.set('userId', 'abc')

4. Route handler
   → Validate input (Zod schema)
   → Get userId from context
   → Check if user owns session 123

5. Save message to database
   → await prisma.message.create(...)
   → Message saved with id "msg-456"

6. Get conversation history
   → await prisma.message.findMany({
       where: { sessionId: '123' }
     })

7. Call LLM (next section)
   → Send conversation to AI
   → AI decides to use file_reader tool

8. Execute tool
   → Run file_reader
   → Get result

9. Stream results back
   → SSE connection already open
   → Send events as they happen:
     - message.start
     - tool.start
     - tool.complete
     - message.delta (AI response)
     - message.complete

10. Return response
    → c.json({ messageId: 'msg-456' })
```

---

### Backend Security Layers

#### 1. Authentication (Who are you?)

**JWT Tokens**:
```
User logs in
    ↓
Backend verifies password
    ↓
Backend creates JWT token:
{
  header: { alg: "HS256" },
  payload: { userId: "abc", exp: 1234567890 },
  signature: hash(header + payload + secret)
}
    ↓
Frontend stores token
    ↓
Frontend sends token with every request:
Authorization: Bearer <token>
    ↓
Backend verifies signature
    ↓
Extracts userId from payload
```

**Why JWT?**
- Stateless (no need to check database on every request)
- Contains user info (userId, email)
- Can't be forged (signature)
- Can expire automatically

#### 2. Authorization (What can you do?)

```typescript
// Check if user owns this session
const session = await prisma.session.findUnique({
  where: { id: sessionId }
});

if (session.userId !== requestingUserId) {
  return c.json({ error: 'Forbidden' }, 403);
}
```

#### 3. Input Validation (Is this data valid?)

**Using Zod**:
```typescript
const MessageInputSchema = z.object({
  content: z.string().min(1).max(100000),
});

// Validate
const result = MessageInputSchema.safeParse(input);
if (!result.success) {
  return c.json({ error: result.error }, 400);
}
```

#### 4. Rate Limiting (Not too many requests)

```typescript
const count = await redis.incr(`rate:${userId}:${currentMinute}`);

if (count > 60) {
  return c.json({ error: 'Too many requests' }, 429);
}
```

---

## Layer 3: AI Architecture

### What Problem Does the AI Layer Solve?

**The Challenge**:
- Understand user's natural language request
- Decide what actions to take
- Use tools when needed
- Generate human-like responses
- Do all this efficiently within token limits

**The Solution**: An LLM (Large Language Model) with function calling capabilities.

---

### The AI Stack

#### 1. OpenAI API (The Standard)

**What It Is**:
- A standard format for communicating with LLMs
- Most providers implement this API (OpenAI, Anthropic, local models)

**Why Standardization Matters**:
- Write code once, works with multiple providers
- Easy to switch providers
- Well-documented

---

#### 2. GLM-4.7 (The Specific Model)

**What It Is**:
- The actual AI model we use
- Provided by jiekou.ai
- OpenAI-compatible API

**Specifications**:
- Context window: 128K tokens (~96K words)
- Supports streaming (real-time responses)
- Supports function calling (can use tools)
- Good at reasoning and code

---

#### 3. LLM Client: The Bridge

**What It Does**:
- Connects to GLM-4.7 API
- Formats requests correctly
- Handles streaming responses
- Manages function calling

**Architecture**:
```typescript
class LLMClient {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: 'https://api.jiekou.ai/openai'
    });
  }

  // Non-streaming: wait for complete response
  async chat(messages, tools) {
    return await this.openai.chat.completions.create({
      model: 'zai-org/glm-4.7',
      messages,
      tools,
      temperature: 0.7
    });
  }

  // Streaming: receive response chunk by chunk
  async *streamChat(messages, tools) {
    const stream = await this.openai.chat.completions.create({
      model: 'zai-org/glm-4.7',
      messages,
      tools,
      stream: true
    });

    for await (const chunk of stream) {
      yield chunk.choices[0]?.delta?.content || '';
    }
  }
}
```

---

#### 4. Function Calling: How AI Uses Tools

**The Problem**:
- AI can generate text, but can't actually DO things
- Need a way for AI to request actions

**The Solution**: Function calling (also called tool calling)

**How It Works**:

**Step 1: Tell LLM about available tools**
```typescript
const tools = [
  {
    type: 'function',
    function: {
      name: 'file_reader',
      description: 'Read contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path to read'
          }
        },
        required: ['path']
      }
    }
  }
];
```

**Step 2: LLM decides to use a tool**
```
User: "What's in app.ts?"

LLM thinks: "I need to read the file app.ts"

LLM responds with:
{
  tool_calls: [{
    id: "call_123",
    function: {
      name: "file_reader",
      arguments: '{"path": "app.ts"}'
    }
  }]
}
```

**Step 3: Backend executes tool**
```typescript
const result = await fileReaderTool.execute({
  path: 'app.ts'
});

// result = { success: true, output: "import React..." }
```

**Step 4: Send result back to LLM**
```typescript
messages.push({
  role: 'tool',
  tool_call_id: 'call_123',
  content: JSON.stringify(result)
});

// LLM continues with this information
```

**Step 5: LLM generates final response**
```
LLM: "The app.ts file contains a React component that..."
```

**Complete Flow**:
```
User message
    ↓
LLM receives message + tool descriptions
    ↓
LLM decides: "I need to use file_reader"
    ↓
LLM returns tool call request
    ↓
Backend executes file_reader
    ↓
Backend sends result back to LLM
    ↓
LLM generates response using that information
    ↓
Response streamed to user
```

---

#### 5. Context Window Management

**The Problem**:
- LLMs have limited memory (128K tokens for GLM-4.7)
- Long conversations exceed this limit
- Need to fit: system prompt + conversation history + tool descriptions

**Token Counting**:
```
1 token ≈ 0.75 words
1 token ≈ 4 characters

"Hello, world!" = ~3 tokens
```

**Strategy**:
```typescript
class TokenCounter {
  countMessages(messages) {
    let total = 0;
    for (const msg of messages) {
      total += this.count(msg.content);
      if (msg.toolCalls) {
        total += this.count(JSON.stringify(msg.toolCalls));
      }
    }
    return total;
  }

  truncateToFit(messages, maxTokens) {
    // 1. Always keep system message
    // 2. Always keep most recent messages
    // 3. Summarize or drop oldest messages
    // 4. Ensure total < maxTokens
  }
}
```

**Example**:
```
Available: 128K tokens
System prompt: 2K tokens
Tool descriptions: 1K tokens
Available for conversation: 125K tokens

If conversation > 125K:
  → Keep most recent 100K tokens
  → Summarize older messages
  → Drop very old messages
```

---

### Tools System Architecture

**Tool Definition**:
```typescript
interface Tool {
  name: string;              // Unique identifier
  description: string;       // What it does (LLM reads this)
  inputSchema: JSONSchema;   // What parameters it needs
  execute: (params) => Promise<ToolResult>;
  requiresConfirmation: boolean;  // Ask user first?
  timeout: number;           // Max execution time
}
```

**Tool Registry**:
```typescript
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool {
    return this.tools.get(name);
  }

  // Convert to OpenAI function format
  toOpenAIFormat(): OpenAIFunction[] {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
  }
}
```

**Tool Executor**:
```typescript
class ToolExecutor {
  async execute(toolName: string, params: any): Promise<ToolResult> {
    const tool = registry.get(toolName);

    // 1. Validate parameters
    const valid = validateSchema(params, tool.inputSchema);
    if (!valid) {
      return { success: false, error: 'Invalid parameters' };
    }

    // 2. Check if needs confirmation
    if (tool.requiresConfirmation) {
      await requestUserApproval(toolName, params);
    }

    // 3. Execute with timeout
    const result = await Promise.race([
      tool.execute(params),
      timeout(tool.timeout)
    ]);

    // 4. Save to database
    await prisma.toolCall.create({
      data: { toolName, parameters: params, result }
    });

    return result;
  }
}
```

---

### Example Tools

#### File Reader Tool
```typescript
const fileReaderTool: Tool = {
  name: 'file_reader',
  description: 'Read contents of a file from the workspace',

  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' }
    },
    required: ['path']
  },

  async execute({ path }) {
    // Security: ensure path is within workspace
    const safePath = resolveSafePath(workspaceDir, path);

    // Read file
    const content = await fs.readFile(safePath, 'utf-8');

    return {
      success: true,
      output: content,
      duration: 50
    };
  },

  requiresConfirmation: false,
  timeout: 5000
};
```

#### Bash Executor Tool
```typescript
const bashExecutorTool: Tool = {
  name: 'bash_executor',
  description: 'Execute a shell command in the workspace',

  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to run' }
    },
    required: ['command']
  },

  async execute({ command }) {
    // Execute in Docker sandbox
    const container = await getSessionContainer(sessionId);
    const result = await container.exec(command);

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
      duration: result.duration
    };
  },

  requiresConfirmation: true,  // Ask user first!
  timeout: 60000
};
```

---

## Infrastructure Layer

### Docker Sandbox

**What It Solves**:
- Running untrusted code is dangerous
- Need isolation from host system
- Need resource limits

**How Docker Helps**:
```
Host Machine
└── Docker Container (Sandbox)
    ├── Isolated filesystem
    ├── No network access
    ├── Limited RAM (512MB)
    ├── Limited CPU (1 core)
    └── Workspace directory mounted
```

**Creating a Sandbox**:
```typescript
async function createSandbox(sessionId: string) {
  const container = await docker.createContainer({
    Image: 'python:3.11-slim',
    WorkingDir: '/workspace',

    HostConfig: {
      Memory: 512 * 1024 * 1024,  // 512MB
      CpuQuota: 100000,            // 1 CPU
      NetworkMode: 'none',         // No internet

      // Mount session workspace
      Binds: [`/tmp/workspaces/${sessionId}:/workspace`]
    }
  });

  await container.start();
  return container;
}
```

**Executing Code**:
```typescript
async function executeInSandbox(sessionId: string, code: string) {
  const container = getContainer(sessionId);

  // Write code to file
  await container.putArchive(code, '/workspace/script.py');

  // Execute
  const exec = await container.exec({
    Cmd: ['python', '/workspace/script.py'],
    AttachStdout: true,
    AttachStderr: true
  });

  // Stream output
  const stream = await exec.start({ Detach: false });

  stream.on('data', (chunk) => {
    // Send to frontend via SSE
    sendSSE('tool.progress', { output: chunk.toString() });
  });
}
```

---

## How Everything Connects: Complete Flow

**Scenario**: User asks "List all TypeScript files"

### Step-by-Step Flow

**1. Frontend (User Types Message)**
```
User types: "List all TypeScript files"
    ↓
React state updates: { inputValue: "List all..." }
    ↓
User presses Enter
    ↓
handleSendMessage() is called
```

**2. Frontend → Backend (API Call)**
```typescript
// Frontend
const response = await fetch('/api/sessions/123/messages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    content: 'List all TypeScript files'
  })
});
```

**3. Backend Receives Request**
```
Request arrives at Hono server
    ↓
Logging middleware: Log the request
    ↓
Auth middleware: Verify JWT token → userId: "user-abc"
    ↓
Route handler: POST /api/sessions/:sessionId/messages
```

**4. Backend Saves to Database**
```typescript
// Save user message
const message = await prisma.message.create({
  data: {
    sessionId: '123',
    role: 'user',
    content: 'List all TypeScript files'
  }
});

// Get conversation history
const history = await prisma.message.findMany({
  where: { sessionId: '123' },
  orderBy: { createdAt: 'asc' }
});
```

**5. Backend → AI (LLM Call)**
```typescript
// Format for LLM
const messages = [
  {
    role: 'system',
    content: 'You are an AI assistant that can use tools...'
  },
  ...history.map(msg => ({
    role: msg.role,
    content: msg.content
  }))
];

// Include tool descriptions
const tools = toolRegistry.toOpenAIFormat();

// Call LLM with streaming
const stream = await llmClient.streamChat(messages, tools);
```

**6. AI Thinks and Decides to Use Tool**
```
LLM receives: "List all TypeScript files"
LLM thinks: "I need to run a bash command to find .ts files"
LLM responds with tool call:

{
  tool_calls: [{
    id: "call_abc",
    function: {
      name: "bash_executor",
      arguments: '{"command": "find . -name \'*.ts\'"}'
    }
  }]
}
```

**7. Backend Executes Tool**
```typescript
// Parse tool call
const toolCall = response.choices[0].message.tool_calls[0];

// Execute
const result = await toolExecutor.execute(
  'bash_executor',
  { command: "find . -name '*.ts'" }
);

// result = {
//   success: true,
//   output: "./src/index.ts\n./src/App.tsx\n...",
//   duration: 150
// }

// Save to database
await prisma.toolCall.create({
  data: {
    sessionId: '123',
    messageId: message.id,
    toolName: 'bash_executor',
    parameters: { command: "find . -name '*.ts'" },
    result
  }
});
```

**8. Backend → AI (Send Tool Result)**
```typescript
// Add tool result to conversation
messages.push({
  role: 'assistant',
  tool_calls: [toolCall]
});

messages.push({
  role: 'tool',
  tool_call_id: 'call_abc',
  content: JSON.stringify(result)
});

// Ask LLM to continue
const finalStream = await llmClient.streamChat(messages, tools);
```

**9. AI Generates Final Response**
```
LLM receives tool result
LLM thinks: "Now I can give a helpful answer"
LLM streams response:

"I found 15 TypeScript files in your project:

- src/index.ts
- src/App.tsx
- src/components/Header.tsx
..."
```

**10. Backend Streams to Frontend (SSE)**
```typescript
// Open SSE connection
const stream = streamSSE(c);

// Send events
stream.writeSSE('message.start', { messageId: 'msg-123' });
stream.writeSSE('tool.start', {
  toolName: 'bash_executor',
  params: { command: "find . -name '*.ts'" }
});
stream.writeSSE('tool.complete', {
  success: true,
  output: './src/index.ts\n...'
});
stream.writeSSE('message.delta', { content: 'I found 15 ' });
stream.writeSSE('message.delta', { content: 'TypeScript files' });
stream.writeSSE('message.complete', { messageId: 'msg-123' });
```

**11. Frontend Receives Events (SSE)**
```typescript
// Frontend listening
eventSource.addEventListener('message.delta', (event) => {
  const { content } = JSON.parse(event.data);

  // Update React state
  setMessages(prev => {
    const last = prev[prev.length - 1];
    return [
      ...prev.slice(0, -1),
      { ...last, content: last.content + content }
    ];
  });
});

// React re-renders → User sees new text appear
```

**12. User Sees Result**
```
Chat interface updates in real-time:
User: "List all TypeScript files"

[Running bash_executor: find . -name '*.ts']
[Completed in 150ms]
Assistant: "I found 15 TypeScript files in your project:

- src/index.ts
- src/App.tsx
- src/components/Header.tsx
- ...
"
```

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   React Frontend                         │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │   │
│  │  │   Chat   │  │ Sessions │  │ Progress │              │   │
│  │  │Interface │  │ Sidebar  │  │  Panel   │              │   │
│  │  └────┬─────┘  └──────────┘  └──────────┘              │   │
│  │       │                                                  │   │
│  │       │ Zustand Store (sessionId, messages, etc.)       │   │
│  │       │                                                  │   │
│  └───────┼──────────────────────────────────────────────────┘   │
└───────────┼──────────────────────────────────────────────────────┘
            │
            │ HTTP / SSE
            ↓
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND SERVER (Bun)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Hono Framework                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │Auth Middleware│ │Rate Limiting │ │   Logging    │  │   │
│  │  └──────┬───────┘  └──────────────┘  └──────────────┘  │   │
│  │         │                                               │   │
│  │  ┌──────▼────────────────────────────────────────────┐ │   │
│  │  │              API Routes                           │ │   │
│  │  │  /auth  /sessions  /messages  /stream  /files    │ │   │
│  │  └──────┬────────────────────────────────────────────┘ │   │
│  └─────────┼──────────────────────────────────────────────┘   │
│            │                                                   │
│  ┌─────────┼───────────────────────────────────────────────┐  │
│  │         ↓        Services Layer                         │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │  │
│  │  │   LLM    │  │   Tool   │  │  Config  │             │  │
│  │  │  Client  │  │ Executor │  │  Loader  │             │  │
│  │  └────┬─────┘  └────┬─────┘  └──────────┘             │  │
│  │       │             │                                   │  │
│  │       │             │  ┌──────────┐                    │  │
│  │       │             └──► Tool     │                    │  │
│  │       │                │ Registry │                    │  │
│  │       │                └──────────┘                    │  │
│  └───────┼──────────────────────────────────────────────────┘  │
└───────────┼──────────────────────────────────────────────────────┘
            │
            │
   ┌────────┼────────┬───────────────┬──────────────────┐
   │        │        │               │                  │
   ↓        ↓        ↓               ↓                  ↓
┌──────┐ ┌────┐  ┌─────┐     ┌──────────┐      ┌──────────┐
│ LLM  │ │ DB │  │Redis│     │  Docker  │      │  BullMQ  │
│ API  │ │PgSQL│ │Cache│     │ Sandbox  │      │  Worker  │
└──────┘ └────┘  └─────┘     └──────────┘      └──────────┘
```

---

## Key Architectural Patterns

### 1. Separation of Concerns

**Frontend**: Presentation and user interaction
**Backend**: Business logic and coordination
**AI Layer**: Intelligence and decision-making
**Infrastructure**: Data persistence and execution environment

### 2. Event-Driven Architecture

Messages flow through the system as events:
- User input events
- LLM response events
- Tool execution events
- Progress update events

### 3. Streaming-First Design

Real-time updates throughout:
- LLM responses stream word-by-word
- Tool output streams line-by-line
- Progress updates stream in real-time

### 4. Isolated Execution

Each session gets:
- Own workspace directory
- Own Docker container
- Own conversation context
- Own SSE connection

---

## Understanding Data Flow

### Data States

**1. Temporary (In-Memory)**
- Current streaming response
- Active SSE connections
- Tool execution state

**2. Fast Cache (Redis)**
- Session state
- Rate limit counters
- Job queues

**3. Permanent Storage (PostgreSQL)**
- User accounts
- Conversation history
- Tool call results
- File metadata

### When to Use Each

**Use Memory**: Streaming data, temporary calculations
**Use Redis**: Frequently accessed, can be regenerated
**Use PostgreSQL**: Must never lose, need complex queries

---

## Security Architecture

### Defense in Depth

**Layer 1: Frontend Validation**
```
User input → Basic validation (length, format)
```

**Layer 2: Network Security**
```
HTTPS → Authentication (JWT) → Authorization
```

**Layer 3: Backend Validation**
```
Zod schemas → Type checking → Business rules
```

**Layer 4: Sandbox Isolation**
```
Docker container → No network → Resource limits
```

**Layer 5: Database Security**
```
Prepared statements → Row-level security → Encryption at rest
```

---

## Performance Considerations

### Frontend Optimization

**Code Splitting**
```
Only load components when needed
Chat page loads separately from settings
```

**Virtual Scrolling**
```
Only render visible messages
Handles 10,000+ messages smoothly
```

**Debouncing**
```
User types → Wait 300ms → Then process
Prevents excessive API calls
```

### Backend Optimization

**Connection Pooling**
```
Reuse database connections
Don't create new connection per request
```

**Caching Strategy**
```
1. Check Redis
2. If miss, query PostgreSQL
3. Store in Redis for next time
```

**Async Processing**
```
Long operations → Background job queue
Return immediately to user
```

---

## Scalability Considerations

### Current Architecture (Single Server)
```
1 server can handle:
- ~100 concurrent users
- ~1,000 messages/minute
- ~10 active tool executions
```

### Horizontal Scaling (Multiple Servers)
```
Load Balancer
    ↓
Server 1 ─┐
Server 2 ─┼─→ Shared PostgreSQL
Server 3 ─┘   Shared Redis
```

**What needs to change**:
- Session affinity (sticky sessions)
- Shared file storage (S3 instead of local disk)
- Distributed job queue

---

## Development Mental Model

### Think of the System as a Restaurant

**Frontend (Dining Room)**
- Customers (users) place orders
- See their food being prepared
- Beautiful presentation

**Backend (Kitchen Manager)**
- Receives orders
- Coordinates chefs (services)
- Ensures quality
- Handles payments (auth)

**AI Layer (Head Chef)**
- Reads recipe (prompt)
- Decides what ingredients (tools) to use
- Creates the dish (response)

**Tools (Sous Chefs)**
- Each specializes in one thing
- File reader chef
- Bash executor chef
- Web scraper chef

**Database (Pantry)**
- Stores ingredients (data)
- Permanent storage
- Organized by type

**Redis (Counter Top)**
- Quick access
- Temporary workspace
- Fast operations

**Docker (Prep Station)**
- Isolated workspace
- Can't contaminate other dishes
- Controlled environment

---

## Common Patterns You'll See

### 1. Async/Await Pattern

```typescript
// Bad: Blocking
const data = fetchData();        // Wait here
const processed = process(data); // Wait here
return processed;

// Good: Non-blocking
const data = await fetchData();        // Wait, but release thread
const processed = await process(data); // Wait, but release thread
return processed;
```

### 2. Middleware Pattern

```typescript
Request
  → Middleware 1 (logging)
  → Middleware 2 (auth)
  → Route handler
  → Response
```

### 3. Repository Pattern

```typescript
// Don't spread database calls everywhere
const user = await prisma.user.findUnique(...);

// Create a repository
class UserRepository {
  async findById(id: string) {
    return await prisma.user.findUnique({ where: { id } });
  }
}

// Use it
const user = await userRepo.findById(id);
```

### 4. Service Pattern

```typescript
// Don't put logic in routes
app.post('/sessions', async (c) => {
  // 100 lines of logic here ❌
});

// Extract to service
class SessionService {
  async create(userId: string) {
    // 100 lines of logic here ✓
  }
}

app.post('/sessions', async (c) => {
  return await sessionService.create(userId);
});
```

---

## Next Steps for Learning

### Week 1-2: Understand the Flow
1. Read this document thoroughly
2. Trace a request through the system
3. Identify each layer's responsibility
4. Draw your own diagrams

### Week 3-4: Frontend Deep Dive
1. Learn React fundamentals
2. Understand state management (Zustand)
3. Practice with SSE
4. Build simple chat interface

### Week 5-6: Backend Deep Dive
1. Learn Hono routing
2. Understand Prisma ORM
3. Practice with authentication
4. Build simple API

### Week 7-8: AI Integration
1. Understand LLM concepts
2. Learn function calling
3. Build simple tools
4. Practice streaming

### Week 9-10: Full Integration
1. Connect frontend to backend
2. Add real-time updates
3. Implement tool execution
4. Test end-to-end

---

## Resources

### Understanding Core Concepts
- [How the Web Works](https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/How_the_Web_works)
- [What is an API?](https://www.redhat.com/en/topics/api/what-are-application-programming-interfaces)
- [Client-Server Architecture](https://en.wikipedia.org/wiki/Client%E2%80%93server_model)

### Frontend
- [React Documentation](https://react.dev/learn)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Zustand Guide](https://docs.pmnd.rs/zustand/getting-started/introduction)

### Backend
- [Hono Documentation](https://hono.dev/)
- [Prisma Guides](https://www.prisma.io/docs)
- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/)

### AI/LLM
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [Prompt Engineering Guide](https://www.promptingguide.ai/)
- [Understanding Tokens](https://platform.openai.com/tokenizer)

---

## Conclusion

You now understand:
- ✅ The three main layers (Frontend, Backend, AI)
- ✅ What problem each technology solves
- ✅ How different parts connect
- ✅ Complete data flow through the system
- ✅ Key architectural patterns
- ✅ Security and scalability considerations

**Remember**: 
- Start with concepts, not code
- Understand the "why" before the "how"
- Draw diagrams to visualize
- Trace requests through the system
- Build your mental model gradually

**You're ready to dive into the codebase!**

