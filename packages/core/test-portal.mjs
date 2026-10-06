import { nextSession, mayAttend, actionsFor, messageText, weekdayOf } from './domain/portal.mjs';
let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
// 2026-10-07 is a Wednesday.
const S = [
  { id: 'a', label: 'Juniors', weekday: 3, starts: '17:00', ends: '18:00', min_age: 6, max_age: 12 },
  { id: 'b', label: 'Adults', weekday: 3, starts: '19:00', ends: '20:30', min_age: 16 },
  { id: 'c', label: 'Seniors', weekday: 5, starts: '19:00', ends: '20:30', min_rank_order: 40 },
];
console.log('\nWEEKDAYS'); ok('wednesday', weekdayOf('2026-10-07') === 3);
console.log('\nWHO MAY GO');
ok('age inside', mayAttend(S[0], { ageYears: 9 })); ok('too old', !mayAttend(S[0], { ageYears: 13 }));
ok('unknown age is not assumed', !mayAttend(S[0], { ageYears: null })); ok('no limits, anyone', mayAttend({ weekday: 1 }, {}));
ok('grade needed', !mayAttend(S[2], { ageYears: 30, rankOrder: 10 }) && mayAttend(S[2], { ageYears: 30, rankOrder: 40 }));
console.log('\nNEXT CLASS');
const n1 = nextSession(S, { date: '2026-10-07', time: '10:00' }, { ageYears: 9 });
ok('a child: today at 5', n1.id === 'a' && n1.daysAway === 0 && n1.weekdayName === 'Wednesday');
const n2 = nextSession(S, { date: '2026-10-07', time: '18:30' }, { ageYears: 9 });
ok('already finished today: the one next week', n2.id === 'a' && n2.daysAway === 7 && n2.date === '2026-10-14');
const n3 = nextSession(S, { date: '2026-10-07', time: '17:30' }, { ageYears: 30, rankOrder: 50 });
ok('mid-class still counts as today', n3.id === 'b' && n3.daysAway === 0);
const n4 = nextSession(S, { date: '2026-10-07', time: '21:00' }, { ageYears: 30, rankOrder: 50 });
ok('adult after hours: Friday', n4.id === 'c' && n4.date === '2026-10-09');
ok('nothing they may attend: null', nextSession(S, { date: '2026-10-07', time: '10:00' }, { ageYears: 3 }) === null);
console.log('\nWHAT NEEDS ATTENTION');
const a = actionsFor({ personId: 'p', owed: [{ amount_cents: 3000, description: 'Entry' }],
  memberships: [{ name: 'Whanganui', standing: 'due', paid_until: '2026-10-20' }],
  closing: [{ title: 'Open' }], qualifications: [{ label: 'First aid', state: 'expired' }, { label: 'Vet', state: 'expiring', expires_on: '2026-11-01' }],
  details: { emergencyContact: false } });
ok('everything is listed', a.length === 6);
ok('urgent first', a[0].kind === 'payment' && a[0].urgent && a[1].kind === 'qualification' && a[1].urgent);
ok('a single payment says what for', /Entry/.test(a[0].text));
ok('nothing wrong: nothing listed', actionsFor({ personId: 'p', memberships: [{ standing: 'current' }, { standing: 'exempt' }] }).length === 0);
ok('overdue membership is urgent', actionsFor({ personId: 'p', memberships: [{ name: 'X', standing: 'overdue', paid_until: '2026-01-01' }] })[0].urgent);
console.log('\nMESSAGES');
ok('tokens are filled', messageText('Hi from {club}. Pay at {payLink}', { club: 'Whanganui' }) === 'Hi from Whanganui. Pay at your payments page');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
