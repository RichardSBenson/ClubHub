/** Probe: data.mjs, statically imported by name (the factory only did it dynamically). */
import { pool, orgs, people, rank, events, Forbidden, NotFound, Invalid }
  from '../packages/api/data.mjs';
export default function (q, s) {
  s.statusCode = 200; s.setHeader('content-type', 'text/plain; charset=utf-8');
  s.end('ping10 ok: ' + [pool, orgs, people, rank, events, Forbidden, NotFound, Invalid]
    .map((x) => typeof x).join(',') + '\n');
}
