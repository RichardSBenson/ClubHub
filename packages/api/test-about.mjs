/** The write-up is set from the register profile by whoever may change the photograph. */
import './reset.mjs';
import { pool, photos, Forbidden, Invalid } from './data.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}${c ? '' : '  ' + d}`); };
const doug = (await pool.query(`select id from account where email='doug@example.nz'`)).rows[0];
const wh = (await pool.query(`select id from organisation where slug='whanganui'`)).rows[0];
const person = (await pool.query(`select p.id from person p join affiliation a on a.person_id=p.id and a.ends is null where a.organisation_id=$1 limit 1`, [wh.id])).rows[0];

console.log('\nWRITE-UP');
await photos.setAbout(doug.id, person.id, '  Trains four nights a week.  ');
const row = (await pool.query('select about from person where id=$1', [person.id])).rows[0];
ok('saved, trimmed', row.about === 'Trains four nights a week.', row.about);
await photos.setAbout(doug.id, person.id, '');
ok('empty clears it', (await pool.query('select about from person where id=$1', [person.id])).rows[0].about === null);
ok('too long is refused', await photos.setAbout(doug.id, person.id, 'x'.repeat(281)).then(() => false, (e) => e instanceof Invalid));
const stranger = (await pool.query(`insert into account (email) values ('nobody@example.nz') returning id`)).rows[0];
ok('a stranger may not', await photos.setAbout(stranger.id, person.id, 'hi').then(() => false, (e) => e instanceof Forbidden));

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
