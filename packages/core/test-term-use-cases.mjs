/** The school-term use cases with no database. */
import { LoadBuiltInTerms, SaveTerm, RemoveTerm, SetMidTermRule, OfferedTerms, EnrolInTerm, WithdrawFromTerm } from './application/terms.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const yes = { async hasRoleAt() { return true; } }, no = { async hasRoleAt() { return false; } };
const TERM = { id: 't1', name: 'Term 4', year: 2026, starts: '2026-10-12', ends: '2026-12-18' };
function store({ today = '2026-10-10', club = { id: 'club', name: 'Taupo', type: 'club', timezone: 'Pacific/Auckland', settings: {} }, dob = '2018-01-01',
  terms = [TERM], enrolment = null, hasTerms = false, enrolled = 0, country = 'NZ', toWithdraw = { id: 'e1', paid: false, organisation_id: 'club', starts: '2026-10-12', timezone: 'x' } } = {}) {
  const log = { added: [], enrolled: [], payments: [], audit: [], voided: 0, withdrawn: 0, rule: null };
  const s = { log, async atomically(w) { return w(s); },
    async organisationById() { return club; }, async countryOf() { return country; }, async todayAt() { return today; }, async termsOf() { return []; },
    async hasTermsIn() { return hasTerms; }, async addTerm(t) { log.added.push(t); }, async nextTermNumber() { return 5; }, async updateTerm() { return { id: 't1' }; },
    async enrolledCount() { return enrolled; }, async removeTerm() { return { id: 't1' }; }, async setMidTermRule(o, r) { log.rule = r; },
    async effectiveTerms() { return { terms }; }, async memberClubOf() { return club; }, async personById() { return { id: 'kid', first_name: 'Ana', date_of_birth: dob }; },
    async trainingWeekdays() { return [2]; }, async feeSchedule() { return [{ id: 'f', amount_cents: 12000, currency: 'NZD', period: 'term', applies_to: 'junior', effective_from: '2026-01-01', effective_to: null }]; },
    async enrolmentOf() { return enrolment; }, async enrol(e) { log.enrolled.push(e); return { id: 'e1' }; },
    async requestPayment(p) { log.payments.push(p); return 'pay1'; }, async enrolmentToWithdraw() { return toWithdraw; },
    async voidUnpaidFor() { log.voided++; }, async markWithdrawn() { log.withdrawn++; }, async audit(a) { log.audit.push(a); } };
  return s;
}
const deps = (st, { auth = yes, how = async () => 'guardian' } = {}) => ({ store: st, auth, howMayActFor: how, adultAge: () => 18, currency: () => 'NZD' });

console.log('\nThe calendar');
{ const st = store(); const n = await new LoadBuiltInTerms(deps(st)).execute({ actorId: 'a', organisationId: 'club', year: 2027 }); ok('loads the country\'s own calendar', n > 0 && st.log.added.length === n && st.log.added[0].source === 'built-in'); }
{ const st = store(); await new LoadBuiltInTerms(deps(st, { auth: no })).execute({ actorId: null, organisationId: 'club', year: 2027, system: true }); ok('the daily run needs no actor', st.log.audit[0].actorId === null); }
await refuses('a manager is needed otherwise', () => new LoadBuiltInTerms(deps(store(), { auth: no })).execute({ actorId: 'a', organisationId: 'club', year: 2027 }), NotPermitted);
await refuses('no calendar for the country', () => new LoadBuiltInTerms(deps(store({ country: 'ZZ' }))).execute({ actorId: 'a', organisationId: 'club', year: 2027 }), Refused, 'no built-in calendar');
await refuses('the year already has terms', () => new LoadBuiltInTerms(deps(store({ hasTerms: true }))).execute({ actorId: 'a', organisationId: 'club', year: 2027 }), Refused, 'already has terms');
{ const st = store(); await new SaveTerm(deps(st)).execute({ actorId: 'a', organisationId: 'club', input: { name: ' Term 1 ', starts: '2027-02-01', ends: '2027-04-09' } }); ok('adds the next number for the year', st.log.added[0].number === 5 && st.log.added[0].year === 2027); }
await refuses('a term that ends before it starts', () => new SaveTerm(deps(store())).execute({ actorId: 'a', organisationId: 'club', input: { name: 'x', starts: '2027-04-09', ends: '2027-02-01' } }), Refused);
await refuses('removing a term with children in it', () => new RemoveTerm(deps(store({ enrolled: 2 }))).execute({ actorId: 'a', organisationId: 'club', termId: 't1' }), Refused, 'Withdraw them first');
{ const st = store(); await new SetMidTermRule(deps(st)).execute({ actorId: 'a', organisationId: 'club', form: { mid_term: 'full' } }); ok('stores the mid-term rule', st.log.rule.mode === 'full'); }
await refuses('only a club has the rule', () => new SetMidTermRule(deps(store({ club: { id: 'f', type: 'federation' } }))).execute({ actorId: 'a', organisationId: 'f', form: {} }), Refused, 'each club');
await refuses('a fixed price must be said', () => new SetMidTermRule(deps(store())).execute({ actorId: 'a', organisationId: 'club', form: { mid_term: 'fixed' } }), Refused, 'reduced price');

console.log('\nOffering and enrolling');
{ const r = await new OfferedTerms(deps(store())).execute({ actorId: 'mum', personId: 'kid' });
  ok('offers the upcoming term at the full fee', r.items.length === 2 || r.items.length === 1); ok('and it is open to enrol', r.items[0].mayEnrol && r.items[0].price.cents === 12000); }
{ const r = await new OfferedTerms(deps(store({ dob: '1990-01-01' }))).execute({ actorId: 'a', personId: 'kid' }); ok('adults are offered nothing here', r.items.length === 0 && r.club === null); }
await refuses('a stranger sees nothing', () => new OfferedTerms(deps(store(), { how: async () => null })).execute({ actorId: 'a', personId: 'kid' }), NotPermitted);
{ const st = store(); const out = await new EnrolInTerm(deps(st)).execute({ actorId: 'mum', personId: 'kid', termId: 't1' });
  ok('enrolling raises one payment for the fee', out.paymentId === 'pay1' && st.log.payments[0].cents === 12000 && st.log.enrolled[0].cents === 12000);
  ok('the bill says whose and which term', /Term 4 2026 classes — Ana/.test(st.log.payments[0].description)); ok('audited', st.log.audit[0].action === 'term_enrolled'); }
await refuses('already enrolled', () => new EnrolInTerm(deps(store({ enrolment: { id: 'e', status: 'enrolled' } }))).execute({ actorId: 'm', personId: 'kid', termId: 't1' }), Refused, 'Already enrolled');
await refuses('no such term', () => new EnrolInTerm(deps(store())).execute({ actorId: 'm', personId: 'kid', termId: 'nope' }), Missing);
{ const st = store({ enrolment: { id: 'e', status: 'withdrawn' } }); await new EnrolInTerm(deps(st)).execute({ actorId: 'm', personId: 'kid', termId: 't1' }); ok('a withdrawn child may enrol again', st.log.enrolled.length === 1); }

console.log('\nWithdrawing');
{ const st = store(); const out = await new WithdrawFromTerm(deps(st)).execute({ actorId: 'm', personId: 'kid', termId: 't1' });
  ok('before the term starts: bill voided, enrolment withdrawn', st.log.voided === 1 && st.log.withdrawn === 1 && out.paid === false); }
await refuses('once it has started, ask the club', () => new WithdrawFromTerm(deps(store({ today: '2026-10-12' }))).execute({ actorId: 'm', personId: 'kid', termId: 't1' }), Refused, 'has started');
await refuses('not enrolled', () => new WithdrawFromTerm(deps(store({ toWithdraw: null }))).execute({ actorId: 'm', personId: 'kid', termId: 't1' }), Missing);
await refuses('a stranger may not', () => new WithdrawFromTerm(deps(store(), { how: async () => null })).execute({ actorId: 'm', personId: 'kid', termId: 't1' }), NotPermitted);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
