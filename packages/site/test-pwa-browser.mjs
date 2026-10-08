/**
 * The app, in a real browser with the network switched off.
 *
 * A small server stands in for Honbu (same headers: signed-in pages are private/no-store) and serves the REAL
 * sw.js and pwa.js. Chromium then goes offline. Skipped, not failed, where no browser is installed.
 */
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { iconPng } from './pwa.mjs';

let pw = null;
for (const from of ['playwright', `${(() => { try { return execSync('npm root -g').toString().trim(); } catch { return ''; } })()}/playwright`]) {
  try { pw = createRequire(import.meta.url)(from); break; } catch { /* try the next place */ }
}
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
if (!pw || !fs.existsSync(pw.chromium.executablePath())) {
  console.log('  (no browser here, so this is skipped)\n\n0 passed, 0 failed\n'); process.exit(0);
}

const ID = '11111111-2222-3333-4444-555555555555';
const file = (p) => fs.readFileSync(new URL(p, import.meta.url));
const posts = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (type, body, headers = {}) => { res.writeHead(200, { 'content-type': type, ...headers }); res.end(body); };
  const page = (title, body, priv = true) => send('text/html', `<!doctype html><title>${title}</title><main>${body}</main><footer class="foot"></footer>
    <script src="/vendor/pwa.js"></script>`, { 'cache-control': priv ? 'private, no-store' : 'public, max-age=0, must-revalidate' });
  if (url.pathname === '/sw.js') return send('text/javascript', file('../../vendor/honbu/sw.js'), { 'service-worker-allowed': '/' });
  if (url.pathname === '/vendor/pwa.js') return send('text/javascript', file('../../vendor/honbu/pwa.js'));
  if (url.pathname === '/vendor/push.js') return send('text/javascript', '');
  if (url.pathname === '/offline.html') return send('text/html', '<title>offline</title>You are offline');
  if (url.pathname.startsWith('/icons/')) return send('image/png', iconPng(192));
  if (url.pathname === '/') return page('Public home', '<h1>Public home</h1>', false);
  if (url.pathname === `/me/${ID}/card`) return page('Card', '<h1>MY CARD</h1>');
  if (url.pathname === '/me/payments') return page('Payments', '<h1>MY PAYMENTS</h1>');
  if (url.pathname === '/o/club/attendance') return page('Attendance', `<h1>Attendance</h1><a href="/o/club/attendance/${ID}">Take the roll</a>`);
  if (url.pathname === `/o/club/attendance/${ID}` && req.method === 'GET')
    return page('Roll', `<h1>ROLL</h1><form method="post" action="/o/club/attendance/${ID}"><input type="hidden" name="_csrf" value="t">
      <input type="hidden" name="date" value="2026-10-08"><label><input type="checkbox" id="a" name="here_aaa" value="1"> Ana</label><button id="save">Save</button></form>`);
  if (url.pathname === `/o/club/attendance/${ID}` && req.method === 'POST') {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { posts.push(b); res.writeHead(302, { location: '/o/club/attendance?done=Saved' }); res.end(); }); return;
  }
  if (url.pathname === '/signout') { req.resume(); req.on('end', () => { res.writeHead(302, { location: '/' }); res.end(); }); return; }
  res.writeHead(404); res.end('no');
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'allow' });
const page = await ctx.newPage();
const text = async () => (await page.textContent('body')).replace(/\s+/g, ' ');
const go = async (p) => { try { await page.goto(base + p, { waitUntil: 'load' }); } catch (e) { /* offline errors are the point */ } };

console.log('\nONLINE FIRST: THE APP INSTALLS ITS WORKER');
await go('/');
await page.evaluate(() => navigator.serviceWorker.ready);
await go('/');                                   // now controlled
ok('the page is controlled by the service worker', await page.evaluate(() => !!navigator.serviceWorker.controller));
await go(`/me/${ID}/card`); await go('/me/payments'); await go('/o/club/attendance');
await page.waitForTimeout(1200);                  // pwa.js warms the roll link
await go(`/o/club/attendance/${ID}`);
ok('the roll opens', (await text()).includes('ROLL'));

console.log('\nTHEN THE SIGNAL GOES');
await ctx.setOffline(true);
await go('/');
ok('a public page still opens', (await text()).includes('Public home'), await text());
await go(`/me/${ID}/card`);
ok('the membership card still opens', (await text()).includes('MY CARD'), await text());
await go('/me/payments');
ok('other signed-in pages are NOT kept, the offline page shows instead', (await text()).includes('You are offline') && !(await text()).includes('MY PAYMENTS'), await text());
await go(`/o/club/attendance/${ID}`);
ok('the class roll still opens', (await text()).includes('ROLL'), await text());

console.log('\nA ROLL TAKEN WITH NO SIGNAL');
await page.check('#a');
await page.click('#save');
await page.waitForTimeout(4500);                  // the reachability probe times out or fails
ok('it is held on the device, and says so', (await text()).includes('saved on this device'), await text());
ok('and nothing reached the server', posts.length === 0, String(posts.length));

await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
for (let i = 0; i < 20 && !posts.length; i++) await page.waitForTimeout(250);
ok('when the signal returns it is sent', posts.length === 1 && posts[0].includes('here_aaa=1') && posts[0].includes('date=2026-10-08'), posts.join('|'));
await page.waitForTimeout(500);
ok('and not sent twice', posts.length === 1, String(posts.length));

console.log('\nSIGNING OUT EMPTIES THE DEVICE');
await go(`/me/${ID}/card`);
await page.evaluate(() => { const f = document.createElement('form'); f.method = 'post'; f.action = '/signout'; f.innerHTML = '<button id="so">Sign out</button>'; document.body.appendChild(f); });
await Promise.all([page.waitForNavigation().catch(() => {}), page.click('#so')]);
await page.waitForTimeout(500);
await ctx.setOffline(true);
await go(`/me/${ID}/card`);
ok('the card is gone from the device', (await text()).includes('You are offline') && !(await text()).includes('MY CARD'), await text());

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
