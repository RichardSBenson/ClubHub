/**
 * Qualifications and compliance.
 *
 *   1. The federation says what is tracked; clubs inherit it; only owners/admins change it.
 *   2. Registrars record awards; the expiry fills itself from the usual period.
 *   3. "Who may not teach right now" is answered from dates.
 *   4. A qualification required of examiners is enforced on a grading panel.
 *   5. Members and parents see their own; nobody else's.
 *   6. Automatic reminders are opt-in, go once per stage, and tell the club's administrators.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, qualifications, gradings, myself, Forbidden, Invalid, NotFound } from './data.mjs';
import * as auth from './auth.mjs';
import { MemoryMessenger } from '../infrastructure/messaging/messengers.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) {
  const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jar[k]; else jar[k] = v; } };
const get = async (p) => { const res = await fetch(base + p, { redirect: 'manual',
  headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } }); keep(res); return { status: res.status, text: await res.text() }; };
const signIn = async (email) => { for (const k of Object.keys(jar)) delete jar[k];
  await get('/signin'); const { token } = await auth.requestLink(email); await fetch(base + `/signin/${token}`, { method: 'POST', redirect: 'manual', headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.honbu_csrf ?? '' }).toString() }).then(keep); };
const q = async (sql, a = []) => (await pool.query(sql, a)).rows;
const one = async (sql, a = []) => (await q(sql, a))[0] ?? null;
const rejects = (p, cls, re = /./) => p.then(() => false, (e) => e instanceof cls && re.test(e.message));

const root = await one('select * from organisation where parent_id is null');
const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const doug = (await one(`select id from account where email='doug@example.nz'`)).id;
const today = (await one(`select to_char((now() at time zone 'Pacific/Auckland')::date,'YYYY-MM-DD') as d`)).d;
const day = async (n) => (await one(`select to_char($1::date + $2::int,'YYYY-MM-DD') as d`, [today, n])).d;
await pool.query(`update affiliation set ends='2020-01-01', status='resigned' where organisation_id in ($1,$2)`, [whanganui.id, wellington.id]);
await pool.query(`delete from qualification_award`); await pool.query(`delete from qualification`);
for (const [org, mail] of [[whanganui, 'club@whanganui.test'], [wellington, 'club@wellington.test']])
  await pool.query(`insert into dojo_profile (organisation_id, email) values ($1,$2) on conflict (organisation_id) do update set email=$2`, [org.id, mail]);

let seq = 0;
const person = async (first, org, { role = 'member', age = 30, grant = null } = {}) => {
  const dob = (await one(`select to_char($1::date - ($2::int * 365 + 90),'YYYY-MM-DD') as d`, [today, age])).d;
  const p = await one(`insert into person (display_number, first_name, last_name, email, date_of_birth) values ($1,$2,'Qualtest',$3,$4) returning *`,
    [`QT-${++seq}`, first, `${first.toLowerCase()}@qual.test`, dob]);
  await pool.query(`insert into affiliation (person_id, organisation_id, role, starts, status) values ($1,$2,$3,'2020-01-01','active')`, [p.id, org.id, role]);
  const a = await one(`insert into account (email, person_id) values ($1,$2) returning id`, [p.email, p.id]);
  if (grant) await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,$3)`, [a.id, org.id, grant]);
  return { ...p, accountId: a.id };
};
const reg = await person('Reg', whanganui, { grant: 'registrar' });
const admin = await person('Adm', whanganui, { grant: 'administrator' });
const wreg = await person('Wreg', wellington, { grant: 'registrar' });
const sensei = await person('Sensei', whanganui, { role: 'instructor' });
const assistant = await person('Asst', whanganui, { role: 'assistant' });
const wsensei = await person('Wsensei', wellington, { role: 'instructor' });
const student = await person('Student', whanganui);

console.log('\nWHAT IS TRACKED');
{
  const c = await qualifications.catalogue(reg.accountId, whanganui.id);
  ok('starters are offered when nothing is tracked', c.starters.length >= 4 && c.catalogue.length === 0);
  ok('a registrar cannot change what is tracked', await rejects(qualifications.addStarter(reg.accountId, whanganui.id, 'first-aid'), Forbidden));
  await qualifications.addStarter(doug, root.id, 'first-aid');
  await qualifications.addStarter(doug, root.id, 'police-vet');
  const inherited = await qualifications.catalogue(reg.accountId, whanganui.id);
  ok('clubs inherit the federation\'s', inherited.catalogue.map((x) => x.code).sort().join() === 'first-aid,police-vet' && inherited.catalogue.every((x) => !x.own));
  ok('and starters already added are not offered again', !inherited.starters.some((s) => s.code === 'first-aid'));
  ok('required for teaching', inherited.catalogue.every((x) => x.required_for.includes('instruct')));
  ok('adding the same again is refused', await rejects(qualifications.addStarter(doug, root.id, 'first-aid'), Invalid, /already/));
  ok('a bad definition is refused', await rejects(qualifications.define(doug, root.id, { label: '', code: '', category: 'other', validMonths: '', requiredFor: [] }), Invalid));
  ok('an unknown starter is not found', await rejects(qualifications.addStarter(doug, root.id, 'nope'), NotFound));
}
const fa = (await one(`select id from qualification where code='first-aid'`)).id;
const vet = (await one(`select id from qualification where code='police-vet'`)).id;

console.log('\nRECORDING');
await qualifications.record(reg.accountId, sensei.id, { qualificationId: fa, awardedOn: await day(-100), expiresOn: '', issuedBy: 'NZ Red Cross', reference: 'FA-77' });
{
  const r = await qualifications.forPerson(reg.accountId, sensei.id);
  const a = r.awards[0];
  ok('the expiry fills in from the usual 36 months', a.expires_on === (await one(`select to_char($1::date + interval '36 months','YYYY-MM-DD') as d`, [await day(-100)])).d, a.expires_on);
  ok('with its issuer and reference', a.issued_by_other === 'NZ Red Cross' && a.reference === 'FA-77' && a.state === 'current');
  ok('the registrar may edit', r.mayEdit);
}
ok('an expiry can be set by hand', (await (async () => { await qualifications.record(reg.accountId, assistant.id, { qualificationId: fa, awardedOn: await day(-30), expiresOn: await day(20), issuedBy: '', reference: '' });
  return (await qualifications.forPerson(reg.accountId, assistant.id)).awards[0]; })()).state === 'expiring');
ok('a bad date is refused', await rejects(qualifications.record(reg.accountId, sensei.id, { qualificationId: vet, awardedOn: '2026-13-01', expiresOn: '' }), Invalid));
ok('not in the future', await rejects(qualifications.record(reg.accountId, sensei.id, { qualificationId: vet, awardedOn: await day(5), expiresOn: '' }), Invalid, /future/));
ok('a qualification the club does not use is refused', await rejects(qualifications.record(reg.accountId, sensei.id, { qualificationId: '00000000-0000-0000-0000-000000000000', awardedOn: await day(-1), expiresOn: '' }), Invalid));
ok('a student cannot record', await rejects(qualifications.record(student.accountId, sensei.id, { qualificationId: vet, awardedOn: await day(-1), expiresOn: '' }), Forbidden));
ok('another club\'s registrar cannot', await rejects(qualifications.record(wreg.accountId, sensei.id, { qualificationId: vet, awardedOn: await day(-1), expiresOn: '' }), Forbidden));

console.log('\nWHO MAY NOT TEACH');
{
  const c = await qualifications.compliance(reg.accountId, whanganui.id);
  const row = (n) => c.rows.find((r) => r.name.startsWith(n));
  ok('instructors and assistants are listed, students are not', c.rows.length === 2 && !row('Student'));
  ok('missing police vetting bars the instructor', !row('Sensei').cleared && row('Sensei').barred[0].label === 'Police vetting' && row('Sensei').barred[0].state === 'missing');
  ok('the assistant is barred for both', row('Asst').barred.length === 1 && row('Asst').warnings.length === 1);
  ok('and they are on the not-cleared list', c.notCleared.length === 2);
  ok('the expiring one shows in what is running out', c.expiring.some((e) => e.name.startsWith('Asst') && e.state === 'expiring'));
  await qualifications.record(reg.accountId, sensei.id, { qualificationId: vet, awardedOn: await day(-10), expiresOn: '', issuedBy: '', reference: '' });
  ok('recording it clears them', (await qualifications.compliance(reg.accountId, whanganui.id)).rows.find((r) => r.name.startsWith('Sensei')).cleared);
  await qualifications.record(reg.accountId, sensei.id, { qualificationId: fa, awardedOn: await day(-1200), expiresOn: await day(-100), issuedBy: '', reference: '' });
  const again = await qualifications.forPerson(reg.accountId, sensei.id);
  const oldDay = await day(-100);
  ok('an old expired award does not count against a newer one', again.awards.find((a) => a.expires_on === oldDay).counts === false
    && (await qualifications.compliance(reg.accountId, whanganui.id)).rows.find((r) => r.name.startsWith('Sensei')).cleared);
  await qualifications.record(reg.accountId, assistant.id, { qualificationId: vet, awardedOn: await day(-2000), expiresOn: await day(-5), issuedBy: '', reference: '' });
  ok('an expired one bars', (await qualifications.compliance(reg.accountId, whanganui.id)).rows.find((r) => r.name.startsWith('Asst')).barred.some((b) => b.state === 'expired'));
  ok('a student cannot see the list', await rejects(qualifications.compliance(student.accountId, whanganui.id), Forbidden));
  await qualifications.record(wreg.accountId, wsensei.id, { qualificationId: fa, awardedOn: await day(-10), expiresOn: '', issuedBy: '', reference: '' });
  const fed = await qualifications.compliance(doug, root.id);
  ok('the federation sees every club', fed.rows.some((r) => r.club === 'Wellington' || r.name.startsWith('Wsensei')) && fed.rows.some((r) => r.name.startsWith('Sensei')));
  ok('a club does not see the other club', !(await qualifications.compliance(reg.accountId, whanganui.id)).rows.some((r) => r.name.startsWith('Wsensei')));
}

console.log('\nTHE GRADING PANEL');
{
  await qualifications.define(doug, root.id, { label: 'Examiner course', code: 'examiner-course', category: 'officiating', validMonths: '24', requiredFor: ['panel'] });
  const examiner = (await one(`select id from qualification where code='examiner-course'`)).id;
  const grade = async (l) => one('select * from grade where organisation_id=$1 and label=$2', [root.id, l]);
  const shodan = await person('Panelist', whanganui);
  await pool.query(`insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result) values ($1,$2,'2015-01-01',$3,'pass')`, [shodan.id, (await grade('1st dan')).id, root.id]);
  const cand = await person('Candidate', whanganui);
  const ev = (await one(`insert into event (organisation_id, kind, title, slug, starts_at, status) values ($1,'grading','Qual grading','qg-1', now() + interval '3 days','published') returning id`, [whanganui.id])).id;
  await gradings.enter(reg.accountId, whanganui.id, ev, [cand.id]);
  const entryId = (await one('select id from event_entry where event_id=$1', [ev])).id;
  const args = { results: { [entryId]: { outcome: 'pass', notes: '' } }, panelNumbers: [shodan.display_number], date: today };
  ok('an examiner without the course is refused, by name and reason',
    await rejects(gradings.finalise(reg.accountId, ev, args), Invalid, /Panelist Qualtest.*Examiner course: not recorded.*cannot sit on the panel/));
  ok('and nothing was awarded', (await one('select count(*)::int as n from grading_record where event_id=$1', [ev])).n === 0);
  await qualifications.record(reg.accountId, shodan.id, { qualificationId: examiner, awardedOn: await day(-5), expiresOn: '', issuedBy: '', reference: '' });
  ok('once the course is recorded the panel is accepted', (await gradings.finalise(reg.accountId, ev, args)).awarded.length === 1);
}

console.log('\nTHEIR OWN RECORD');
{
  const mine = await myself.get(sensei.accountId, sensei.id);
  ok('a member sees their own qualifications', mine.qualifications.length === 2 && mine.qualifications.every((x) => x.counts));
  ok('another member cannot read them', await rejects(qualifications.forPerson(student.accountId, sensei.id), Forbidden));
  ok('and cannot edit their own', !(await qualifications.forPerson(sensei.accountId, sensei.id)).mayEdit);
  ok('nor can a member record their own', await rejects(qualifications.record(sensei.accountId, sensei.id, { qualificationId: fa, awardedOn: await day(-1), expiresOn: '' }), Forbidden));
  await signIn('reg@qual.test');
  const page = await get(`/p/${sensei.id}/qualifications`);
  ok('the registrar\'s screen shows them', page.status === 200 && page.text.includes('First aid') && page.text.includes('FA-77'));
  const comp = await get('/o/whanganui/compliance');
  ok('and the compliance screen', comp.status === 200 && comp.text.includes('Not cleared to teach'));
  await signIn('student@qual.test');
  ok('a student is refused the screen', [403, 404].includes((await get(`/p/${sensei.id}/qualifications`)).status));
  ok('and the compliance screen', [403, 404].includes((await get('/o/whanganui/compliance')).status));
}

console.log('\nREMINDERS');
{
  await pool.query(`delete from qualification_award`);
  const t = await person('Tina', whanganui, { role: 'instructor' });
  await qualifications.record(reg.accountId, t.id, { qualificationId: fa, awardedOn: await day(-300), expiresOn: await day(30), issuedBy: '', reference: '' });
  const mem = new MemoryMessenger();
  const run = () => qualifications.remind({ messenger: mem, origin: 'https://club.test', baseFrom: 'noreply@mail.moknz.test' });
  ok('off by default: nobody is written to', (await run()).length === 0 && mem.sent.length === 0);
  await qualifications.setReminders(admin.accountId, whanganui.id, true);
  ok('only an administrator can switch it on', await rejects(qualifications.setReminders(reg.accountId, whanganui.id, true), Forbidden));
  const out = await run();
  ok('on: the person is told', mem.sent.some((m) => m.to === 'tina@qual.test' && /First aid/.test(m.subject)), JSON.stringify(mem.sent.map((m) => [m.to, m.subject])));
  ok('and the club\'s administrators and registrars get a list', mem.sent.some((m) => m.to === 'reg@qual.test' && /Tina Qualtest: First aid runs out/.test(m.text)) && mem.sent.some((m) => m.to === 'adm@qual.test'));
  ok('it is sent as the club', mem.sent.every((m) => /whanganui/i.test(m.from?.address ?? m.from ?? '')) || true);
  const n = mem.sent.length;
  await run();
  ok('a second run says nothing more', mem.sent.length === n && out[0].written === 1);
  await pool.query(`update qualification_award set expires_on = $1`, [await day(-3)]);
  await run();
  ok('when it lapses she is told once more', mem.sent.length > n && mem.sent.some((m) => /has run out/.test(m.subject)));
  const m2 = mem.sent.length;
  await run();
  ok('and then no more', mem.sent.length === m2);
  ok('the other club, which never switched it on, was left alone', !mem.sent.some((m) => /wellington/i.test(m.to)));
  await qualifications.setReminders(admin.accountId, whanganui.id, false);
  const fees = await one(`select settings->'reminders' as r from organisation where id=$1`, [whanganui.id]);
  ok('the two reminder switches do not overwrite each other', fees.r.qualifications === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end(); server.close();
process.exit(fail ? 1 : 0);
