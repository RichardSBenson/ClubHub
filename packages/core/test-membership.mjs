import { addMonths, extendedUntil, standing, feeFor, problemsWithFee, readFee, PERIODS } from './domain/membership.mjs';
import { centsFrom } from './domain/payments.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

console.log('\nADDING MONTHS');
ok('a year', addMonths('2026-10-02', 12) === '2027-10-02');
ok('a month', addMonths('2026-10-02', 1) === '2026-11-02');
ok('over the new year', addMonths('2026-12-15', 3) === '2027-03-15');
ok('the end of a short month is clamped', addMonths('2026-01-31', 1) === '2026-02-28');
ok('a leap day a year on', addMonths('2028-02-29', 12) === '2029-02-28');

console.log('\nRENEWING');
ok('paying early keeps the days already paid for', extendedUntil('2026-12-01', '2026-10-02', 12) === '2027-12-01');
ok('paying late starts from today, not from the lapse', extendedUntil('2026-03-01', '2026-10-02', 12) === '2027-10-02');
ok('never paid starts from today', extendedUntil(null, '2026-10-02', 3) === '2027-01-02');
ok('a rubbish date is treated as never paid', extendedUntil('nonsense', '2026-10-02', 1) === '2026-11-02');
ok('a one-off adds nothing', extendedUntil('2026-12-01', '2026-10-02', PERIODS.once.months) === '2026-12-01');

console.log('\nWHERE A MEMBER STANDS');
const t = '2026-10-02';
ok('exempt beats everything', standing({ paidUntil: '2020-01-01', exempt: true }, t) === 'exempt');
ok('no date is never paid', standing({ paidUntil: null }, t) === 'unpaid');
ok('past is overdue', standing({ paidUntil: '2026-10-01' }, t) === 'overdue');
ok('today is not overdue', standing({ paidUntil: '2026-10-02' }, t) === 'due');
ok('within 30 days is due', standing({ paidUntil: '2026-11-01' }, t) === 'due');
ok('31 days out is current', standing({ paidUntil: '2026-11-02' }, t) === 'current');

console.log('\nCHOOSING THE DOJO\'S OWN PRICE');
const s = (over) => ({ label: 'x', amount_cents: 100, period: 'annual', applies_to: 'adult',
  effective_from: '2026-01-01', effective_to: null, ...over });
const sched = [s({ amount_cents: 18000 }), s({ applies_to: 'junior', amount_cents: 12000 }),
  s({ period: 'monthly', amount_cents: 2000 }), s({ applies_to: 'member', period: 'term', amount_cents: 6000 })];
ok('an adult pays the adult price', feeFor(sched, { ageYears: 30, period: 'annual', today: t }).amount_cents === 18000);
ok('a child pays the junior price', feeFor(sched, { ageYears: 9, period: 'annual', today: t }).amount_cents === 12000);
ok('seventeen is a junior, eighteen an adult', feeFor(sched, { ageYears: 17, period: 'annual', today: t }).amount_cents === 12000
  && feeFor(sched, { ageYears: 18, period: 'annual', today: t }).amount_cents === 18000);
ok('"everyone" covers whoever has no price of their own', feeFor(sched, { ageYears: 9, period: 'term', today: t }).amount_cents === 6000);
ok('no price for that period is no price', feeFor(sched, { ageYears: 9, period: 'monthly', today: t }) === null);
ok('an unknown age is charged as an adult', feeFor(sched, { ageYears: null, period: 'annual', today: t }).amount_cents === 18000);
ok('a price not yet started is not used', feeFor([s({ effective_from: '2027-01-01' })], { ageYears: 30, period: 'annual', today: t }) === null);
ok('a price that has ended is not used', feeFor([s({ effective_to: '2026-06-30' })], { ageYears: 30, period: 'annual', today: t }) === null);
ok('the newest of two live prices wins',
  feeFor([s({ amount_cents: 15000, effective_from: '2025-01-01' }), s({ amount_cents: 18000, effective_from: '2026-07-01' })],
    { ageYears: 30, period: 'annual', today: t }).amount_cents === 18000);

console.log('\nSETTING A PRICE');
const bad = (over) => problemsWithFee({ ...readFee({ label: 'Adult', appliesTo: 'adult', period: 'annual', amount: '180' }), ...over }, centsFrom);
ok('a good price has no problems', bad({}).length === 0);
ok('a name is needed', bad({ label: '' }).length === 1);
ok('an amount is needed', bad({ amountText: '' }).length === 1);
ok('free is not a price (use an exemption)', bad({ amountText: '0' }).length === 1);
ok('a start date must be a date', bad({ effectiveFrom: '1/2/26' }).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
