/**
 * The same person is not added twice, even when the form is sent twice at once.
 */
import './reset.mjs';
import { pool, people, Invalid } from './data.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}${c ? '' : '  ' + d}`); };
const { rows: [club] } = await pool.query(`select id from organisation where slug='whanganui'`);
const { rows: [admin] } = await pool.query(`select id from account where email='doug@example.nz'`);

console.log('\nTWO SUBMITS AT ONCE');
const fields = { organisationId: club.id, firstName: 'Twin', lastName: 'Testperson', email: 'twin.test@example.nz', role: 'member' };
const results = await Promise.allSettled([people.enrol(admin.id, fields), people.enrol(admin.id, fields)]);
ok('exactly one is created', results.filter((r) => r.status === 'fulfilled').length === 1, JSON.stringify(results.map((r) => r.status)));
const bad = results.find((r) => r.status === 'rejected');
ok('the other says where the first is', bad?.reason instanceof Invalid && /already on the register as/.test(bad.reason.message), bad?.reason?.message);

console.log('\nSAME NAME, SAME BIRTHDAY, NO EMAIL');
await people.enrol(admin.id, { organisationId: club.id, firstName: 'Dob', lastName: 'Twin', dateOfBirth: '2001-02-03', role: 'member' });
const again = await people.enrol(admin.id, { organisationId: club.id, firstName: 'dob', lastName: 'TWIN', dateOfBirth: '2001-02-03', role: 'member' }).catch((e) => e);
ok('refused', again instanceof Invalid);

console.log('\nA CHILD SHARING A PARENT\'S EMAIL IS FINE');
await people.enrol(admin.id, { organisationId: club.id, firstName: 'Parent', lastName: 'Shared', email: 'shared@example.nz', role: 'member' });
const kid = await people.enrol(admin.id, { organisationId: club.id, firstName: 'Kid', lastName: 'Shared', email: 'shared@example.nz', role: 'member' }).catch((e) => e);
ok('different name, same email', !(kid instanceof Error), kid.message);

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
