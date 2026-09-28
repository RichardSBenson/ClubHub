/**
 * Local development listener.
 *
 * The server is constructed here, not in server.mjs. A createServer or listen
 * call inside the module graph Vercel bundles makes it treat the function as
 * a captured Node server, and every route 404s in production. Keep the
 * plumbing on this side of the line.
 */
import http from 'node:http';
import handler from './server.mjs';

const port = +(process.env.PORT ?? 8080);
http.createServer(handler).listen(port, () =>
  console.log(`honbu admin on http://localhost:${port}`));
