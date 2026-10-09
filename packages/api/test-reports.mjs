/**
 * Reports and CSV downloads.
 *
 *   1. Each report needs the right role: contact details and money are not for every instructor.
 *   2. A club sees its own people; a federation sees everybody beneath it; nobody sees across.
 *   3. The numbers are right, and a hostile name cannot become a formula.
 *   4. Downloading personal details is audited.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, reports, Forbidden, NotFound } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) {
  const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jar[k]; else jar[k] = v; } };
const get = async (p) => { const res = await fetch(base + p, { redirect: 'manual',
  headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
  keep(res); return { status: res.status, type: res.headers.get('content-type'), disp: res.headers.get('content-disposition'), text: await res.text() }; };
const signIn = async (email) => { for (const k of Object.keys(jar)) delete jar[k];
  await get('/signin'); const { token } = await auth.requestLink(email); await fetch(base + `/signin/${token}`, { method: 'POST', redirect: 'manual', headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.honbu_csrf ?? '' }).toString() }).then(keep); };
const q = async (sql, a = []) => (await pool.query(sql, a)).rows;
const one = async (sql, a = []) => (await q(sql, a))[0] ?? null;
const rejects = (p, cls) => p.then(() => false, (e) => e instanceof cls);

const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const root = await one('select * from organisation where parent_id is null');
const doug = (await one(`select id from account where email='doug@example.nz'`)).id;
const tane = (await one(`select id from account where email='tane@example.nz'`)).id;
const today = (await one(`select to_char((now() at time zone 'Pacific/Auckland')::date,'YYYY-MM-DD') as d`)).d;
await pool.query(`update affiliation set ends='2020-01-01', status='resigned' where organisation_id in ($1,$2)`, [whanganui.id, wellington.id]);

let seq = 0;
const person = async (first, last, org, { role = 'member', paidUntil = null, exempt = false, email = null } = {}) => {
  const p = await one(`insert into person (display_number, first_name, last_name, email, phone, date_of_birth)
    values ($1,$2,$3,$4,'021 555 000','1990-01-01') returning *`, [`RP-${++seq}`, first, last, email ?? `${first.toLowerCase()}@rep.test`]);
  await pool.query(`insert into affiliation (person_id, organisation_id, role, starts, status, paid_until, fee_exempt)
    values ($1,$2,$3,'2020-01-01','active',$4,$5)`, [p.id, org.id, role, paidUntil, exempt]);
  const a = await one(`insert into account (email, person_id) values ($1,$2) returning id`, [p.email, p.id]);
  return { ...p, accountId: a.id };
};
const add = (d) => one(`select to_char($1::date + $2::int,'YYYY-MM-DD') as d`, [today, d]).then((r) => r.d);
const ann = await person('Ann', 'Current', whanganui, { paidUntil: await add(200) });
const bob = await person('Bob', 'Late', whanganui, { paidUntil: await add(-40) });
const cat = await person('Cat', 'Never', whanganui);
const dan = await person('Dan', 'Free', whanganui, { exempt: true });
const evil = await person('=HYPERLINK("http://x")', 'Evil', whanganui, { paidUntil: await add(-5) });
const wel = await person('Wendy', 'Wellington', wellington, { paidUntil: await add(-10) });
const registrar = await person('Reg', 'Istrar', whanganui, { paidUntil: await add(300) });
await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,'registrar')`, [registrar.accountId, whanganui.id]);
const sensei = await person('Sen', 'Sei', whanganui, { role: 'instructor', paidUntil: await add(300) });
await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,'instructor')`, [sensei.accountId, whanganui.id]);

console.log('\nWHO MAY');
ok('an instructor cannot get the member list', await rejects(reports.run(sensei.accountId, whanganui.id, 'members'), Forbidden));
ok('but can get attendance', !!(await reports.run(sensei.accountId, whanganui.id, 'attendance')));
ok('a registrar gets members, fees, gradings', !!(await reports.run(registrar.accountId, whanganui.id, 'members'))
  && !!(await reports.run(registrar.accountId, whanganui.id, 'fees')) && !!(await reports.run(registrar.accountId, whanganui.id, 'gradings')));
ok('a registrar cannot get the money', await rejects(reports.run(registrar.accountId, whanganui.id, 'payments'), Forbidden));
ok('another club cannot', await rejects(reports.run(tane, whanganui.id, 'members'), Forbidden));
ok('an unknown report is not found', await rejects(reports.run(doug, root.id, 'secrets'), NotFound));

console.log('\nWHAT IT SAYS');
{
  const m = await reports.run(registrar.accountId, whanganui.id, 'members');
  ok('the club\'s own people', m.rows.some((r) => r.last_name === 'Current') && !m.rows.some((r) => r.last_name === 'Wellington'));
  const st = (n) => m.rows.find((r) => r.last_name === n).standing;
  ok('fees standing is worked out', st('Current') === 'current' && st('Late') === 'overdue' && st('Never') === 'unpaid' && st('Free') === 'exempt');
  const f = await reports.run(registrar.accountId, whanganui.id, 'fees');
  ok('fees owing lists those who owe, worst first', f.rows[0].last_name === 'Late' && f.rows[0].days_late === 40, JSON.stringify(f.rows.map((r) => r.last_name)));
  ok('not those who are paid or exempt', !f.rows.some((r) => ['Current', 'Free'].includes(r.last_name)));
  const fed = await reports.run(doug, root.id, 'members');
  ok('the federation sees every club beneath it', fed.rows.some((r) => r.last_name === 'Wellington') && fed.rows.some((r) => r.last_name === 'Current'));
  ok('and the club column says which', fed.rows.find((r) => r.last_name === 'Wellington').club === wellington.name);
}

console.log('\nMONEY, ATTENDANCE, GRADINGS');
{
  const pay = await one(`insert into payment (organisation_id, person_id, amount_cents, status, method, settled_at, receipt_no)
    values ($1,$2,6000,'succeeded','cash', now(), 'R-2026-0001') returning id`, [whanganui.id, ann.id]);
  await pool.query(`insert into payment_line (payment_id, kind, description, amount_cents) values ($1,'dojo_fee','Annual fee',6000)`, [pay.id]);
  await pool.query(`insert into payment (organisation_id, person_id, amount_cents, status) values ($1,$2,9999,'pending')`, [whanganui.id, bob.id]);
  const r = await reports.run(doug, whanganui.id, 'payments');
  ok('succeeded payments are listed with their total', r.rows.length === 1 && r.total === 6000 && r.rows[0].amount === '60.00' && r.rows[0].receipt === 'R-2026-0001');
  ok('pending ones are not', !r.rows.some((x) => x.amount_cents === 9999));
  const old = await reports.run(doug, whanganui.id, 'payments', { from: '2001-01-01', to: '2001-02-01' });
  ok('a date range excludes it', old.rows.length === 0 && old.range.from === '2001-01-01');

  const cls = await one(`insert into training_session (organisation_id, label, weekday, starts, ends) values ($1,'R',1,'18:00','19:00') returning id`, [whanganui.id]);
  for (const d of [-3, -2, -1]) await pool.query(`insert into attendance (person_id, organisation_id, session_date, session_id) values ($1,$2,$3,$4)`, [ann.id, whanganui.id, await add(d), cls.id]);
  const at = await reports.run(sensei.accountId, whanganui.id, 'attendance');
  ok('attendance counts classes', at.rows.find((x) => x.last_name === 'Current').classes === 3);
  const g = await one(`select id from grade limit 1`);
  await pool.query(`insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result, certificate_no) values ($1,$2,$3,$4,'pass','C-1')`, [ann.id, g.id, today, whanganui.id]);
  const gr = await reports.run(registrar.accountId, whanganui.id, 'gradings');
  ok('gradings list the award and certificate', gr.rows.length === 1 && gr.rows[0].certificate === 'C-1');
}

console.log('\nTHE DOWNLOAD');
{
  await signIn('doug@example.nz');
  const hub = await get(`/o/${whanganui.slug}/reports`);
  ok('the hub lists what he may download', hub.status === 200 && hub.text.includes('Fees owing') && hub.text.includes('Payments received'));
  const csv = await get(`/o/${whanganui.slug}/reports/fees?format=csv`);
  ok('a CSV with a filename', csv.status === 200 && /text\/csv/.test(csv.type) && /attachment; filename=".*fees.*\.csv"/.test(csv.disp), csv.disp);
  const raw = new Uint8Array(await (await fetch(`${base}/o/${whanganui.slug}/reports/fees?format=csv`, { headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } })).arrayBuffer());
  ok('with a byte order mark and a header', raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf && csv.text.includes('Member number'));
  ok('a hostile name cannot be a formula', csv.text.includes(`"'=HYPERLINK`) && !/(^|,)=HYPERLINK/m.test(csv.text), csv.text.split('\r\n').find((l) => /Evil/.test(l)));
  ok('it was audited', !!(await one(`select 1 from audit_log where action='report_exported' and organisation_id=$1`, [whanganui.id])));
  const page = await get(`/o/${whanganui.slug}/reports/members`);
  ok('the on-screen version escapes too', page.status === 200 && !page.text.replace('<script src="/vendor/pwa.js" defer></script>', '').replace('<script src="/vendor/day-of-week.js" defer></script>', '').includes('<script') && page.text.includes('&quot;http'));
  const other = await get(`/o/${wellington.slug}/reports/members?format=csv`);
  ok('he can also reach a club below him', other.status === 200 && other.text.includes('Wellington'));
  await signIn('tane@example.nz');
  const no = await get(`/o/${whanganui.slug}/reports/members?format=csv`);
  ok('another club\'s admin is refused', no.status === 403 || no.status === 404);
  ok('and nothing came back', !no.text.includes('Current'));
}

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end(); server.close();
process.exit(fail ? 1 : 0);
