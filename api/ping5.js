/** Probe: views.mjs on its own. */
import * as V from '../packages/api/views.mjs';
export default function (q, s) {
  s.statusCode = 200; s.setHeader('content-type', 'text/plain; charset=utf-8');
  s.end('ping5 ok: views exports ' + Object.keys(V).length + '\n');
}
