/**
 * Can somebody who runs a dojo actually put an event on the calendar?
 *
 * This drives the real HTTP routes with real form posts against a real
 * database — no stubs. If this passes, a person with a browser can do it.
 *
 * It is deliberately written as a sequence somebody would actually perform:
 * open the calendar, add an event, get it wrong, fix it, publish it, change the
 * date, call it off. Tests that poke one route at a time never catch the thing
 * that is broken between two of them.
 */

import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';

const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const jar = {};
async function req(path, { method = 'GET', form } = {}) {
  const headers = {};
  const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (c) headers.cookie = c;
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + path, {
    method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
               : undefined,
  });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}

/** What the redirect said, decoded — the message the person actually sees. */
const messageIn = (location) =>
  decodeURIComponent(new URL(location, base).searchParams.get('done')
    ?? new URL(location, base).searchParams.get('error') ?? '');

const FULL = {
  title: 'Summer Kyu Grading', kind: 'grading', slug: '',
  summary: 'Kyu grades only. Bring your licence.',
  startsAt: '2026-12-05T09:00', endsAt: '2026-12-05T13:00',
  venueName: 'Springvale Hall', addressLine: '1 Hall Road, Whanganui',
  visibility: 'public', minRankOrder: '', maxRankOrder: '',
  minAge: '', maxAge: '', entriesOpen: '', entriesClose: '2026-11-28T17:00',
  capacity: '40',
};

// ---------------------------------------------------------------------------

console.log('\nTHE CALENDAR IS BEHIND SIGN-IN');
{
  ok('the list redirects when signed out',
    (await req('/o/whanganui/events')).status === 302);
  ok('so does the form',
    (await req('/o/whanganui/events/new')).status === 302);
  await req('/signin');
  const posted = await req('/o/whanganui/events/new',
    { method: 'POST', form: FULL });
  ok('and so does posting one', posted.status === 302 || posted.status === 403,
    String(posted.status));
}

console.log('\nSIGNED IN AS SOMEONE WHO RUNS A DOJO');
{
  const { token } = await auth.requestLink('doug@example.nz');
  const r = await req(`/signin/${token}`);
  ok('the session is live', r.status === 302 && !!jar.honbu_session);

  const list = await req('/o/whanganui/events');
  ok('the calendar opens', list.status === 200);
  ok('with a way to add one', list.html.includes('/o/whanganui/events/new'));
}

console.log('\nTHE FORM OFFERS THIS FEDERATION\'S OWN GRADES');
{
  const f = await req('/o/whanganui/events/new');
  ok('it renders', f.status === 200);
  ok('with a title field', f.html.includes('name="title"'));
  ok('and every event kind', f.html.includes('value="grading"')
    && f.html.includes('value="tournament"'));
  ok('the grade limits come from the register, not a hard-coded list',
    f.html.includes('kyu') || f.html.includes('Shodan'),
    'no grade labels in the dropdowns');
  ok('and it says which timezone the times are in',
    f.html.includes('Pacific/Auckland'));
  ok('it carries a csrf token', f.html.includes('name="_csrf"'));
}

console.log('\nA FORM FILLED IN WRONG COMES BACK WITH THE ANSWERS STILL IN IT');
{
  const bad = await req('/o/whanganui/events/new', { method: 'POST',
    form: { ...FULL, endsAt: '2026-12-05T08:00' } });
  ok('it is refused', bad.status === 422, String(bad.status));
  ok('and says what was wrong', bad.html.includes('the end is before the start'),
    bad.html.slice(0, 200));
  ok('with the title still typed in', bad.html.includes('Summer Kyu Grading'));
  ok('and the venue too', bad.html.includes('Springvale Hall'));
  ok('and the capacity', bad.html.includes('value="40"'));

  const { rows: [n] } = await pool.query(
    `select count(*)::int n from event where slug = 'summer-kyu-grading'`);
  ok('nothing was saved', n.n === 0, `${n.n} rows`);
}

console.log('\nEVERY PROBLEM AT ONCE, NOT ONE AT A TIME');
{
  const bad = await req('/o/whanganui/events/new', { method: 'POST',
    form: { ...FULL, endsAt: '2026-12-05T08:00',
            entriesClose: '2026-12-09T09:00', capacity: '0' } });
  ok('all three are reported together',
    bad.html.includes('the end is before the start')
    && bad.html.includes('entries close after the event starts')
    && bad.html.includes('capacity is less than one place'));
}

console.log('\nSAVING ONE AS A DRAFT');
{
  const r = await req('/o/whanganui/events/new',
    { method: 'POST', form: { ...FULL, status: 'draft' } });
  ok('it redirects back to the calendar',
    r.status === 302 && r.location.startsWith('/o/whanganui/events?'));
  ok('saying what happened, by name',
    messageIn(r.location).includes('Summer Kyu Grading'), messageIn(r.location));

  const { rows: [e] } = await pool.query(
    `select * from event where slug = 'summer-kyu-grading'`);
  ok('the row is there', !!e);
  ok('the web address was made from the title', e?.slug === 'summer-kyu-grading');
  ok('it is a draft', e?.status === 'draft');
  ok('the venue was kept', e?.venue_name === 'Springvale Hall');
  ok('and the capacity', e?.capacity === 40);

  // 9am in December in New Zealand is UTC+13, so 20:00 the day before.
  ok('9am means 9am in Whanganui, not on the server',
    e?.starts_at.toISOString() === '2026-12-04T20:00:00.000Z',
    e?.starts_at.toISOString());
}

console.log('\nA DRAFT IS NOT ON THE PUBLIC SITE');
{
  const { rows } = await pool.query(
    `select * from event where slug='summer-kyu-grading' and status='published'`);
  ok('nothing published yet', rows.length === 0);

  const list = await req('/o/whanganui/events');
  ok('but the person who made it can see it', list.html.includes('Summer Kyu Grading'));
  ok('marked as a draft', list.html.includes('Draft'));
}

console.log('\nTHE SAME EVENT TWICE IS DECIDED BY WHEN, NOT BY TITLE');
{
  const again = await req('/o/whanganui/events/new',
    { method: 'POST', form: { ...FULL, status: 'draft' } });
  ok('the same kind at the same time is refused', again.status === 422);
  ok('by name, with what to do about it',
    again.html.includes('already has') && again.html.includes('at that date and time')
    && again.html.includes('change the time'));
  ok('the form no longer asks for a web address', !/name="slug" value=""/.test(again.html) && !/Web address/.test(again.html));
  const later = await req('/o/whanganui/events/new',
    { method: 'POST', form: { ...FULL, startsAt: '2026-12-12T09:00', endsAt: '2026-12-12T12:00', status: 'draft' } });
  ok('the same title on another day is fine', later.status === 302, later.html.slice(0, 160));
}

console.log('\nOPENING IT TO CHANGE IT');
{
  const f = await req('/o/whanganui/events/summer-kyu-grading/edit');
  ok('the form opens filled in', f.status === 200
    && f.html.includes('value="Summer Kyu Grading"'));
  ok('the start time reads back as 9am local, not 8pm the day before',
    f.html.includes('value="2026-12-05T09:00"'),
    (f.html.match(/name="startsAt"[^>]*/) ?? [''])[0]);
  ok('entries closing reads back too',
    f.html.includes('value="2026-11-28T17:00"'));
  ok('it offers to publish', f.html.includes('Save and publish'));
  ok('and to call it off', f.html.includes('Cancel this event'));
}

console.log('\nPUBLISHING IT');
{
  const r = await req('/o/whanganui/events/summer-kyu-grading/edit',
    { method: 'POST', form: { ...FULL, status: 'published' } });
  ok('it saves', r.status === 302, String(r.status) + ' ' + r.html.slice(0, 300));

  const { rows: [e] } = await pool.query(
    `select * from event where slug='summer-kyu-grading'`);
  ok('the status changed', e?.status === 'published');
  ok('and it is the same event, not a new one',
    (await pool.query(`select count(*)::int n from event
      where slug='summer-kyu-grading'`)).rows[0].n === 1);
}

console.log('\nMOVING THE DATE');
{
  const r = await req('/o/whanganui/events/summer-kyu-grading/edit',
    { method: 'POST', form: { ...FULL, status: 'published',
      startsAt: '2026-12-12T10:00', endsAt: '2026-12-12T14:00',
      venueName: 'Wanganui Girls College Gym' } });
  ok('it saves', r.status === 302);

  const { rows: [e] } = await pool.query(
    `select * from event where slug='summer-kyu-grading'`);
  ok('the new date is stored, in the right zone',
    e?.starts_at.toISOString() === '2026-12-11T21:00:00.000Z',
    e?.starts_at.toISOString());
  ok('the venue changed', e?.venue_name === 'Wanganui Girls College Gym');
  ok('and it is still published', e?.status === 'published');
}

console.log('\nRENAMING IT MOVES ITS WEB ADDRESS');
{
  const r = await req('/o/whanganui/events/summer-kyu-grading/edit',
    { method: 'POST', form: { ...FULL, title: 'December Kyu Grading',
      slug: 'december-kyu-grading', status: 'published' } });
  ok('it saves', r.status === 302, String(r.status));

  const { rows: [e] } = await pool.query(
    `select * from event where slug='december-kyu-grading'`);
  ok('the new address works', !!e);
  ok('the title changed with it', e?.title === 'December Kyu Grading');
  ok('and the old address is gone', (await pool.query(
    `select count(*)::int n from event where slug='summer-kyu-grading'`))
    .rows[0].n === 0);
}

console.log('\nCALLING IT OFF LEAVES A RECORD');
{
  const r = await req('/o/whanganui/events/december-kyu-grading/cancel',
    { method: 'POST', form: {} });
  ok('it redirects with a message',
    r.status === 302 && messageIn(r.location).includes('cancelled'),
    messageIn(r.location));

  const { rows: [e] } = await pool.query(
    `select * from event where slug='december-kyu-grading'`);
  ok('the event is still there', !!e);
  ok('marked cancelled, not deleted', e?.status === 'cancelled');

  const list = await req('/o/whanganui/events');
  ok('and the calendar says so', list.html.includes('Cancelled'));
}

console.log('\nTHE NATIONAL OWNER REACHES EVERY CLUB BENEATH HIM');
{
  // Doug's grant is owner at the national body, so his authority runs down the
  // whole tree. That is the point of the tree, and it is worth asserting
  // rather than assuming.
  const f = await req('/o/far-north/events/new');
  ok('a club he has no direct grant at is still his to schedule',
    f.status === 200, String(f.status));
}

console.log('\nSOMEBODY ELSE\'S CLUB IS NOT');
{
  // Tane administers Wellington and nothing above it.
  const jarSaved = { ...jar };
  for (const k of Object.keys(jar)) delete jar[k];
  await req('/signin');
  const { token } = await auth.requestLink('tane@example.nz');
  await req(`/signin/${token}`);

  const own = await req('/o/wellington/events');
  ok('he can open his own calendar', own.status === 200, String(own.status));

  const list = await req('/o/whanganui/events');
  ok('another club\'s calendar is refused outright', list.status === 403,
    String(list.status));
  ok('with a message that says whose it is',
    list.html.includes('do not have access'), list.html.slice(0, 200));

  const f = await req('/o/whanganui/events/new');
  ok('and he is not shown a form for it', f.status === 403, String(f.status));

  const before = (await pool.query(`select count(*)::int n from event e
    join organisation o on o.id = e.organisation_id
    where o.slug = 'whanganui'`)).rows[0].n;
  const p = await req('/o/whanganui/events/new',
    { method: 'POST', form: { ...FULL, title: 'Snuck in', status: 'draft' } });
  ok('posting to it is refused', p.status === 403, String(p.status));
  const after = (await pool.query(`select count(*)::int n from event e
    join organisation o on o.id = e.organisation_id
    where o.slug = 'whanganui'`)).rows[0].n;
  ok('and nothing was written', after === before, `${before} → ${after}`);

  const edit = await req('/o/whanganui/events/december-kyu-grading/edit');
  ok('nor can he edit one that exists there', edit.status === 403,
    String(edit.status));

  for (const k of Object.keys(jar)) delete jar[k];
  Object.assign(jar, jarSaved);
}

console.log('\nA 404 FOR AN EVENT THAT IS NOT THERE');
{
  const r = await req('/o/whanganui/events/no-such-thing/edit');
  ok('says so', r.status === 404, String(r.status));
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
await pool.end();
process.exit(fail ? 1 : 0);
