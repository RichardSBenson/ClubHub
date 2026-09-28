/**
 * Probe: run the admin handler in-process and report what it produced.
 *
 * WebFetch will not show the body of a 404, so a 404 from /signin could be
 * Vercel saying "no such route" or the admin saying "no such page" and there
 * is no way to tell them apart from outside. This calls the handler directly
 * with a fake request and answers 200 with the result, so the answer is
 * visible either way.
 *
 *   /api/ping13?path=/signin
 */
import { Readable } from 'node:stream';
import handler from '../packages/api/server.mjs';

export default async function (request, response) {
  const asked = new URL(request.url, 'http://localhost').searchParams.get('path') ?? '/signin';

  const req = new Readable({ read() { this.push(null); } });
  req.method = 'GET';
  req.url = asked;
  req.headers = { host: 'club-hub-fawn.vercel.app', 'x-forwarded-proto': 'https' };
  req.socket = { encrypted: true };

  const headers = {};
  const chunks = [];
  let finished;
  const done = new Promise((resolve) => { finished = resolve; });

  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    removeHeader(k) { delete headers[k.toLowerCase()]; },
    writeHead(code, extra) {
      res.statusCode = code;
      if (extra) for (const [k, v] of Object.entries(extra)) headers[k.toLowerCase()] = v;
      return res;
    },
    write(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); return true; },
    end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); finished(); },
    on() {}, once() {}, emit() {}, removeListener() {},
  };

  let threw = null;
  try {
    await handler(req, res);
    await Promise.race([done, new Promise((r) => setTimeout(r, 8000))]);
  } catch (error) {
    threw = `${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(0, 6).join('\n')}`;
  }

  const body = Buffer.concat(chunks).toString('utf8');
  response.statusCode = 200;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(
    `asked: ${asked}\n` +
    `status: ${res.statusCode}\n` +
    `headers: ${JSON.stringify(headers)}\n` +
    `threw: ${threw ?? 'no'}\n` +
    `--- first 1200 bytes of body ---\n${body.slice(0, 1200)}\n`
  );
}
