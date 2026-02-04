import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { requireAuth, AuthContext } from '../middleware/auth';
import { getExternalSkillLoader } from '../services/external-skills/loader';

const sessions = new Hono<AuthContext>();
const externalSkillLoader = getExternalSkillLoader();

// All session routes require authentication
sessions.use('*', requireAuth);

// Validation schemas
const createSessionSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
});

/**
 * GET /api/sessions
 * List all sessions for the authenticated user
 */
sessions.get('/', async (c) => {
  const user = c.get('user');

  const userSessions = await prisma.session.findMany({
    where: {
      userId: user.userId,
    },
    orderBy: {
      lastActiveAt: 'desc',
    },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      lastActiveAt: true,
      _count: {
        select: {
          messages: true,
        },
      },
    },
  });

  return c.json({
    sessions: userSessions,
  });
});

/**
 * POST /api/sessions
 * Create a new session
 */
sessions.post('/', zValidator('json', createSessionSchema), async (c) => {
  const user = c.get('user');
  const { name } = c.req.valid('json');

  const session = await prisma.session.create({
    data: {
      userId: user.userId,
      name: name || 'New Session',
      status: 'active',
    },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      lastActiveAt: true,
    },
  });

  const snapshot = await externalSkillLoader.getSkillSnapshot(session.id);

  return c.json(
    {
      ...session,
      externalSkillSnapshotId: snapshot.snapshotId,
    },
    201
  );
});

/**
 * GET /api/sessions/:id
 * Get a specific session with its messages
 */
sessions.get('/:id', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');

  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId, // Ensure user owns the session
    },
    include: {
      messages: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  return c.json(session);
});

/**
 * DELETE /api/sessions/:id
 * Delete a session and all its messages
 */
sessions.delete('/:id', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');

  // Check if session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  // Delete session (cascade will delete messages)
  await prisma.session.delete({
    where: {
      id: sessionId,
    },
  });

  return c.json({
    message: 'Session deleted successfully',
  });
});

/**
 * PATCH /api/sessions/:id
 * Update session name or status
 */
const updateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.string().optional(), // Use string to match schema
});

sessions.patch('/:id', zValidator('json', updateSessionSchema), async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  const updates = c.req.valid('json');

  // Check if session exists and belongs to user
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
      userId: user.userId,
    },
  });

  if (!session) {
    return c.json(
      {
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      },
      404
    );
  }

  // Update session
  const updatedSession = await prisma.session.update({
    where: {
      id: sessionId,
    },
    data: updates,
    select: {
      id: true,
      name: true,
      status: true,
      lastActiveAt: true,
    },
  });

  return c.json(updatedSession);
});

export { sessions as sessionRoutes };
