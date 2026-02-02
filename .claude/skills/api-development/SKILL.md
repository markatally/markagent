---
name: api-development
description: Guide for developing REST APIs with Hono, TypeScript, Prisma, and Zod in the Mark Agent backend. Use when creating endpoints, implementing authentication, handling validation, or working with the database.
---

# API Development

This skill provides guidance for developing backend APIs in the Mark Agent.

## Tech Stack

- **Framework**: Hono (fast, lightweight, TypeScript-first)
- **Validation**: Zod (runtime type checking)
- **Database**: Prisma ORM (PostgreSQL)
- **Authentication**: JWT (jsonwebtoken)
- **Queue**: BullMQ (Redis-backed)

## Project Structure

```
apps/api/src/
├── index.ts              # Entry point, app setup
├── routes/               # API route handlers
│   ├── auth.ts
│   ├── sessions.ts
│   ├── messages.ts
│   └── files.ts
├── services/             # Business logic
│   ├── llm/
│   ├── tools/
│   ├── sandbox/
│   └── mcp/
├── middleware/           # Custom middleware
│   ├── auth.ts
│   ├── rateLimit.ts
│   └── errorHandler.ts
├── lib/                  # Shared utilities
│   ├── prisma.ts
│   ├── redis.ts
│   └── logger.ts
└── types/                # TypeScript types
```

## Creating API Endpoints

### Basic Route Pattern

```typescript
// apps/api/src/routes/sessions.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';

// Validation schemas
const createSessionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

const sessionParamsSchema = z.object({
  id: z.string().uuid(),
});

// Create router
export const sessionsRoute = new Hono()
  // Apply auth middleware to all routes
  .use('/*', authMiddleware)

  // GET /sessions - List user's sessions
  .get('/', async (c) => {
    const userId = c.get('userId');

    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
      take: 20,
    });

    return c.json({ sessions });
  })

  // POST /sessions - Create new session
  .post('/', zValidator('json', createSessionSchema), async (c) => {
    const userId = c.get('userId');
    const { name } = c.req.valid('json');

    const session = await prisma.session.create({
      data: {
        userId,
        name: name || `Session ${Date.now()}`,
        workspacePath: `/workspaces/${crypto.randomUUID()}`,
      },
    });

    return c.json(session, 201);
  })

  // GET /sessions/:id - Get session details
  .get('/:id', zValidator('param', sessionParamsSchema), async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    const session = await prisma.session.findFirst({
      where: { id, userId },
      include: { messages: { take: 50, orderBy: { createdAt: 'desc' } } },
    });

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json(session);
  })

  // DELETE /sessions/:id - Delete session
  .delete('/:id', zValidator('param', sessionParamsSchema), async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    await prisma.session.deleteMany({
      where: { id, userId },
    });

    return c.json({ success: true });
  });
```

### Register Routes

```typescript
// apps/api/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { sessionsRoute } from './routes/sessions';
import { authRoute } from './routes/auth';
import { errorHandler } from './middleware/errorHandler';

const app = new Hono()
  // Global middleware
  .use('*', logger())
  .use('*', cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  }))
  .onError(errorHandler)

  // Health check
  .get('/api/health', (c) => c.json({ status: 'ok' }))

  // Routes
  .route('/api/auth', authRoute)
  .route('/api/sessions', sessionsRoute);

export default app;
```

## Authentication

### JWT Middleware

```typescript
// apps/api/src/middleware/auth.ts
import { Context, Next } from 'hono';
import { verify } from 'jsonwebtoken';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = verify(token, process.env.JWT_SECRET!) as {
      sub: string;
      email: string;
      type: string;
    };

    if (payload.type !== 'access') {
      return c.json({ error: 'Invalid token type' }, 401);
    }

    // Set user context
    c.set('userId', payload.sub);
    c.set('email', payload.email);

    await next();
  } catch (error) {
    return c.json({ error: 'Invalid token' }, 401);
  }
}
```

### Auth Routes

```typescript
// apps/api/src/routes/auth.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { hash, compare } from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const authRoute = new Hono()
  .post('/register', zValidator('json', registerSchema), async (c) => {
    const { email, password } = c.req.valid('json');

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return c.json({ error: 'Email already registered' }, 400);
    }

    const passwordHash = await hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash },
    });

    const tokens = generateTokens(user);
    return c.json(tokens, 201);
  })

  .post('/login', zValidator('json', loginSchema), async (c) => {
    const { email, password } = c.req.valid('json');

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const valid = await compare(password, user.passwordHash);
    if (!valid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const tokens = generateTokens(user);
    return c.json(tokens);
  })

  .post('/refresh', async (c) => {
    // Refresh token logic
  });

function generateTokens(user: { id: string; email: string }) {
  const accessToken = sign(
    { sub: user.id, email: user.email, type: 'access' },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );

  const refreshToken = sign(
    { sub: user.id, type: 'refresh' },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
}
```

## Server-Sent Events (SSE)

```typescript
// apps/api/src/routes/sessions.ts
import { streamSSE } from 'hono/streaming';
import { EventEmitter } from 'events';

// Session event emitters
const sessionEmitters = new Map<string, EventEmitter>();

export const sessionsRoute = new Hono()
  // SSE endpoint
  .get('/:id/stream', zValidator('param', sessionParamsSchema), async (c) => {
    const { id } = c.req.valid('param');

    return streamSSE(c, async (stream) => {
      const emitter = getOrCreateEmitter(id);

      const handler = async (event: StreamEvent) => {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
          id: event.id,
        });
      };

      emitter.on('event', handler);

      // Keep connection alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '' });
      }, 30000);

      // Cleanup on disconnect
      stream.onAbort(() => {
        clearInterval(keepAlive);
        emitter.off('event', handler);
      });

      // Wait indefinitely (connection kept open)
      await new Promise(() => {});
    });
  });

// Emit events to session
export function emitToSession(sessionId: string, event: StreamEvent) {
  const emitter = sessionEmitters.get(sessionId);
  if (emitter) {
    emitter.emit('event', event);
  }
}
```

## Database Operations (Prisma)

### Transaction Pattern

```typescript
// Always use transactions for related operations
async function createSessionWithMessage(userId: string, content: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.session.create({
      data: { userId, name: 'New Session' },
    });

    const message = await tx.message.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content,
      },
    });

    return { session, message };
  });
}
```

### Pagination Pattern

```typescript
const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

.get('/', zValidator('query', paginationSchema), async (c) => {
  const { page, limit } = c.req.valid('query');
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.session.findMany({ skip, take: limit }),
    prisma.session.count(),
  ]);

  return c.json({
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});
```

## Error Handling

### Global Error Handler

```typescript
// apps/api/src/middleware/errorHandler.ts
import { Context } from 'hono';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../lib/logger';

export function errorHandler(err: Error, c: Context) {
  logger.error({ err }, 'Request error');

  // Zod validation errors
  if (err instanceof ZodError) {
    return c.json({
      error: 'Validation failed',
      details: err.errors,
    }, 400);
  }

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return c.json({ error: 'Resource already exists' }, 409);
    }
    if (err.code === 'P2025') {
      return c.json({ error: 'Resource not found' }, 404);
    }
  }

  // Default error
  return c.json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  }, 500);
}
```

## Rate Limiting

```typescript
// apps/api/src/middleware/rateLimit.ts
import { Context, Next } from 'hono';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

export function rateLimit(options: { limit: number; window: number }) {
  return async (c: Context, next: Next) => {
    const key = `rate:${c.get('userId') || c.req.header('x-forwarded-for')}`;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, options.window);
    }

    if (count > options.limit) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    c.header('X-RateLimit-Limit', String(options.limit));
    c.header('X-RateLimit-Remaining', String(options.limit - count));

    await next();
  };
}
```

## Background Jobs (BullMQ)

```typescript
// apps/api/src/services/queue.ts
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

// Create queue
export const taskQueue = new Queue('tasks', { connection });

// Add job
export async function enqueueTask(sessionId: string, task: any) {
  await taskQueue.add('execute', { sessionId, task }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

// Worker (apps/api/src/worker.ts)
const worker = new Worker('tasks', async (job) => {
  const { sessionId, task } = job.data;
  // Process task...
}, { connection });

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});
```

## API Design Guidelines

1. **Use proper HTTP methods**: GET (read), POST (create), PATCH (update), DELETE (remove)
2. **Return appropriate status codes**: 200 (OK), 201 (created), 400 (bad request), 401 (unauthorized), 404 (not found), 500 (error)
3. **Validate all inputs** with Zod schemas
4. **Use consistent response format**: `{ data }` for success, `{ error, details? }` for errors
5. **Include pagination** for list endpoints
6. **Add rate limiting** to prevent abuse
7. **Log errors** with context for debugging
