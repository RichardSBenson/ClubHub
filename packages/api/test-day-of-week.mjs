/** The day-of-week script, run against a tiny fake page: it writes the day under each date box and keeps it up to date. */
import fs from 'node:fs';
import vm from 'node:vm';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

const make = (value) => {
  const listeners = {};
  const out = { style: {}, setAttribute() {}, textContent: '' };
  const input = { value, addEventListener: (e, f) => { listeners[e] = f; }, parentNode: { insertBefore: (el) => { input.out = el; } }, nextSibling: null };
  return { input, out, listeners };
};
const run = (value) => {
  const box = make(value);
  const document = { querySelectorAll: () => [box.input], createElement: () => box.out };
  vm.runInNewContext(fs.readFileSync(new URL('../../vendor/honbu/day-of-week.js', import.meta.url), 'utf8'), { document, Array, Date, isNaN });
  return box;
};

console.log('\nDAY OF THE WEEK UNDER A DATE BOX');
ok('17 Oct 2026 is a Saturday', run('2026-10-17').out.textContent === 'Saturday 17 October 2026');
ok('a date and time shows the day of the date', run('2026-10-17T10:00').out.textContent === 'Saturday 17 October 2026');
ok('1 Jan 2027 is a Friday', run('2027-01-01').out.textContent === 'Friday 1 January 2027');
ok('leap day', run('2028-02-29').out.textContent === 'Tuesday 29 February 2028');
ok('blank shows nothing', run('').out.textContent === '');
ok('an impossible date shows nothing', run('2026-02-31').out.textContent === '');
{
  const b = run('2026-10-17'); b.input.value = '2026-10-18'; b.listeners.input();
  ok('it updates when the date changes', b.out.textContent === 'Sunday 18 October 2026');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
