/**
 * The digital card and class check-in.
 *
 *   1. A member's card (and a child's, for a guardian) is a signed QR; nobody else's is reachable.
 *   2. A scan says only whether the code is good — unless the scanner is an official of that club.
 *   3. A lapsed member, or a forged or altered code, is never "current".
 *   4. Class check-in: a rotating code, a parent checks in the children it suits, once.
 *   5. Sign-in remembers where you were going, and only ever on this site.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people, competition, cards, checkin } from './data.mjs';
import { signCheckin } from './card-token.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CARD_SECRET = 'test-card-secret';
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

const mum = await enrol('Mere', 'Card', '1985-05-05', 'mere.card@example.nz');
const kid = await enrol('Tama', 'Card', '2015-04-04');
const other = await enrol('Olly', 'Other', '1990-01-01', 'olly.other@example.nz');
for (const p of [mum, other]) await pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [p.email, p.id]);
await pool.query(`insert into guardian_link (guardian_id, child_id, relationship) values ($1,$2,'parent')`, [mum.id, kid.id]);
await pool.query(`update person set display_number = case id when $1 then 'CARD-0001' when $2 then 'CARD-0002' else 'CARD-0003' end where id = any($3::uuid[])`,
  [mum.id, kid.id, [mum.id, kid.id, other.id]]);
await pool.query(`update affiliation set paid_until = current_date + 200, status = 'active' where person_id = any($1::uuid[])`, [[mum.id, kid.id, other.id]]);

console.log('\nTHE CARD ON SCREEN');
await signIn('mere.card@example.nz');
{
  const r = await req(`/me/${mum.id}/card`);
  ok('opens', r.status === 200);
  ok('draws a QR code', /<svg[^>]*aria-label="Membership card for Mere Card"/.test(r.html));
  ok('shows the number and club', /CARD-0001/.test(r.html) && /Whanganui/.test(r.html));
  ok('says when this code stops working', /works until \d{4}-\d{2}-\d{2}/.test(r.html));
  const k = await req(`/me/${kid.id}/card`);
  ok('a guardian gets the child\'s card', k.status === 200 && /Tama Card/.test(k.html) && /Keep it on your own phone/.test(k.html));
  const o = await req(`/me/${other.id}/card`);
  ok('but not an adult\'s who is not theirs', o.status === 403 || o.status === 404, String(o.status));
  const home = await req('/me');
  ok('the home screen links to it', home.html.includes(`/me/${mum.id}/card`));
}

console.log('\nA LAPSED MEMBER HAS NO CARD');
{
  await pool.query(`update affiliation set paid_until = current_date - 3 where person_id = $1`, [kid.id]);
  const r = await req(`/me/${kid.id}/card`);
  ok('no QR code', !/<svg/.test(r.html));
  ok('says why', /ran out on/.test(r.html));
  await pool.query(`update affiliation set paid_until = current_date + 200 where person_id = $1`, [kid.id]);
}

console.log('\nSCANNING A CARD');
const card = await cards.forPerson((await one(`select id from account where email='mere.card@example.nz'`)).id, mum.id);
ok('the person who holds a card can get its token', card.issued && !!card.token);
{
  delete jar.honbu_session;
  let r = await req(`/v/${card.token}`);
  ok('a stranger with no sign-in is told it is good', r.status === 200 && /Current member/.test(r.html));
  ok('and nothing about who', !/Mere/.test(r.html) && !/CARD-0001/.test(r.html));
  ok('and is offered a way to sign in as an official', /signin\?next=/.test(r.html));

  const bad = card.token.slice(0, -2) + (card.token.endsWith('AA') ? 'BB' : 'AA');
  r = await req(`/v/${bad}`);
  ok('an altered code is not valid', /Not valid/.test(r.html) && !/Current member/.test(r.html));
  r = await req('/v/rubbish');
  ok('rubbish is not valid either', r.status === 200 && /Not valid/.test(r.html));

  await signIn('olly.other@example.nz');
  r = await req(`/v/${card.token}`);
  ok('another member sees only that it is good', /Current member/.test(r.html) && !/Mere/.test(r.html) && /not an official/.test(r.html));

  await signIn('doug@example.nz');
  r = await req(`/v/${card.token}`);
  ok('an official sees who it is', /Mere Card/.test(r.html) && /CARD-0001/.test(r.html) && /Whanganui/.test(r.html));

  await pool.query(`update affiliation set paid_until = current_date - 1 where person_id = $1`, [mum.id]);
  r = await req(`/v/${card.token}`);
  ok('a code made before the membership ran out is no longer current', /Not a current member/.test(r.html) && /ran out on/.test(r.html));
  await pool.query(`update affiliation set paid_until = current_date + 200 where person_id = $1`, [mum.id]);

}

// A class today, for children six to twelve.
const clock = await one(`select extract(dow from (now() at time zone o.timezone))::int as dow from organisation o where o.id = $1`, [wh.id]);
const juniors = await one(`insert into training_session (organisation_id, label, weekday, starts, ends, min_age, max_age)
  values ($1,'Juniors',$2,'16:00','17:00',6,12) returning id`, [wh.id, clock.dow]);
const otherDay = await one(`insert into training_session (organisation_id, label, weekday, starts, ends)
  values ($1,'Another day',$2,'19:00','20:00') returning id`, [wh.id, (clock.dow + 3) % 7]);

console.log('\nTHE INSTRUCTOR\'S CODE');
{
  await signIn('doug@example.nz');
  const r = await req(`/o/whanganui/attendance/${juniors.id}/code`);
  ok('opens for the club\'s own officials', r.status === 200);
  ok('draws a QR', /<svg/.test(r.html));
  ok('refreshes itself every minute', /http-equiv="refresh" content="60"/.test(r.html));
  const tab = await req('/o/whanganui/attendance');
  ok('the attendance screen links to it for today', tab.html.includes(`/attendance/${juniors.id}/code`));
  const no = await req(`/o/whanganui/attendance/${otherDay.id}/code`);
  ok('a class that does not run today gets no code', no.status === 302 && /does%20not%20run%20today/.test(no.location ?? ''), `${no.status} ${no.location}`);
  await signIn('mere.card@example.nz');
  const mumTry = await req(`/o/whanganui/attendance/${juniors.id}/code`);
  ok('a parent cannot make one', mumTry.status === 403);
}

console.log('\nCHECKING IN');
const date = (await one(`select to_char(now() at time zone o.timezone,'YYYY-MM-DD') as d from organisation o where o.id=$1`, [wh.id])).d;
const code = signCheckin({ sessionId: juniors.id, date });
{
  delete jar.honbu_session;
  let r = await req(`/checkin/${code}`);
  ok('a signed-out parent is sent to sign in and brought back', r.status === 302 && r.location.startsWith('/signin?next='));
  ok('with the way back', decodeURIComponent(r.location).includes(`/checkin/${code}`));

  await signIn('mere.card@example.nz');
  r = await req(`/checkin/${code}`);
  ok('shows the family', r.status === 200 && /Tama/.test(r.html) && /Mere/.test(r.html));
  ok('the child is ticked', new RegExp(`name="here_${kid.id}" value="1" checked`).test(r.html));
  ok('the adult is not offered a children\'s class', !new RegExp(`name="here_${mum.id}"`).test(r.html) && /not for their age or grade/.test(r.html));

  r = await req(`/checkin/${code}`, { method: 'POST', form: { [`here_${kid.id}`]: '1', [`here_${mum.id}`]: '1' } });
  ok('checks the child in', r.status === 200 && /Checked in: Tama/.test(r.html));
  const rows = (await pool.query(`select person_id from attendance where session_id=$1 and session_date=$2::date`, [juniors.id, date])).rows;
  ok('one row, the child\'s — the adult was not let in by tampering with the form', rows.length === 1 && rows[0].person_id === kid.id);
  const by = await one(`select recorded_by from attendance where person_id=$1 and session_id=$2`, [kid.id, juniors.id]);
  ok('recorded as her doing', by.recorded_by === mum.id);
  ok('audited', !!(await one(`select 1 as x from audit_log where action='self_check_in' and entity_id=$1`, [juniors.id])));

  r = await req(`/checkin/${code}`, { method: 'POST', form: { [`here_${kid.id}`]: '1' } });
  ok('doing it twice changes nothing', (await pool.query(`select count(*)::int as n from attendance where session_id=$1`, [juniors.id])).rows[0].n === 1);
  r = await req(`/checkin/${code}`);
  ok('and shows them as already in', /Already checked in/.test(r.html));

  r = await req(`/checkin/${signCheckin({ sessionId: juniors.id, date }, Date.now() - 10 * 60000)}`);
  ok('a code from ten minutes ago has run out', /has run out/.test(r.html));
  r = await req(`/checkin/${signCheckin({ sessionId: juniors.id, date: '2020-01-01' })}`);
  ok('a code for another day has run out', /has run out/.test(r.html));
  const forged = code.slice(0, -3) + 'abc';
  r = await req(`/checkin/${forged}`);
  ok('an altered code is not found', r.status === 404);
  r = await req(`/checkin/${code}`, { method: 'POST', form: {} });
  ok('ticking nobody checks nobody in', r.status === 200 && /Nobody new/.test(r.html));

  await signIn('olly.other@example.nz');
  await pool.query(`update affiliation set organisation_id = $1 where person_id = $2 and role = 'member'`, [wellington.id, other.id]);
  r = await req(`/checkin/${code}`);
  ok('a member of another club is told so and offered nothing', /not a member of this club|Not a member of this club|Nobody on your account/i.test(r.html) && !/type="checkbox"/.test(r.html));
}

console.log('\nSIGNING IN TO GET THERE');
{
  delete jar.honbu_session;
  await req('/signin');
  const before = (await one(`select count(*)::int as n from login_link`)).n;
  await req('/signin', { method: 'POST', form: { email: 'mere.card@example.nz', next: `/checkin/${code}` } });
  const link = await one(`select redirect_to from login_link order by created_at desc limit 1`);
  ok('the link remembers where you were going', link.redirect_to === `/checkin/${code}`);
  await req('/signin', { method: 'POST', form: { email: 'mere.card@example.nz', next: '//evil.example/x' } });
  const evil = await one(`select redirect_to from login_link order by created_at desc limit 1`);
  ok('a destination off this site is dropped', evil.redirect_to === null);
  await req('/signin', { method: 'POST', form: { email: 'mere.card@example.nz', next: 'https://evil.example' } });
  const evil2 = await one(`select redirect_to from login_link order by created_at desc limit 1`);
  ok('so is a full web address', evil2.redirect_to === null);
}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
