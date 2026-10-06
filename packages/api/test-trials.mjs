/**
 * Adult free trials and referrals.
 *
 *   1. A visitor starts a trial: a real person, no member number, a membership marked 'trial'.
 *   2. Somebody the register already knows never gets a second record, and the page cannot say who is known.
 *   3. A trial person can sign in, is on the roll, and can check in to classes.
 *   4. Joining is the first membership payment: it makes them a member, gives a number, converts the trial.
 *   5. A referral earns its reward only when the club's conditions are met, once, within the limits.
 *   6. The daily run reminds, ends and forgets; the admin screen reports.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people, competition, trials, referrals, growth, payments, checkin } from './data.mjs';
import { sharedMemoryMessenger } from '../infrastructure/messaging/messengers.mjs';
import { signCheckin } from './card-token.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CARD_SECRET = 'test-card-secret';
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
  await req(`/signin/${token}`);
};
const build = async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await run(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..') });
};

const wh = await one(`select * from organisation where slug='whanganui'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const mail = sharedMemoryMessenger();
const enrol = (first, last, dob, email = null, phone = null) => people.enrol(doug.id, {
  organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email, phone });
const todayNZ = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [wh.timezone])).d;
const plus = async (days) => (await one(`select to_char($1::date + $2::int,'YYYY-MM-DD') as d`, [todayNZ, days])).d;

// A referrer, and a price list.
const mere = await enrol('Mere', 'Referrer', '1985-05-05', 'mere.ref@example.nz', '021 555 1111');
await pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [mere.email, mere.id]);
await pool.query(`update affiliation set paid_until = current_date + 100, status = 'active' where person_id = $1`, [mere.id]);
await pool.query(`insert into fee_schedule (organisation_id, label, amount_cents, period, applies_to, effective_from)
  values ($1,'Adult annual',30000,'annual','adult','2020-01-01'),($1,'Adult monthly',3000,'monthly','adult','2020-01-01')`, [wh.id]);
await pool.query(`update person set display_number = 'TEST-REF' where id = $1`, [mere.id]);

const SIGNUP = (over = {}) => ({ firstName: 'Ana', lastName: 'Trial', email: 'ana.trial@example.nz', phone: '021 555 2222', dateOfBirth: '1990-05-05',
  emergencyName: 'Sam Trial', emergencyPhone: '021 555 3333', accepted: '1', ...over });

console.log('\nTHE PAGE');
await signIn('doug@example.nz');
{
  let r = await req('/trial/whanganui');
  ok('there is no trial until the club turns it on', r.status === 404);
  r = await req('/o/whanganui/growth', { method: 'POST', form: {} }).catch(() => ({ status: 0 }));
  r = await req('/o/whanganui/growth/settings', { method: 'POST', form: { referral_enabled: '1', referrer_kind: 'free_weeks', referrer_weeks: '4' } });
  ok('referrals without a trial are refused', r.status === 422 && /turn the trial on/.test(r.html));
  r = await req('/o/whanganui/growth/settings', { method: 'POST', form: { trial_enabled: '1', trial_days: '30', trial_min_age: '18',
    referral_enabled: '1', min_classes: '2', max_per_year: '1', referrer_kind: 'free_weeks', referrer_weeks: '4', referred_kind: 'none' } });
  ok('the club switches it on', r.status === 302 && /done=Saved/.test(r.location));
  r = await req('/trial/whanganui');
  ok('now there is a page', r.status === 200 && /Start my free month/.test(r.html) && /30 days are free/.test(r.html));
  ok('the page carries a honeypot and no secrets', /name="website"/.test(r.html) && !/Mere/.test(r.html));
  delete jar.honbu_session;
  r = await req('/trial/nowhere');
  ok('a club that does not exist is not found', r.status === 404);
}

console.log('\nWHO COUNTS AS A REFERRER');
const code = (await referrals.mine((await one(`select id from account where email='mere.ref@example.nz'`)).id, mere.id)).code;
{
  ok('a member gets a code', /^[A-Z2-9]{6}$/.test(code));
  ok('and the same one every time', (await referrals.mine((await one(`select id from account where email='mere.ref@example.nz'`)).id, mere.id)).code === code);
  let r = await req(`/r/${code}`);
  ok('the invitation names who invited, and the club', r.status === 200 && /Mere invited you to Whanganui/.test(r.html));
  ok('and sends them to the trial with the code', r.html.includes(`/trial/whanganui?ref=${code}`));
  ok('lower case and spaces are fine', (await req(`/r/${code.toLowerCase()}`)).status === 200);
  ok('a code nobody has is not found', (await req('/r/ZZZZZZ')).status === 404);
  r = await req(`/trial/whanganui?ref=${code}`);
  ok('the sign-up form is filled with the code and names the friend', new RegExp(`name="code"[^>]*value="${code}"`).test(r.html) && /Mere thought you would enjoy/.test(r.html));
  await signIn('mere.ref@example.nz');
  r = await req('/me/refer');
  ok('the referrer\'s page shows the code, a QR and the offer', r.status === 200 && r.html.includes(code) && /<svg/.test(r.html) && /4 free weeks/.test(r.html));
  ok('their home links to it', (await req('/me')).html.includes('/me/refer'));
  delete jar.honbu_session;
}

console.log('\nSTARTING A TRIAL');
let ana;
{
  mail.clear();
  let r = await req('/trial/whanganui', { method: 'POST', form: SIGNUP({ dateOfBirth: '2012-01-01' }) });
  ok('a child is turned away on the page, kindly', r.status === 422 && /aged 18 and over/.test(r.html));
  r = await req('/trial/whanganui', { method: 'POST', form: SIGNUP({ accepted: '' }) });
  ok('the waiver is required', r.status === 422 && /waiver/.test(r.html));
  ok('and nothing was created', !(await one(`select 1 as x from person where email = 'ana.trial@example.nz'`)));
  r = await req('/trial/whanganui', { method: 'POST', form: SIGNUP({ website: 'http://spam' }) });
  ok('a robot is thanked and ignored', r.status === 302 && /thanks/.test(r.location) && !(await one(`select 1 as x from person where email = 'ana.trial@example.nz'`)));
  ok('no mail went anywhere', mail.sent.length === 0);

  r = await req('/trial/whanganui', { method: 'POST', form: SIGNUP({ code: code }) });
  ok('a real sign-up goes to the thank-you page', r.status === 302 && r.location === '/trial/whanganui/thanks');
  ana = await one(`select * from person where email = 'ana.trial@example.nz'`);
  ok('a real person was made', !!ana && ana.first_name === 'Ana');
  ok('with no member number yet', ana.display_number === null);
  const a = await one(`select status, to_char(paid_until,'YYYY-MM-DD') as until, role from affiliation where person_id = $1 and ends is null`, [ana.id]);
  ok('on a membership marked as a trial', a.status === 'trial' && a.role === 'member');
  ok('that lasts the number of days the club chose', a.until === await plus(30));
  ok('with emergency details kept private', (await one(`select emergency_name from person_private where person_id=$1`, [ana.id])).emergency_name === 'Sam Trial');
  ok('and an account to sign in with', !!(await one(`select 1 as x from account where email = $1`, [ana.email])));
  ok('the waiver is recorded by name', (await one(`select consent_by from member_trial where person_id=$1`, [ana.id])).consent_by === 'Ana Trial');
  const ref = await one(`select status, referrer_id from referral where referred_id = $1`, [ana.id]);
  ok('the referral is on record, attributed to Mere', ref.status === 'trial' && ref.referrer_id === mere.id);
  ok('a welcome email with a working sign-in link', mail.to('ana.trial@example.nz').length === 1 && /signin\//.test(mail.to('ana.trial@example.nz')[0].text)
    && new RegExp(`until ${a.until}`).test(mail.to('ana.trial@example.nz')[0].text));
  r = await req('/trial/whanganui/thanks');
  ok('the thank-you page', r.status === 200 && /Check your email/.test(r.html));
  ok('she is not on the roll as a member', !(await one(`select 1 as x from affiliation where person_id=$1 and status='active'`, [ana.id])));
  ok('and the audit log knows', !!(await one(`select 1 as x from audit_log where action='trial_started' and entity_id=$1`, [ana.id])));
}

console.log('\nNOBODY IS SEEN TWICE');
{
  const before = (await one(`select count(*)::int as n from person`)).n;
  mail.clear();
  let r = await req('/trial/whanganui', { method: 'POST', form: SIGNUP() });
  ok('the same email again gives the same answer', r.status === 302 && r.location === '/trial/whanganui/thanks');
  ok('and no second person', (await one(`select count(*)::int as n from person`)).n === before);
  ok('she is sent a sign-in link, because it is her address', mail.to('ana.trial@example.nz').length === 1 && /Sign in to/.test(mail.to('ana.trial@example.nz')[0].subject));

  mail.clear();
  r = await req('/trial/whanganui', { method: 'POST', form: SIGNUP({ email: 'different@example.nz', phone: '+64 21 555 2222' }) });
  ok('the same mobile, different email: still one person', r.status === 302 && (await one(`select count(*)::int as n from person`)).n === before);
  ok('and nothing is sent to the new address — it might not be hers', mail.sent.length === 0);

  mail.clear();
  r = await req('/trial/whanganui', { method: 'POST', form: SIGNUP({ email: 'third@example.nz', phone: '021 999 0000' }) });
  ok('the same name and birthday: still one person', r.status === 302 && (await one(`select count(*)::int as n from person`)).n === before);

  mail.clear();
  r = await req('/trial/whanganui', { method: 'POST', form: SIGNUP({ firstName: 'Mere', lastName: 'Referrer', dateOfBirth: '1985-05-05', email: 'mere.ref@example.nz' }) });
  ok('an existing member cannot start a trial either', (await one(`select count(*)::int as n from member_trial where person_id = $1`, [mere.id])).n === 0);
}

console.log('\nTHE LIMITS');
{
  // The page rate-limits by visitor. Walk the function directly so the test is not tied to one address.
  let refused = false;
  for (let i = 0; i < 4; i++) {
    try { await trials.start({ slug: 'whanganui', ipHash: 'same-visitor', input: { ...SIGNUP({ email: `limit${i}@example.nz`, phone: `021 777 000${i}`, firstName: `Limit${i}`, lastName: 'Visitor' }), code: '' } }); }
    catch (e) { refused = e.status === 429; }
  }
  ok('a fourth trial from one visitor in an hour is refused', refused);
  await pool.query(`delete from person where email like 'limit%@example.nz'`);
}

console.log('\nA TRIAL PERSON AT CLASS');
const anaAccount = await one(`select id from account where email = 'ana.trial@example.nz'`);
{
  await signIn('ana.trial@example.nz');
  let r = await req('/me');
  ok('she sees her home', r.status === 200 && /Kia ora, Ana/.test(r.html));
  ok('it says it is a free trial', /Free trial/.test(r.html));
  ok('and nudges her to join, with days left', /Your free month ends in 30 days/.test(r.html));
  r = await req(`/me/${ana.id}/card`);
  ok('there is no card until she joins, and it says so', !/<svg/.test(r.html) && /free trial/.test(r.html));

  const dow = (await one(`select extract(dow from (now() at time zone $1))::int as d`, [wh.timezone])).d;
  const sess = await one(`insert into training_session (organisation_id, label, weekday, starts, ends, min_age) values ($1,'Adults',$2,'18:00','19:30',16) returning id`, [wh.id, dow]);
  r = await req('/me/classes');
  ok('the timetable shows her club\'s classes', /Adults/.test(r.html));
  const token = signCheckin({ sessionId: sess.id, date: todayNZ });
  r = await req(`/checkin/${token}`);
  ok('she can check in to a class by scanning', r.status === 200 && new RegExp(`name="here_${ana.id}"`).test(r.html));
  r = await req(`/checkin/${token}`, { method: 'POST', form: { [`here_${ana.id}`]: '1' } });
  ok('and is checked in', /Checked in: Ana/.test(r.html));
  await signIn('doug@example.nz');
  r = await req(`/o/whanganui/attendance/${sess.id}?date=${todayNZ}`);
  ok('the instructor\'s roll lists her', r.status === 200 && /Ana Trial/.test(r.html));
  ok('she is not in the member count the register uses', !(await one(`select 1 as x from affiliation where person_id=$1 and status='active'`, [ana.id])));

  const sheetCount = (await pool.query(`select count(*)::int as n from attendance where person_id=$1`, [ana.id])).rows[0].n;
  ok('one attendance row', sheetCount === 1);
}

console.log('\nJOINING');
let payId;
{
  await signIn('ana.trial@example.nz');
  let r = await req(`/me/${ana.id}/join`);
  ok('the join page lists the club\'s prices', r.status === 200 && /Adult annual/.test(r.html) && /\$300/.test(r.html) && /Adult monthly/.test(r.html));
  ok('and says the membership carries on from the trial\'s end', /carries on from the day it ends/.test(r.html));
  r = await req(`/me/${ana.id}/join`, { method: 'POST', form: { period: 'weekly' } });
  ok('a price the club does not offer is refused', r.status === 422);
  r = await req(`/me/${ana.id}/join`, { method: 'POST', form: { period: 'annual' } });
  ok('choosing one goes to payment', r.status === 302 && /\/me\/payments\//.test(r.location));
  payId = r.location.split('/').pop();
  const again = await req(`/me/${ana.id}/join`, { method: 'POST', form: { period: 'annual' } });
  ok('asking twice does not make a second bill', again.location === r.location);
  ok('nothing changes until it is paid', (await one(`select status from affiliation where person_id=$1 and ends is null`, [ana.id])).status === 'trial');

  // Somebody else's trial is not hers to join.
  const r2 = await req(`/me/${mere.id}/join`);
  ok('nor anybody else\'s', r2.status === 403 || r2.status === 404);

  await signIn('doug@example.nz');
  await payments.recordManual(doug.id, payId, 'cash');
  const a = await one(`select status, to_char(paid_until,'YYYY-MM-DD') as until from affiliation where person_id=$1 and ends is null`, [ana.id]);
  ok('paying makes her a member', a.status === 'active');
  ok('the paid year starts when the free month ends', a.until === (await one(`select to_char($1::date + 30 + interval '12 months','YYYY-MM-DD') as d`, [todayNZ])).d);
  const p = await one(`select display_number from person where id = $1`, [ana.id]);
  ok('she is given a member number in the federation\'s sequence', /^[A-Z]+-\d{4}$/.test(p.display_number ?? ''), String(p.display_number));
  ok('the trial is marked joined', (await one(`select status from member_trial where person_id=$1`, [ana.id])).status === 'converted');
  ok('it is still the same one person', (await one(`select count(*)::int as n from person where email='ana.trial@example.nz'`)).n === 1);
  ok('the referral moved on, but there is no reward yet', (await one(`select status, note from referral where referred_id=$1`, [ana.id])).status === 'member');
  const note = await one(`select note from referral where referred_id=$1`, [ana.id]);
  ok('and it says why: one class of the two asked for', /1 of the 2/.test(note.note ?? ''), String(note.note));
  ok('no reward row yet', (await one(`select count(*)::int as n from referral_reward`)).n === 0);
}

console.log('\nTHE REWARD');
const mereAccount = await one(`select id from account where email = 'mere.ref@example.nz'`);
{
  const before = (await one(`select to_char(paid_until,'YYYY-MM-DD') as d from affiliation where person_id=$1 and ends is null`, [mere.id])).d;
  const s2 = await one(`insert into training_session (organisation_id, label, weekday, starts, ends) values ($1,'Extra',$2,'06:00','07:00') returning id`, [wh.id, (await one(`select extract(dow from (now() at time zone $1))::int as d`, [wh.timezone])).d]);
  await pool.query(`insert into attendance (person_id, organisation_id, session_date, session_id) values ($1,$2,$3,$4)`, [ana.id, wh.id, todayNZ, s2.id]);
  mail.clear();
  const report = await growth.run({ messenger: mail, baseFrom: 'noreply@log.local', origin: 'http://x.test', signInLink: async (e, to) => `http://x.test/signin/tok?${e}` });
  ok('the daily run notices the second class', report.requalified === 1);
  const ref = await one(`select status, note from referral where referred_id=$1`, [ana.id]);
  ok('and the referral earns its reward', ref.status === 'rewarded');
  const w = await one(`select kind, weeks, status, person_id from referral_reward`);
  ok('four free weeks, to Mere, given by the system', w.kind === 'free_weeks' && w.weeks === 4 && w.status === 'given' && w.person_id === mere.id);
  const after = (await one(`select to_char(paid_until,'YYYY-MM-DD') as d from affiliation where person_id=$1 and ends is null`, [mere.id])).d;
  ok('they were added to her membership', after === (await one(`select to_char($1::date + 28,'YYYY-MM-DD') as d`, [before])).d, `${before} → ${after}`);
  ok('and she was told', report.told === 1 && mail.to('mere.ref@example.nz').length === 1 && /4 free weeks/.test(mail.to('mere.ref@example.nz')[0].text));
  const again = await growth.run({ messenger: mail, baseFrom: 'noreply@log.local', origin: 'http://x.test', signInLink: async () => 'x' });
  ok('running again gives nothing twice', again.requalified === 0 && again.told === 0 && (await one(`select count(*)::int as n from referral_reward`)).n === 1);

  await signIn('mere.ref@example.nz');
  const r = await req('/me/refer');
  ok('Mere sees her friend and her reward', /Ana/.test(r.html) && /Joined — reward earned/.test(r.html) && /4 free weeks/.test(r.html));
  ok('but only the friend\'s first name', !/Trial/.test(r.html.replace(/Free trial/g, '')) );
}

console.log('\nTHE YEARLY LIMIT, AND REFERRERS WHO HAVE GONE');
{
  // The limit is one a year. A second friend joins and attends enough, but there is no second reward.
  const bea = await trials.start({ slug: 'whanganui', input: { ...SIGNUP({ firstName: 'Bea', lastName: 'Second', email: 'bea@example.nz', phone: '021 444 0001', dateOfBirth: '1991-01-01' }), code } });
  ok('a second referral is recorded', !!(await one(`select 1 as x from referral where referred_id=$1 and status='trial'`, [bea.personId])));
  await pool.query(`update member_trial set starts = current_date - 3 where person_id = $1`, [bea.personId]);
  for (let i = 0; i < 2; i++) {
    const s = await one(`insert into training_session (organisation_id, label, weekday, starts, ends) values ($1,'Bea ${i}',$2,'05:00','06:00') returning id`, [wh.id, i]);
    await pool.query(`insert into attendance (person_id, organisation_id, session_date, session_id) values ($1,$2,current_date - $3::int,$4)`, [bea.personId, wh.id, i, s.id]);
  }
  const f = await growth.overview(doug.id, wh.id);
  const t = f.trials.find((x) => x.name === 'Bea Second');
  const payAfter = await (async () => { const o = await trials.joinNow((await one(`select id from account where email='bea@example.nz'`)).id, bea.personId, 'monthly'); await payments.recordManual(doug.id, o.paymentId, 'cash'); })();
  const r2 = await one(`select status, note from referral where referred_id=$1`, [bea.personId]);
  ok('the limit stops the second reward', r2.status === 'void' && /limit of 1/.test(r2.note), JSON.stringify(r2));
  ok('and no second reward exists', (await one(`select count(*)::int as n from referral_reward`)).n === 1);

  // A referrer who has lapsed earns nothing.
  await pool.query(`update affiliation set status = 'lapsed' where person_id = $1 and ends is null`, [mere.id]);
  const cat = await trials.start({ slug: 'whanganui', input: { ...SIGNUP({ firstName: 'Cat', lastName: 'Third', email: 'cat@example.nz', phone: '021 444 0002', dateOfBirth: '1992-02-02' }), code } });
  const rc = await one(`select status, note from referral where referred_id=$1`, [cat.personId]);
  ok('somebody who is not a current member cannot refer', rc.status === 'void' && /not a current member/.test(rc.note));
  ok('but their friend still gets the trial', (await one(`select status from member_trial where person_id=$1`, [cat.personId])).status === 'trialling');
  await pool.query(`update affiliation set status = 'active' where person_id = $1 and ends is null`, [mere.id]);

  // Using your own address earns nothing; neither does a code that does not exist (ignored quietly).
  const dan = await trials.start({ slug: 'whanganui', input: { ...SIGNUP({ firstName: 'Dan', lastName: 'Fourth', email: 'dan@example.nz', phone: '021 444 0003', dateOfBirth: '1993-03-03' }), code: 'NOSUCH' } });
  ok('an unknown code is ignored without fuss', !(await one(`select 1 as x from referral where referred_id=$1`, [dan.personId])) && dan.existing === false);
}

console.log('\nTHE DAILY RUN: REMINDERS, ENDINGS, FORGETTING');
{
  mail.clear();
  const eve = await trials.start({ slug: 'whanganui', input: { ...SIGNUP({ firstName: 'Eve', lastName: 'Fifth', email: 'eve@example.nz', phone: '021 444 0004', dateOfBirth: '1994-04-04' }), code: '' } });
  const deps = { messenger: mail, baseFrom: 'noreply@log.local', origin: 'http://x.test', signInLink: async (e, to) => `http://x.test/signin/tok?to=${encodeURIComponent(to)}` };
  mail.clear();
  let rep = await growth.run(deps);
  ok('nothing is sent to somebody with weeks left', mail.to('eve@example.nz').length === 0);

  await pool.query(`update member_trial set ends = current_date + 6 where person_id = $1`, [eve.personId]);
  await pool.query(`update affiliation set paid_until = current_date + 6 where person_id = $1`, [eve.personId]);
  rep = await growth.run(deps);
  ok('a week from the end: a reminder with a link that lands on the join page', mail.to('eve@example.nz').length === 1
    && /a week to go/.test(mail.to('eve@example.nz')[0].subject) && mail.to('eve@example.nz')[0].text.includes(`/me/${eve.personId}/join`.replace(/\//g, '%2F')));
  await growth.run(deps);
  ok('and only the once', mail.to('eve@example.nz').length === 1);

  await pool.query(`update member_trial set ends = current_date + 1 where person_id = $1`, [eve.personId]);
  await growth.run(deps);
  ok('the last days: one more', mail.to('eve@example.nz').length === 2 && /ends soon/.test(mail.to('eve@example.nz')[1].subject));

  await pool.query(`update member_trial set ends = current_date - 1 where person_id = $1`, [eve.personId]);
  rep = await growth.run(deps);
  const t = await one(`select status from member_trial where person_id=$1`, [eve.personId]);
  const a = await one(`select status, ends is not null as closed from affiliation where person_id=$1 order by created_at desc limit 1`, [eve.personId]);
  ok('after the end the trial is ended and the membership closed', t.status === 'ended' && a.status === 'resigned' && a.closed);
  ok('she is told it has ended, and what happens to her details', mail.to('eve@example.nz').length === 3 && /180 days/.test(mail.to('eve@example.nz')[2].text));
  ok('she is no longer on the roll', !(await one(`select 1 as x from affiliation where person_id=$1 and ends is null`, [eve.personId])));

  // She can still come back: joining starts an ordinary membership, becoming active when paid.
  const eveAcc = await one(`select id from account where email='eve@example.nz'`);
  const j = await trials.joinNow(eveAcc.id, eve.personId, 'monthly');
  ok('an ended trial can still join', !!j.paymentId);
  ok('through a membership waiting to be paid for', (await one(`select status from affiliation where person_id=$1 and ends is null`, [eve.personId])).status === 'lapsed');
  await pool.query(`update payment set status='void' where id=$1`, [j.paymentId]);
  await pool.query(`update affiliation set ends = current_date, status = 'resigned' where person_id=$1 and ends is null`, [eve.personId]);

  // Forgotten after 180 days. Somebody who joined is never forgotten.
  await pool.query(`update member_trial set ended_at = now() - interval '181 days' where person_id = $1`, [eve.personId]);
  await pool.query(`delete from payment where person_id = $1`, [eve.personId]);
  rep = await growth.run(deps);
  ok('a trial nobody joined is forgotten after 180 days', rep.forgotten === 1 && !(await one(`select 1 as x from person where id=$1`, [eve.personId])));
  ok('but a member is never touched', !!(await one(`select 1 as x from person where id=$1`, [ana.id])));
}

console.log('\nTHE CLUB\'S SCREEN');
{
  await signIn('doug@example.nz');
  let r = await req('/o/whanganui/growth');
  ok('opens for the club\'s officials', r.status === 200 && /Trials and referrals/.test(r.html));
  ok('it shows the link to share', /\/trial\/whanganui/.test(r.html));
  ok('trials, with who referred them', /Ana Trial/.test(r.html) && /referred/.test(r.html));
  ok('the report', /trials started/.test(r.html) && /paid by referred members/.test(r.html) && /Top referrers/.test(r.html));
  ok('the settings are there for administrators', /name="trial_days"/.test(r.html));
  ok('the side menu links to it', /<aside class="rail"[\s\S]*\/o\/whanganui\/growth/.test(r.html));

  const o = await growth.overview(doug.id, wh.id);
  ok('the numbers add up', o.report.started >= 4 && o.report.converted === 2 && o.report.referralMembers >= 1 && o.report.rewarded === 1);
  ok('referral revenue is the money referred members actually paid', o.report.revenueCents === 30000 + 3000);

  // A reward that cannot be given by the system waits for a person.
  await req('/o/whanganui/growth/settings', { method: 'POST', form: { trial_enabled: '1', referral_enabled: '1', min_classes: '0', max_per_year: '10',
    referrer_kind: 'merchandise', referrer_note: 'A club T-shirt', referred_kind: 'credit', referred_amount: '10' } });
  const flo = await trials.start({ slug: 'whanganui', input: { ...SIGNUP({ firstName: 'Flo', lastName: 'Sixth', email: 'flo@example.nz', phone: '021 444 0005', dateOfBirth: '1995-05-05' }), code } });
  const floAcc = await one(`select id from account where email='flo@example.nz'`);
  await payments.recordManual(doug.id, (await trials.joinNow(floAcc.id, flo.personId, 'annual')).paymentId, 'cash');
  r = await req('/o/whanganui/growth');
  ok('a T-shirt and a credit are listed as owed', /Rewards to hand over/.test(r.html) && /A club T-shirt/.test(r.html) && /\$10 account credit/.test(r.html));
  const owed = await one(`select id from referral_reward where status='owed' limit 1`);
  r = await req(`/o/whanganui/growth/rewards/${owed.id}/given`, { method: 'POST', form: {} });
  ok('somebody hands it over and marks it', r.status === 302 && (await one(`select status, given_by from referral_reward where id=$1`, [owed.id])).status === 'given');
  ok('and it is in the audit log', !!(await one(`select 1 as x from audit_log where action='reward_given' and entity_id=$1`, [owed.id])));

  await signIn('mere.ref@example.nz');
  r = await req('/o/whanganui/growth');
  ok('a member who is not an official cannot open it', r.status === 403);
  r = await req('/o/whanganui/growth/settings', { method: 'POST', form: { trial_enabled: '1' } });
  ok('or change it', r.status === 403);
  delete jar.honbu_session;
  ok('signed out it is shut', (await req('/o/whanganui/growth')).status === 302);

  // Turning the trial off closes the door.
  await signIn('doug@example.nz');
  await req('/o/whanganui/growth/settings', { method: 'POST', form: {} });
  ok('the club can turn it off again, and the page goes', (await req('/trial/whanganui')).status === 404 && (await req(`/r/${code}`)).status === 404);
}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
