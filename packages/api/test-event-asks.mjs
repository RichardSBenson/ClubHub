/**
 * A club's grading goes on its own page, and on the federation's by asking.
 *
 * Richard: "if Whanganui has a grading they should have access to the events
 * system to publish a grading event to their page, and it should also go onto
 * the main page via asking, the same as a new article."
 *
 *   1. A club publishes an event and it is on its own page without anybody's say-so.
 *   2. It is NOT on the federation's calendar until it asks and is approved.
 *   3. A club cannot approve itself; a draft cannot ask.
 *   4. Declined stays on the club's own page. Every decision is in the history.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
const OUT = '/tmp/honbu-event-asks';
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
const wh = await one(`select * from organisation where slug='whanganui'`);
const federation = await one(`select * from organisation where parent_id is null`);
const site = (rel) => { const f = path.join(OUT, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
const ev = (slug) => one(`select * from event where organisation_id=$1 and slug=$2`, [wh.id, slug]);
const day = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);

await signIn('doug@example.nz');

console.log('\nWHANGANUI SCHEDULES A GRADING');
{
  const made = await req('/o/whanganui/events/new', { method: 'POST', form: {
    title: 'Whanganui Dojo Grading', kind: 'grading', visibility: 'public',
    startsAt: day + 'T10:00', endsAt: day + 'T13:00', venueName: 'Cooks Gardens Hall',
    summary: 'Kyu grading for juniors and adults.', status: 'draft' } });
  ok('the events screen takes it', made.status === 302, `${made.status} ${made.html.slice(0, 200)}`);
  const row = await one(`select * from event where organisation_id=$1 and kind='grading'
    and title='Whanganui Dojo Grading'`, [wh.id]);
  ok('as a grading, on Whanganui\'s own calendar', !!row);
  globalThis.slug = row?.slug;
}
const slug = globalThis.slug;

console.log('\nA DRAFT CANNOT ASK; A PUBLISHED EVENT STAYS OFF THE FEDERATION UNTIL APPROVED');
{
  const early = await req(`/o/whanganui/events/${slug}/ask`, { method: 'POST', form: {} });
  ok('a draft cannot be put forward', /error=/.test(early.location ?? '')
    && (await ev(slug)).publish_up_state === 'none');

  await pool.query(`update event set status='published' where id=$1`, [(await ev(slug)).id]);
  const ask = await req(`/o/whanganui/events/${slug}/ask`, { method: 'POST', form: {} });
  ok('once published it can ask', /done=/.test(ask.location ?? ''), ask.location);
  ok('and is recorded as requested', (await ev(slug)).publish_up_state === 'requested');

  await build();
  ok('requested is not approved: not on the federation\'s calendar',
    !site('events/index.html')?.includes('Whanganui Dojo Grading'));
  const screen = await req('/o/moknz/events');
  ok('the federation sees the request, with who it is from',
    /Asking to go on this calendar/.test(screen.html)
    && /Whanganui Dojo Grading/.test(screen.html));
}

console.log('\nA CLUB CANNOT APPROVE ITSELF');
{
  const id = (await ev(slug)).id;
  const self = await req(`/o/whanganui/event-requests/${id}/decide`,
    { method: 'POST', form: { answer: 'approve' } });
  ok('refused', /error=/.test(self.location ?? ''), self.location);
  ok('and still only requested', (await ev(slug)).publish_up_state === 'requested');
}

console.log('\nTHE FEDERATION DECIDES');
{
  const id = (await ev(slug)).id;
  const no = await req(`/o/${federation.slug}/event-requests/${id}/decide`,
    { method: 'POST', form: { answer: 'decline' } });
  ok('declining works', /done=/.test(no.location ?? ''));
  ok('and says declined', (await ev(slug)).publish_up_state === 'declined');
  await build();
  ok('so it is not on the federation\'s calendar',
    !site('events/index.html')?.includes('Whanganui Dojo Grading'));

  await req(`/o/whanganui/events/${slug}/ask`, { method: 'POST', form: {} });
  const yes = await req(`/o/${federation.slug}/event-requests/${id}/decide`,
    { method: 'POST', form: { answer: 'approve' } });
  ok('asking again and approving works', /done=/.test(yes.location ?? ''));
  ok('and says approved', (await ev(slug)).publish_up_state === 'approved');

  const again = await req(`/o/${federation.slug}/event-requests/${id}/decide`,
    { method: 'POST', form: { answer: 'decline' } });
  ok('an answered request cannot be answered again', /error=/.test(again.location ?? ''));

  await build();
  const list = site('events/index.html') ?? '';
  ok('now it is on the federation\'s calendar', list.includes('Whanganui Dojo Grading'));
  ok('credited to the club', /Whanganui/.test(list));
  ok('with a page of its own, that cannot collide with the federation\'s',
    !!site(`events/${slug}-whanganui/index.html`));

  // Fixing a typo after approval must not quietly withdraw the listing.
  const edit = await req(`/o/whanganui/events/${slug}/edit`, { method: 'POST', form: {
    title: 'Whanganui Dojo Grading', kind: 'grading', visibility: 'public',
    startsAt: day + 'T10:00', endsAt: day + 'T13:00', venueName: 'Cooks Gardens Hall',
    summary: 'Kyu grading, juniors and adults.', status: 'published' } });
  ok('editing an approved event works', edit.status === 302, String(edit.status));
  ok('and keeps it approved', (await ev(slug)).publish_up_state === 'approved'
    && (await ev(slug)).publish_up === true);

  const log = await one(`select count(*)::int n from audit_log
    where entity='event' and entity_id=$1 and action in
    ('event_publish_up_asked','event_publish_up')`, [id]);
  ok('every ask and answer is in the history', log.n === 4, String(log.n));
}

console.log('\nITS OWN PAGE CARRIES IT WITHOUT ANYBODY\'S SAY-SO');
{
  await pool.query(`update event set publish_up=false, publish_up_state='none' where id=$1`,
    [(await ev(slug)).id]);
  await pool.query(`insert into dojo_profile (organisation_id, published) values ($1, true)
    on conflict (organisation_id) do update set published = true`, [wh.id]);
  await build();
  const page = site('whanganui/index.html') ?? '';
  ok('Whanganui\'s own page shows the grading', page.includes('Whanganui Dojo Grading'));
  ok('and the federation\'s calendar does not',
    !site('events/index.html')?.includes('Whanganui Dojo Grading'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
