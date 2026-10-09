/**
 * The role rules: instructors are shodan or above; supporters are not members and have nothing
 * to do with rank; children sit under a parent.
 */
import './reset.mjs';
import { pool, people, rank, instructorRole as instructors, family } from './data.mjs';
import { planImport } from '../core/domain/roll-import.mjs';
import { chooseRecipients } from '../core/domain/messaging.mjs';
import { whyNotInstructor, problemsWithRoleAndGrade } from '../core/domain/roles.mjs';

process.env.HONBU_STORE = 'postgres';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e.message ?? String(e); } };

const wh = await one(`select * from organisation where slug='whanganui'`);
const root = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, role = 'member') => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, role });
const grade = (label) => one(`select id from grade where label=$1 and organisation_id=$2`, [label, root.id]);
const give = async (p, label) => pool.query(`insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result, panel) values ($1,$2,'2015-01-01',$3,'pass','[]')`, [p.id, (await grade(label)).id, root.id]);

console.log('\nPURE RULES');
ok('no grade: not an instructor', !!whyNotInstructor(null));
ok('a kyu grade: not an instructor', !!whyNotInstructor({ label: '3rd kyu', is_dan: false }));
ok('1st dan: may instruct', whyNotInstructor({ label: '1st dan', is_dan: true }) === null);
ok('a supporter with a grade is a problem', problemsWithRoleAndGrade({ role: 'supporter', hasGrade: true }).length === 1);

console.log('\nINSTRUCTORS');
{
  const kyu = await enrol('Kyu', 'Person', '1990-01-01'); await give(kyu, '2nd kyu');
  const dan = await enrol('Dan', 'Person', '1980-01-01'); await give(dan, '1st dan');
  ok('a kyu grade is refused', /dan grade/.test(await refused(() => instructors.set(doug.id, kyu.id, true)) ?? ''));
  ok('a 1st dan is accepted', (await instructors.set(doug.id, dan.id, true)).changed === true);
  ok('enrolling straight in as an instructor is refused', /dan grade/.test(await refused(() => enrol('Straight', 'In', '1980-01-01', 'instructor')) ?? ''));
}

console.log('\nSUPPORTERS');
{
  const sup = await enrol('Sue', 'Supporter', '1970-01-01', 'supporter');
  const g = await grade('5th kyu');
  ok('no grade can be awarded', /not a member/.test(await refused(() => rank.award(doug.id, { personId: sup.id, gradeId: g.id, awardedByOrg: wh.id, awardedOn: '2020-01-01' })) ?? ''));
  ok('no grade can be recorded as held', (await refused(() => rank.recognise(doug.id, { personId: sup.id, gradeId: g.id }))) !== null);
  ok('nothing is offered to record', (await rank.recognisable(doug.id, sup.id)).grades.length === 0);
  ok('no grade is on the record', !(await one('select 1 x from grading_record where person_id=$1', [sup.id])));
  const rows = [{ line: 2, values: {} }];
  const plan = planImport({ headers: ['First name', 'Last name', 'Role', 'Grade'], rows: [['Sam', 'Sup', 'supporter', '5th kyu']] },
    { ladder: await rank.ladder(root.id), existing: [] });
  ok('an import row for a supporter with a grade is refused', JSON.stringify(plan).includes('"refuse"') || /nothing to do with grades/.test(JSON.stringify(plan)));
}

console.log('\nCHILDREN');
{
  const kid = await enrol('Kid', 'Alone', new Date(Date.now() - 9 * 365.25 * 864e5).toISOString().slice(0, 10));
  const adult = await enrol('Adult', 'Alone', '1985-01-01');
  const lonely = await family.withoutGuardian([kid.id, adult.id]);
  ok('a child with nobody linked is flagged', lonely.has(kid.id));
  ok('an adult is not', !lonely.has(adult.id));
  const mum = await enrol('Mum', 'Alone', '1985-02-02');
  await family.link(doug.id, { guardianId: mum.id, childId: kid.id, relationship: 'parent' });
  ok('once linked, the child is no longer flagged', !(await family.withoutGuardian([kid.id])).has(kid.id));
}

console.log('\nMAIN CONTACT');
{
  const kid = { personId: 'k', email: null, isMinor: true, optedOut: false };
  const mum = { personId: 'm', email: 'mum@x.nz', optedOut: false, main: false, alsoCopy: false };
  const dad = { personId: 'd', email: 'dad@x.nz', optedOut: false, main: false, alsoCopy: false };
  const to = (gs) => chooseRecipients([{ ...kid, guardians: gs }]).recipients.map((r) => r.email).sort().join();
  ok('with no main contact, both parents get the mail', to([mum, dad]) === 'dad@x.nz,mum@x.nz');
  ok('with a main contact, only she does', to([{ ...mum, main: true }, dad]) === 'mum@x.nz');
  ok('a parent marked "also copy" is added', to([{ ...mum, main: true }, { ...dad, alsoCopy: true }]) === 'dad@x.nz,mum@x.nz');
  const kidP = await enrol('Kid', 'Contact', new Date(Date.now() - 8 * 365.25 * 864e5).toISOString().slice(0, 10));
  const m1 = await enrol('Mum', 'Contact', '1985-02-02'), d1 = await enrol('Dad', 'Contact', '1984-02-02');
  const l1 = await family.link(doug.id, { guardianId: m1.id, childId: kidP.id, relationship: 'parent' });
  const l2 = await family.link(doug.id, { guardianId: d1.id, childId: kidP.id, relationship: 'parent' });
  await family.setContact(doug.id, l1.id, { main: true });
  await family.setContact(doug.id, l2.id, { main: true });
  const rows = (await pool.query('select id, is_main_contact m from guardian_link where child_id=$1', [kidP.id])).rows;
  ok('only one parent can be the main contact', rows.filter((r) => r.m).length === 1 && rows.find((r) => r.id === l2.id).m);
  await family.setContact(doug.id, l1.id, { main: false, copy: true });
  ok('"also copy" is stored', (await one('select also_copy from guardian_link where id=$1', [l1.id])).also_copy === true);
}

console.log('\nWHO LOOKS AFTER THE FEES');
{
  const gp = { personId: 'g', email: 'gran@x.nz', optedOut: false };
  const mum = { personId: 'm', email: 'mum@x.nz', optedOut: false };
  const kid = { personId: 'k', email: null, isMinor: true, optedOut: false };
  const to = (gs, o) => chooseRecipients([{ ...kid, guardians: gs }], o).recipients.map((r) => r.email).sort().join();
  ok('renewals go to the adult who looks after the fees', to([{ ...gp, pays: true }, mum], { preferFees: true }) === 'gran@x.nz');
  ok('ordinary news still goes to both', to([{ ...gp, pays: true }, mum]) === 'gran@x.nz,mum@x.nz');
  const kidP = await enrol('Fee', 'Child', new Date(Date.now() - 7 * 365.25 * 864e5).toISOString().slice(0, 10));
  const gran = await enrol('Gran', 'Fee', '1955-01-01'), auntie = await enrol('Auntie', 'Fee', '1980-01-01');
  const acc = async (p, email) => (await pool.query(`insert into account (email, person_id) values ($1,$2) returning id`, [email, p.id])).rows[0].id;
  const ga = await acc(gran, 'gran.fee@example.nz'), aa = await acc(auntie, 'auntie.fee@example.nz');
  const lg = await family.link(doug.id, { guardianId: gran.id, childId: kidP.id, relationship: 'grandparent' });
  const la = await family.link(doug.id, { guardianId: auntie.id, childId: kidP.id, relationship: 'aunt_uncle' });
  ok('with nobody marked, both may pay', await family.mayPayFor(ga, kidP.id) && await family.mayPayFor(aa, kidP.id));
  await family.setContact(doug.id, lg.id, { main: true, fees: true });
  ok('the marked grandparent may pay', await family.mayPayFor(ga, kidP.id));
  ok('the auntie no longer may', !(await family.mayPayFor(aa, kidP.id)));
  ok('but still acts for the child otherwise', (await family.mayActFor(aa, kidP.id)) === 'guardian');
  await family.setContact(doug.id, la.id, { fees: true });
  ok('only one adult looks after the fees', !(await family.mayPayFor(ga, kidP.id)) && await family.mayPayFor(aa, kidP.id));
}

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
