/**
 * One-click entry.
 *
 *   1. Nothing to choose (a grading): the offer itself is the button.
 *   2. Same as last time and the weight is recent: one press.
 *   3. A weight older than 60 days, a different division, a first entry, or a
 *      declaration to read: the person is shown what is different, never a
 *      quiet carry-over.
 *   4. Experience is counted from the record, not typed.
 *   5. Nobody can use the shortcut for somebody they may not act for.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people, competition } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
const OUT = '/tmp/honbu-member-entries';
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
const wellington = await one(`select * from organisation where slug='wellington'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, {
  organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });


const addEvent = async (org, over = {}) => one(`
  insert into event (organisation_id, kind, title, slug, starts_at, visibility, status,
    entries_open, entries_close, guardian_under, consent_version, consent_text)
  values ($1,$2,$3,$4, now() + interval '40 days', $5, $6,
    now() - interval '1 day', $7, $8, $9, $10) returning *`,
  [org.id, over.kind ?? 'grading', over.title, over.slug, over.visibility ?? 'public',
   over.status ?? 'published',
   over.close ?? new Date(Date.now() + 30 * 864e5).toISOString(),
   over.guardianUnder ?? 16, over.consent === null ? null : 'v1',
   over.consent === null ? null : 'I accept the risks of training.']);


const rua = await enrol('Rua', 'Quick', '1990-03-03', 'rua@example.nz');
const hone = await enrol('Hone', 'Other', '1991-03-03', 'hone@example.nz');
const kidQ = await enrol('Mere', 'Quick', '2016-03-03');
for (const p of [rua, hone]) await pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [p.email, p.id]);
const entriesOf = (personId) => pool.query(`select * from event_entry where person_id=$1 order by created_at`, [personId]).then((r) => r.rows);

const tourney = async (title, slug, { consent = null, divisions } = {}) => {
  const e = await addEvent(wh, { title, slug, kind: 'tournament', guardianUnder: 18, consent });
  const d = await competition.addDiscipline(doug.id, e.id, { name: 'Kumite' });
  for (const dv of divisions ?? [{ label: 'Open 60-80', minWeightKg: 60, maxWeightKg: 80 }])
    await competition.addDivision(doug.id, d.id, dv);
  return e;
};

await signIn('rua@example.nz');

console.log('\nNOTHING TO CHOOSE: THE OFFER IS THE BUTTON');
const g1 = await addEvent(wh, { title: 'Quick Grading', slug: 'q-grading', consent: null });
{
  const list = await req('/me/events');
  ok('the grading offers a button that posts', new RegExp(`action="/me/events/${g1.id}/${rua.id}/quick"`).test(list.html));
  const r = await req(`/me/events/${g1.id}/${rua.id}/quick`, { method: 'POST', form: {} });
  ok('one press enters', r.status === 302, `${r.status} ${r.location}`);
  const [e] = (await entriesOf(rua.id));
  ok('a real entry exists', !!e && e.status === 'entered' && e.weight_kg === null);
  ok('pressing again does not duplicate', (await req(`/me/events/${g1.id}/${rua.id}/quick`, { method: 'POST', form: {} })).status === 302 && (await entriesOf(rua.id)).length === 1);
}

console.log('\nFIRST TIME: THE FORM, WITH A REASON');
const t1 = await tourney('Quick Open One', 'q-open-1');
{
  const list = await req('/me/events');
  ok('a tournament is a link the first time, not a button', !new RegExp(`/me/events/${t1.id}/${rua.id}/quick`).test(list.html));
  const form = await req(`/me/events/${t1.id}/${rua.id}`);
  ok('the form opens and says why', form.status === 200 && /first entry/.test(form.html));
  const disc1 = (await competition.setupFor(t1.id)).disciplines[0];
  const send = { [`disc_${disc1.id}`]: '1', weight: '74', height: '178' };
  const preview = await req(`/me/events/${t1.id}/${rua.id}`, { method: 'POST', form: send });
  ok('checked', preview.status === 200 && /Open 60-80/.test(preview.html));
  const done = await req(`/me/events/${t1.id}/${rua.id}`, { method: 'POST', form: { ...send, confirm: 'yes' } });
  ok('entered', done.status === 302);
  const mine = (await entriesOf(rua.id)).find((e) => e.event_id === t1.id);
  ok('weight and height remembered on the entry', Number(mine.weight_kg) === 74 && mine.height_cm === 178);
  ok('years training worked out from the roll', mine.years_training != null);
  ok('prior events counted from the record (none yet)', mine.prior_events === 0);
}

console.log('\nSAME AS LAST TIME: ONE PRESS');
const t2 = await tourney('Quick Open Two', 'q-open-2');
{
  const list = await req('/me/events');
  ok('now a direct button', new RegExp(`action="/me/events/${t2.id}/${rua.id}/quick"`).test(list.html));
  ok('says what it will repeat', /Same as last time: Kumite, 74 kg/.test(list.html));
  const r = await req(`/me/events/${t2.id}/${rua.id}/quick`, { method: 'POST', form: {} });
  ok('one press enters', r.status === 302);
  const e = (await entriesOf(rua.id)).find((x) => x.event_id === t2.id);
  ok('with the remembered weight', Number(e.weight_kg) === 74);
  const sel = await one(`select v.label from entry_selection s join event_division v on v.id = s.division_id where s.entry_id=$1`, [e.id]);
  ok('in the division the rules chose', sel?.label === 'Open 60-80');
}

console.log('\nA WEIGHT THAT IS TOO OLD ASKS AGAIN');
const t3 = await tourney('Quick Open Three', 'q-open-3');
{
  await pool.query(`update event_entry set created_at = now() - interval '90 days' where person_id=$1`, [rua.id]);
  const list = await req('/me/events');
  ok('no direct button', !new RegExp(`/me/events/${t3.id}/${rua.id}/quick`).test(list.html));
  const form = await req(`/me/events/${t3.id}/${rua.id}`);
  ok('the form says the weight is old', /a while ago/.test(form.html));
  ok('and has the old weight filled in', /value="74/.test(form.html));
  const r = await req(`/me/events/${t3.id}/${rua.id}/quick`, { method: 'POST', form: {} });
  ok('the shortcut is refused, sent to the form', r.status === 302 && /edit=1/.test(r.location ?? ''));
  ok('and nothing was entered', !(await entriesOf(rua.id)).some((x) => x.event_id === t3.id));
}

console.log('\nA DIFFERENT DIVISION IS SHOWN, NOT ASSUMED');
{
  await pool.query(`update event_entry set created_at = now() - interval '5 days' where person_id=$1`, [rua.id]);
  const t4 = await tourney('Quick Open Four', 'q-open-4', { divisions: [{ label: 'Heavy 70-90', minWeightKg: 70, maxWeightKg: 90 }] });
  const form = await req(`/me/events/${t4.id}/${rua.id}`);
  ok('shown the form, not the button', /Your division is different/.test(form.html));
  ok('with what changed', /Open 60-80 → Heavy 70-90/.test(form.html));
  const r = await req(`/me/events/${t4.id}/${rua.id}/quick`, { method: 'POST', form: {} });
  ok('the shortcut is refused', r.status === 302 && /edit=1/.test(r.location ?? ''));
}

console.log('\nA DECLARATION IS READ, THEN ONE PRESS AGREES');
{
  const t5 = await tourney('Quick Open Five', 'q-open-5', { consent: 'v1' });
  const list = await req('/me/events');
  ok('not a silent button on the list', !new RegExp(`action="/me/events/${t5.id}/${rua.id}/quick"`).test(list.html));
  const screen = await req(`/me/events/${t5.id}/${rua.id}`);
  ok('the one-click screen shows the declaration', /accept the risks/.test(screen.html) && /I agree/.test(screen.html));
  const r = await req(`/me/events/${t5.id}/${rua.id}/quick`, { method: 'POST', form: {} });
  ok('one press agrees and enters', r.status === 302);
  const e = (await entriesOf(rua.id)).find((x) => x.event_id === t5.id);
  const c = await one(`select * from entry_consent where entry_id=$1`, [e.id]);
  ok('consent recorded against the version', c?.version === 'v1');
  ok('in the name of whoever pressed it', c?.accepted_name === 'Rua Quick');
}

console.log('\nEXPERIENCE IS COUNTED, NOT TYPED');
{
  const past = await one(`insert into event (organisation_id, kind, title, slug, starts_at, status, visibility)
    values ($1,'tournament','Old Open','old-open', now() - interval '200 days','published','public') returning id`, [wh.id]);
  await pool.query(`insert into event_entry (event_id, person_id, status) values ($1,$2,'confirmed')`, [past.id, rua.id]);
  await pool.query(`update affiliation set starts = '2018-01-01' where person_id = $1`, [rua.id]);
  const { memberEvents } = await import('./data.mjs');
  const x = await memberEvents.experience(rua.id);
  ok('one past tournament', x.priorEvents === 1);
  ok('years on the roll', x.yearsTraining >= 5);
}

console.log('\nNOBODY ELSE\'S SHORTCUT');
{
  await signIn('hone@example.nz');
  const g2 = await addEvent(wh, { title: 'Quick Grading Two', slug: 'q-grading-2', consent: null });
  const r = await req(`/me/events/${g2.id}/${rua.id}/quick`, { method: 'POST', form: {} });
  ok('cannot enter somebody they do not look after', r.status === 403 || r.status === 404, String(r.status));
  ok('nothing was entered', !(await entriesOf(rua.id)).some((x) => x.event_id === g2.id));
  const kid2 = await req(`/me/events/${g2.id}/${kidQ.id}/quick`, { method: 'POST', form: {} });
  ok('or another family\'s child', kid2.status === 403 || kid2.status === 404);
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
