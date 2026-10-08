import { entryRule } from './render.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

ok('a black belt event', entryRule({ min_grade: '1st dan' }) === '1st dan and above', entryRule({ min_grade: '1st dan' }));
ok('a kyu event', entryRule({ max_grade: '1st kyu' }) === '1st kyu and below');
ok('a band of grades', entryRule({ min_grade: '8th kyu', max_grade: '1st kyu' }) === '8th kyu to 1st kyu');
ok('ages', entryRule({ min_age: 5, max_age: 12 }) === 'Ages 5 to 12', entryRule({ min_age: 5, max_age: 12 }));
ok('grade and age together', entryRule({ min_grade: '1st dan', min_age: 16 }) === '1st dan and above, age 16 and over');
ok('no limit says nothing', entryRule({}) === '');
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
