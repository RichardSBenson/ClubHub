/**
 * How events are announced, and club galleries.
 *
 *   1. An event is picked from the federation's list, and its banner is text plus the crest.
 *   2. Contacts, cost and a map sit beside it on the event page.
 *   3. A club builds its own photo strip; the page shows it once it has pictures.
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
const OUT = '/tmp/honbu-event-pages';
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

console.log('\nTHE CREST');
await signIn('doug@example.nz');
{
  let r = await req('/o/moknz/appearance');
  ok('the appearance screen offers a crest', r.status === 200 && /name="logoFile"/.test(r.html));
  r = await multi('/o/moknz/appearance/logo', {}, { field: 'logoFile', bytes: PNG, name: 'crest.png' });
  ok('uploading one sets it', r.status === 302 && /done=Crest/.test(r.location));
  const set = (await one(`select settings->>'logoAssetId' as id from organisation where id=$1`, [root.id])).id;
  ok('and records which picture', /^[0-9a-f-]{36}$/.test(set));
  r = await multi('/o/whanganui/appearance/logo', {}, { field: 'logoFile', bytes: PNG, name: 'x.png' });
  ok('a club cannot set the federation\'s crest', r.status === 403 || r.status === 302 && /appearance|club-page/.test(r.location) && !/done=/.test(r.location));
}

console.log('\nPICKING AN EVENT TYPE');
let eventSlug;
{
  const form = await req('/o/whanganui/events/new');
  const types = ['Training Camp — North Island', 'Training Camp — South Island', 'Shinsa — North Island', 'Shinsa — South Island',
    'Nationals', 'Kyu Grading', 'Seminar', 'Dojo Operators Meeting'];
  ok('the form offers the federation\'s event types', types.every((t) => form.html.includes(t)));
  ok('and contacts, cost and a map pin', ['contactName', 'contactEmail', 'costNote', 'infoUrl', 'latitude'].every((n) => form.html.includes(`name="${n}"`)));

  const when = await day(40), end = await day(41);
  const base = { eventType: 'camp_north', title: '', startsAt: `${when}T09:00`, endsAt: `${end}T16:00`, venueName: 'Whanganui Collegiate Gym',
    addressLine: '1 Hospital Road, Whanganui', contactName: 'Doug Holloway', contactPhone: '06 345 0000', contactEmail: 'doug@example.nz',
    costNote: '$60 adults, $40 juniors', infoUrl: 'https://example.nz/camp', latitude: '-39.9301', longitude: '175.0479',
    visibility: 'public', status: 'published', kind: 'training' };

  let r = await req('/o/whanganui/events/new', { method: 'POST', form: { ...base, contactEmail: 'not-an-email' } });
  ok('a bad contact email is refused, with the form kept', r.status === 422 && /contact email/.test(r.html) && /Doug Holloway/.test(r.html));
  r = await req('/o/whanganui/events/new', { method: 'POST', form: { ...base, longitude: '' } });
  ok('a pin needs both numbers', r.status === 422 && /both latitude and longitude/.test(r.html));
  r = await req('/o/whanganui/events/new', { method: 'POST', form: { ...base, infoUrl: 'javascript:alert(1)' } });
  ok('a link that is not https is refused', r.status === 422 && /https/.test(r.html));

  r = await req('/o/whanganui/events/new', { method: 'POST', form: base });
  ok('a good one is saved', r.status === 302 && /done=/.test(r.location), r.html.slice(0, 200));
  const ev = await one(`select e.id, e.kind, e.title, e.slug, d.type_key, d.contact_name, d.cost_note, d.latitude::float as lat
    from event e left join event_detail d on d.event_id = e.id where e.organisation_id=$1 order by e.created_at desc limit 1`, [wh.id]);
  eventSlug = ev.slug; var eventId = ev.id;
  ok('the title comes from the type when left blank', ev.title === 'North Island Training Camp');
  ok('and the kind follows the type', ev.kind === 'camp');
  ok('the details are kept', ev.type_key === 'camp_north' && ev.contact_name === 'Doug Holloway' && ev.cost_note.startsWith('$60') && ev.lat === -39.9301);

  r = await req(`/o/whanganui/events/${eventSlug}/edit`);
  ok('editing shows what was chosen', /<option value="camp_north" selected>/.test(r.html) && /value="Doug Holloway"/.test(r.html) && /value="-39.9301"/.test(r.html));
  r = await req(`/o/whanganui/events/${eventSlug}/edit`, { method: 'POST', form: { ...base, eventType: 'seminar', title: 'Karate Seminar with Shihan Tanaka', status: 'published' } });
  if (r.status !== 302) console.log('   edit said', r.status, (r.html.match(/class="bad">([^<]*)/) ?? [])[1]);
  ok('the type can be changed', r.status === 302 && (await one(`select d.type_key from event_detail d where d.event_id=$1`, [eventId])).type_key === 'seminar');
  eventSlug = (await one('select slug from event where id=$1', [eventId])).slug;
  r = await req(`/o/whanganui/events/${eventSlug}/edit`, { method: 'POST', form: { ...base, slug: eventSlug, eventType: 'shinsa_south', title: '', status: 'published' } });
  ok('and back to another', r.status === 302);
}

console.log('\nTHE BANNER AND THE PAGE');
{
  await build();
  const events = fs.readFileSync(path.join(OUT, 'events/index.html'), 'utf8');
  ok('the federation\'s events list shows banners', /class="evbanner small"/.test(events) && /class="evcard"/.test(events));
  const imgs = [...events.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  ok('the only picture is the crest', imgs.length > 0 && imgs.every((i) => /class="(crest|crestmark)"/.test(i)));
  const club0 = fs.readFileSync(path.join(OUT, 'whanganui/index.html'), 'utf8');
  ok('a dojo\'s own event shows on its page as a banner', /<span class="evtop">South Island<\/span>/.test(club0) && /<span class="evmain">Shinsa<\/span>/.test(club0));
  ok('the date is written out', /<span class="evwhen">\d+(–\d+)? \w+<\/span>/.test(club0));
  ok('and links to a page under the dojo', new RegExp(`href="/whanganui/events/${eventSlug}"`).test(club0));
  const html = fs.readFileSync(path.join(OUT, 'whanganui/events', eventSlug, 'index.html'), 'utf8');
  ok('without anybody at the federation approving it', !fs.existsSync(path.join(OUT, 'events', eventSlug)));
  ok('the event page has the big banner', /class="evbanner"/.test(html) && /Shinsa/.test(html));
  ok('the banner names the dojo that is running it', /<span class="evhost">Whanganui Dojo<\/span>/.test(html));
  ok('the heading is there for screen readers and search', /<h1 class="sr">/.test(html));
  ok('the venue and address are listed', /Whanganui Collegiate Gym/.test(html) && /1 Hospital Road/.test(html));
  ok('the contact is a phone and an email link', /href="tel:063450000"/.test(html) && /href="mailto:doug@example.nz"/.test(html));
  ok('cost and a more-information link are there', /\$60 adults/.test(html) && /href="https:\/\/example.nz\/camp"/.test(html));
  ok('the map is shown with a pin and links out', /openstreetmap\.org\/export\/embed\.html\?bbox=/.test(html) && /marker=-39.9301%2C175.0479/.test(html)
    && /Open in Google Maps/.test(html));
  ok('the crest sits in the header too', /class="crestmark"/.test(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8')));
  ok('the banner font is requested the way Google accepts it', /family=Anton["&]/.test(html) && !/Anton:wght/.test(html));
  const club = fs.readFileSync(path.join(OUT, 'whanganui/index.html'), 'utf8');
  ok('a dojo page lists its events as banners', /class="evcard"/.test(club));
  ok('and has no gallery until it has pictures', !/class="gallery"/.test(club));
}

console.log('\nA DOJO GALLERY');
{
  await signIn('doug@example.nz');
  let r = await req('/o/whanganui/gallery');
  ok('the operator\'s gallery screen opens', r.status === 200 && /0 of 300/.test(r.html));
  ok('with the size to aim for', /1200 × 800/.test(r.html));
  r = await multi('/o/whanganui/gallery', { caption: 'Juniors after a grading', alt_text: 'Juniors bowing' }, { field: 'file', bytes: PNG, name: 'juniors.png' });
  ok('uploading a picture adds it', r.status === 302 && /done=Added/.test(r.location));
  ok('and says when it is small', /wide/.test(decodeURIComponent(r.location)));
  const lib = await mkAsset(wh.id, 'hall.png');
  r = await multi('/o/whanganui/gallery', { assetId: lib.id, caption: 'The hall' });
  ok('a picture already in the library can be chosen', r.status === 302 && /done=Added/.test(r.location));
  r = await multi('/o/whanganui/gallery', { assetId: lib.id });
  ok('twice is refused', /error=/.test(r.location) && /already/.test(decodeURIComponent(r.location)));
  const theirs = await mkAsset(wn.id, 'theirs.png');
  r = await multi('/o/whanganui/gallery', { assetId: theirs.id });
  ok('another club\'s picture cannot be used', /error=/.test(r.location) && (await one(`select count(*)::int as n from club_gallery where organisation_id=$1`, [wh.id])).n === 2);
  r = await multi('/o/whanganui/gallery', {});
  ok('nothing chosen says so', /error=/.test(r.location));

  const rows = async () => (await pool.query(`select id, caption from club_gallery where organisation_id=$1 order by position`, [wh.id])).rows;
  let [first, second] = await rows();
  ok('they are in the order added', first.caption === 'Juniors after a grading' && second.caption === 'The hall');
  await req(`/o/whanganui/gallery/${second.id}/move`, { method: 'POST', form: { direction: 'up' } });
  ok('one can move earlier', (await rows())[0].caption === 'The hall');
  await req(`/o/whanganui/gallery/${second.id}/caption`, { method: 'POST', form: { caption: 'Our hall' } });
  ok('captions can be changed', (await rows())[0].caption === 'Our hall');

  await build();
  let club = fs.readFileSync(path.join(OUT, 'whanganui/index.html'), 'utf8');
  ok('the page shows the strip, in order, with captions', /class="gallery"/.test(club) && club.indexOf('Our hall') < club.indexOf('Juniors after a grading'));
  ok('the pictures are files on the site', (club.match(/<img src="\/images\/[^"]+" alt/g) ?? []).length === 2);

  await req(`/o/whanganui/gallery/${second.id}/remove`, { method: 'POST', form: {} });
  ok('removing takes it out and closes the gap', (await rows()).length === 1 && (await one(`select position from club_gallery where organisation_id=$1`, [wh.id])).position === 0);

}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
