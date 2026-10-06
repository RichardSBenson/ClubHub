import { cardValidThrough, cardRefusal, verdictFor, checkinPlan } from './domain/card.mjs';
import { qrMatrix, qrSvg, MAX_BYTES } from './domain/qr.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

console.log('\nTHE QR CODE');
{
  const g = qrMatrix('A');
  ok('the smallest code is 21 modules square', g.length === 21 && g.every((r) => r.length === 21));
  const finder = (x, y) => [0, 1, 2, 3, 4, 5, 6].every((i) => g[y][x + i] && g[y + 6][x + i] && g[y + i][x] && g[y + i][x + 6]) && !g[y + 1][x + 1] && g[y + 2][x + 2];
  ok('the three finder squares are where scanners look', finder(0, 0) && finder(14, 0) && finder(0, 14));
  ok('the dark module is set', g[13][8] === true);
  ok('same text, same picture', JSON.stringify(qrMatrix('https://x.nz/v/abc')) === JSON.stringify(qrMatrix('https://x.nz/v/abc')));
  ok('longer text, bigger code', qrMatrix('x'.repeat(100)).length > qrMatrix('x'.repeat(10)).length);
  ok('the longest allowed fits', qrMatrix('x'.repeat(MAX_BYTES)).length === 57);
  let refused = false; try { qrMatrix('x'.repeat(MAX_BYTES + 1)); } catch { refused = true; }
  ok('one byte too many is refused, not drawn too small to read', refused);
  const svg = qrSvg('hello <b>', { label: 'a "label" & <more>' });
  ok('draws an SVG with a readable name', svg.startsWith('<svg') && svg.includes('role="img"') && svg.includes('a &quot;label&quot; &amp; &lt;more&gt;'));
  ok('the label cannot break out of the markup', !svg.includes('<more>'));
}

console.log('\nWHEN A CARD LASTS');
{
  ok('a week ahead when the membership is longer', cardValidThrough({ paidUntil: '2027-01-01' }, '2026-10-06') === '2026-10-13');
  ok('the day the membership ends when that is sooner', cardValidThrough({ paidUntil: '2026-10-08' }, '2026-10-06') === '2026-10-08');
  ok('no paid-until and not exempt: none', cardValidThrough({ paidUntil: null }, '2026-10-06') === null);
  ok('exempt members get a week', cardValidThrough({ paidUntil: null, exempt: true }, '2026-10-06') === '2026-10-13');
}

console.log('\nWHO CAN HAVE ONE');
{
  const base = { role: 'member', status: 'active', paidUntil: '2027-01-01', exempt: false, displayNumber: 'NZ-1' };
  ok('a current member can', cardRefusal(base, '2026-10-06') === null);
  ok('an instructor-only affiliation cannot', /Only members/.test(cardRefusal({ ...base, role: 'instructor' }, '2026-10-06')));
  ok('a lapsed status cannot', /lapsed/.test(cardRefusal({ ...base, status: 'lapsed' }, '2026-10-06')));
  ok('no number cannot', /member number/.test(cardRefusal({ ...base, displayNumber: null }, '2026-10-06')));
  ok('no paid-until cannot', /paid-until/.test(cardRefusal({ ...base, paidUntil: null }, '2026-10-06')));
  ok('ran out cannot, and says when', /ran out on 2026-09-01/.test(cardRefusal({ ...base, paidUntil: '2026-09-01' }, '2026-10-06')));
  ok('an exempt member needs no paid-until', cardRefusal({ ...base, paidUntil: null, exempt: true }, '2026-10-06') === null);
}

console.log('\nWHAT A SCAN SAYS');
{
  const live = { role: 'member', status: 'active', paidUntil: '2027-01-01', exempt: false, displayNumber: 'NZ-1' };
  ok('a good code and a current member', verdictFor({ signature: { valid: true }, live, today: '2026-10-06' }).ok);
  ok('a forged code', !verdictFor({ signature: { valid: false, reason: 'Signature does not match' }, live, today: '2026-10-06' }).ok);
  ok('a genuine code for somebody who has gone', /nobody holds/.test(verdictFor({ signature: { valid: true }, live: null, today: '2026-10-06' }).why));
  ok('a genuine code for somebody who has lapsed', !verdictFor({ signature: { valid: true }, live: { ...live, status: 'lapsed' }, today: '2026-10-06' }).ok);
}

console.log('\nWHO CAN BE CHECKED IN');
{
  const session = { min_age: 6, max_age: 12, min_rank_order: null };
  const people = [
    { id: 'a', name: 'Kid', ageYears: 9, rankOrder: 1, member: true },
    { id: 'b', name: 'Teen', ageYears: 15, rankOrder: 1, member: true },
    { id: 'c', name: 'Visitor', ageYears: 9, rankOrder: 1, member: false },
    { id: 'd', name: 'Early', ageYears: 8, rankOrder: 1, member: true },
  ];
  const plan = checkinPlan(people, session, new Set(['d']));
  const by = Object.fromEntries(plan.map((p) => [p.id, p.state]));
  ok('the child who fits can go in', by.a === 'can');
  ok('the teenager is too old for it', by.b === 'not-for-them');
  ok('somebody off the roll cannot', by.c === 'not-member');
  ok('somebody already in is shown as in', by.d === 'here');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
