/**
 * Probe: ask the live site about itself over HTTPS and report the raw status.
 * Tells apart Vercel's 404 from the admin's own 404 page.
 */
export default async function (request, response) {
  const base = 'https://club-hub-fawn.vercel.app';
  const paths = ['/signin', '/admin', '/api/index', '/api/ping8', '/api/ping'];
  const lines = [];

  for (const path of paths) {
    try {
      const r = await fetch(base + path, { redirect: 'manual' });
      const text = (await r.text()).replace(/\s+/g, ' ').slice(0, 160);
      lines.push(`${path.padEnd(14)} ${r.status} ${r.headers.get('content-type') ?? '-'} :: ${text}`);
    } catch (error) {
      lines.push(`${path.padEnd(14)} threw ${error.message}`);
    }
  }

  response.statusCode = 200;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(lines.join('\n') + '\n');
}
