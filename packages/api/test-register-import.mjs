/**
 * Loading the dojo register from CSV files, from inside the app.
 *
 * Richard: "1 2 3 are not in the system."
 *
 *   1. The federation pastes the three files, sees a preview, and nothing is saved until it confirms.
 *   2. Saving updates dojo, class times and instructors, and a dojo it did not know is added.
 *   3. A dojo missing what a visitor needs is held back, not published.
 *   4. Running it twice changes nothing more.
 *   5. A club cannot use it; mistakes in the files say what to fix.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) { const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jar[k]; else jar[k] = v; } };
async function req(p, { method = 'GET', form } = {}) {
  const headers = {};
  if (cookie()) headers.cookie = cookie();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + p, { method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString() : undefined });
  keep(res);
  return { status: res.status, html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => { delete jar.honbu_session; await req('/signin'); const { token } = await auth.requestLink(email); await req(`/signin/${token}`); };
const federation = await one('select * from organisation where parent_id is null');

const DOJOS = `slug,name,venue_name,address_line,suburb,city,postcode,latitude,longitude,phone,email,directions,blurb,who_trains,instructor_name,instructor_grade,publish
wellington,Wellington,Toitu Hub,49 Kilbirnie Crescent,Kilbirnie,Wellington,6022,,,+64 27 564 7822,kenworthydojo@gmail.com,,,,,,yes
hornby,Hornby,Webster Dojo,442 Main South Road,Hornby,Christchurch,8042,,,+64 21 031 1606,sensei@example.test,,,,,,yes
taumarunui,Taumarunui,,4 Marae Street,,Taumarunui,3920,,,+64 21 0297 7149,v@example.test,,,,,,yes`;
const SESSIONS = `slug,label,weekday,starts,ends,min_age,max_age
wellington,Juniors and Seniors,Monday,18:30,20:00,,
wellington,Juniors and Seniors,Wednesday,18:30,20:00,,
hornby,Seniors,Monday,18:30,20:30,,
taumarunui,Juniors,Monday,16:30,17:30,7,12`;
const INSTRUCTORS = `slug,first_name,last_name,dan,distinct
wellington,Mike,Kenworthy,7,
wellington,Penina,Kenworthy,6,
hornby,Mark,Webster,4,
hornby,Mike,Kenworthy,7,`;
const files = { dojos: DOJOS, sessions: SESSIONS, instructors: INSTRUCTORS };
const slug = federation.slug;
const state = async () => ({
  dojo: (await one('select count(*)::int n from organisation')).n,
  people: (await one('select count(*)::int n from person')).n,
  sessions: (await one('select count(*)::int n from training_session')).n,
  grades: (await one('select count(*)::int n from grading_record')).n,
});

await signIn('doug@example.nz');

console.log('\nPREVIEW SAVES NOTHING');
{
  const screen = await req(`/o/${slug}/register-import`);
  ok('the screen opens for the federation', screen.status === 200 && /Import dojo/.test(screen.html), String(screen.status));
  ok('and is reachable from the clubs screen', /register-import/.test((await req(`/o/${slug}/clubs`)).html));
  const before = await state();
  const prev = await req(`/o/${slug}/register-import`, { method: 'POST', form: files });
  ok('a preview says it is a preview', prev.status === 200 && /Nothing is saved yet/.test(prev.html), String(prev.status));
  ok('it offers to save', /Save these changes/.test(prev.html));
  ok('it says a dojo would be added', /Hornby would be added/.test(prev.html));
  ok('it says what would be held back, and why', /Taumarunui needs venue/.test(prev.html));
  const after = await state();
  ok('nothing at all changed', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} ${JSON.stringify(after)}`);
}

console.log('\nCONFIRMING SAVES IT');
{
  const done = await req(`/o/${slug}/register-import`, { method: 'POST', form: { ...files, confirm: 'yes' } });
  ok('confirming saves', done.status === 200 && /Saved\./.test(done.html), String(done.status));
  const wel = await one(`select p.* from dojo_profile p join organisation o on o.id = p.organisation_id where o.slug = 'wellington'`);
  ok('Wellington has its venue and is published', wel.venue_name === 'Toitu Hub' && wel.published === true, JSON.stringify(wel));
  ok('and the phone number as given', wel.phone === '+64 27 564 7822');
  const hornby = await one(`select o.parent_id, o.type, p.published from organisation o join dojo_profile p on p.organisation_id = o.id where o.slug = 'hornby'`);
  ok('Hornby is a new dojo under the federation', hornby?.type === 'club' && hornby.parent_id === federation.id && hornby.published === true, JSON.stringify(hornby));
  const tau = await one(`select p.published, p.venue_name from organisation o join dojo_profile p on p.organisation_id = o.id where o.slug = 'taumarunui'`);
  ok('Taumarunui is held back, with no venue invented', tau.published === false && tau.venue_name === null, JSON.stringify(tau));
  const times = await one(`select count(*)::int n from training_session s join organisation o on o.id = s.organisation_id where o.slug = 'wellington'`);
  ok('class times are in', times.n === 2, String(times.n));
  const mike = await pool.query(`select o.slug, a.role from person p join affiliation a on a.person_id = p.id join organisation o on o.id = a.organisation_id where p.last_name = 'Kenworthy' and p.first_name = 'Mike' order by o.slug`);
  ok('Mike Kenworthy is one person on two rolls, as an instructor', mike.rows.length === 2 && mike.rows.every((r) => r.role === 'instructor'), JSON.stringify(mike.rows));
  ok('only one Mike Kenworthy exists', (await one(`select count(*)::int n from person where first_name='Mike' and last_name='Kenworthy'`)).n === 1);
  const grade = await one(`select g.label from grading_record r join grade g on g.id = r.grade_id join person p on p.id = r.person_id where p.first_name = 'Penina'`);
  ok('Penina holds a 6th dan', grade?.label === '6th dan', JSON.stringify(grade));
  const audit = await one(`select count(*)::int n from audit_log where action = 'register_import'`);
  ok('the import is in the audit log', audit.n === 1);
}

console.log('\nRUNNING IT AGAIN CHANGES NOTHING');
{
  const before = await state();
  await req(`/o/${slug}/register-import`, { method: 'POST', form: { ...files, confirm: 'yes' } });
  const after = await state();
  ok('no new dojo, people, class times or grades', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} ${JSON.stringify(after)}`);
}

console.log('\nMISTAKES AND WHO MAY');
{
  const empty = await req(`/o/${slug}/register-import`, { method: 'POST', form: { dojos: '', sessions: '', instructors: '' } });
  ok('nothing pasted is refused', empty.status === 422 && /at least one file/.test(empty.html), String(empty.status));
  const wrong = await req(`/o/${slug}/register-import`, { method: 'POST', form: { instructors: 'slug,first,last\nwellington,A,B' } });
  ok('a missing column is named', wrong.status === 422 && /no (?:"|&quot;)first_name(?:"|&quot;) column/.test(wrong.html), String(wrong.status));
  const noHeader = await req(`/o/${slug}/register-import`, { method: 'POST', form: { dojos: 'wellington,Wellington,Toitu Hub\nhornby,Hornby,Webster Dojo' } });
  ok('a file pasted without its column names says what it found', noHeader.status === 422 && /first line must be the column names/.test(noHeader.html) && /wellington/.test(noHeader.html), String(noHeader.status));
  const tabbed = await req(`/o/${slug}/register-import`, { method: 'POST', form: { instructors: 'slug\tfirst_name\tlast_name\tdan\twellington\tA\tB\t1'.replace('dan\twellington', 'dan\nwellington').replace(/\t(?=A)/, '\t') } });
  ok('tab-separated text, as copied from a spreadsheet, is read', tabbed.status === 200 && /Preview/.test(tabbed.html), String(tabbed.status));
  const club = await req('/o/wellington/register-import');
  ok('a club cannot use it', club.status === 403, String(club.status));
  const clubPost = await req('/o/wellington/register-import', { method: 'POST', form: files });
  ok('nor post to it', clubPost.status === 403, String(clubPost.status));
  delete jar.honbu_session;
  const out = await req(`/o/${slug}/register-import`);
  ok('signed out, it sends you to sign in', out.status === 302 || out.status === 401 || out.status === 403, String(out.status));
}

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end(); server.close();
process.exit(fail ? 1 : 0);
