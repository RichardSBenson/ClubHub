import { nextGrading, nextGradingWords, rhythmWords } from '../core/domain/next-grading.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
// The gap now comes from the federation's own ladder, so the tests say what a ladder might say.
const t = (months, nextL, { inv = false, on = '2026-01-31', today = '2026-10-09' } = {}) =>
  nextGrading({ held: { awardedOn: on, usualMonths: months, byInvitation: inv }, next: nextL ? { label: nextL } : null, today });

console.log('\nNEXT GRADING, FROM THE LADDER');
ok('6 months', t(6, '7th kyu').dueFrom === '2026-07-31' && t(6, '7th kyu').due);
ok('a year', t(12, '5th kyu').dueFrom === '2027-01-31' && !t(12, '5th kyu').due);
ok('3 years, not by invitation', t(36, 'Nidan').dueFrom === '2029-01-31' && !t(36, 'Nidan').byInvitation);
ok('4 years by invitation', t(48, 'Sandan', { inv: true }).dueFrom === '2030-01-31' && t(48, 'Sandan', { inv: true }).byInvitation);
ok('no set timetable: no date', t(null, 'Sixth').dueFrom === null && /no set timetable/.test(nextGradingWords(t(null, null))));
ok('month ends clamp (31 Aug + 6 months)', t(6, 'Next', { on: '2026-08-31' }).dueFrom === '2027-02-28');
ok('a timetable but nothing above: nothing to say', t(12, null) === null);
ok('no grade: nothing', nextGrading({ held: null, next: null, today: '2026-10-09' }) === null);
ok('words: due now', /due now/.test(nextGradingWords(t(6, '7th kyu'))));
ok('words: future date', /due from 31 Jan 2027/.test(nextGradingWords(t(12, '5th kyu'))));
ok('rhythm in words', rhythmWords(6) === 'about twice a year' && rhythmWords(12) === 'about once a year' && rhythmWords(36) === 'about every 3 years' && rhythmWords(18) === 'about every 18 months' && rhythmWords(48, true) === 'about every 4 years, by invitation');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
