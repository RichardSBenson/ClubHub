/** A federation sets its own gaps between gradings; they come from its ladder, not the code. */
import './reset.mjs';
import { pool, rank, orgs, Forbidden } from './data.mjs';
import { readTimetable } from '../core/domain/next-grading.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}${c ? '' : '  ' + d}`); };
const doug = (await pool.query(`select id from account where email='doug@example.nz'`)).rows[0];
const fed = (await pool.query(`select id from organisation where slug='moknz'`)).rows[0];
const ladder = await rank.ladder(fed.id);

console.log('\nTHE SEEDED TIMETABLE');
const by = (label) => ladder.find((g) => g.label === label);
ok('7th kyu: 6 months', by('7th kyu')?.usual_months_to_next === 6);
ok('6th kyu: a year', by('6th kyu')?.usual_months_to_next === 12);
ok('1st dan: 3 years', by('1st dan')?.usual_months_to_next === 36 && !by('1st dan').next_by_invitation);
ok('2nd dan: 4 years by invitation', by('2nd dan')?.usual_months_to_next === 48 && by('2nd dan').next_by_invitation);
ok('5th dan: no set timetable', by('5th dan')?.usual_months_to_next === null);

console.log('\nCHANGING IT');
const form = Object.fromEntries(ladder.flatMap((g) => [[`months_${g.id}`, ''], [`invite_${g.id}`, '']]));
form[`months_${by('6th kyu').id}`] = '9'; form[`invite_${by('6th kyu').id}`] = 'on';
const { rows, problems } = readTimetable(form, ladder);
ok('reads cleanly', problems.length === 0 && rows.length === ladder.length);
await rank.setTimetable(doug.id, fed.id, rows);
const after = (await rank.ladder(fed.id)).find((g) => g.label === '6th kyu');
ok('saved', after.usual_months_to_next === 9 && after.next_by_invitation === true);
ok('a blank clears it', (await rank.ladder(fed.id)).find((g) => g.label === '7th kyu').usual_months_to_next === null);
form[`months_${by('6th kyu').id}`] = 'soon';
ok('nonsense is refused', readTimetable(form, ladder).problems.length === 1);
form[`months_${by('6th kyu').id}`] = '999';
ok('so is too long', readTimetable(form, ladder).problems.length === 1);
const nobody = (await pool.query(`insert into account (email) values ('nobody@example.nz') returning id`)).rows[0];
ok('only an administrator may', await rank.setTimetable(nobody.id, fed.id, rows).then(() => false, (e) => e instanceof Forbidden));

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
