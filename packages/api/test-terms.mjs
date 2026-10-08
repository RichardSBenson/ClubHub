/**
 * School terms.
 *
 *   1. A country's calendar is loaded once at the top and every club inherits it; a club can override.
 *   2. Children enrol term by term, priced by the club's own rule for joining part-way; paying marks it paid.
 *   3. Enrolment is separate from membership, and only a child's own family can make it.
 *   4. The daily run offers the next term to families whose children were in the last one.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people, competition, terms, payments } from './data.mjs';
import { sharedMemoryMessenger } from '../infrastructure/messaging/messengers.mjs';
import { termPrice } from '../core/domain/terms.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CRON_SECRET = 'test-cron-secret';
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
const root = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const mail = sharedMemoryMessenger();
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });
const day = async (n) => (await one(`select to_char(current_date + $1::int,'YYYY-MM-DD') as d`, [n])).d;
const addTerm = (org, name, from, to, number) => pool.query(`insert into school_term (organisation_id, year, number, name, starts, ends)
  values ($1, extract(year from $3::date)::int, $5, $2, $3, $4)`, [org, name, from, to, number]);
const clearTerms = () => pool.query('delete from school_term');

const mere = await enrol('Mere', 'Terms', '1985-05-05', 'mere.terms@example.nz');
const tama = await enrol('Tama', 'Terms', '2015-04-04');
await pool.query(`insert into account (email, person_id) values ($1,$2)`, [mere.email, mere.id]);
await pool.query(`insert into guardian_link (guardian_id, child_id, relationship) values ($1,$2,'parent')`, [mere.id, tama.id]);
await pool.query(`update affiliation set paid_until = current_date + 200 where person_id = any($1::uuid[])`, [[mere.id, tama.id]]);
const other = await enrol('Olly', 'Other', '1990-01-01', 'olly.terms@example.nz');
await pool.query(`insert into account (email, person_id) values ($1,$2)`, [other.email, other.id]);
await pool.query(`insert into fee_schedule (organisation_id, label, amount_cents, period, applies_to, effective_from) values ($1,'Junior term',12000,'term','junior','2020-01-01')`, [wh.id]);
for (let d = 0; d < 7; d++) await pool.query(`insert into training_session (organisation_id, label, weekday, starts, ends) values ($1,'Kids',$2,'16:00','17:00')`, [wh.id, d]);

console.log('\nTHE COUNTRY\'S CALENDAR');
await signIn('doug@example.nz');
{
  await clearTerms();
  let r = await req('/o/whanganui/terms');
  ok('the screen opens, with no terms yet', r.status === 200 && /No terms for/.test(r.html));
  ok('and offers New Zealand\'s own calendar, because the club is in New Zealand', /New Zealand state schools calendar is available/.test(r.html));
  r = await req('/o/whanganui/terms/load', { method: 'POST', form: { year: '2026' } });
  ok('loading it at the club works', r.status === 302);
  ok('four terms', (await one(`select count(*)::int as n from school_term where organisation_id=$1 and year=2026`, [wh.id])).n === 4);
  r = await req('/o/whanganui/terms/load', { method: 'POST', form: { year: '2026' } });
  ok('loading it twice is refused', r.status === 422 && /already has terms/.test(r.html));
  r = await req('/o/whanganui/terms/load', { method: 'POST', form: { year: '2031' } });
  ok('a year the calendar does not cover is refused plainly', r.status === 422 && /no built-in calendar/.test(r.html));
  await clearTerms();

  // The federation sets them once; the club inherits.
  const loaded = await terms.loadBuiltIn(doug.id, root.id, 2026);
  ok('loaded once at the top of the tree', loaded === 4);
  r = await req('/o/whanganui/terms');
  ok('the club sees them, and where they came from', /Inherited from/.test(r.html) && /Term 4/.test(r.html) && /2026-10-12/.test(r.html));
  ok('with the holidays between them', /Holidays: 2026-04-03 to 2026-04-19/.test(r.html));
  ok('and a note on what is approximate', /vary by school/.test(r.html));

  // A club can have its own.
  r = await req('/o/whanganui/terms', { method: 'POST', form: { name: 'Our Term', starts: '2026-02-09', ends: '2026-04-10' } });
  ok('a club can set terms of its own', r.status === 302);
  r = await req('/o/whanganui/terms');
  ok('which replace the inherited ones for that year', !/Inherited from/.test(r.html) && /Our Term/.test(r.html) && !/Term 4/.test(r.html));
  ok('without touching the federation\'s', (await one(`select count(*)::int as n from school_term where organisation_id=$1`, [root.id])).n === 4);
  r = await req('/o/whanganui/terms', { method: 'POST', form: { name: 'Clash', starts: '2026-03-01', ends: '2026-05-01' } });
  ok('overlaps are refused', r.status === 422 && /overlaps/.test(r.html));
  const mine = await one(`select id from school_term where organisation_id=$1`, [wh.id]);
  r = await req(`/o/whanganui/terms/${mine.id}/remove`, { method: 'POST', form: {} });
  ok('and can be removed', r.status === 302 && !(await one(`select 1 as x from school_term where organisation_id=$1`, [wh.id])));

  await signIn('olly.terms@example.nz');
  r = await req('/o/whanganui/terms');
  ok('a member who is not an official cannot open the screen', r.status === 403);
  r = await req('/o/whanganui/terms/load', { method: 'POST', form: { year: '2027' } });
  ok('or load anything', r.status === 403);
}

console.log('\nENROLLING A CHILD');
await clearTerms();
const past = await day(-100), pastEnd = await day(-40);
await addTerm(root.id, 'Last Term', past, pastEnd, 1);
await addTerm(root.id, 'Term Now', await day(-10), await day(60), 2);          // running, ~10 weeks, 10 days in
await addTerm(root.id, 'Term Soon', await day(74), await day(130), 3);          // not open yet
await signIn('mere.terms@example.nz');
let nowTerm, paymentId;
{
  nowTerm = await one(`select id, to_char(starts,'YYYY-MM-DD') as starts, to_char(ends,'YYYY-MM-DD') as ends from school_term where name='Term Now'`);
  const soon = await one(`select id from school_term where name='Term Soon'`);
  let r = await req('/me/terms');
  ok('the parent sees the child and the terms', r.status === 200 && /Tama/.test(r.html) && /Term Now/.test(r.html));
  ok('the one that is not open yet says so', /Opens soon/.test(r.html));
  ok('the finished one is not offered', !/Last Term/.test(r.html));
  ok('she is not offered enrolment for herself', (r.html.match(/<h2>/g) ?? []).length === 1);
  ok('her home screen says it is open', /Term Now enrolment is open for Tama/.test((await req('/me')).html));

  const expected = termPrice({ fullCents: 12000, term: nowTerm, today: await day(0), rule: { mode: 'weeks' }, weekdays: [0, 1, 2, 3, 4, 5, 6] });
  ok('part-way through, the price is pro-rata by the weeks left', /\$/.test(r.html) && r.html.includes(`$${(expected.cents / 100).toFixed(2).replace(/\.00$/, '')}`) && expected.cents < 12000, String(expected.cents));
  r = await req(`/me/terms/${soon.id}/${tama.id}`, { method: 'POST', form: {} });
  ok('a term that is not open cannot be entered', r.status === 302 && /error=/.test(r.location) && !(await one(`select 1 as x from term_enrolment where term_id=$1`, [soon.id])));
  r = await req(`/me/terms/${nowTerm.id}/${tama.id}`, { method: 'POST', form: {} });
  ok('enrolling goes to payment', r.status === 302 && /\/me\/payments\//.test(r.location));
  paymentId = r.location.split('/').pop();
  const e = await one(`select status, paid, fee_cents, price_note from term_enrolment where term_id=$1 and person_id=$2`, [nowTerm.id, tama.id]);
  ok('the enrolment is recorded at the pro-rata price, unpaid', e.status === 'enrolled' && !e.paid && e.fee_cents === expected.cents && /weeks left/.test(e.price_note));
  ok('the bill is for the same amount', (await one(`select amount_cents from payment where id=$1`, [paymentId])).amount_cents === expected.cents);
  ok('her membership is untouched', (await one(`select status from affiliation where person_id=$1 and ends is null`, [tama.id])).status === 'active');
  r = await req(`/me/terms/${nowTerm.id}/${tama.id}`, { method: 'POST', form: {} });
  ok('enrolling twice is refused', /error=/.test(r.location) && (await one(`select count(*)::int as n from term_enrolment where person_id=$1`, [tama.id])).n === 1);
  r = await req('/me/terms');
  ok('the screen shows enrolled and not paid', /Enrolled/.test(r.html) && /Not paid/.test(r.html));

  await payments.recordManual(doug.id, paymentId, 'cash');
  ok('paying marks the enrolment paid', (await one(`select paid from term_enrolment where person_id=$1`, [tama.id])).paid === true);
  r = await req(`/me/terms/${nowTerm.id}/${tama.id}/withdraw`, { method: 'POST', form: {} });
  ok('a running term cannot be withdrawn from online', /error=/.test(r.location) && (await one(`select status from term_enrolment where person_id=$1`, [tama.id])).status === 'enrolled');
}

console.log('\nNOT ANYBODY ELSE\'S CHILD');
{
  await signIn('olly.terms@example.nz');
  const r = await req(`/me/terms/${nowTerm.id}/${tama.id}`, { method: 'POST', form: {} });
  ok('a stranger cannot enrol or withdraw somebody else\'s child', r.status === 403 || r.status === 404);
  ok('and nothing changed', (await one(`select count(*)::int as n from term_enrolment where person_id=$1 and status='enrolled'`, [tama.id])).n === 1);
  ok('she sees nothing of Tama', !/Tama/.test((await req('/me/terms')).html));
}

console.log('\nTHE CLUB\'S RULES');
{
  await pool.query(`delete from term_enrolment`);
  await signIn('doug@example.nz');
  let r = await req('/o/whanganui/terms/rule', { method: 'POST', form: { mid_term: 'none' } });
  ok('the club can refuse joiners part-way through', r.status === 302);
  await signIn('mere.terms@example.nz');
  r = await req(`/me/terms/${nowTerm.id}/${tama.id}`, { method: 'POST', form: {} });
  ok('and then the running term is closed to her', /error=.*part-way/.test(decodeURIComponent(r.location)));
  await signIn('doug@example.nz');
  await req('/o/whanganui/terms/rule', { method: 'POST', form: { mid_term: 'fixed', fixed: '60' } });
  await signIn('mere.terms@example.nz');
  r = await req(`/me/terms/${nowTerm.id}/${tama.id}`, { method: 'POST', form: {} });
  ok('a fixed reduced price is charged as set', (await one(`select fee_cents from term_enrolment where person_id=$1`, [tama.id])).fee_cents === 6000);
  await pool.query(`delete from term_enrolment`);
  await signIn('doug@example.nz');
  r = await req('/o/whanganui/terms/rule', { method: 'POST', form: { mid_term: 'fixed' } });
  ok('a fixed price must have an amount', r.status === 422);

  // No term price set: free.
  await req('/o/whanganui/terms/rule', { method: 'POST', form: { mid_term: 'weeks' } });
  await pool.query(`delete from fee_schedule where period='term'`);
  await signIn('mere.terms@example.nz');
  r = await req(`/me/terms/${nowTerm.id}/${tama.id}`, { method: 'POST', form: {} });
  ok('with no term price the club has not charged for terms: enrolment is free and recorded', /done=/.test(r.location) && (await one(`select paid from term_enrolment where person_id=$1`, [tama.id])).paid === true);
  await pool.query(`delete from term_enrolment`);
  await pool.query(`insert into fee_schedule (organisation_id, label, amount_cents, period, applies_to, effective_from) values ($1,'Junior term',12000,'term','junior','2020-01-01')`, [wh.id]);
}

console.log('\nWITHDRAWING BEFORE IT STARTS');
{
  await clearTerms();
  await addTerm(root.id, 'Term Next', await day(10), await day(80), 1);
  const nx = await one(`select id from school_term`);
  await signIn('mere.terms@example.nz');
  let r = await req(`/me/terms/${nx.id}/${tama.id}`, { method: 'POST', form: {} });
  ok('enrolling before it starts is at the full price', (await one(`select fee_cents, price_note from term_enrolment where person_id=$1`, [tama.id])).fee_cents === 12000);
  const pid = r.location.split('/').pop();
  r = await req(`/me/terms/${nx.id}/${tama.id}/withdraw`, { method: 'POST', form: {} });
  ok('withdrawing cancels the unpaid bill', /done=Withdrawn/.test(r.location) && (await one(`select status from payment where id=$1`, [pid])).status === 'void');
  ok('and she can enrol again', /payments/.test((await req(`/me/terms/${nx.id}/${tama.id}`, { method: 'POST', form: {} })).location));
  await payments.recordManual(doug.id, (await one(`select p.id from payment p join payment_line l on l.payment_id = p.id join term_enrolment e on e.id = l.term_enrolment_id
    where p.status='pending' and e.person_id=$1 and e.status='enrolled'`, [tama.id])).id, 'cash');
  r = await req(`/me/terms/${nx.id}/${tama.id}/withdraw`, { method: 'POST', form: {} });
  ok('withdrawing after paying tells her the club will arrange the refund', /refund/.test(decodeURIComponent(r.location)));
}

console.log('\nTHE NEXT TERM IS OFFERED');
{
  await clearTerms(); await pool.query('delete from term_enrolment'); await pool.query('delete from term_offer');
  await addTerm(root.id, 'Term Before', await day(-80), await day(-5), 1);
  await addTerm(root.id, 'Term After', await day(10), await day(80), 2);
  const before = await one(`select id from school_term where name='Term Before'`), after = await one(`select id from school_term where name='Term After'`);
  await pool.query(`insert into term_enrolment (term_id, person_id, organisation_id, fee_cents, paid, enrolled_on) values ($1,$2,$3,12000,true,current_date - 70)`, [before.id, tama.id, wh.id]);
  const sib = await enrol('Sib', 'Terms', '2016-06-06');
  await pool.query(`insert into guardian_link (guardian_id, child_id) values ($1,$2)`, [mere.id, sib.id]);
  await pool.query(`insert into term_enrolment (term_id, person_id, organisation_id, fee_cents, paid, enrolled_on) values ($1,$2,$3,12000,true,current_date - 70)`, [before.id, sib.id, wh.id]);
  await pool.query(`insert into term_enrolment (term_id, person_id, organisation_id, fee_cents, paid, enrolled_on) values ($1,$2,$3,12000,true,current_date)`, [after.id, sib.id, wh.id]);
  mail.clear();
  const deps = { messenger: mail, baseFrom: 'noreply@log.local', origin: 'http://x.test' };
  const rep = await terms.run(deps);
  const sent = mail.to('mere.terms@example.nz');
  ok('the family is told once', sent.length === 1 && /Term After enrolment is open/.test(sent[0].subject));
  ok('it names the child who is not yet in, and not the one who is', /Tama/.test(sent[0].text) && !/Sib/.test(sent[0].text));
  ok('and links to the enrolment page', /\/me\/terms/.test(sent[0].text));
  await terms.run(deps);
  ok('and not again', mail.to('mere.terms@example.nz').length === 1);
  ok('the run reports', rep.offered === 1);
}

console.log('\nTHE LOADING RUN');
{
  await clearTerms();
  const rep = await terms.run({ messenger: mail, baseFrom: 'noreply@log.local', origin: 'http://x.test' });
  const years = (await pool.query(`select distinct year from school_term where organisation_id=$1`, [root.id])).rows.map((r) => r.year);
  ok('a federation in a country with a calendar gets this year\'s terms by itself', years.includes(Number((await day(0)).slice(0, 4))) || rep.loaded.length === 0 && years.length === 0);
  // From September it also offers next year's; after that, nothing is loaded again.
  await terms.run({ messenger: mail, baseFrom: 'noreply@log.local', origin: 'x' });
  ok('and nothing is loaded twice', (await terms.run({ messenger: mail, baseFrom: 'noreply@log.local', origin: 'x' })).loaded.length === 0);
  await pool.query(`update organisation set settings = settings || '{"terms":{"auto":false}}'::jsonb where id=$1`, [root.id]);
  await clearTerms();
  ok('unless the federation has turned it off', (await terms.run({ messenger: mail, baseFrom: 'noreply@log.local', origin: 'x' })).loaded.length === 0);
}

console.log('\nWHO IS ENROLLED');
{
  await clearTerms();
  await addTerm(root.id, 'Term Roster', await day(-5), await day(60), 1);
  const t = await one(`select id from school_term`);
  await pool.query(`insert into term_enrolment (term_id, person_id, organisation_id, fee_cents, paid, enrolled_on, price_note) values ($1,$2,$3,9000,false,current_date,'8 of 10 weeks left')`, [t.id, tama.id, wh.id]);
  await signIn('doug@example.nz');
  let r = await req(`/o/whanganui/terms/${t.id}`);
  ok('the club sees who is in, what they pay and whether they have', r.status === 200 && /Tama Terms/.test(r.html) && /\$90/.test(r.html) && /Not paid/.test(r.html) && /8 of 10 weeks/.test(r.html));
  r = await req('/o/whanganui/terms');
  ok('the calendar counts them', /Term Roster/.test(r.html) && /<td>1 /.test(r.html));
  r = await req(`/o/whanganui/terms/${t.id}/remove`, { method: 'POST', form: {} });
  ok('a term with children in it cannot be removed', r.status === 422 || r.status === 403);
  delete jar.honbu_session;
  ok('signed out it is shut', (await req('/o/whanganui/terms')).status === 302);
}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
