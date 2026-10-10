/** Prices, renewals, reminders and exemptions with no database. */
import { ListFees, SaveFee, RemoveFee, RenewalRoster, RemindMembers, SetReminders, AskToRenew, SetExemption, CarryExemptMemberOn } from './application/renewals.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const yes = { async hasRoleAt() { return true; } }, no = { async hasRoleAt() { return false; } };
const FEES = [
  { id: 'f1', label: 'Adult annual', amount_cents: 18000, period: 'annual', applies_to: 'adult', effective_from: '2026-01-01', effective_to: null, currency: 'NZD' },
  { id: 'f2', label: 'Junior annual', amount_cents: 9000, period: 'annual', applies_to: 'junior', effective_from: '2026-01-01', effective_to: null, currency: 'NZD' }];
const ROLL = [
  { affiliation_id: 'a1', person_id: 'p1', name: 'Ann Adult', age: 30, status: 'active', paid_until: '2026-12-01', fee_exempt: false, asked: false },
  { affiliation_id: 'a2', person_id: 'p2', name: 'Kai Kid', age: 9, status: 'lapsed', paid_until: '2026-01-01', fee_exempt: false, asked: false },
  { affiliation_id: 'a3', person_id: 'p3', name: 'Ex Empt', age: 40, status: 'active', paid_until: null, fee_exempt: true, asked: false },
  { affiliation_id: 'a4', person_id: 'p4', name: 'Al Ready', age: 50, status: 'active', paid_until: null, fee_exempt: false, asked: true },
  { affiliation_id: 'a5', person_id: 'p5', name: 'Try Al', age: 20, status: 'trial', paid_until: null, fee_exempt: false, asked: false }];

function store(o = {}) {
  const log = { audit: [], requested: [], ended: [], added: [], voided: [], exemption: [] };
  const t = { log, async atomically(w) { return w(t); },
    async clubById() { return o.club === undefined ? { id: 'club', type: 'club', timezone: 'Pacific/Auckland' } : o.club; }, async todayAt() { return '2026-10-01'; },
    async feeRows() { return o.fees ?? FEES; }, async endFeesBefore(x) { log.ended.push(x); }, async addFee(x) { log.added.push(x); return { id: 'new' }; },
    async removeFee() { return o.removed === undefined ? { label: 'Old', amount_cents: 100 } : o.removed; }, async rosterRows() { return o.roll ?? ROLL; },
    async remindersEnabled() { return false; }, async setReminders(c, e) { log.reminders = e; },
    async requestRenewal(x) { log.requested.push(x); return 'pay' + log.requested.length; },
    async setExemption(x) { log.exemption.push(x); return o.exempted === undefined ? 'p3' : o.exempted; }, async voidAskedFor(id) { log.voided.push(id); }, async personName() { return 'Ex Empt'; },
    async affiliationOf() { return o.affiliation === undefined ? { id: 'a3', person_id: 'p3', fee_exempt: true } : o.affiliation; }, async audit(a) { log.audit.push(a); } };
  return t;
}
const mk = (C, st, extra = {}) => new C({ store: st, auth: yes, adultAge: () => 18, currency: () => 'NZD', ...extra });
const A = { actorId: 'reg', organisationId: 'club' };

console.log('\nPrices');
ok('registrars may see them', (await mk(ListFees, store()).execute(A)).length === 2);
await refuses('only a club has prices', () => mk(ListFees, store({ club: { id: 'f', type: 'federation' } })).execute(A), Refused, 'each club');
await refuses('unknown organisation', () => mk(ListFees, store({ club: null })).execute(A), Missing);
await refuses('listing needs REGISTER', () => mk(ListFees, store(), { auth: no }).execute(A), NotPermitted);
{ const st = store(); const r = await mk(SaveFee, st).execute({ ...A, input: { label: 'Adult annual', appliesTo: 'adult', period: 'annual', amountText: '195', effectiveFrom: '' } });
  ok('a new price starts today and ends the old one', st.log.added[0].cents === 19500 && st.log.added[0].from === '2026-10-01' && st.log.ended[0].from === '2026-10-01' && r.id === 'new');
  ok('the change is in the history', st.log.audit[0].action === 'fee_set' && st.log.audit[0].after.amountCents === 19500); }
{ const st = store(); await mk(SaveFee, st).execute({ ...A, input: { label: 'X', appliesTo: 'adult', period: 'annual', amountText: '10', effectiveFrom: '2027-01-01' } }); ok('a future start date is kept', st.log.added[0].from === '2027-01-01'); }
await refuses('a nameless price', () => mk(SaveFee, store()).execute({ ...A, input: { label: '', appliesTo: 'adult', period: 'annual', amountText: '10' } }), Refused, 'name');
await refuses('setting prices needs MANAGE', () => mk(SaveFee, store(), { auth: no }).execute({ ...A, input: {} }), NotPermitted);
{ const st = store(); await mk(RemoveFee, st).execute({ ...A, feeId: 'f1' }); ok('removal is recorded', st.log.audit[0].action === 'fee_removed' && st.log.audit[0].after.label === 'Old'); }
await refuses('removing a price that is not there', () => mk(RemoveFee, store({ removed: null })).execute({ ...A, feeId: 'zz' }), Missing);

console.log('\nWhere fees stand');
{ const { rows } = await mk(RenewalRoster, store()).execute(A);
  ok('each person has a standing', rows.find((r) => r.person_id === 'p1').standing !== rows.find((r) => r.person_id === 'p2').standing);
  ok('a trial is a trial, not overdue', rows.find((r) => r.person_id === 'p5').standing === 'trial'); }

console.log('\nAsking to renew');
const ask = (st, o = {}, extra = {}) => mk(AskToRenew, st, { recordManual: async (x) => (st.log.manual ??= []).push(x), ...extra }).execute({ ...A, affiliationIds: ['a1', 'a2', 'a3', 'a4', 'a5'], period: 'annual', ...o });
{ const st = store(); const r = await ask(st);
  ok('asks those who owe, at their own price', st.log.requested.length === 3 && st.log.requested.find((x) => x.personId === 'p2').cents === 9000 && st.log.requested.find((x) => x.personId === 'p1').cents === 18000);
  ok('and says who was left out and why', r.skipped.some((s) => s.name === 'Ex Empt' && s.reason === 'not charged') && r.skipped.some((s) => s.name === 'Al Ready' && s.reason === 'already asked') && r.asked === 3);
  ok('each request is in the history', st.log.audit.length === 3 && st.log.audit[0].action === 'payment_requested'); }
{ const st = store({ fees: [FEES[0]] }); const r = await ask(st, { affiliationIds: ['a2'] }); ok('no junior price → says so', r.asked === 0 && r.skipped[0].reason.includes('junior')); }
{ const st = store(); await ask(st, { affiliationIds: ['a1'], received: 'cash' }); ok('cash in hand is recorded at once', st.log.manual[0].method === 'cash' && st.log.manual[0].paymentId === 'pay1'); }
await refuses('a made-up period', () => ask(store(), { period: 'decade' }), Refused, 'how long');
await refuses('a once-only fee is not a renewal', () => ask(store(), { period: 'once' }), Refused, 'how long');
await refuses('nobody ticked', () => ask(store(), { affiliationIds: [] }), Refused, 'Tick');
await refuses('card is not a hand method', () => ask(store(), { received: 'card' }), Refused);

console.log('\nReminders');
{ const sent = []; const r = await mk(RemindMembers, store()).execute({ ...A, affiliationIds: ['a1', 'a3'], subject: '  Fees   due ', body: ' Hi ', prepareMessage: async (a, o, i) => (sent.push(i), 'draft') });
  ok('the exempt are left out and the words tidied', r === 'draft' && sent[0].personIds.join() === 'p1' && sent[0].subject === 'Fees due' && sent[0].kind === 'renewal'); }
await refuses('only exempt ticked', () => mk(RemindMembers, store()).execute({ ...A, affiliationIds: ['a3'], subject: '', body: '', prepareMessage: async () => {} }), Refused, 'Tick');
{ const st = store(); await mk(SetReminders, st).execute({ ...A, enabled: 1 }); ok('automatic reminders on, recorded', st.log.reminders === true && st.log.audit[0].after.enabled === true); }
await refuses('reminders are for administrators', () => mk(SetReminders, store(), { auth: no }).execute({ ...A, enabled: true }), NotPermitted);

console.log('\nNot charged');
{ const st = store(); await mk(SetExemption, st).execute({ ...A, affiliationId: 'a3', input: { exempt: true, reason: 'instructor' } });
  ok('exempt: anything asked is withdrawn', st.log.voided[0] === 'a3' && st.log.exemption[0].exempt === true); ok('with the reason in the history', st.log.audit[0].after.person === 'Ex Empt'); }
{ const st = store(); await mk(SetExemption, st).execute({ ...A, affiliationId: 'a3', input: { exempt: false, reason: '' } }); ok('charging again withdraws nothing', st.log.voided.length === 0 && st.log.exemption[0].reason === null); }
await refuses('a reason is needed', () => mk(SetExemption, store()).execute({ ...A, affiliationId: 'a3', input: { exempt: true, reason: '' } }), Refused, 'why');
await refuses('no such member', () => mk(SetExemption, store({ exempted: null })).execute({ ...A, affiliationId: 'zz', input: { exempt: false } }), Missing);

console.log('\nCarrying on');
{ const st = store(); const r = await mk(CarryExemptMemberOn, st, { carryOn: async (id, m) => `${id}:${m}` }).execute({ ...A, affiliationId: 'a3' });
  ok('a year, no payment, in the history', r === 'a3:12' && st.log.audit[0].action === 'membership_carried_on'); }
await refuses('only the exempt', () => mk(CarryExemptMemberOn, store({ affiliation: { id: 'a1', person_id: 'p1', fee_exempt: false } }), { carryOn: async () => 'x' }).execute({ ...A, affiliationId: 'a1' }), Refused, 'not charged');
await refuses('no such member to carry on', () => mk(CarryExemptMemberOn, store({ affiliation: null }), { carryOn: async () => 'x' }).execute({ ...A, affiliationId: 'zz' }), Missing);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
