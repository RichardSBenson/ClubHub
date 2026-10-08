/**
 * The dojo gallery: many pictures at once, filed by year and event, shown by year and event.
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
const OUT = '/tmp/honbu-gallery';
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
  await req(`/signin/${token}`, { method: 'POST', form: {} });
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



const evId = async (org, slug) => (await one(`select id from event where organisation_id=$1 and slug=$2`, [org, slug]))?.id;
const mkEvent = async (orgSlug, orgId, title, offsetDays) => {
  const d = await day(offsetDays);
  const r = await req(`/o/${orgSlug}/events/new`, { method: 'POST', form: { eventType: '', kind: 'training', title, startsAt: `${d}T09:00`, visibility: 'public', status: 'published' } });
  return (await one(`select id, slug from event where organisation_id=$1 order by created_at desc limit 1`, [orgId]));
};
const manyOf = (names) => names.map((n) => ({ field: 'file', bytes: PNG, name: n }));
async function multiMany(p, fields, files, headers = {}) {
  const fd = new FormData();
  fd.append('_csrf', jar.honbu_csrf ?? '');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append(f.field, new Blob([f.bytes], { type: f.type ?? 'image/png' }), f.name);
  const res = await fetch(base + p, { method: 'POST', headers: { cookie: cookie(), ...headers }, redirect: 'manual', body: fd });
  keep(res);
  return { status: res.status, location: res.headers.get('location'), type: res.headers.get('content-type'), text: await res.text() };
}
const rows = async () => (await pool.query(`select g.id, g.caption, g.year, g.event_id, g.position from club_gallery g where g.organisation_id=$1 order by g.created_at, g.position`, [wh.id])).rows;

console.log('\nADDING MANY AT ONCE');
await signIn('doug@example.nz');
const grading = await mkEvent('whanganui', wh.id, 'Kyu Grading', 20);
const camp = await mkEvent('whanganui', wh.id, 'Summer camp', 45);
const elsewhere = await mkEvent('wellington', wn.id, 'Wellington seminar', 30);
const lastYear = new Date().getFullYear() - 1, thisYear = new Date().getFullYear();
{
  let r = await req('/o/whanganui/gallery');
  ok('the screen takes several files', /<input type="file" name="file" multiple/.test(r.html) && /name="year"/.test(r.html) && /name="eventId"/.test(r.html));
  ok('and loads the small uploader script from this site', /<script src="\/vendor\/gallery-upload\.js" defer>/.test(r.html) && !/<script>/.test(r.html));
  ok('the event list is this dojo\'s own', r.html.includes('Kyu Grading') && r.html.includes('Summer camp') && !r.html.includes('Wellington seminar'));

  r = await multiMany('/o/whanganui/gallery', { year: String(lastYear) }, manyOf(['a.png', 'b.png', 'c.png']));
  ok('three pictures go in with one submit', r.status === 302 && /done=Added%203/.test(r.location), r.location);
  ok('all filed under the year chosen', (await rows()).length === 3 && (await rows()).every((x) => x.year === lastYear && !x.event_id));

  r = await multiMany('/o/whanganui/gallery', { eventId: grading.id, year: '' }, manyOf(['d.png', 'e.png']));
  ok('an event with no year chosen gives the pictures its own year', (await rows()).filter((x) => x.event_id === grading.id).length === 2
    && (await rows()).filter((x) => x.event_id === grading.id).every((x) => x.year === thisYear));
  r = await multiMany('/o/whanganui/gallery', { eventId: elsewhere.id }, manyOf(['f.png']));
  ok('another dojo\'s event cannot be used', /error=/.test(r.location) && (await rows()).length === 5);
  r = await multiMany('/o/whanganui/gallery', { year: '1800' }, manyOf(['g.png']));
  ok('a silly year is refused', /error=/.test(r.location) && (await rows()).length === 5);

  r = await multiMany('/o/whanganui/gallery', { year: String(thisYear) }, [{ field: 'file', bytes: PNG, name: 'ok.png' }, { field: 'file', bytes: Buffer.from('not a picture'), name: 'notes.txt' }]);
  ok('one that is not a picture does not stop the rest', /done=Added%201/.test(r.location) && /notes\.txt/.test(decodeURIComponent(r.location)) && (await rows()).length === 6);

  r = await multiMany('/o/whanganui/gallery', { year: String(thisYear) }, manyOf(['h.png']), { accept: 'application/json' });
  ok('the script gets JSON back, one picture at a time', r.status === 200 && /json/.test(r.type) && JSON.parse(r.text).ok === true && JSON.parse(r.text).added === 1);
  r = await multiMany('/o/whanganui/gallery', {}, [{ field: 'file', bytes: Buffer.from('nope'), name: 'x.txt' }], { accept: 'application/json' });
  ok('and an honest refusal when it is not a picture', r.status === 422 && JSON.parse(r.text).ok === false);
}

console.log('\nFILING AND TIDYING');
{
  let all = await rows();
  const [a, b, c] = all;
  let r = await req('/o/whanganui/gallery/bulk', { method: 'POST', form: { action: 'file', eventId: camp.id, [`pick_${a.id}`]: 'on', [`pick_${b.id}`]: 'on' } });
  all = await rows();
  ok('ticked pictures can be moved into an event', all.filter((x) => x.event_id === camp.id).length === 2);
  ok('and take that event\'s year', all.filter((x) => x.event_id === camp.id).every((x) => x.year === thisYear));
  r = await req('/o/whanganui/gallery/bulk', { method: 'POST', form: { action: 'file', year: String(lastYear - 1), [`pick_${a.id}`]: 'on' } });
  ok('the year can be changed alone', (await rows()).find((x) => x.id === a.id).year === lastYear - 1 && (await rows()).find((x) => x.id === a.id).event_id === camp.id);
  r = await req('/o/whanganui/gallery/bulk', { method: 'POST', form: { action: 'file', eventId: 'none', [`pick_${a.id}`]: 'on' } });
  ok('and a picture taken out of its event', (await rows()).find((x) => x.id === a.id).event_id === null);
  r = await req('/o/whanganui/gallery/bulk', { method: 'POST', form: { action: 'file', year: '2020' } });
  ok('nothing ticked says so', /error=/.test(r.location) && /Tick/.test(decodeURIComponent(r.location)));
  r = await req('/o/whanganui/gallery/bulk', { method: 'POST', form: { action: 'file', eventId: elsewhere.id, [`pick_${c.id}`]: 'on' } });
  ok('filing under another dojo\'s event is refused', /error=/.test(r.location) && (await rows()).find((x) => x.id === c.id).event_id !== elsewhere.id);

  r = await req(`/o/whanganui/gallery/${c.id}/details`, { method: 'POST', form: { caption: 'Our first grading', year: '2019', eventId: grading.id } });
  const cc = (await rows()).find((x) => x.id === c.id);
  ok('one picture\'s caption, year and event save together', cc.caption === 'Our first grading' && cc.year === 2019 && cc.event_id === grading.id);

  r = await req(`/o/whanganui/gallery?year=${thisYear}`);
  ok('the screen can show one year', /<h2>\d{4}<\/h2>/.test(r.html) && !new RegExp(`<h2>${lastYear - 1}</h2>`).test(r.html) && r.html.includes(`<h2>${thisYear}</h2>`));
  r = await req(`/o/whanganui/gallery?event=${camp.id}`);
  ok('or one event', (r.html.match(/name="pick_/g) ?? []).length === 1);
  r = await req('/o/whanganui/gallery');
  ok('with years and event headings, newest first', r.html.indexOf(`<h2>${thisYear}</h2>`) < r.html.indexOf(`<h2>${lastYear - 1}</h2>`) && r.html.indexOf(`<h2>${lastYear - 1}</h2>`) < r.html.indexOf('<h2>2019</h2>'));
  ok('and a place to tick them', /<form id="bulk"/.test(r.html) && /Remove the ticked ones/.test(r.html));

  const before = (await rows()).length;
  r = await req('/o/whanganui/gallery/bulk', { method: 'POST', form: { action: 'remove', [`pick_${b.id}`]: 'on' } });
  ok('ticked ones can be removed', (await rows()).length === before - 1 && !(await rows()).find((x) => x.id === b.id));
  r = await req(`/o/whanganui/gallery/${a.id}/move`, { method: 'POST', form: { direction: 'up' } });
  ok('moving earlier works inside its group', r.status === 302);
}

console.log('\nWHAT THE PUBLIC SEES');
{
  await build();
  const dojo = fs.readFileSync(path.join(OUT, 'whanganui/index.html'), 'utf8');
  const stripCount = (dojo.match(/<ul class="gallery">[\s\S]*?<\/ul>/)?.[0].match(/<li>/g) ?? []).length;
  const total = (await rows()).length;
  ok('the dojo page shows a short strip, not all of them', total > 8 ? stripCount === 8 : stripCount === total, `${stripCount}/${total}`);
  ok('with a link to the full gallery', (total > 8 ? new RegExp(`href="/whanganui/gallery">See all ${total} photos`) : /href="\/whanganui\/gallery">Photos by year and event/).test(dojo));
  const file = path.join(OUT, 'whanganui/gallery/index.html');
  ok('the dojo has a gallery page of its own', fs.existsSync(file));
  const html = fs.readFileSync(file, 'utf8');
  ok('it has a button per year', new RegExp(`href="#y${thisYear}"`).test(html) && new RegExp(`href="#y${lastYear - 1}"`).test(html) && /href="#y2019"/.test(html));
  ok('years run newest first', html.indexOf(`id="y${thisYear}"`) < html.indexOf(`id="y${lastYear - 1}"`) && html.indexOf(`id="y${lastYear - 1}"`) < html.indexOf('id="y2019"'));
  ok('events are headings, linked to their page', /<h3 class="galevent"><a href="\/whanganui\/events\/kyu-grading[^"]*">Kyu Grading<\/a><\/h3>/.test(html));
  ok('a caption shows', html.includes('Our first grading'));
  ok('every picture is a file on the site', (html.match(/<img src="\/images\/[^"]+"/g) ?? []).length === total);
  ok('a dojo with no pictures has no gallery page', !fs.existsSync(path.join(OUT, 'wellington/gallery/index.html')) && !fs.existsSync(path.join(OUT, 'wellington/gallery')));
  ok('each picture links to its full-size file, so it opens large even without scripts', (html.match(/<a class="glink" href="\/images\/[^"]+"><img/g) ?? []).length === total);
  ok('the page loads the photo viewer from this site', /<script src="\/vendor\/lightbox\.js" defer><\/script>/.test(html) && /<script src="\/vendor\/lightbox\.js"/.test(dojo));
  ok('the viewer script is part of the site', fs.existsSync(path.join(OUT, 'vendor/lightbox.js')) && /ArrowRight/.test(fs.readFileSync(path.join(OUT, 'vendor/lightbox.js'), 'utf8')));
  ok('the uploader script is part of the site', fs.existsSync(path.join(OUT, 'vendor/gallery-upload.js')) && /createImageBitmap/.test(fs.readFileSync(path.join(OUT, 'vendor/gallery-upload.js'), 'utf8')));
}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
