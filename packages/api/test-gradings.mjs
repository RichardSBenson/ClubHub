/**
 * Grading events, end to end.
 *
 *   1. Clubs enter only members who have met the syllabus; refusals name the person.
 *   2. Fees go to the right payee: kyu to the club, black belt to the federation.
 *   3. Finalising is all-or-nothing: a bad panel or a missing result changes nothing.
 *   4. Passes reach the register with numbered certificates; fails are kept as history.
 *   5. Only the right people can read a certificate.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, gradings, Forbidden, Invalid, NotFound } from './data.mjs';
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
  keep(res); return { status: res.status, text: await res.text() }; };
const signIn = async (email) => { for (const k of Object.keys(jar)) delete jar[k];
  await get('/signin'); const { token } = await auth.requestLink(email); await get(`/signin/${token}`); };
const q = async (sql, a = []) => (await pool.query(sql, a)).rows;
const one = async (sql, a = []) => (await q(sql, a))[0] ?? null;
const rejects = (p, cls, re = /./) => p.then(() => false, (e) => e instanceof cls && re.test(e.message));

const root = await one('select * from organisation where parent_id is null');
const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const doug = (await one(`select id from account where email='doug@example.nz'`)).id;
const tane = (await one(`select id from account where email='tane@example.nz'`)).id;
await pool.query(`update affiliation set ends='2020-01-01', status='resigned' where organisation_id in ($1,$2)`, [whanganui.id, wellington.id]);
const today = (await one(`select to_char((now() at time zone 'Pacific/Auckland')::date,'YYYY-MM-DD') as d`)).d;
// This test is about gradings; the demo seed's qualification rules have their own test.
await pool.query('delete from qualification_award'); await pool.query('delete from qualification');
const grade = async (label) => (await one('select * from grade where organisation_id=$1 and label=$2', [root.id, label]));

let seq = 0;
const person = async (first, org, { age = 30, role = 'member' } = {}) => {
  const dob = (await one(`select to_char($1::date - ($2::int * 365 + 90),'YYYY-MM-DD') as d`, [today, age])).d;
  const p = await one(`insert into person (display_number, first_name, last_name, email, date_of_birth) values ($1,$2,'Gradetest',$3,$4) returning *`,
    [`GT-${++seq}`, first, `${first.toLowerCase()}@grade.test`, dob]);
  await pool.query(`insert into affiliation (person_id, organisation_id, role, starts, status) values ($1,$2,$3,'2020-01-01','active')`, [p.id, org.id, role]);
  const a = await one(`insert into account (email, person_id) values ($1,$2) returning id`, [p.email, p.id]);
  return { ...p, accountId: a.id };
};
const staff = async (first, org, role) => { const p = await person(first, org);
  await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,$3)`, [p.accountId, org.id, role]); return p; };
const holds = (p, g, on = '2020-01-01') => pool.query(`insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result) values ($1,$2,$3,$4,'pass')`, [p.id, g.id, on, root.id]);
const event = async (org, title, { down = false } = {}) => (await one(`insert into event (organisation_id, kind, title, slug, starts_at, status, publish_down)
  values ($1,'grading',$2,$3, now() + interval '7 days','published',$4) returning *`, [org.id, title, `g-${++seq}`, down])).id;

const reg = await staff('Reg', whanganui, 'registrar');
const inst = await staff('Inst', whanganui, 'instructor');
const wreg = await staff('Wreg', wellington, 'registrar');
// A shodan to sit on a kyu panel.
const shodan = await person('Shodan', whanganui); await holds(shodan, await grade('Shodan'));
const ann = await person('Ann', whanganui); const bob = await person('Bob', whanganui);
const cat = await person('Cat', whanganui); const dee = await person('Dee', whanganui);
const eve = await person('Eve', whanganui);
// Eve holds 10th kyu with no training since: not ready for 9th.
await holds(eve, await grade('10th kyu'), today);

console.log('\nENTERING');
const ev = await event(whanganui, 'Whanganui kyu grading');
await gradings.setFee(reg.accountId, ev, '45');
ok('the fee is stored in cents', (await one('select fee_cents from grading_event where event_id=$1', [ev])).fee_cents === 4500);
ok('an instructor cannot set it', await rejects(gradings.setFee(inst.accountId, ev, '1'), Forbidden));
ok('a silly fee is refused', await rejects(gradings.setFee(reg.accountId, ev, 'lots'), Invalid, /dollar/));
{
  const g = await gradings.get(reg.accountId, whanganui.id, ev);
  ok('the registrar sees who is ready', g.candidates.find((c) => c.name.startsWith('Ann')).eligible && !g.candidates.find((c) => c.name.startsWith('Eve')).eligible);
  ok('and why not', /sessions|months|age/.test(g.candidates.find((c) => c.name.startsWith('Eve')).unmet.join()));
}
ok('an unready member is refused by name', await rejects(gradings.enter(reg.accountId, whanganui.id, ev, [ann.id, eve.id]), Invalid, /Eve Gradetest is not ready/));
ok('and nobody was entered', (await one('select count(*)::int as n from event_entry where event_id=$1', [ev])).n === 0);
ok('an instructor cannot enter', await rejects(gradings.enter(inst.accountId, whanganui.id, ev, [ann.id]), Forbidden));
ok('another club cannot enter Whanganui\'s members', await rejects(gradings.enter(wreg.accountId, wellington.id, ev, [ann.id]), NotFound));
ok('nor can a club enter somebody else\'s member', await rejects(gradings.enter(reg.accountId, whanganui.id, ev, [(await person('Wel', wellington)).id]), Invalid, /not a current member/));
ok('nothing ticked is refused', await rejects(gradings.enter(reg.accountId, whanganui.id, ev, []), Invalid));
const out = await gradings.enter(reg.accountId, whanganui.id, ev, [ann.id, bob.id, cat.id, dee.id]);
ok('four entered', out.entered === 4);
{
  const p = await one(`select py.organisation_id, py.amount_cents, l.kind from payment py join payment_line l on l.payment_id=py.id
    join event_entry en on en.id = py.event_entry_id where en.person_id=$1`, [ann.id]);
  ok('a kyu fee is the club\'s, as a kyu grading', p.organisation_id === whanganui.id && p.amount_cents === 4500 && p.kind === 'kyu_grading', JSON.stringify(p));
}
ok('entering twice is refused', await rejects(gradings.enter(reg.accountId, whanganui.id, ev, [ann.id]), Invalid, /already/));
const entry = async (p) => (await one('select id from event_entry where event_id=$1 and person_id=$2', [ev, p.id])).id;
await gradings.withdraw(reg.accountId, whanganui.id, await entry(dee));
ok('withdrawing voids the unpaid fee', (await one(`select status from payment where event_entry_id=$1`, [await entry(dee)])).status === 'void');
ok('another club cannot withdraw', await rejects(gradings.withdraw(wreg.accountId, wellington.id, await entry(ann)), NotFound));
await gradings.enter(reg.accountId, whanganui.id, ev, [dee.id]);
ok('a withdrawn member can be entered again', (await one('select status from event_entry where id=$1', [await entry(dee)])).status === 'entered');
await gradings.withdraw(reg.accountId, whanganui.id, await entry(dee));

console.log('\nFINALISING IS ALL OR NOTHING');
const results = { [await entry(ann)]: { outcome: 'pass', notes: 'strong' }, [await entry(bob)]: { outcome: 'fail', notes: '' }, [await entry(cat)]: { outcome: 'absent', notes: '' } };
const fin = (extra = {}) => gradings.finalise(reg.accountId, ev, { results, panelNumbers: [shodan.display_number], date: today, ...extra });
ok('every entrant needs a result', await rejects(fin({ results: { [await entry(ann)]: { outcome: 'pass' } } }), Invalid, /Bob Gradetest|Cat Gradetest/));
ok('a pass needs a panel', await rejects(fin({ panelNumbers: [] }), Invalid, /panel/));
ok('an unknown panel number is refused', await rejects(fin({ panelNumbers: ['NOPE-1'] }), Invalid, /No member found/));
ok('a panel who are not senior enough is refused', await rejects(fin({ panelNumbers: [bob.display_number] }), Invalid, /Every examiner/));
ok('and the register is untouched', (await one('select count(*)::int as n from grading_record where event_id=$1', [ev])).n === 0
  && (await one('select status from event where id=$1', [ev])).status === 'published');
ok('another club cannot finalise it', await rejects(gradings.finalise(wreg.accountId, ev, { results, panelNumbers: [shodan.display_number], date: today }), Forbidden));
ok('the future is refused', await rejects(fin({ date: '2999-01-01' }), Invalid, /before it has happened/));

const done = await fin();
ok('finalised: one award', done.awarded.length === 1 && /-G-\d{4}-0001$/.test(done.awarded[0].certificate), JSON.stringify(done.awarded));
ok('the pass is in the register as 10th kyu', (await one(`select g.label from person_current_grade cg join grade g on g.id=cg.grade_id where cg.person_id=$1`, [ann.id])).label === '10th kyu');
ok('the fail is kept as history, not as a grade', (await one(`select result from grading_record where person_id=$1 and event_id=$2`, [bob.id, ev])).result === 'fail'
  && !(await one('select 1 from person_current_grade where person_id=$1', [bob.id])));
ok('absent leaves no record', !(await one('select 1 from grading_record where person_id=$1 and event_id=$2', [cat.id, ev])));
ok('the event is completed', (await one('select status from event where id=$1', [ev])).status === 'completed');
ok('finalising twice is refused', await rejects(fin(), Invalid, /already/));
ok('so is entering afterwards', await rejects(gradings.enter(reg.accountId, whanganui.id, ev, [eve.id]), Invalid));
ok('it was audited', !!(await one(`select 1 from audit_log where action='grading_finalised' and entity_id=$1`, [ev])));

console.log('\nCERTIFICATES');
const rec = (await one('select id from grading_record where person_id=$1 and event_id=$2', [ann.id, ev])).id;
const failRec = (await one('select id from grading_record where person_id=$1 and event_id=$2', [bob.id, ev])).id;
{
  const c = await gradings.certificate(ann.accountId, ann.id, rec);
  ok('the member can read their own', c.name === 'Ann Gradetest' && c.grade === '10th kyu' && c.examiners.length === 1);
  ok('their registrar can', !!(await gradings.certificate(reg.accountId, ann.id, rec)));
  ok('the organiser\'s federation can', !!(await gradings.certificate(doug, ann.id, rec)).certificate_no);
  ok('another member cannot', await rejects(gradings.certificate(bob.accountId, ann.id, rec), Forbidden));
  ok('another club\'s registrar cannot', await rejects(gradings.certificate(wreg.accountId, ann.id, rec), Forbidden));
  ok('a fail has no certificate', await rejects(gradings.certificate(bob.accountId, bob.id, failRec), NotFound));
  ok('a record cannot be read under somebody else\'s id', await rejects(gradings.certificate(doug, bob.id, rec), NotFound));
  await signIn('ann@grade.test');
  const page = await get(`/p/${ann.id}/certificate/${rec}`);
  ok('the page renders with the number', page.status === 200 && page.text.includes('Certificate of Grading') && page.text.includes(done.awarded[0].certificate));
  const profile = await get(`/me/${ann.id}`);
  ok('and their own page links to it', profile.text.includes(`/p/${ann.id}/certificate/${rec}`));
  await signIn('bob@grade.test');
  ok('Bob is refused Ann\'s', [403, 404].includes((await get(`/p/${ann.id}/certificate/${rec}`)).status));
}

console.log('\nA NATIONAL BLACK BELT GRADING');
{
  const nat = await event(root, 'National grading', { down: true });
  await gradings.setFee(doug, nat, '120');
  const hopeful = await person('Hopeful', whanganui);
  await holds(hopeful, await grade('1st kyu'), '2020-01-01');
  await pool.query(`insert into attendance (person_id, organisation_id, session_date, session_id)
    select $1, $2, ('2021-01-01'::date + g)::date, null from generate_series(0, 200) g`, [hopeful.id, whanganui.id]);
  const list = await gradings.list(reg.accountId, whanganui.id);
  ok('the club sees the national grading', list.events.some((e) => e.title === 'National grading'));
  const view = await gradings.get(reg.accountId, whanganui.id, nat);
  ok('and who is ready for it', view.candidates.find((c) => c.name.startsWith('Hopeful'))?.eligible, JSON.stringify(view.candidates.find((c) => c.name.startsWith('Hopeful'))));
  await gradings.enter(reg.accountId, whanganui.id, nat, [hopeful.id]);
  const p = await one(`select py.organisation_id, l.kind, py.amount_cents from payment py join payment_line l on l.payment_id=py.id
    join event_entry en on en.id=py.event_entry_id where en.event_id=$1`, [nat]);
  ok('a black belt fee is the federation\'s', p.organisation_id === root.id && p.kind === 'dan_grading' && p.amount_cents === 12000, JSON.stringify(p));
  ok('the federation sees every club\'s entries', (await gradings.get(doug, root.id, nat)).entries.length === 1);
  ok('Wellington cannot see Whanganui\'s entries', (await gradings.get(wreg.accountId, wellington.id, nat)).entries.length === 0);
  const entryId = (await one('select id from event_entry where event_id=$1', [nat])).id;
  const panel = [];
  for (const n of ['A', 'B', 'C']) { const y = await person(`Yondan${n}`, whanganui); await holds(y, await grade('Yondan')); panel.push(y.display_number); }
  ok('a panel of two is too few for a black belt', await rejects(gradings.finalise(doug, nat, { results: { [entryId]: { outcome: 'pass' } }, panelNumbers: panel.slice(0, 2), date: today }), Invalid, /panel of 3/));
  const r = await gradings.finalise(doug, nat, { results: { [entryId]: { outcome: 'pass' } }, panelNumbers: panel, date: today });
  ok('Shodan awarded with a certificate', r.awarded.length === 1 && r.awarded[0].grade === 'Shodan', JSON.stringify(r.awarded));
  ok('certificate numbers continue the federation\'s count', /-0002$/.test(r.awarded[0].certificate), r.awarded[0].certificate);
  ok('a club cannot hold a national grading itself', await rejects(gradings.finalise(reg.accountId, nat, { results: {}, panelNumbers: [], date: today }), Forbidden));
}

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end(); server.close();
process.exit(fail ? 1 : 0);
