/**
 * Automatic renewal: saving a method, charging when fees run out, retries, pausing, stopping, reminders.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people, fees, autoRenew, reminders } from './data.mjs';
import { TestProvider } from '../infrastructure/payments/providers.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CRON_SECRET = 'test-cron-secret';
const OUT = '/tmp/honbu-auto';
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
const build = async () => {}; // unused here


const wh = await one(`select * from organisation where slug='whanganui'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });
const login = (person, email) => pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [email, person.id]);
const aff = async (p) => (await one(`select id from affiliation where person_id=$1 and organisation_id=$2 and ends is null`, [p.id, wh.id])).id;
const state = async (p) => await one(`select paid_until::text d, status from affiliation where person_id=$1 and organisation_id=$2 and ends is null`, [p.id, wh.id]);
const setPaid = (p, d) => pool.query(`update affiliation set paid_until=$3 where person_id=$1 and organisation_id=$2 and ends is null`, [p.id, wh.id, d]);
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

await fees.save(doug.id, wh.id, { label: 'Adult annual', appliesTo: 'adult', period: 'annual', amountText: '180', effectiveFrom: '' });
await fees.save(doug.id, wh.id, { label: 'Adult monthly', appliesTo: 'adult', period: 'monthly', amountText: '25', effectiveFrom: '' });

const amy = await enrol('Amy', 'Auto', '1990-01-01', 'amy@example.nz'); await login(amy, 'amy@example.nz');
const bob = await enrol('Bob', 'Bad', '1990-01-01', 'bob@example.nz'); await login(bob, 'bob@example.nz');
const cat = await enrol('Cat', 'Cancel', '1990-01-01', 'cat@example.nz'); await login(cat, 'cat@example.nz');
const sam = await enrol('Sam', 'Stranger', '1980-01-01', 'sam@example.nz'); await login(sam, 'sam@example.nz');
const exempt = await enrol('Eve', 'Exempt', '1985-01-01');
const provider = new TestProvider();
const payments = async (p) => (await pool.query(`select status, amount_cents from payment where person_id=$1 order by created_at`, [p.id])).rows;

console.log('\nTURNING IT ON');
await signIn('amy@example.nz');
{
  let r = await req(`/me/${amy.id}/auto-renew`);
  ok('the screen opens with the dojo and its prices', r.status === 200 && /Whanganui/.test(r.html) && /\$180\.00/.test(r.html));
  r = await req(`/me/${amy.id}/auto-renew`, { method: 'POST', form: { affiliationId: await aff(amy), period: 'annual', method: 'card', card: '4242424242424242' } });
  ok('it needs her agreement', /error=.*agree/i.test(decodeURIComponent(r.location ?? '')));
  r = await req(`/me/${amy.id}/auto-renew`, { method: 'POST', form: { affiliationId: await aff(amy), period: 'annual', method: 'card', card: '4000000000000002', agreed: 'on' } });
  ok('a declined card is not saved', /error=/.test(r.location) && !(await one('select 1 x from payment_agreement where person_id=$1', [amy.id])));
  r = await req(`/me/${amy.id}/auto-renew`, { method: 'POST', form: { affiliationId: await aff(amy), period: 'annual', method: 'card', card: '4242424242424242', agreed: 'on' } });
  ok('it turns on', /done=/.test(r.location));
  const g = await one('select * from payment_agreement where person_id=$1', [amy.id]);
  ok('only a token and the last four are kept', g.label === 'Card ending 4242' && !JSON.stringify(g).includes('4242424242424242') && g.provider_ref.startsWith('test_pm_'));
  r = await req(`/me/${amy.id}/auto-renew`, { method: 'POST', form: { affiliationId: await aff(amy), period: 'monthly', method: 'card', card: '4242424242424242', agreed: 'on' } });
  ok('once is enough', /error=/.test(r.location));
  r = await req(`/me/${amy.id}/auto-renew`);
  ok('the screen says it is on and offers to stop it', /Stop automatic renewal/.test(r.html));
  r = await req(`/me/${sam.id}/auto-renew`);
  ok('nobody else can look', r.status === 403 || r.status === 404);
  r = await req(`/me/${sam.id}/auto-renew`, { method: 'POST', form: { affiliationId: await aff(sam), period: 'annual', method: 'card', card: '4242424242424242', agreed: 'on' } });
  ok('nor set it up for somebody', r.status === 403 || r.status === 404);
}

console.log('\nCHARGING');
{
  await setPaid(amy, day(60));
  let rep = await autoRenew.run({ provider });
  ok('nothing is charged while fees run a long way ahead', rep.charged === 0 && (await payments(amy)).length === 0);
  await setPaid(amy, day(2));
  rep = await autoRenew.run({ provider });
  ok('charged when fees are about to run out', rep.charged === 1);
  const p = await payments(amy);
  ok('at the dojo\'s price', p.length === 1 && p[0].status === 'succeeded' && p[0].amount_cents === 18000);
  ok('the membership moved on a year from where it ran to', (await state(amy)).d === day(2 + 0).replace(/^(\d{4})/, (y) => String(+y + 1)) || (await state(amy)).d > day(300));
  rep = await autoRenew.run({ provider });
  ok('a second run charges nothing more', rep.charged === 0 && (await payments(amy)).length === 1);
}

console.log('\nWHEN IT FAILS');
await signIn('bob@example.nz');
{
  await req('/signin');
  const r = await req(`/me/${bob.id}/auto-renew`, { method: 'POST', form: { affiliationId: await aff(bob), period: 'annual', method: 'card', card: '4000000000009995', agreed: 'on' } });
  ok('a card that will later decline is saved now', /done=/.test(r.location));
  await setPaid(bob, day(1));
  let rep = await autoRenew.run({ provider });
  let g = await one('select * from payment_agreement where person_id=$1', [bob.id]);
  ok('first failure: counted, retried in 3 days', rep.failed === 1 && g.failures === 1 && g.status === 'active' && g.next_attempt_on.toString().length > 0);
  ok('the membership did not move', (await state(bob)).d === day(1));
  rep = await autoRenew.run({ provider });
  ok('not tried again before the retry date', rep.failed === 0 && rep.skipped >= 1);
  await pool.query(`update payment_agreement set next_attempt_on = current_date - 1 where id=$1`, [g.id]);
  await autoRenew.run({ provider });
  await pool.query(`update payment_agreement set next_attempt_on = current_date - 1 where id=$1`, [g.id]);
  rep = await autoRenew.run({ provider });
  g = await one('select * from payment_agreement where person_id=$1', [bob.id]);
  ok('the third failure pauses it', g.status === 'paused' && g.failures === 3 && rep.paused === 1);
  rep = await autoRenew.run({ provider });
  ok('a paused agreement is never charged', rep.charged === 0 && rep.failed === 0);
  ok('one payment is reused, not one per attempt', (await payments(bob)).length === 1);
  const r2 = await req(`/me/${bob.id}/auto-renew`);
  ok('the member is told it has stopped', /Stopped/.test(r2.html));
}

console.log('\nSTOPPING');
await signIn('cat@example.nz');
{
  await req(`/me/${cat.id}/auto-renew`, { method: 'POST', form: { affiliationId: await aff(cat), period: 'monthly', method: 'card', card: '4242424242424242', agreed: 'on' } });
  const g = await one('select id from payment_agreement where person_id=$1', [cat.id]);
  await setPaid(cat, day(1));
  const r = await req(`/me/${cat.id}/auto-renew/${g.id}/stop`, { method: 'POST', form: {} });
  ok('one press stops it', /done=/.test(r.location) && (await one('select status from payment_agreement where id=$1', [g.id])).status === 'cancelled');
  await autoRenew.run({ provider });
  ok('and nothing is charged afterwards', (await payments(cat)).length === 0);
  await signIn('sam@example.nz');
  const x = await req(`/me/${cat.id}/auto-renew/${g.id}/stop`, { method: 'POST', form: {} });
  ok('only the right people can stop it', x.status === 403 || x.status === 404);
}

console.log('\nTHE DOJO');
await signIn('doug@example.nz');
{
  let r = await req('/o/whanganui/renewals');
  ok('the dojo sees who renews themselves', /Renewing themselves \(2\)/.test(r.html) && /Amy Auto/.test(r.html));
  ok('and who stopped after failures', /Stopped after failed payments/.test(r.html) && /Bob Bad/.test(r.html));
  const ro = await (await import('./data.mjs')).renewals.roster(doug.id, wh.id);
  ok('the roll flags automatic renewers', ro.rows.find((x) => x.name === 'Amy Auto').auto_renew === true && ro.rows.find((x) => x.name === 'Cat Cancel').auto_renew === false);
  const { dueForReminder } = await import('../core/domain/membership.mjs');
  const rows = [{ fee_exempt: false, auto_renew: true, standing: 'due', last_reminded: null }, { fee_exempt: false, auto_renew: false, standing: 'due', last_reminded: null }];
  ok('they are not sent renewal reminders', dueForReminder(rows, day(0)).due.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
