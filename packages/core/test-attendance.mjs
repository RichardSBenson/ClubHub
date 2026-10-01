import { isDate, weekdayOf, addDays, problemsWithSheet, classesOn, notSeenSince, perWeek, readVisitors } from './domain/attendance.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

console.log('\nDATES');
ok('a real date', isDate('2026-10-02')); ok('not 31 September', !isDate('2026-09-31')); ok('not nonsense', !isDate('2/10/26'));
ok('2 Oct 2026 is a Friday (5)', weekdayOf('2026-10-02') === 5);
ok('a Sunday is 0', weekdayOf('2026-10-04') === 0);
ok('adding days crosses the month', addDays('2026-10-30', 3) === '2026-11-02');

console.log('\nWHEN A ROLL CAN BE KEPT');
const today = '2026-10-02';
ok('today is fine', problemsWithSheet({ date: '2026-10-02', sessionWeekday: 5 }, today).length === 0);
ok('last week is fine', problemsWithSheet({ date: '2026-09-25', sessionWeekday: 5 }, today).length === 0);
ok('tomorrow is refused', problemsWithSheet({ date: '2026-10-03', sessionWeekday: 6 }, today).length === 1);
ok('over 60 days back is refused', problemsWithSheet({ date: '2026-07-01', sessionWeekday: 3 }, today).length === 1);
ok('the wrong day of the week is refused', /does not run/.test(problemsWithSheet({ date: '2026-10-01', sessionWeekday: 5 }, today)[0]));
ok('a bad date is refused', problemsWithSheet({ date: 'x', sessionWeekday: 5 }, today).length === 1);

console.log('\nWHICH CLASSES RUN');
const s = [{ weekday: 2, label: 'Juniors' }, { weekday: 5, label: 'Seniors' }, { weekday: 5, label: 'Open mat' }];
ok('both Friday classes', classesOn(s, '2026-10-02').length === 2);
ok('none on a Monday', classesOn(s, '2026-10-05').length === 0);

console.log('\nWHO HAS NOT BEEN SEEN');
const m = [{ name: 'a', joined: '2020-01-01', last_seen: '2026-09-30' }, { name: 'b', joined: '2020-01-01', last_seen: '2026-08-01' },
  { name: 'c', joined: '2020-01-01', last_seen: null }, { name: 'd', joined: '2026-09-25', last_seen: null }];
const gone = notSeenSince(m, today, 30).map((x) => x.name);
ok('lapsed attenders and never-seen are listed', gone.includes('b') && gone.includes('c'));
ok('somebody who came this week is not', !gone.includes('a'));
ok('a brand new member has not been missed yet', !gone.includes('d'));
ok('sessions a week', perWeek(12, 84) === 1 && perWeek(5, 30) === 1.2);

console.log('\nVISITORS');
ok('numbers split however they are typed', JSON.stringify(readVisitors('nz-1, NZ-2\nnz-1;  NZ-3')) === JSON.stringify(['NZ-1', 'NZ-2', 'NZ-3']));
ok('blank is nobody', readVisitors('  ').length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
