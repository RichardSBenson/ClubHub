/**
 * The member portal's home.
 *
 *   1. The dashboard shows me, my children, and nobody else.
 *   2. Next class respects age and grade limits and the club's own clock.
 *   3. What needs attention is worked out from the record.
 *   4. Messages from the club appear, are marked read once opened, and are only ever the recipient's.
 *   5. Record, documents and timetable are for the person and their guardians only.
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
process.env.MESSENGER_PROVIDER = 'none';
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
  await req(`/signin/${token}`, { method: 'POST', form: {} });
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



const wl = await one(`select * from organisation where slug='wellington'`);
const mum = await enrol('Mere', 'Portal', '1985-05-05', 'mere.portal@example.nz');
const kid = await enrol('Tama', 'Portal', '2015-04-04');
const stranger = await enrol('Sam', 'Stranger', '1990-01-01', 'sam.stranger@example.nz');
for (const p of [mum, stranger]) await pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [p.email, p.id]);
await pool.query(`insert into guardian_link (guardian_id, child_id, relationship) values ($1,$2,'parent')`, [mum.id, kid.id]);

// A timetable: juniors every day (so there is always a next one), adults only on one weekday.
for (let d = 0; d < 7; d++)
  await pool.query(`insert into training_session (organisation_id, label, weekday, starts, ends, min_age, max_age)
    values ($1,'Juniors',$2,'16:00','17:00',6,12)`, [wh.id, d]);
await pool.query(`insert into training_session (organisation_id, label, weekday, starts, ends, min_age)
  values ($1,'Adults',3,'19:00','20:30',16)`, [wh.id]);
await pool.query(`update person set date_of_birth = '2015-04-04' where id=$1`, [kid.id]);

// A grading and attendance for the child.
const g = await one(`select id from grade order by rank_order limit 1`);
const gr = await one(`insert into grading_record (person_id, grade_id, awarded_on, result, certificate_no, awarded_by_org)
  values ($1,$2,'2026-03-03','pass','C-1',$3) returning id`, [kid.id, g.id, wh.id]);
for (const d of ['2026-09-01', '2026-09-08']) await pool.query(`insert into attendance (person_id, organisation_id, session_date) values ($1,$2,$3)`, [kid.id, wh.id, d]);

await signIn('mere.portal@example.nz');

console.log('\nTHE HOME SCREEN');
{
  const r = await req('/me');
  ok('opens', r.status === 200);
  ok('greets her', /Kia ora, Mere/.test(r.html));
  ok('shows her child', /Tama Portal/.test(r.html) && /you look after this person/.test(r.html));
  ok('and nobody else', !/Sam Stranger/.test(r.html));
  ok('every section is there', ['Membership', 'Current grade', 'Next class', 'Next event', 'Payments', 'Documents', 'Training', 'Notifications'].every((w) => r.html.includes(w)));
  ok('the child\'s grade', /since 2026-03-03/.test(r.html));
  ok('a next class for the child, not the adult one', /Juniors/.test(r.html));
  ok('her club is shown in the hierarchy', /Whanganui/.test(r.html));
  ok('still has the link to her details', /See and update my details/.test(r.html));
}

console.log('\nWHAT NEEDS ATTENTION');
{
  const before = await req('/me');
  ok('an emergency contact is asked for', /Add an emergency contact/.test(before.html));
  await pool.query(`insert into person_private (person_id, emergency_name, emergency_phone) values ($1,'Aunt','021 1') on conflict (person_id) do update set emergency_name='Aunt', emergency_phone='021 1'`, [mum.id]);
  await pool.query(`insert into person_private (person_id, emergency_name, emergency_phone) values ($1,'Aunt','021 1') on conflict (person_id) do update set emergency_name='Aunt', emergency_phone='021 1'`, [kid.id]);
  ok('and stops being asked once given', !/Add an emergency contact/.test((await req('/me')).html));

  await pool.query(`update affiliation set paid_until = '2020-01-01' where person_id=$1`, [kid.id]);
  const late = await req('/me');
  ok('an overdue membership is flagged', /membership ran out on 2020-01-01/.test(late.html));
  await pool.query(`update affiliation set paid_until = current_date + 400 where person_id=$1`, [kid.id]);

  const ev = await one(`insert into event (organisation_id, kind, title, slug, starts_at, status, visibility, entries_open, entries_close)
    values ($1,'grading','Portal Grading','portal-grading', now() + interval '30 days','published','public', now() - interval '1 day', now() + interval '3 days') returning id`, [wh.id]);
  ok('an event closing soon is flagged, for each person it is open to', ((await req('/me')).html.match(/Entries for Portal Grading close soon/g) ?? []).length === 2);
  await req(`/me/events/${ev.id}/${kid.id}/quick`, { method: 'POST', form: {} });
  const afterEntry = await req('/me');
  ok('once entered, it is the next event and no longer flagged for the child', /Portal Grading/.test(afterEntry.html) && (afterEntry.html.match(/Entries for Portal Grading close soon/g) ?? []).length === 1);
  ok('the next event says what kind it is and who runs it', /Grading · you are (entered|confirmed)/.test(afterEntry.html) && /Run by Whanganui/.test(afterEntry.html));
  const sem = await one(`insert into event (organisation_id, kind, title, slug, starts_at, status, visibility, entries_open, entries_close)
    values ($1,'seminar','Paid Seminar','paid-seminar', now() + interval '40 days','published','public', now() - interval '1 day', now() + interval '30 days') returning id`, [wh.id]);
  await pool.query(`insert into entry_price (event_id, for_count, amount_cents, label) values ($1,1,2500,'Entry fee')`, [sem.id]);
  await req(`/me/events/${sem.id}/${kid.id}/quick`, { method: 'POST', form: {} });
  const semEntry = await one(`select id, amount_cents from event_entry where event_id=$1 and person_id=$2`, [sem.id, kid.id]);
  ok('a seminar with a fee charges that fee on entry', semEntry?.amount_cents === 2500, String(semEntry?.amount_cents));
  ok('and a payment is waiting for it', !!(await one(`select 1 from payment where event_entry_id=$1 and amount_cents=2500`, [semEntry?.id])));
  const list = await req('/me/events');
  ok('the entered list names the kind and the host too', /Portal Grading<\/strong> <span class="tag">Grading<\/span>/.test(list.html) && /run by Whanganui/.test(list.html));
}

console.log('\nMESSAGES');
{
  const m = await one(`insert into message (organisation_id, kind, audience, subject, body, sender_name, sender_address)
    values ($1,'announcement','members','Grading next month','Kia ora from {club}. See {payLink}.','Whanganui Dojo','noreply@x.nz') returning id`, [wh.id]);
  const r1 = await one(`insert into message_recipient (message_id, person_id, email, about_id, status, sent_at)
    values ($1,$2,'mere.portal@example.nz',$3,'sent', now()) returning id`, [m.id, mum.id, kid.id]);
  const other = await one(`insert into message_recipient (message_id, person_id, email, status, sent_at)
    values ($1,$2,'sam.stranger@example.nz','sent', now()) returning id`, [m.id, stranger.id]);
  const queued = await one(`insert into message_recipient (message_id, person_id, email, status) values ($1,$2,'x@x.nz','queued') returning id`, [m.id, mum.id]);
  const home = await req('/me');
  ok('shown on the home screen as new', /Grading next month/.test(home.html) && /1 new/.test(home.html));
  const inbox = await req('/me/messages');
  ok('the inbox lists it, with who it is about', inbox.status === 200 && /Grading next month/.test(inbox.html) && /about Tama/.test(inbox.html));
  const open = await req(`/me/messages/${r1.id}`);
  ok('it opens, with the tokens filled', open.status === 200 && /Kia ora from Whanganui/.test(open.html) && /your payments page/.test(open.html) && !/\{club\}/.test(open.html));
  ok('and is marked read', (await one(`select read_at from message_recipient where id=$1`, [r1.id])).read_at !== null);
  ok('so the new count goes', !/1 new/.test((await req('/me')).html));
  ok('somebody else\'s message is not found', (await req(`/me/messages/${other.id}`)).status === 404);
  ok('and does not mark it read', (await one(`select read_at from message_recipient where id=$1`, [other.id])).read_at === null);
  ok('a message not yet sent is not shown', (await req(`/me/messages/${queued.id}`)).status === 404);
  ok('not an id at all', (await req('/me/messages/nope')).status === 404);
}

console.log('\nTHE CHILD\'S RECORD');
{
  const r = await req(`/me/${kid.id}/record`);
  ok('opens for her child', r.status === 200);
  ok('grade history', /Grade history/.test(r.html) && /2026-03-03/.test(r.html) && /Passed/.test(r.html));
  ok('with the certificate link', new RegExp(`/p/${kid.id}/certificate/${gr.id}`).test(r.html));
  ok('attendance and counts', /2026-09-08/.test(r.html) && /2 in all/.test(r.html));
  ok('events they are entered in', /Portal Grading/.test(r.html) && /Entered/.test(r.html));
  ok('says results are not here yet', /Results are not shown here yet/.test(r.html));
}

console.log('\nDOCUMENTS');
{
  const r = await req(`/me/${kid.id}/documents`);
  ok('opens', r.status === 200 && /Certificates/.test(r.html) && /C-1/.test(r.html));
  const ent = await one(`select id from event_entry where person_id=$1`, [kid.id]);
  await pool.query(`update event set consent_version='v1', consent_text='We accept the risk.' where title='Portal Grading'`);
  await pool.query(`insert into entry_consent (entry_id, version, accepted_name, guardian) values ($1,'v1','Mere Portal','{"relationship":"parent"}')`, [ent.id]);
  const withConsent = await req(`/me/${kid.id}/documents`);
  ok('a signed declaration, with its text and who agreed', /We accept the risk/.test(withConsent.html) && /Mere Portal/.test(withConsent.html) && /parent/.test(withConsent.html));
  await pool.query(`insert into payment (organisation_id, person_id, amount_cents, currency, status, receipt_no, settled_at)
    values ($1,$2,2500,'NZD','succeeded','R-2026-0001', now())`, [wh.id, kid.id]);
  ok('receipts', /R-2026-0001/.test((await req(`/me/${kid.id}/documents`)).html));
}

console.log('\nTIMETABLE');
{
  const r = await req('/me/classes');
  ok('opens', r.status === 200 && /Whanganui/.test(r.html));
  ok('says which classes are for whom', /For you/.test(r.html) && /Not for you/.test(r.html));
  ok('offers booking', /Book a class/.test(r.html));
}

console.log('\nNOBODY ELSE\'S');
{
  await signIn('sam.stranger@example.nz');
  const home = await req('/me');
  ok('a stranger\'s home shows only themselves', /Sam Stranger/.test(home.html) && !/Tama/.test(home.html) && !/Mere/.test(home.html));
  ok('cannot read the child\'s record', (await req(`/me/${kid.id}/record`)).status === 403);
  ok('or documents', (await req(`/me/${kid.id}/documents`)).status === 403);
  const theirs = await req('/me/messages');
  ok('and her inbox is not his', theirs.status === 200 && !/about Tama/.test(theirs.html));
  ok('not an id', (await req('/me/nope/record')).status === 404);
  delete jar.honbu_session;
  ok('signed out: sent to sign in', [302, 401, 403].includes((await req('/me')).status));
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
