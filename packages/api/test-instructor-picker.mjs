/**
 * Choosing instructors from the roll: grade-ordered, filterable, many at once; and the 280-character write-up.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people } from './data.mjs';
import { identify } from '../content/images.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CRON_SECRET = 'test-cron-secret';
const OUT = '/tmp/honbu-picker';
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
const build = async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await run(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..') });
};



const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const wh = await one(`select * from organisation where slug='whanganui'`);
const root = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });
const login = async (person, email) => {
  await pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [email, person.id]);
};


const wn = await one(`select * from organisation where slug='wellington'`);
const gid = async (label) => (await one(`select id from grade where label=$1 and organisation_id=$2`, [label, root.id])).id;
const give = async (person, label, on = '2015-01-01') => pool.query(`insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result, panel) values ($1,$2,$3,$4,'pass','[]')`, [person.id, await gid(label), on, root.id]);
const sandanA = await enrol('Aroha', 'Sandan', '1975-01-01', 'aroha@example.nz');
const shodanB = await enrol('Ben', 'Shodan', '1985-02-02', 'ben@example.nz');
const teen = await enrol('Tia', 'Teen', new Date(Date.now() - 16 * 365.25 * 864e5).toISOString().slice(0, 10), 'tia@example.nz');
const kyuC = await enrol('Cal', 'Kyu', '1990-03-03', 'cal@example.nz');
const nobelt = await enrol('Nan', 'Newbie', '1992-04-04', 'nan@example.nz');
await give(sandanA, 'Sandan'); await give(shodanB, 'Shodan'); await give(teen, 'Shodan', '2025-01-01'); await give(kyuC, '3rd kyu');
const away = await people.enrol(doug.id, { organisationId: wn.id, firstName: 'Wendy', lastName: 'Away', dateOfBirth: '1980-01-01' });
await give(away, 'Shodan');
await pool.query(`insert into account (email, person_id) values ('aroha@example.nz',$1) on conflict do nothing`, [sandanA.id]);
const status = async (p) => (await one(`select exists(select 1 from affiliation where person_id=$1 and organisation_id=$2 and role='instructor' and ends is null) as ins, coalesce((select published from instructor_profile where person_id=$1 and organisation_id=$2), false) as pub`, [p.id, wh.id]));
const order = (html, names) => names.map((n) => html.indexOf(n));
const rowsOf = (html) => (html.match(/name="pick_[0-9a-f-]+"/g) ?? []).length;

console.log('\nTHE ROLL, HIGHEST GRADE FIRST');
await signIn('doug@example.nz');
{
  const roll = await req('/o/whanganui/roster');
  ok('the roll links straight to choosing instructors', /href="\/o\/whanganui\/instructors">Choose instructors/.test(roll.html));
  let r = await req('/o/whanganui/instructors');
  ok('the screen leads with a picker of the roll', r.status === 200 && /Choose your instructors/.test(r.html));
  const idx = order(r.html.slice(r.html.indexOf('Choose your instructors'), r.html.indexOf('Their cards')), ['Aroha Sandan', 'Ben Shodan', 'Tia Teen']);
  ok('black belts only by default, highest grade first', idx.every((i) => i >= 0) && idx[0] < idx[1] && !/Cal Kyu/.test(r.html.slice(r.html.indexOf('Choose your instructors'), r.html.indexOf('Their cards'))));
  ok('another dojo\'s black belt is not on it', !/Wendy Away/.test(r.html));
  r = await req('/o/whanganui/instructors?grade=all');
  ok('every grade can be shown, black belts still first', /Cal Kyu/.test(r.html) && /Nan Newbie/.test(r.html) && r.html.indexOf('Aroha Sandan') < r.html.indexOf('Cal Kyu'));
  r = await req(`/o/whanganui/instructors?grade=${await gid('Sandan')}`);
  ok('one grade only', /Aroha Sandan/.test(r.html) && !/Ben Shodan/.test(r.html));
  r = await req('/o/whanganui/instructors?band=junior');
  ok('juniors', /Tia Teen/.test(r.html) && !/Aroha Sandan/.test(r.html));
  r = await req('/o/whanganui/instructors?band=senior');
  ok('seniors', /Aroha Sandan/.test(r.html) && !/Tia Teen/.test(r.html));
  r = await req('/o/whanganui/instructors');
  ok('nobody is ticked to begin with', !/class="pick" type="checkbox"[^>]* checked/.test(r.html));
  r = await req('/o/whanganui/instructors?all=1');
  ok('"select everyone shown" ticks them all, with no script needed', (r.html.match(/class="pick" type="checkbox"[^>]* checked/g) ?? []).length === rowsOf(r.html) && rowsOf(r.html) >= 3);
}

console.log('\nMANY AT ONCE');
{
  let r = await req('/o/whanganui/instructors/bulk', { method: 'POST', form: { action: 'show' } });
  ok('nobody ticked says so', /error=/.test(r.location) && /Tick/.test(decodeURIComponent(r.location)));
  r = await req('/o/whanganui/instructors/bulk', { method: 'POST', form: { action: 'role', [`pick_${kyuC.id}`]: 'on' } });
  const s1 = await status(kyuC);
  ok('"instructors only" gives the role without showing them', r.status === 302 && s1.ins && !s1.pub);
  r = await req('/o/whanganui/instructors/bulk', { method: 'POST', form: { action: 'show', grade: 'dan', [`pick_${sandanA.id}`]: 'on', [`pick_${shodanB.id}`]: 'on', [`pick_${teen.id}`]: 'on', [`pick_${away.id}`]: 'on' } });
  const msg = decodeURIComponent(r.location);
  const [sa, sb, st] = [await status(sandanA), await status(shodanB), await status(teen)];
  ok('adults become instructors and are shown', sa.ins && sa.pub && sb.ins && sb.pub);
  ok('a junior becomes an instructor but is never shown', st.ins && !st.pub && /Tia Teen/.test(msg) && /under 18/.test(msg));
  ok('somebody from another dojo is refused by name', /Wendy Away/.test(msg) && !(await one(`select 1 x from affiliation where person_id=$1 and role='instructor' and ends is null`, [away.id])));
  ok('the screen keeps the filter it was on', /grade=dan/.test(r.location));
  r = await req('/o/whanganui/instructors?grade=all');
  ok('the roll now says who is shown', /On the website/.test(r.html) && /Instructor, not shown/.test(r.html));
  r = await req('/o/whanganui/instructors/bulk', { method: 'POST', form: { action: 'off', [`pick_${kyuC.id}`]: 'on' } });
  ok('and they can be taken off again', !(await status(kyuC)).ins);

  await signIn('aroha@example.nz');
  r = await req('/o/whanganui/instructors/bulk', { method: 'POST', form: { action: 'show', [`pick_${nobelt.id}`]: 'on' } });
  ok('an ordinary member cannot', (r.status === 403 || r.status === 404) && !(await status(nobelt)).ins);
}

console.log('\nTHE 280-CHARACTER WRITE-UP');
{
  await signIn('aroha@example.nz');
  let r = await req(`/me/${sandanA.id}`);
  ok('every profile has the box', /name="about"[^>]*maxlength="280"/.test(r.html));
  const long = 'I started training in 1994 and love teaching children. ' .repeat(8);
  const contact = { phone: '021 000 0000', email: 'aroha@example.nz', about: long };
  r = await req(`/me/${sandanA.id}`, { method: 'POST', form: contact });
  const saved = (await one(`select about from person where id=$1`, [sandanA.id])).about;
  ok('it saves, cut to 280 characters', r.status === 302 && saved.length === 280 && saved.startsWith('I started training'));
  await req(`/me/${sandanA.id}`, { method: 'POST', form: { ...contact, about: 'Trained under Shihan Smith. I love teaching juniors.' } });
  await signIn('doug@example.nz');
  await build();
  const html = fs.readFileSync(path.join(OUT, 'whanganui/index.html'), 'utf8');
  ok('the card on the dojo\'s website shows it', /Trained under Shihan Smith\. I love teaching juniors\./.test(html));
  ok('the junior who was not shown is not on the page', !/Tia Teen/.test(html));
  ok('Ben, with no write-up yet, still has a card', /Ben Shodan/.test(html));
}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
