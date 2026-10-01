/**
 * Taking the roll.
 *
 *   1. Instructors keep it for their own club's classes, on days the class runs,
 *      not in the future and not months back.
 *   2. It is a set: taking it twice, or changing it, leaves exactly who is ticked.
 *   3. Visitors from another club in the federation can be added; strangers cannot.
 *   4. Nobody else's people or classes can be touched.
 *   5. It feeds grading eligibility, which is what the roll is for.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, attendance, Forbidden, Invalid, NotFound } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) {
  const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jar[k]; else jar[k] = v; } };
async function req(p, { method = 'GET', form } = {}) {
  const headers = {}; if (cookie()) headers.cookie = cookie();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + p, { method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString() : undefined });
  keep(res); return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}
const q = async (sql, a = []) => (await pool.query(sql, a)).rows;
const one = async (sql, a = []) => (await q(sql, a))[0] ?? null;
const signIn = async (email) => { for (const k of Object.keys(jar)) delete jar[k];
  await req('/signin'); const { token } = await auth.requestLink(email); await req(`/signin/${token}`); };
const rejects = (p, cls, re = /./) => p.then(() => false, (e) => e instanceof cls && re.test(e.message));

const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const tane = await one(`select id from account where email='tane@example.nz'`);
await pool.query(`update affiliation set ends='2020-01-01', status='resigned' where organisation_id in ($1,$2)`, [whanganui.id, wellington.id]);
const today = (await one(`select to_char((now() at time zone 'Pacific/Auckland')::date,'YYYY-MM-DD') as d`)).d;
const dayOf = async (n) => (await one(`select to_char($1::date + $2::int,'YYYY-MM-DD') as d`, [today, n])).d;
const weekdayToday = (await one(`select extract(dow from $1::date)::int as d`, [today])).d;

await pool.query(`delete from training_session where organisation_id in ($1,$2)`, [whanganui.id, wellington.id]);
const cls = async (org, label, weekday) => (await one(`insert into training_session (organisation_id, label, weekday, starts, ends)
  values ($1,$2,$3,'18:00','19:00') returning *`, [org.id, label, weekday])).id;
const todaysClass = await cls(whanganui, 'Seniors', weekdayToday);
const otherDayClass = await cls(whanganui, 'Juniors', (weekdayToday + 1) % 7);
const theirClass = await cls(wellington, 'Wellington squad', weekdayToday);

let seq = 0;
const member = async (first, { org = whanganui, role = 'member', joined = '2020-01-01', years = 30 } = {}) => {
  const dob = (await one(`select to_char($1::date - ($2::int * 365 + 90),'YYYY-MM-DD') as d`, [today, years])).d;
  const p = await one(`insert into person (display_number, first_name, last_name, email, date_of_birth)
    values ($1,$2,'Rolltest',$3,$4) returning *`, [`AT-${++seq}`, first, `${first.toLowerCase()}@roll.test`, dob]);
  await pool.query(`insert into affiliation (person_id, organisation_id, role, starts, status) values ($1,$2,$3,$4,'active')`, [p.id, org.id, role, joined]);
  const a = await one(`insert into account (email, person_id) values ($1,$2) returning id`, [p.email, p.id]);
  return { ...p, accountId: a.id };
};
const ann = await member('Ann'); const bob = await member('Bob'); const cat = await member('Cat'); const kid = await member('Kidd', { years: 9 });
const sensei = await member('Sensei', { role: 'instructor' });
const visitor = await member('Visitor', { org: wellington });
const stranger = await member('Stranger', { org: wellington });
await pool.query(`update affiliation set ends='2020-01-02', status='resigned' where person_id=$1`, [stranger.id]);
await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,'instructor')`, [sensei.accountId, whanganui.id]);
const came = async (cid, date) => (await q(`select p.first_name from attendance a join person p on p.id=a.person_id
  where a.session_id=$1 and a.session_date=$2::date order by p.first_name`, [cid, date])).map((r) => r.first_name);

console.log('\nTHE OVERVIEW');
{
  const o = await attendance.overview(sensei.accountId, whanganui.id);
  ok('an instructor sees today\'s class', o.classes.length === 1 && o.classes[0].label === 'Seniors', JSON.stringify(o.classes));
  ok('not a class on another day', !o.classes.some((c) => c.label === 'Juniors'));
  ok('and that it has not been taken', o.classes[0].came === null);
  ok('a member cannot see it', await rejects(attendance.overview(ann.accountId, whanganui.id), Forbidden));
  ok('another club cannot', await rejects(attendance.overview(tane.id, whanganui.id), Forbidden));
  ok('a federation has no roll of its own', await rejects(attendance.overview(doug.id, (await one('select id from organisation where parent_id is null')).id), Invalid, /each club/));
}

console.log('\nTAKING THE ROLL');
{
  const sheet = await attendance.sheet(sensei.accountId, whanganui.id, todaysClass, today);
  ok('everybody on the roll is listed', ['Ann', 'Bob', 'Cat', 'Kidd', 'Sensei'].every((n) => sheet.members.some((m) => m.name.startsWith(n))));
  ok('nobody from another club is', !sheet.members.some((m) => m.name.startsWith('Visitor')));
  ok('nobody is ticked at first', sheet.members.every((m) => !m.present));

  const r = await attendance.save(sensei.accountId, whanganui.id, todaysClass, today, { personIds: [ann.id, bob.id, kid.id] });
  ok('saved', r.came === 3 && JSON.stringify(await came(todaysClass, today)) === JSON.stringify(['Ann', 'Bob', 'Kidd']), JSON.stringify(await came(todaysClass, today)));
  ok('and who took it', (await one('select recorded_by from attendance where person_id=$1', [ann.id])).recorded_by === sensei.id);

  await attendance.save(sensei.accountId, whanganui.id, todaysClass, today, { personIds: [ann.id, cat.id] });
  ok('taking it again leaves exactly who is ticked', JSON.stringify(await came(todaysClass, today)) === JSON.stringify(['Ann', 'Cat']));
  await attendance.save(sensei.accountId, whanganui.id, todaysClass, today, { personIds: [ann.id, cat.id] });
  ok('twice the same is the same', (await came(todaysClass, today)).length === 2);
  ok('the sheet shows who is ticked', (await attendance.sheet(sensei.accountId, whanganui.id, todaysClass, today)).members.filter((m) => m.present).length === 2);
  const log = await one(`select before, after from audit_log where action='roll_taken' order by id desc limit 1`);
  ok('it is in the history', log.after.came === 2 && log.after.label === 'Seniors');

  await attendance.save(sensei.accountId, whanganui.id, todaysClass, today, { personIds: [] });
  ok('an empty roll clears it', (await came(todaysClass, today)).length === 0);
}

console.log('\nWHEN, AND FOR WHICH CLASS');
{
  const save = (cid, date, org = whanganui, who = sensei.accountId) => attendance.save(who, org.id, cid, date, { personIds: [ann.id] });
  ok('tomorrow is refused', await rejects(save(todaysClass, await dayOf(1)), Invalid, /not happened/));
  ok('3 months ago is refused', await rejects(save(todaysClass, await dayOf(-91)), Invalid, /60 days/));
  ok('a class on the wrong day is refused', await rejects(save(otherDayClass, today), Invalid, /does not run/));
  ok('last week\'s class can be filled in', (await save(todaysClass, await dayOf(-7))).came === 1);
  ok('a rubbish date is refused', await rejects(save(todaysClass, 'tomorrow-ish'), Invalid));
  ok('a class that does not exist is not found', await rejects(save('00000000-0000-0000-0000-000000000000', today), NotFound));
}

console.log('\nWHO CAN BE MARKED');
{
  ok('a member of another club cannot be ticked into this roll',
    (await attendance.save(sensei.accountId, whanganui.id, todaysClass, today, { personIds: [visitor.id, ann.id] })).came === 1);
  ok('they were ignored, not recorded', JSON.stringify(await came(todaysClass, today)) === JSON.stringify(['Ann']));
  const v = await attendance.save(sensei.accountId, whanganui.id, todaysClass, today,
    { personIds: [ann.id], visitorNumbers: [visitor.display_number.toLowerCase()] });
  ok('a visitor can be added by number', v.came === 2 && (await came(todaysClass, today)).includes('Visitor'));
  ok('and shows as a visitor on the sheet', (await attendance.sheet(sensei.accountId, whanganui.id, todaysClass, today)).visitors.some((x) => x.name.startsWith('Visitor')));
  ok('unticked visitors come off', (await attendance.save(sensei.accountId, whanganui.id, todaysClass, today, { personIds: [ann.id] })).came === 1);
  ok('an unknown number is refused, and nothing changes',
    await rejects(attendance.save(sensei.accountId, whanganui.id, todaysClass, today, { personIds: [bob.id], visitorNumbers: ['NOPE-9'] }), Invalid, /NOPE-9/)
    && JSON.stringify(await came(todaysClass, today)) === JSON.stringify(['Ann']));
  ok('somebody who is no longer a member anywhere cannot be a visitor',
    await rejects(attendance.save(sensei.accountId, whanganui.id, todaysClass, today, { personIds: [], visitorNumbers: [stranger.display_number] }), Invalid, /No member found/));
}

console.log('\nWHAT IS NOT YOURS');
{
  ok('another club\'s instructor cannot take this roll', await rejects(attendance.save(tane.id, whanganui.id, todaysClass, today, { personIds: [ann.id] }), Forbidden));
  ok('nor a member', await rejects(attendance.save(ann.accountId, whanganui.id, todaysClass, today, { personIds: [ann.id] }), Forbidden));
  ok('nor reach their class through their own club', await rejects(attendance.sheet(tane.id, wellington.id, todaysClass, today), NotFound));
  ok('and nothing was written to the other club', (await came(theirClass, today)).length === 0);
}

console.log('\nWHO HAS NOT BEEN SEEN, AND WHAT IT FEEDS');
{
  await pool.query(`delete from attendance`);
  await pool.query(`insert into attendance (person_id, organisation_id, session_date, session_id)
    values ($1,$2,$3,$4),($5,$2,$6,$4)`, [ann.id, whanganui.id, today, todaysClass, bob.id, await dayOf(-45)]);
  const o = await attendance.overview(sensei.accountId, whanganui.id);
  const names = o.notSeen.map((m) => m.name.split(' ')[0]);
  ok('Bob (45 days ago) and Cat (never) are listed', names.includes('Bob') && names.includes('Cat'), names.join());
  ok('Ann (today) is not', !names.includes('Ann'));
  ok('the numbers add up', o.totals.sessions === 1 && o.totals.people === 1);
  ok('the most regular are named', o.busiest[0]?.name.startsWith('Ann'));
  const p = await attendance.forPerson(sensei.accountId, ann.id, whanganui.id);
  ok('one person\'s training', p.last30 === 1 && p.ever === 1 && p.last_seen === today);
  ok('somebody who never came', (await attendance.forPerson(sensei.accountId, cat.id, whanganui.id)).ever === 0);
  const fed = await one('select id from organisation where parent_id is null');
  const { rank } = await import('./data.mjs');
  const e1 = await rank.eligibility(ann.id, fed.id);
  await attendance.save(sensei.accountId, whanganui.id, todaysClass, await dayOf(-7), { personIds: [ann.id] });
  const e2 = await rank.eligibility(ann.id, fed.id);
  ok('taking a roll is what grading eligibility counts as sessions', e1.sessions && e2.sessions && e2.sessions.has === e1.sessions.has + 1,
    JSON.stringify([e1.sessions, e2.sessions]));
}

console.log('\nTHE SCREENS');
{
  await signIn('sensei@roll.test');
  const o = await req('/o/whanganui/attendance');
  ok('the overview opens for an instructor', o.status === 200 && /Take the roll|Change/.test(o.html), `${o.status}`);
  ok('the rail links to it', /\/o\/whanganui\/attendance/.test(o.html));
  const sheet = await req(`/o/whanganui/attendance/${todaysClass}?date=${today}`);
  ok('the roll opens', sheet.status === 200 && /Who came\?/.test(sheet.html) && /Ann Rolltest/.test(sheet.html));
  const post = await req(`/o/whanganui/attendance/${todaysClass}`, { method: 'POST', form: { date: today, [`here_${bob.id}`]: '1', [`here_${cat.id}`]: '1', visitors: visitor.display_number } });
  ok('saving goes back to the overview with a note', post.status === 302 && /Saved\.\+?%20?3|Saved/.test(decodeURIComponent(post.location ?? '')), post.location);
  ok('and recorded exactly those', JSON.stringify(await came(todaysClass, today)) === JSON.stringify(['Bob', 'Cat', 'Visitor']), JSON.stringify(await came(todaysClass, today)));
  const bad = await req(`/o/whanganui/attendance/${todaysClass}`, { method: 'POST', form: { date: today, visitors: 'NOPE-1' } });
  ok('a mistake says what to fix and keeps the roll', bad.status === 422 && /NOPE-1/.test(bad.html));
  const wrongDay = await req(`/o/whanganui/attendance/${otherDayClass}?date=${today}`);
  ok('the wrong day goes back with the reason', wrongDay.status === 302 && /does\+?%?20?not\+?%?20?run|does%20not%20run|does not run/.test(decodeURIComponent(wrongDay.location ?? '').replace(/\+/g, ' ')));
  const person = await req(`/p/${bob.id}`);
  ok('the person\'s record shows their training', /Training/.test(person.html) && /classes in the last 30 days/.test(person.html));
  await signIn('ann@roll.test');
  ok('a member is turned away from the roll', (await req('/o/whanganui/attendance')).status === 403);
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
