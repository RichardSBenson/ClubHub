/** Probe: auth.mjs on its own. */
import * as auth from '../packages/api/auth.mjs';
export default function (q, s) {
  s.statusCode = 200; s.setHeader('content-type', 'text/plain; charset=utf-8');
  s.end('ping6 ok: auth exports ' + Object.keys(auth).length + '\n');
}
