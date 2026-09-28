/** Probe: does the pg optionalDependency resolve inside a function bundle? */
import pg from 'pg';
export default function (request, response) {
  response.statusCode = 200;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end('ping3 ok: pg loaded, Pool is ' + typeof pg.Pool + '\n');
}
