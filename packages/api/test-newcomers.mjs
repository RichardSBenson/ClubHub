/**
 * Walk-ins: people trying a class.
 *
 *   1. An instructor can add one, with the waiver, and mark them at a class.
 *   2. A child needs a parent; nothing is stored without the waiver.
 *   3. They are NOT people: no member number, not on the roll, not in the roster.
 *   4. Joining makes a real member and the classes already done count.
 *   5. Not continuing wipes their details; stale ones are purged.
 *   6. Nobody else can see or touch them.
 */
import { open as unseal } from '../infrastructure/crypto/vault.mjs';
import './reset.mjs';
import { pool, newcomers, attendance, Forbidden, Invalid, NotFound } from './data.mjs';
import { readNewcomer } from '../core/domain/newcomer.mjs';

process.env.HONBU_STORE = 'postgres';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const q = async (sql, a = []) => (await pool.query(sql, a)).rows;
const one = async (sql, a = []) => (await q(sql, a))[0] ?? null;
const rejects = (p, cls, re = /./) => p.then(() => false, (e) => e instanceof cls && re.test(e.message));

const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const tane = (await one(`select id from account where email='tane@example.nz'`)).id;
const today = (await one(`select to_char((now() at time zone 'Pacific/Auckland')::date,'YYYY-MM-DD') as d`)).d;
const weekdayToday = (await one(`select extract(dow from $1::date)::int as d`, [today])).d;
await pool.query(`delete from training_session where organisation_id=$1`, [whanganui.id]);
const classId = (await one(`insert into training_session (organisation_id, label, weekday, starts, ends)
  values ($1,'Seniors',$2,'18:00','19:00') returning id`, [whanganui.id, weekdayToday])).id;

let seq = 0;
const staff = async (role) => {
  const p = await one(`insert into person (display_number, first_name, last_name, email) values ($1,$2,'Nctest',$3) returning *`,
    [`NC-${++seq}`, role, `${role}@nc.test`]);
  await pool.query(`insert into affiliation (person_id, organisation_id, role, starts, status) values ($1,$2,'member','2020-01-01','active')`, [p.id, whanganui.id]);
  const a = await one(`insert into account (email, person_id) values ($1,$2) returning id`, [p.email, p.id]);
  await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,$3)`, [a.id, whanganui.id, role]);
  return a.id;
};
const sensei = await staff('instructor'); const reg = await staff('registrar');
const plain = await one(`insert into account (email) values ('walker@nc.test') returning id`).then((r) => r.id);

const form = (o = {}) => readNewcomer({ firstName: 'Sam', lastName: 'Walker', email: 'sam@nc.test', dateOfBirth: '1990-05-01',
  emergencyName: 'Pat', emergencyPhone: '021 555 1234', consent: '1', consentName: 'Sam Walker', medicalNotes: 'Asthma', ...o });
const kid = (o = {}) => form({ firstName: 'Kai', email: '', dateOfBirth: '2016-03-14', emergencyName: '', emergencyPhone: '',
  guardianName: 'Mere Walker', guardianPhone: '021 555 9999', consentName: 'Mere Walker', ...o });

console.log('\nADDING');
const sam = await newcomers.add(sensei, whanganui.id, form(), { sessionId: classId, date: today });
ok('an instructor can add one and mark them here', !!sam.id);
const sheet = await attendance.sheet(sensei, whanganui.id, classId, today);
ok('they appear on the roll sheet as present', sheet.newcomers.some((n) => n.id === sam.id && n.present && n.visits === 1));
ok('but not among the members', !sheet.members.some((m) => /Sam/.test(m.name ?? '')));
ok('no member number was taken', (await one(`select count(*)::int as n from person where first_name='Sam' and last_name='Walker'`)).n === 0);
ok('the waiver is on record', (await one('select consent_by, consent_taken_by from newcomer where id=$1', [sam.id])).consent_by === 'Sam Walker');
ok('a duplicate is refused', await rejects(newcomers.add(sensei, whanganui.id, form()), Invalid, /already/));
ok('without the waiver nothing is stored', await rejects(newcomers.add(sensei, whanganui.id, form({ firstName: 'Zed', email: 'z@nc.test', consent: '' })), Invalid, /waiver/));
ok('a child needs a parent', await rejects(newcomers.add(sensei, whanganui.id, kid({ guardianName: '', guardianPhone: '' })), Invalid, /parent/));
const kai = await newcomers.add(sensei, whanganui.id, kid());
ok('a child with a parent is fine', !!kai.id);
ok('an existing member\'s email is refused', await rejects(newcomers.add(sensei, whanganui.id, form({ firstName: 'Dup', email: 'instructor@nc.test' })), Invalid, /already a member/));
ok('an ordinary member cannot add', await rejects(newcomers.add(plain, whanganui.id, form({ firstName: 'Q', email: 'q@nc.test' })), Forbidden));
ok('another club\'s admin cannot', await rejects(newcomers.add(tane, whanganui.id, form({ firstName: 'Q', email: 'q@nc.test' })), Forbidden));
ok('a class on the wrong day is refused', await rejects(newcomers.add(sensei, whanganui.id, form({ firstName: 'Late', email: 'l@nc.test' }), { sessionId: classId, date: '2020-01-01' }), Invalid));

console.log('\nTHE ROLL');
await attendance.save(sensei, whanganui.id, classId, today, { personIds: [], newcomerIds: [kai.id, sam.id] });
let l = await newcomers.list(sensei, whanganui.id);
ok('both are marked', l.newcomers.find((n) => n.id === kai.id).visits === 1);
ok('saving the roll counts newcomers', (await attendance.save(sensei, whanganui.id, classId, today, { personIds: [], newcomerIds: [sam.id] })).came === 1);
ok('unticking removes the visit', (await newcomers.list(sensei, whanganui.id)).newcomers.find((n) => n.id === kai.id).visits === 0);
const wellSession = await one(`select id from training_session where organisation_id=$1 limit 1`, [wellington.id]);
ok('a newcomer id from elsewhere is ignored', (await attendance.save(sensei, whanganui.id, classId, today, { personIds: [], newcomerIds: ['00000000-0000-0000-0000-000000000000'] })).came === 0);
await attendance.save(sensei, whanganui.id, classId, today, { personIds: [], newcomerIds: [sam.id] });

console.log('\nJOINING');
ok('an instructor cannot make a member', await rejects(newcomers.join(sensei, whanganui.id, sam.id), Forbidden));
const { person } = await newcomers.join(reg, whanganui.id, sam.id);
ok('a registrar can; they get a member number', /-\d+$/.test(person.display_number), person.display_number);
ok('their class counts as the member\'s', (await one('select count(*)::int as n from attendance where person_id=$1', [person.id])).n === 1);
ok('their medical note moved to the member', unseal((await one('select medical_notes from person_private where person_id=$1', [person.id])).medical_notes) === 'Asthma');
const joined = await one('select * from newcomer where id=$1', [sam.id]);
ok('the trial record keeps only the consent', joined.status === 'joined' && !joined.email && !joined.medical_notes && joined.consent_by === 'Sam Walker');
ok('joining twice is refused', await rejects(newcomers.join(reg, whanganui.id, sam.id), Invalid, /already/));
const kidJoin = await newcomers.join(reg, whanganui.id, kai.id);
const ec = await one('select emergency_name, emergency_phone from person_private where person_id=$1', [kidJoin.person.id]);
ok('a child\'s parent becomes the emergency contact', ec.emergency_name === 'Mere Walker' && ec.emergency_phone === '021 555 9999');

console.log('\nNOT CONTINUING AND FORGETTING');
const lee = await newcomers.add(sensei, whanganui.id, form({ firstName: 'Lee', email: 'lee@nc.test' }));
await newcomers.notContinuing(sensei, whanganui.id, lee.id);
const gone = await one('select * from newcomer where id=$1', [lee.id]);
ok('their details are wiped', gone.status === 'not_continuing' && !gone.email && !gone.medical_notes && !gone.emergency_phone);
ok('a joined person cannot be marked not continuing', await rejects(newcomers.notContinuing(sensei, whanganui.id, sam.id), Invalid));
const old = await newcomers.add(sensei, whanganui.id, form({ firstName: 'Old', email: 'old@nc.test' }));
await pool.query(`update newcomer set created_at = now() - interval '200 days', updated_at = now() - interval '200 days' where id=$1`, [old.id]);
const fresh = await newcomers.add(sensei, whanganui.id, form({ firstName: 'New', email: 'new@nc.test' }));
ok('purge removes the stale', (await newcomers.purgeStale()) >= 1 && !(await one('select 1 from newcomer where id=$1', [old.id])));
ok('and keeps the fresh and the joined', !!(await one('select 1 from newcomer where id=$1', [fresh.id])) && !!(await one('select 1 from newcomer where id=$1', [sam.id])));

console.log('\nPRIVACY');
ok('another club cannot list them', await rejects(newcomers.list(tane, whanganui.id), Forbidden));
ok('another club cannot wipe them', await rejects(newcomers.notContinuing(tane, whanganui.id, fresh.id), Forbidden));
ok('a wrong club id does not find them', await rejects(newcomers.notContinuing(sensei, whanganui.id, '00000000-0000-0000-0000-000000000000'), NotFound));
ok('they are not in the roster', !(await q(`select 1 from affiliation a join person p on p.id=a.person_id where a.organisation_id=$1 and p.first_name='Lee'`, [whanganui.id])).length);

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
