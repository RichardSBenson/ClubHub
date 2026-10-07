import { bookableDates, placeFor, problemWithBooking, placesFree, nextInQueue, queuePosition, readCapacity } from './domain/booking.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

console.log('\nPLACES');
ok('blank means no booking', readCapacity('').value === null && readCapacity('  ').value === null);
ok('a number is a number of places', readCapacity('12').value === 12);
for (const bad of ['0', '-3', '2.5', 'lots', '501', '1e3']) ok(`"${bad}" is refused`, !!readCapacity(bad).problem);
ok('free place books, full goes to the queue', placeFor({ capacity: 3, booked: 2 }) === 'booked' && placeFor({ capacity: 3, booked: 3 }) === 'waiting');
ok('free places are never negative', placesFree({ capacity: 3, booked: 5 }) === 0 && placesFree({ capacity: 3, booked: 1 }) === 2);

console.log('\nWHICH DATES');
const mon = { weekday: 1, starts: '18:00', ends: '19:00' };      // 2026-10-05 is a Monday
ok('the Monday class this week and the next two', bookableDates(mon, { date: '2026-10-05', time: '09:00' }).join() === '2026-10-05,2026-10-12,2026-10-19');
ok('a class that has started today is not offered', bookableDates(mon, { date: '2026-10-05', time: '18:00' }).join() === '2026-10-12,2026-10-19');
ok('a class that has not started is', bookableDates(mon, { date: '2026-10-05', time: '17:59' })[0] === '2026-10-05');
ok('not further than two weeks', bookableDates(mon, { date: '2026-10-05', time: '09:00' }).every((d) => d <= '2026-10-19'));
const now = { date: '2026-10-05', time: '09:00' };
ok('no places set: no booking', !!problemWithBooking({ session: { ...mon, capacity: null }, date: '2026-10-12', now, who: {} }));
ok('a date that is not a class day is refused', !!problemWithBooking({ session: { ...mon, capacity: 5 }, date: '2026-10-13', now, who: {} }));
ok('age limits are respected', !!problemWithBooking({ session: { ...mon, capacity: 5, max_age: 12 }, date: '2026-10-12', now, who: { ageYears: 30 } }));
ok('a fine booking has no problem', problemWithBooking({ session: { ...mon, capacity: 5 }, date: '2026-10-12', now, who: { ageYears: 30 } }) === null);

console.log('\nTHE QUEUE');
const t = (ms) => new Date(1_700_000_000_000 + ms);
const q = [{ id: 'c', created_at: t(30) }, { id: 'a', created_at: t(10) }, { id: 'b', created_at: t(20) }];
ok('the longest waiting goes first', nextInQueue(q, 1)[0].id === 'a' && nextInQueue(q, 2).map((x) => x.id).join() === 'a,b');
ok('positions count from one', queuePosition(q, 'a') === 1 && queuePosition(q, 'c') === 3);
const same = [{ id: 'x', created_at: t(100) }, { id: 'y', created_at: t(900) }];   // inside one second
ok('people inside the same second keep their true order', queuePosition(same, 'x') === 1 && queuePosition(same, 'y') === 2 && nextInQueue([...same].reverse(), 1)[0].id === 'x');
ok('dates and strings sort alike', nextInQueue([{ id: 'p', created_at: '2026-10-05T10:00:00.900Z' }, { id: 'o', created_at: '2026-10-05T10:00:00.100Z' }], 1)[0].id === 'o');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
