import { serve } from '@hono/node-server';
import app, { injectWebSocket } from './index';

const port = Number(process.env.PORT) || 4000;

console.log(`Starting server on port ${port}...`);

const server = serve({
  fetch: app.fetch,
  port,
  // Keep Bun/global fetch APIs intact to avoid Response type mismatches.
  overrideGlobalObjects: false,
});

injectWebSocket(server);

console.log(`Server running at http://localhost:${port}`);
