import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { createNodeWebSocket } from '@hono/node-ws';

// Route imports
import { authRoutes } from './routes/auth';
import { sessionRoutes } from './routes/sessions';
import { messageRoutes } from './routes/messages';
import { streamRoutes } from './routes/stream';
import { createBrowserStreamRoutes } from './routes/browser-stream';
import { fileRoutes } from './routes/files';
import { skillRoutes } from './routes/skills';
import { externalSkillRoutes } from './routes/external-skills';
import { userSkillRoutes } from './routes/user-skills';
import { publicDownloadRoutes } from './routes/public-download';

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

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

// Root: avoid GET / hitting 404 and ensure native Response for adapters (e.g. Bun)
app.get('/', (c) => {
  return c.json({
    name: 'Mark Agent API',
    version: '0.1.0',
    docs: '/api/health',
  });
});

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
app.route('/api', createBrowserStreamRoutes(upgradeWebSocket)); // Browser screencast WebSocket
app.route('/api', fileRoutes); // File upload/download endpoints
app.route('/api/skills', skillRoutes); // Skill listing and invocation
app.route('/api/external-skills', externalSkillRoutes);
app.route('/api/user-skills', userSkillRoutes); // User skill preferences
app.route('/api/public', publicDownloadRoutes); // Public download with token

// 404 handler: return native Response so runtimes (e.g. Bun) that expect Response don't throw
app.notFound((c) => {
  const body = JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  return new Response(body, {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
});

// Error handler: same — return native Response for adapter compatibility
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  const body = JSON.stringify({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    },
  });
  return new Response(body, {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
});

export { injectWebSocket };

export default app;
