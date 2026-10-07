/**
 * The public site's finishing touches.
 *
 *   1. The federation sets the home page's picture, words and share picture.
 *   2. An event can carry a written description, and a calendar file to add it to a phone.
 *   3. Pages say which picture to show when they are shared.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, assets } from './data.mjs';
import { identify } from '../content/images.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CRON_SECRET = 'test-cron-secret';
const OUT = '/tmp/honbu-public-site';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
};
async function req(p, { method = 'GET', form } = {}) {
  const headers = {};
  if (cookie()) headers.cookie = cookie();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + p, { method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
               : undefined });
  keep(res);
  return { status: res.status, location: res.headers.get('location'),
           headers: res.headers, html: await res.text() };
}
async function multi(p, fields = {}, file = null) {
  const fd = new FormData();
  fd.append('_csrf', jar.honbu_csrf ?? '');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append(file.field, new Blob([file.bytes], { type: 'image/png' }), file.name);
  const res = await fetch(base + p, { method: 'POST', headers: { cookie: cookie() }, redirect: 'manual', body: fd });
  keep(res);
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`);
};
const build = async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await run(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..') });
};


const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const wh = await one(`select * from organisation where slug='whanganui'`);
const wn = await one(`select * from organisation where slug='wellington'`);
const root = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const day = async (n) => (await one(`select to_char(current_date + $1::int,'YYYY-MM-DD') as d`, [n])).d;
const mkAsset = (org, name) => assets.create(doug.id, org, { bytes: PNG, identified: identify(PNG, { filename: name }), filename: name, altText: name });


console.log('\nTHE HOME PAGE');
await signIn('doug@example.nz');
{
  let r = await req('/o/moknz/appearance');
  ok('the appearance screen offers the home page', r.status === 200 && /name="heroFile"/.test(r.html) && /name="heroHeading"/.test(r.html) && /name="shareFile"/.test(r.html));
  ok('with the sizes to aim for', /2400 × 1000/.test(r.html) && /1200 × 630/.test(r.html));
  r = await multi('/o/moknz/appearance/home', { heroHeading: 'Train with us', heroText: 'Karate across Aotearoa.', heroButton: 'Find a dojo' },
    { field: 'heroFile', bytes: PNG, name: 'hero.png' });
  ok('saving sets the words and the picture', r.status === 302 && /done=Home/.test(r.location), r.location);
  ok('and warns that a tiny picture will look soft', /wide/.test(decodeURIComponent(r.location)));
  const set = (await one(`select settings->'homePage' as h from organisation where id=$1`, [root.id])).h;
  ok('the settings record both', set.heroHeading === 'Train with us' && /^[0-9a-f-]{36}$/.test(set.heroAssetId));
  r = await multi('/o/moknz/appearance/home', { heroHeading: 'x'.repeat(81) });
  ok('an over-long heading is refused', /error=/.test(r.location) && /too long/.test(decodeURIComponent(r.location)));
  r = await multi('/o/moknz/appearance/home', { heroHeading: 'Train with us', heroText: 'Karate across Aotearoa.', heroButton: 'Find a dojo' },
    { field: 'shareFile', bytes: PNG, name: 'share.png' });
  ok('a share picture can be added on its own, leaving the big one', r.status === 302
    && (await one(`select settings->'homePage'->>'heroAssetId' as a, settings->'homePage'->>'shareAssetId' as b from organisation where id=$1`, [root.id])).a === set.heroAssetId);
  r = await multi('/o/whanganui/appearance/home', { heroHeading: 'Mine' });
  ok('a club cannot change the federation\'s home page', r.status === 403 || (r.status === 302 && !/done=/.test(r.location)));
  const audit = await one(`select count(*)::int as n from audit_log where action='home_page_set'`);
  ok('each change is in the audit log', audit.n >= 2);

  await build();
  const home = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  ok('the site uses the stored heading, words and button', /<h1>Train with us<\/h1>/.test(home) && /Karate across Aotearoa\./.test(home) && />Find a dojo</.test(home));
  ok('the big picture is behind the heading', /class="hero photo"[^>]*url\('\/images\//.test(home));
  ok('the share picture is offered to Facebook and chat apps', /<meta property="og:image" content="https?:\/\/[^"]+\/images\/[^"]+">/.test(home) && /twitter:card" content="summary_large_image"/.test(home));
  const dojoPage = fs.readFileSync(path.join(OUT, 'whanganui/index.html'), 'utf8');
  ok('so is every other page, absolute and on this site', /og:image" content="https?:\/\//.test(dojoPage));

  r = await multi('/o/moknz/appearance/home', { heroHeading: '', heroText: '', heroButton: '', removeHero: '1', removeShare: '1' });
  const cleared = (await one(`select settings->'homePage' as h from organisation where id=$1`, [root.id])).h;
  ok('blank words and Remove put things back', r.status === 302 && !cleared.heroHeading && !cleared.heroAssetId && !cleared.shareAssetId);
  await build();
  const plain = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  ok('the settings file\'s heading returns, with no picture to share', /Everyone starts as a white belt\./.test(plain) && !/og:image/.test(plain) && /twitter:card" content="summary"/.test(plain));

  delete jar.honbu_session;
  r = await multi('/o/moknz/appearance/home', { heroHeading: 'Hacked' });
  ok('somebody signed out cannot', (r.status === 302 && /signin/.test(r.location ?? '')) || r.status === 401 || r.status === 403);
  ok('and nothing changed', !(await one(`select settings->'homePage'->>'heroHeading' as h from organisation where id=$1`, [root.id])).h);
  await signIn('doug@example.nz');
}

console.log('\nEVENT DESCRIPTIONS AND THE CALENDAR FILE');
{
  const when = await day(30), end = await day(31);
  const form = { eventType: 'seminar', title: 'Seminar with Sensei <b>Aroha</b>', startsAt: `${when}T09:00`, endsAt: `${end}T16:00`, venueName: 'Whanganui Collegiate Gym',
    addressLine: '1 Hospital Road, Whanganui', visibility: 'public', status: 'published', kind: 'seminar',
    description: 'A weekend of kata and bunkai.\r\n\r\nBring a gi; lunch is provided.\nParking is at the back.\r\n\r\n<script>alert(1)</script>' };
  let r = await req('/o/whanganui/events/new');
  ok('the event form has an About box', /<textarea id="description" name="description"/.test(r.html));
  r = await req('/o/whanganui/events/new', { method: 'POST', form: { ...form, description: 'x'.repeat(4001) } });
  ok('an over-long description is refused, with the form kept', r.status === 422 && /too long/.test(r.html) && /Seminar with Sensei/.test(r.html));
  r = await req('/o/whanganui/events/new', { method: 'POST', form });
  ok('a good one is saved', r.status === 302 && /done=/.test(r.location), r.html.slice(0, 200));
  const ev = await one(`select e.id, e.slug, d.description from event e join event_detail d on d.event_id = e.id where e.organisation_id=$1 order by e.created_at desc limit 1`, [wh.id]);
  ok('the description is kept with plain line breaks', ev.description.startsWith('A weekend of kata and bunkai.\n\nBring a gi;') && !ev.description.includes('\r'));
  r = await req(`/o/whanganui/events/${ev.slug}/edit`);
  ok('editing shows it again', /A weekend of kata and bunkai\./.test(r.html) && /&lt;script&gt;/.test(r.html) && !/<script>alert/.test(r.html));

  await build();
  const dir = path.join(OUT, 'whanganui/events', ev.slug);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const paras = [...html.matchAll(/<p class="evdesc">(.*?)<\/p>/g)].map((m) => m[1]);
  ok('the page shows it as paragraphs', paras.length === 3 && /kata and bunkai/.test(paras[0]));
  ok('a single line break stays a line break', /lunch is provided\.<br>Parking/.test(paras[1]));
  ok('markup in it is shown as text, never run', !/<script>alert/.test(html) && /&lt;script&gt;/.test(html));
  ok('the page offers the file for iPhone, Samsung and others', new RegExp(`href="/whanganui/events/${ev.slug}/event.ics" download`).test(html));
  ok('and one-tap Google Calendar and Outlook buttons', /href="https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE[^"]*" target="_blank" rel="noopener">Google Calendar/.test(html) && /href="https:\/\/outlook\.live\.com\/calendar\/0\/deeplink\/compose[^"]*" target="_blank" rel="noopener">Outlook/.test(html));
  const ics = fs.readFileSync(path.join(dir, 'event.ics'), 'utf8');
  ok('the file is a calendar entry for this event', /^BEGIN:VCALENDAR\r\n/.test(ics) && /SUMMARY:Seminar with Sensei <b>Aroha<\\\/b>|SUMMARY:Seminar with Sensei/.test(ics));
  ok('with its place, and the description folded in', /LOCATION:Whanganui Collegiate Gym\\, 1 Hospital Road\\, Whanganui/.test(ics) && /kata and bunkai/.test(ics.replace(/\r\n /g, '')));
  ok('and the page address, so the entry links back', new RegExp(`URL:https?://[^\\r]+/whanganui/events/${ev.slug}\\r\\n`).test(ics.replace(/\r\n /g, '')));
  ok('the file ends with a final line break', ics.endsWith('END:VCALENDAR\r\n'));

  r = await req(`/o/whanganui/events/${ev.slug}/edit`, { method: 'POST', form: { ...form, slug: ev.slug, description: '' } });
  ok('clearing the description removes it', r.status === 302 && !(await one(`select description from event_detail where event_id=$1`, [ev.id]))?.description);
  await build();
  { const again = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'); ok('and the page shows none', !/class="evdesc"/.test(again), again.slice(Math.max(0, again.indexOf("evtext") - 80), again.indexOf("evtext") + 120)); }

  r = await req(`/o/whanganui/events/${ev.slug}/cancel`, { method: 'POST', form: {} });
  await build();
  ok('a cancelled event is not in the build, so has no calendar file', !fs.existsSync(path.join(dir, 'event.ics')));
}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
