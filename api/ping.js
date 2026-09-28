/**
 * Diagnostic only. No imports, no dependencies, nothing to bundle.
 *
 * If /api/ping answers and /api/index does not, the admin's module graph is
 * what fails to build. If neither answers, this project is not building
 * functions at all and the cause is a project setting, not the code.
 *
 * Delete once the admin is up.
 */
export default function (request, response) {
  response.statusCode = 200;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end('pong\n');
}
