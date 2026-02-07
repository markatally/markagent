import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { serve } from '@hono/node-server';

// Route imports
import { authRoutes } from './routes/auth';
import { sessionRoutes } from './routes/sessions';
import { messageRoutes } from './routes/messages';
import { streamRoutes } from './routes/stream';
import { fileRoutes } from './routes/files';
import { skillRoutes } from './routes/skills';
import { externalSkillRoutes } from './routes/external-skills';
import { userSkillRoutes } from './routes/user-skills';
import { publicDownloadRoutes } from './routes/public-download';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', secureHeaders());
app.use(
  '*',
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  })
);

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});

// API Routes
app.route('/api/auth', authRoutes);
app.route('/api/sessions', sessionRoutes);
app.route('/api', messageRoutes); // Messages are nested under sessions
app.route('/api', streamRoutes); // SSE streaming endpoints
app.route('/api', fileRoutes); // File upload/download endpoints
app.route('/api/skills', skillRoutes); // Skill listing and invocation
app.route('/api/external-skills', externalSkillRoutes);
app.route('/api/user-skills', userSkillRoutes); // User skill preferences
app.route('/api/public', publicDownloadRoutes); // Public download with token

// 404 handler
app.notFound((c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      },
    },
    500
  );
});

// Start server only when run directly (not when imported by tests)
const isMainModule = import.meta.main || process.argv[1]?.includes('index.ts');

if (isMainModule) {
  const port = Number(process.env.PORT) || 4000;

  console.log(`Starting server on port ${port}...`);

  serve({
    fetch: app.fetch,
    port,
  });

  console.log(`Server running at http://localhost:${port}`);
}

export default app;
