/**
 * A time typed in a hall must mean that time in that hall, wherever the server
 * happens to be. Two of these run the whole test under a different TZ to prove
 * the server's own zone does not leak in.
 */
import { toInstant, toLocalInput, toReadable, isKnownZone } from './zones.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const NZ = 'Pacific/Auckland';

console.log('\nNINE IN THE MORNING MEANS NINE IN THE MORNING');
{
  // December: New Zealand is on daylight time, UTC+13. 9am is 20:00 the day
  // before, in UTC.
  const d = toInstant('2026-12-05T09:00', NZ);
  ok('a summer morning converts to the right instant',
    d.toISOString() === '2026-12-04T20:00:00.000Z', d.toISOString());

  // July: standard time, UTC+12.
  const w = toInstant('2026-07-05T09:00', NZ);
  ok('and so does a winter morning',
    w.toISOString() === '2026-07-04T21:00:00.000Z', w.toISOString());
}

console.log('\nIT SURVIVES THE ROUND TRIP');
{
  for (const local of ['2026-12-05T09:00', '2026-07-05T19:30',
                       '2026-01-01T00:00', '2026-09-27T13:45']) {
    const back = toLocalInput(toInstant(local, NZ), NZ);
    ok(`${local} comes back unchanged`, back === local, back);
  }
}

console.log('\nTHE DAYS THE CLOCKS CHANGE');
{
  // New Zealand moves to daylight time at 2am on the last Sunday in September
  // 2026 — the 27th. 1:30am exists, 3:30am exists, 2:30am does not.
  const before = toInstant('2026-09-27T01:30', NZ);
  const after = toInstant('2026-09-27T03:30', NZ);
  ok('an hour before the change is +12',
    before.toISOString() === '2026-09-26T13:30:00.000Z', before.toISOString());
  ok('an hour after it is +13',
    after.toISOString() === '2026-09-26T14:30:00.000Z', after.toISOString());
  // Two hours on the wall, one hour of real time: the hour between them does
  // not exist. An event scheduled either side of the change is still the right
  // number of minutes away, which is the whole point of storing instants.
  ok('two wall-clock hours across the change are one real hour apart',
    after - before === 3600_000, String((after - before) / 3600_000) + 'h');

  // Going back: 2am on the first Sunday in April 2027 happens twice.
  const ambiguous = toInstant('2027-04-04T02:30', NZ);
  ok('an hour that happens twice still resolves to one instant',
    !Number.isNaN(ambiguous.getTime()));
  ok('and lands on the right day',
    ambiguous.toISOString().startsWith('2027-04-03'), ambiguous.toISOString());
}

console.log('\nA ZONE THAT IS NOT NEW ZEALAND');
{
  ok('London in summer is +1',
    toInstant('2026-07-05T09:00', 'Europe/London').toISOString()
      === '2026-07-05T08:00:00.000Z');
  ok('Denver is -6 in summer',
    toInstant('2026-07-05T09:00', 'America/Denver').toISOString()
      === '2026-07-05T15:00:00.000Z');
  ok('Tokyo does not change clocks',
    toInstant('2026-12-05T09:00', 'Asia/Tokyo').toISOString()
      === '2026-12-05T00:00:00.000Z');
  ok('Kathmandu is three quarters of an hour off the hour',
    toInstant('2026-12-05T09:00', 'Asia/Kathmandu').toISOString()
      === '2026-12-05T03:15:00.000Z');
}

console.log('\nA ZONE NOBODY HAS HEARD OF DOES NOT SILENTLY BECOME UTC');
{
  ok('a nonsense zone is reported as unknown', !isKnownZone('Middle/Earth'));
  ok('a real one is not', isKnownZone(NZ));
  ok('and nothing throws on the nonsense one',
    toInstant('2026-12-05T09:00', 'Middle/Earth') instanceof Date);
}

console.log('\nWHAT IT READS LIKE');
{
  const d = toInstant('2026-12-05T09:00', NZ);
  const text = toReadable(d, NZ);
  ok('the date is the local one, not UTC\'s',
    text.includes('5') && text.includes('Dec') && !text.includes('4 Dec'), text);
  ok('a whole-day event leaves the time off',
    !/\d:\d\d/.test(toReadable(d, NZ, { withTime: false })),
    toReadable(d, NZ, { withTime: false }));
}

console.log('\nNOTHING BREAKS ON EMPTY');
{
  ok('no time given is no instant', toInstant('', NZ) === null);
  ok('and renders as blank', toLocalInput(null, NZ) === '');
  ok('so does an unparseable one', toLocalInput('not a date', NZ) === '');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
