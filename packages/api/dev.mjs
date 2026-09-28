/**
 * Local development listener.
 *
 * Deliberately separate from server.mjs: a listen() call inside the module
 * graph that Vercel bundles makes it treat the function as a captured Node
 * server, and the route 404s in production. Keep binding here.
 */
import { createServer } from './server.mjs';

const port = +(process.env.PORT ?? 8080);
createServer().listen(port, () =>
  console.log(`honbu admin on http://localhost:${port}`));
