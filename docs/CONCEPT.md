# Mark Agent Concepts for Beginners

This guide explains all the technical terms, concepts, and architecture used in Mark Agent. It's designed for new coders who want to understand the project quickly.

---

## Table of Contents

1. [What is Mark Agent?](#what-is-mark-agent)
2. [Core Concepts](#core-concepts)
3. [Tech Stack Explained](#tech-stack-explained)
4. [Project Architecture](#project-architecture)
5. [Key Systems](#key-systems)
6. [Development Workflow](#development-workflow)
7. [Common Terms Glossary](#common-terms-glossary)

---

## What is Mark Agent?

**Mark Agent** is an AI-powered autonomous agent that can execute complex tasks through natural language. Think of it as an AI assistant that can:
- Write and execute code
- Use tools (read files, run commands, search the web)
- Break down complex tasks into steps
- Learn from context and adapt

**Example**: You tell it "Create a REST API for user management" and it will:
1. Plan the architecture
2. Write the code
3. Create tests
4. Show you the results

---

## Core Concepts

### 1. Agent

**What it is**: An AI program that can make decisions and take actions autonomously.

**How it works**:
- Receives your request in natural language
- Thinks about how to solve it (reasoning)
- Uses tools to accomplish the task
- Reports back with results

**Analogy**: Like a smart assistant that can use your computer to get work done.

### 2. LLM (Large Language Model)

**What it is**: The AI brain that understands and generates text.

**In Mark Agent**:
- Model used: GLM-4.7
- Purpose: Understands your requests and decides what to do
- How it works: Converts text into actions

**Analogy**: Like the thinking part of the agent's brain.

### 3. Tools

**What they are**: Specific actions the agent can perform.

**Built-in tools in Mark Agent**:
- `file_reader` - Reads file contents
- `file_writer` - Creates or modifies files
- `bash_executor` - Runs shell commands

**Analogy**: Like apps on your phone - each does one specific thing well.

### 4. Sessions

**What it is**: A conversation thread between you and the agent.

**Properties**:
- Each session has its own workspace (isolated files)
- Maintains conversation history
- Can be resumed later

**Analogy**: Like a chat conversation in messaging apps - each one is separate.

### 5. Streaming

**What it is**: Real-time delivery of responses as they're generated.

**How it works**:
- Agent starts responding immediately
- You see words appear as they're created
- Progress updates show what's happening

**Analogy**: Like watching a video as it downloads, rather than waiting for the full download.

### 6. Sandbox

**What it is**: An isolated, safe environment where code runs.

**Why it's important**:
- Prevents dangerous operations from affecting your system
- Limits resources (memory, CPU)
- Each session has its own sandbox

**Analogy**: Like a virtual computer inside your computer that can't access your real files.

---

## Tech Stack Explained

### Frontend Technologies

#### React
**What**: A JavaScript library for building user interfaces.
**Purpose**: Creates the web page you interact with.
**Example**: The chat interface, buttons, message display.

#### TypeScript
**What**: JavaScript with type checking.
**Purpose**: Catches errors before code runs.
**Example**:
```typescript
// TypeScript - knows name must be a string
function greet(name: string) {
  return `Hello, ${name}`;
}

// JavaScript - no type checking
function greet(name) {
  return `Hello, ${name}`;
}
```

#### Vite
**What**: A build tool that makes development fast.
**Purpose**: Bundles your code and runs a development server.
**Speed**: Instant hot reload when you change files.

#### Tailwind CSS
**What**: A utility-first CSS framework.
**Purpose**: Style components without writing custom CSS.
**Example**: `<div className="text-blue-500 p-4 rounded">` creates a styled div.

#### shadcn/ui
**What**: Pre-built, customizable React components.
**Purpose**: Beautiful UI components ready to use.
**Example**: Buttons, dialogs, dropdowns already designed.

#### Zustand
**What**: State management library.
**Purpose**: Shares data between React components.
**Example**: Current session ID available to all components.

### Backend Technologies

#### Bun
**What**: A fast JavaScript runtime (alternative to Node.js).
**Purpose**: Runs the backend server.
**Speed**: 3x faster than Node.js for many tasks.

#### Hono
**What**: A lightweight web framework.
**Purpose**: Handles HTTP requests and routing.
**Example**: Defines what happens when you visit `/api/sessions`.

#### Prisma
**What**: Database ORM (Object-Relational Mapping).
**Purpose**: Interact with PostgreSQL using TypeScript code.
**Example**:
```typescript
// Instead of SQL
await prisma.user.create({ data: { email: 'test@example.com' } });

// Rather than
await db.query('INSERT INTO users (email) VALUES ($1)', ['test@example.com']);
```

#### PostgreSQL
**What**: A relational database.
**Purpose**: Stores all data (users, sessions, messages).
**Structure**: Tables with rows and columns (like Excel spreadsheets).

#### Redis
**What**: An in-memory data store.
**Purpose**: Fast caching and session storage.
**Speed**: 100x faster than database for simple operations.

#### BullMQ
**What**: Job queue system.
**Purpose**: Handles background tasks.
**Example**: Long-running code execution runs in background.

### AI/LLM Layer

#### OpenAI API
**What**: Standard API format for language models.
**Purpose**: Communicate with LLM providers.
**Why**: Most LLM providers support this format.

#### GLM-4.7
**What**: The specific language model used.
**Provider**: jiekou.ai
**Features**: Streaming, function calling, 128K token context.

#### Function Calling (Tool Calling)
**What**: LLM can request to use tools.
**How it works**:
1. LLM decides it needs to read a file
2. Sends tool call request: `{"name": "file_reader", "params": {"path": "app.ts"}}`
3. Backend executes the tool
4. Returns result to LLM
5. LLM uses result to continue

#### Tiktoken
**What**: Token counter for LLMs.
**Purpose**: Manages context window (how much text fits in memory).
**Why**: LLMs have limits (e.g., 128K tokens = ~96K words).

---

## Project Architecture

### Monorepo Structure

**What is a monorepo?**
Multiple related projects in one repository.

**Mark Agent structure**:
```
mark-agent/
├── apps/
│   ├── web/          # Frontend React app
│   └── api/          # Backend server
├── packages/
│   └── shared/       # Code used by both frontend and backend
└── skills/           # Agent capabilities (slash commands)
```

**Benefits**:
- Share code easily
- Single source of truth
- Deploy together

### Request Flow

**User sends message** → **Frontend** → **Backend API** → **LLM** → **Tools** → **Response**

**Detailed flow**:
1. User types in chat interface (Frontend)
2. POST request to `/api/sessions/:id/messages` (Backend)
3. Backend formats prompt and calls LLM
4. LLM responds with text or tool calls
5. If tool calls, backend executes them
6. Results streamed back via SSE (Server-Sent Events)
7. Frontend displays in real-time

### Database Schema

**Users Table**
- Stores user accounts
- Fields: id, email, password_hash

**Sessions Table**
- One session = one conversation
- Fields: id, user_id, name, workspace_path

**Messages Table**
- Chat history
- Fields: id, session_id, role (user/assistant), content

**ToolCalls Table**
- History of tool executions
- Fields: id, tool_name, parameters, result, status

---

## Key Systems

### 1. Authentication System

**Purpose**: Secure user login and session management.

**How it works**:
1. User registers with email/password
2. Password hashed with bcrypt (one-way encryption)
3. Login returns JWT tokens (access + refresh)
4. Access token used for API requests (expires 15min)
5. Refresh token gets new access token (expires 7 days)

**JWT (JSON Web Token)**:
- A secure token that proves identity
- Format: `header.payload.signature`
- Can't be forged without secret key

### 2. LLM Integration

**Components**:

**LLMClient**:
- Connects to OpenAI-compatible API
- Sends messages and receives responses
- Supports streaming

**Token Counter**:
- Counts tokens in messages
- Truncates old messages to fit context window
- Ensures we don't exceed limits

**Streaming**:
- Receives response word-by-word
- Shows progress in real-time

### 3. Tool System

**Architecture**:

**Tool Definition**:
```typescript
{
  name: 'file_reader',
  description: 'Reads file contents',
  inputSchema: { /* what parameters it needs */ },
  execute: async (params) => { /* the actual code */ },
  requiresConfirmation: false,
  timeout: 5000
}
```

**Tool Registry**:
- Central place that knows all tools
- Converts tools to OpenAI function format
- Looks up tools by name

**Tool Executor**:
- Runs tools safely
- Validates parameters
- Handles timeouts and errors
- Saves results to database

### 4. SSE (Server-Sent Events)

**What it is**: One-way real-time communication from server to client.

**How it works**:
1. Frontend opens connection: `GET /api/sessions/:id/stream`
2. Backend keeps connection open
3. Backend sends events as they happen
4. Frontend receives and displays

**Event types**:
- `message.delta` - New text chunk
- `tool.start` - Tool execution began
- `tool.complete` - Tool finished
- `error` - Something went wrong

**Why not WebSocket?**
- SSE is simpler for one-way communication
- Automatic reconnection
- Works through proxies better

### 5. Sandbox System

**Purpose**: Run untrusted code safely.

**Technology**: Docker containers

**Security features**:
- Network disabled (can't access internet)
- Resource limits (512MB RAM, 1 CPU)
- Isolated filesystem
- Timeout enforcement (max 5 minutes)

**Workflow**:
1. Create container for session
2. Mount workspace directory
3. Execute code inside container
4. Stream output back
5. Destroy container when done

---

## Development Workflow

### Phase 1: Foundation (Completed)
- Set up project structure
- Install dependencies
- Start databases (PostgreSQL, Redis)
- Run migrations
- Verify servers start

### Phase 2: Core Backend (Completed)
- Authentication (register/login)
- Session management (CRUD operations)
- Message storage
- Basic API endpoints

### Phase 3: LLM Integration (Completed)
- Connect to GLM-4.7 API
- Implement streaming
- Token counting
- Context management

### Phase 4: Tool System (Completed)
- Build tool registry
- Create 3 basic tools
- Implement function calling
- Tool execution with streaming

### Phase 5: Frontend (Current)
- Chat interface
- Real-time updates with SSE
- Session management UI
- Progress display

### Phase 6: Advanced Features (Pending)
- MCP integration
- Docker sandbox
- File upload/download
- Skills system

---

## Common Terms Glossary

### A

**API (Application Programming Interface)**
- A way for programs to talk to each other
- Example: Frontend talks to backend via REST API

**AsyncGenerator**
- A function that yields values over time
- Used for streaming responses

**Authentication**
- Proving who you are (login)

**Authorization**
- Proving what you can do (permissions)

### B

**bcrypt**
- Password hashing algorithm
- One-way encryption (can't be reversed)

**Backend**
- Server-side code
- Processes requests, stores data

**BullMQ**
- Job queue for background tasks

### C

**CORS (Cross-Origin Resource Sharing)**
- Security feature in browsers
- Controls which websites can call your API

**CRUD (Create, Read, Update, Delete)**
- Basic database operations

**Context Window**
- How much text an LLM can "remember"
- GLM-4.7: 128K tokens (~96K words)

### D

**Docker**
- Creates isolated containers for running code
- Like lightweight virtual machines

**Docker Compose**
- Tool to manage multiple Docker containers
- Example: Start database + redis together

### E

**Environment Variables**
- Configuration stored outside code
- Example: `LLM_API_KEY`, `DATABASE_URL`

**ENV file (.env)**
- File storing environment variables
- Never commit to git (contains secrets)

### F

**Frontend**
- User interface code
- Runs in web browser

**Function Calling**
- LLM requesting to use a tool
- Also called "tool calling"

### H

**Hono**
- Fast web framework for backend
- Handles routing and middleware

**HTTP (Hypertext Transfer Protocol)**
- How browsers talk to servers
- Methods: GET, POST, PATCH, DELETE

### J

**JWT (JSON Web Token)**
- Secure token for authentication
- Contains user info + signature

**JSON (JavaScript Object Notation)**
- Data format for sending information
- Example: `{"name": "Alice", "age": 30}`

### L

**LLM (Large Language Model)**
- AI that understands and generates text
- Examples: GPT-4, GLM-4.7

### M

**Middleware**
- Code that runs before route handlers
- Example: Check if user is logged in

**Migration**
- Database schema change script
- Example: Add new table or column

**Monorepo**
- Multiple projects in one repository

### O

**ORM (Object-Relational Mapping)**
- Write database queries using code instead of SQL
- Example: Prisma

### P

**Prisma**
- ORM for TypeScript
- Type-safe database access

**PostgreSQL**
- Relational database
- Stores structured data in tables

### R

**Redis**
- In-memory data store
- Very fast, used for caching

**REST API**
- Standard way to design web APIs
- Uses HTTP methods + URLs

**Runtime**
- Environment where code executes
- Examples: Bun, Node.js, Browser

### S

**Sandbox**
- Isolated environment for running code safely

**Schema**
- Structure of database tables
- Defined in `prisma/schema.prisma`

**Session**
- Conversation thread with agent
- Each has isolated workspace

**SSE (Server-Sent Events)**
- Real-time updates from server to client
- One-way communication

**Streaming**
- Sending data in chunks as it's ready
- Enables real-time responses

### T

**Token**
- Small unit of text for LLMs
- ~0.75 words = 1 token

**Tool**
- Action the agent can perform
- Examples: read file, run command

**TypeScript**
- JavaScript with type checking
- Catches errors early

**Turborepo**
- Tool for managing monorepos
- Caches builds, runs tasks in parallel

### V

**Vite**
- Fast build tool for frontend
- Hot reload during development

### W

**Workspace**
- Isolated directory for each session
- Contains files user/agent create

**WebSocket**
- Two-way real-time communication
- Not used in Mark Agent (we use SSE)

### Z

**Zod**
- Runtime validation library
- Ensures data has correct shape

**Zustand**
- Simple state management for React
- Alternative to Redux

---

## Understanding the Tech Stack

### Why These Technologies?

**Bun over Node.js**
- 3x faster startup
- Built-in TypeScript support
- Better developer experience

**Hono over Express**
- Lightweight (50KB vs 200KB)
- Edge-compatible
- Faster routing

**Prisma over raw SQL**
- Type safety
- Auto-generated types
- Easy migrations

**PostgreSQL over MongoDB**
- Strong consistency
- Relations between data
- Complex queries

**Redis for caching**
- In-memory = super fast
- Simple data structures
- Session storage

**Zustand over Redux**
- Simpler API
- Less boilerplate
- Good TypeScript support

---

## How Everything Connects

### Example: Sending a Message

**1. Frontend (React)**
```typescript
// User types message and clicks send
const sendMessage = async (content: string) => {
  const response = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({ content })
  });
};
```

**2. Backend Route (Hono)**
```typescript
// Receives request at POST /api/sessions/:id/messages
app.post('/api/sessions/:sessionId/messages', authMiddleware, async (c) => {
  const { content } = await c.req.json();
  const userId = c.get('userId');

  // Save message to database
  const message = await prisma.message.create({
    data: {
      sessionId,
      role: 'user',
      content
    }
  });

  // Get conversation history
  const history = await prisma.message.findMany({
    where: { sessionId }
  });

  // Call LLM
  const llmResponse = await llmClient.streamChat(history);

  // Stream response back
  return c.stream(/* ... */);
});
```

**3. LLM Service**
```typescript
// Calls GLM-4.7 API
async streamChat(messages: Message[]): AsyncGenerator<string> {
  const stream = await openai.chat.completions.create({
    model: 'zai-org/glm-4.7',
    messages,
    stream: true,
    tools: toolRegistry.getTools()
  });

  for await (const chunk of stream) {
    if (chunk.choices[0]?.delta?.content) {
      yield chunk.choices[0].delta.content;
    }
  }
}
```

**4. Frontend Updates (SSE)**
```typescript
// Listens for real-time updates
const eventSource = new EventSource(`/api/sessions/${sessionId}/stream`);

eventSource.addEventListener('message.delta', (event) => {
  const { content } = JSON.parse(event.data);
  // Append to UI
  appendToMessage(content);
});
```

---

## Quick Start for Beginners

### Step 1: Understand the Flow
1. User types message
2. Frontend sends to backend
3. Backend saves to database
4. Backend asks LLM what to do
5. LLM responds (maybe calls tools)
6. Response streamed back
7. Frontend displays in real-time

### Step 2: Key Files to Know
- `apps/api/src/index.ts` - Backend entry point
- `apps/api/src/routes/` - API endpoints
- `apps/api/src/services/llm.ts` - LLM client
- `apps/web/src/App.tsx` - Frontend entry
- `packages/shared/src/types/` - Shared types

### Step 3: Development Commands
```bash
# Start everything
bun run dev

# Just backend
bun run dev:api

# Just frontend
bun run dev:web

# Database UI
bun run db:studio
```

### Step 4: Making Changes

**Add a new API endpoint**:
1. Create file in `apps/api/src/routes/`
2. Export route handler
3. Register in `apps/api/src/index.ts`

**Add a new tool**:
1. Create file in `apps/api/src/services/tools/`
2. Export Tool object
3. Register in tool registry

**Add a React component**:
1. Create file in `apps/web/src/components/`
2. Export component
3. Import and use in another component

---

## Learning Path

### Week 1: Basics
- [ ] Understand TypeScript basics
- [ ] Learn React fundamentals
- [ ] Understand REST APIs
- [ ] Read through PROGRESS.md

### Week 2: Backend
- [ ] Explore Hono routing
- [ ] Learn Prisma basics
- [ ] Understand JWT authentication
- [ ] Try creating simple endpoint

### Week 3: Frontend
- [ ] React hooks (useState, useEffect)
- [ ] Zustand state management
- [ ] SSE event handling
- [ ] Build simple component

### Week 4: Integration
- [ ] Understand LLM client
- [ ] Learn tool system
- [ ] Explore streaming
- [ ] Connect frontend to backend

### Week 5: Advanced
- [ ] Docker and sandbox
- [ ] Background jobs (BullMQ)
- [ ] Security best practices
- [ ] Performance optimization

---

## Resources for Learning

### TypeScript
- [Official Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- Focus on: types, interfaces, async/await

### React
- [Official Tutorial](https://react.dev/learn)
- Focus on: components, hooks, state

### Backend Development
- [REST API Tutorial](https://restfulapi.net/)
- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/)

### Tools We Use
- [Prisma Docs](https://www.prisma.io/docs)
- [Hono Guide](https://hono.dev/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)

---

## Common Beginner Questions

### Q: What's the difference between frontend and backend?
**A**: Frontend = what you see (browser). Backend = processes data (server).

### Q: Why do we need both PostgreSQL and Redis?
**A**: PostgreSQL for permanent storage. Redis for fast, temporary data (caching).

### Q: What is streaming and why use it?
**A**: Sending data as it's ready. Makes UI feel faster - see responses immediately.

### Q: How does the agent know what tools to use?
**A**: The LLM decides based on your request and available tool descriptions.

### Q: What's a token in LLM context?
**A**: A piece of text (~0.75 words). LLMs process text as tokens, not words.

### Q: Why TypeScript instead of JavaScript?
**A**: Catches errors before runtime. Better IDE support. Self-documenting code.

### Q: What's the purpose of the sandbox?
**A**: Run untrusted code safely without affecting your real system.

### Q: How do sessions work?
**A**: Each conversation is a session. Maintains history and isolated workspace.

---

## Next Steps

1. Read through this guide thoroughly
2. Explore the codebase structure
3. Try running the project locally
4. Make a small change and see it work
5. Read PROGRESS.md to see current status
6. Check CLAUDE.md for development guidelines

**Remember**: Start small, ask questions, and learn by doing!
