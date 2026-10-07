/**
 * Class booking: places, waiting list, promotion on cancel, who may book, the club's view.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people, booking } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CRON_SECRET = 'test-cron-secret';
const OUT = '/tmp/honbu-book';
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
const build = async () => {}; // unused here


const wh = await one(`select * from organisation where slug='whanganui'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });
const login = (person, email) => pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [email, person.id]);
const tomorrow = (await one(`select to_char((now() at time zone $1)::date + 1,'YYYY-MM-DD') d, extract(dow from (now() at time zone $1)::date + 1)::int dow`, [wh.timezone]));
const mk = async (label, extra = {}) => (await one(`insert into training_session (organisation_id, label, weekday, starts, ends, min_age, max_age, capacity)
  values ($1,$2,$3,'18:00','19:00',$4,$5,$6) returning id`, [wh.id, label, tomorrow.dow, extra.min ?? null, extra.max ?? null, extra.cap ?? null])).id;
const open = await mk('Open class', { cap: 2 });
const free = await mk('Turn up class');
const kids = await mk('Kids class', { cap: 5, max: 12 });

const a = await enrol('Ann', 'One', '1990-01-01', 'ann@example.nz'); await login(a, 'ann@example.nz');
const b = await enrol('Ben', 'Two', '1990-01-01', 'ben@example.nz'); await login(b, 'ben@example.nz');
const c = await enrol('Cy', 'Three', '1990-01-01', 'cy@example.nz'); await login(c, 'cy@example.nz');
const d = await enrol('Di', 'Four', '1990-01-01', 'di@example.nz'); await login(d, 'di@example.nz');
const out = await enrol('Ollie', 'Outside', '1990-01-01', 'ollie@example.nz'); await login(out, 'ollie@example.nz');
await pool.query(`update affiliation set ends = current_date where person_id=$1`, [out.id]);
const rowsOf = async (sid) => (await pool.query(`select p.first_name n, b.status s from class_booking b join person p on p.id=b.person_id where b.session_id=$1 and b.session_date=$2 and b.status<>'cancelled' order by b.created_at`, [sid, tomorrow.d])).rows;

console.log('\nBOOKING');
await signIn('ann@example.nz');
{
  let r = await req('/me/classes');
  ok('the classes page offers booking', /Book a class/.test(r.html));
  r = await req(`/me/${a.id}/book`);
  ok('only classes with places are listed', /Open class/.test(r.html) && !/Turn up class/.test(r.html) && /2 left/.test(r.html));
  ok('a junior class is not offered to an adult', !/Kids class/.test(r.html));
  r = await req(`/me/${a.id}/book`, { method: 'POST', form: { sessionId: open, date: tomorrow.d } });
  ok('a place is booked', /done=You%20are%20booked/.test(r.location) || /booked/i.test(decodeURIComponent(r.location)));
  r = await req(`/me/${a.id}/book`, { method: 'POST', form: { sessionId: open, date: tomorrow.d } });
  ok('booking twice does nothing more', (await rowsOf(open)).length === 1);
  r = await req(`/me/${a.id}/book`, { method: 'POST', form: { sessionId: free, date: tomorrow.d } });
  ok('a class that is not booked is refused', /error=/.test(r.location));
  r = await req(`/me/${a.id}/book`, { method: 'POST', form: { sessionId: kids, date: tomorrow.d } });
  ok('a class not for them is refused', /error=/.test(r.location));
  r = await req(`/me/${a.id}/book`, { method: 'POST', form: { sessionId: open, date: '2020-01-06' } });
  ok('a date in the past is refused', /error=/.test(r.location));
}
await signIn('ben@example.nz');
await req(`/me/${b.id}/book`, { method: 'POST', form: { sessionId: open, date: tomorrow.d } });
await signIn('cy@example.nz');
{
  let r = await req(`/me/${c.id}/book`);
  ok('a full class says so', /Full/.test(r.html) && /Join waiting list/.test(r.html));
  r = await req(`/me/${c.id}/book`, { method: 'POST', form: { sessionId: open, date: tomorrow.d } });
  ok('the third person goes on the waiting list', /waiting/i.test(decodeURIComponent(r.location)));
}
await signIn('di@example.nz');
await req(`/me/${d.id}/book`, { method: 'POST', form: { sessionId: open, date: tomorrow.d } });
{
  const rs = await rowsOf(open);
  ok('places never go past the number', rs.filter((x) => x.s === 'booked').length === 2 && rs.map((x) => x.n + x.s).join() === 'Annbooked,Benbooked,Cywaiting,Diwaiting');
  const r = await req(`/me/${d.id}/book`);
  ok('they see their place in the queue', /Waiting list — number 2/.test(r.html));
}

console.log('\nCONCURRENCY');
{
  const racers = [];
  for (let i = 0; i < 6; i++) racers.push(await enrol(`Race${i}`, 'Runner', '1991-01-01'));
  const s2 = await mk('Race class', { cap: 3 });
  const acts = [];
  for (const p of racers) {
    const acc = (await pool.query(`insert into account (email, person_id) values ($1,$2) returning id`, [`race${p.id.slice(0, 6)}@example.nz`, p.id])).rows[0];
    acts.push(booking.book(acc.id, p.id, s2, tomorrow.d));
  }
  await Promise.all(acts);
  const rs = await rowsOf(s2);
  ok('six at once for three places: exactly three booked', rs.filter((x) => x.s === 'booked').length === 3 && rs.filter((x) => x.s === 'waiting').length === 3);
}

console.log('\nCANCELLING');
await signIn('ann@example.nz');
{
  const mine = await one(`select id from class_booking where person_id=$1 and status='booked'`, [a.id]);
  let r = await req(`/me/${a.id}/book/${mine.id}/cancel`, { method: 'POST', form: {} });
  ok('cancelling works', /done=/.test(r.location));
  const rs = await rowsOf(open);
  ok('the longest-waiting person moves up', rs.map((x) => x.n + x.s).join() === 'Benbooked,Cybooked,Diwaiting');
  ok('and it is recorded as a promotion', !!(await one(`select 1 x from class_booking where person_id=$1 and promoted_at is not null`, [c.id])));
  r = await req(`/me/${a.id}/book/${mine.id}/cancel`, { method: 'POST', form: {} });
  ok('cancelling twice is refused', r.status === 404 || r.status === 403);
  await signIn('cy@example.nz');
  const dis = await one(`select id from class_booking where person_id=$1 and status='waiting'`, [d.id]);
  r = await req(`/me/${c.id}/book/${dis.id}/cancel`, { method: 'POST', form: {} });
  ok('nobody can cancel for somebody else', r.status === 404 || r.status === 403);
  r = await req(`/me/${d.id}/book`);
  ok('nor see their bookings', r.status === 403 || r.status === 404);
}
await signIn('ollie@example.nz');
{
  const r = await req(`/me/${out.id}/book`, { method: 'POST', form: { sessionId: open, date: tomorrow.d } });
  ok('somebody who has left the club cannot book', r.status === 404 || r.status === 403);
}

console.log('\nTHE CLUB');
await signIn('doug@example.nz');
{
  let r = await req('/o/whanganui/bookings');
  ok('the club sees its classes and who is booked', r.status === 200 && /Open class/.test(r.html) && /Ben Two/.test(r.html) && /Waiting: Di Four/.test(r.html));
  r = await req(`/o/whanganui/bookings/${open}/places`, { method: 'POST', form: { capacity: '3' } });
  ok('more places bring people up from the list', (await rowsOf(open)).filter((x) => x.s === 'booked').length === 3 && /done=/.test(r.location));
  r = await req(`/o/whanganui/bookings/${open}/places`, { method: 'POST', form: { capacity: 'lots' } });
  ok('nonsense is refused', /error=/.test(r.location));
  r = await req(`/o/whanganui/bookings/${open}/places`, { method: 'POST', form: { capacity: '' } });
  ok('blank turns booking off', (await one('select capacity from training_session where id=$1', [open])).capacity === null);
}
await signIn('ann@example.nz');
{
  const r = await req(`/o/whanganui/bookings/${open}/places`, { method: 'POST', form: { capacity: '1' } });
  ok('a member cannot change places', r.status === 403 || r.status === 404);
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
