import { danNumber, japaneseGrade, titledName, gradeMarkup } from './honorifics.mjs';
import { instructorCard } from './render.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const list = [['2nd dan', '二段'], ['3rd dan', '三段'], ['4th dan', '四段'], ['5th dan', '五段'], ['1st dan', '初段'], ['8th dan', '八段'], ['10th dan', '十段']];
for (const [g, k] of list) ok(`${g} is ${k}`, japaneseGrade(g) === k);
for (const [g, k] of [['10th kyu', '十級'], ['9th kyu', '九級'], ['8th kyu', '八級'], ['3rd kyu', '三級'], ['2nd kyu', '二級'], ['1st kyu', '一級']]) ok(`${g} is ${k}`, japaneseGrade(g) === k);
ok('nothing to give for a blank or a made-up grade', japaneseGrade('') === null && japaneseGrade(null) === null && japaneseGrade('11th kyu') === null && japaneseGrade('white belt') === null);
ok('nonsense is refused', danNumber('11th dan') === null && danNumber('0th dan') === null && danNumber('dan') === null);

ok('title comes before the name', titledName({ title: 'Sensei', firstName: 'Richard', lastName: 'Benson' }) === 'Sensei Richard Benson');
ok('no title, no gap', titledName({ firstName: 'Ann', lastName: 'Lee' }) === 'Ann Lee');
ok('grade markup carries the language', gradeMarkup('3rd dan', esc) === '3rd dan <span lang="ja">三段</span>');
ok('a kyu grade carries its kanji too', gradeMarkup('3rd kyu', esc) === '3rd kyu <span lang="ja">三級</span>');
ok('a grade we cannot write in Japanese is shown as it is', gradeMarkup('white belt', esc) === 'white belt');
ok('markup is escaped', !gradeMarkup('<b>', esc).includes('<b>'));

const card = instructorCard({ firstName: 'Richard', lastName: 'Benson', title: 'Sensei', grade: '3rd dan', paragraphs: [] });
ok('the card reads like the list', card.includes('<h3>Sensei Richard Benson</h3>') && card.includes('3rd dan <span lang="ja">三段</span>'));
ok('the title is not repeated on the grade line', !/irank">Sensei/.test(card));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
