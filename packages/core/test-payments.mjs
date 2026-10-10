/** The payment use cases with no database. */
import { SettlePayment, ListPaymentsFor, ListOwed, ViewPayment, PayPayment, CompleteTestPayment, PaymentsReceived, RecordManualPayment, RequestPayment, CancelPaymentRequest, renewMembership } from './application/payments.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const yes = { async hasRoleAt() { return true; } }, no = { async hasRoleAt() { return false; } };

function ledger(o = {}) {
  const log = { settled: [], audit: [], extended: [], numbers: [], trials: [], referrals: [], fulfilled: [], progress: [], claimed: [], created: [], voided: [] };
  const pay = o.pay ?? { id: 'p1', organisation_id: 'club', person_id: 'kid', amount_cents: 5000, currency: 'NZD', status: 'pending' };
  const t = { log, async atomically(w) { return w(t); },
    async paymentById() { return pay; }, async paymentsFor() { return [pay]; }, async owedFor(ids) { log.owedFor = ids; return [pay]; },
    async receivedBy() { return { rows: [pay], totals: [], methods: [] }; },
    async claim(c) { log.claimed.push(c); return o.claim ?? true; }, async noteProgress(...a) { log.progress.push(a); },
    async settle(s) { log.settled.push(s); return o.settleRow === null ? null : { organisation_id: 'club', person_id: 'kid', amount_cents: 5000, receipt_no: s.manual?.receiptNo ?? null }; },
    async markFulfilled() { return o.lines ?? []; },
    async affiliationForRenewal() { return o.affiliation === undefined ? { paid_until: null, status: 'active', today: '2026-10-01' } : o.affiliation; },
    async extendMembership(id, until) { log.extended.push([id, until]); },
    async personAndClubOf() { return { person_id: 'kid', organisation_id: 'club' }; },
    async numberOf() { return o.number ?? null; }, async setNumber(p, n) { log.numbers.push(n); },
    async federationShortNameFor() { return 'mok'; }, async lastNumberIn() { return 41; },
    async referralAwaitingReward() { return null; }, async convertTrial() { log.trials.push(1); }, async promoteReferral() { log.referrals.push(1); },
    async nextReceipt() { return { year: 2026, number: 7 }; }, async voidUnpaid(...a) { log.voided.push(a); return o.voided ?? true; },
    async organisationById() { return { id: 'club', path: 'fed.club' }; },
    async personByNumber() { return o.person === undefined ? { id: 'kid', first_name: 'Mia', last_name: 'Lee' } : o.person; },
    async clubHomeOf() { return o.home === undefined ? { id: 'club' } : o.home; }, async federationAbove() { return { id: 'fed' }; },
    async createRequest(r) { log.created.push(r); return { id: 'new', ...r }; }, async audit(a) { log.audit.push(a); } };
  return t;
}
const deps = (l, extra = {}) => ({ ledger: l, auth: yes, mayPayFor: async () => true, announce: async (...a) => (l.log.announced ??= []).push(a), afterMemberJoined: async (p) => (l.log.joined ??= []).push(p), ...extra });
const settle = (l, extra) => { const s = new SettlePayment(deps(l, extra)); return { s, run: (x) => s.execute(x) }; };

console.log('\nSettling');
{ const l = ledger({ lines: [{ id: 'a1', months: 12 }] }); const r = await settle(l).run({ paymentId: 'p1', ok: true, detail: 'ok', actorId: 'm' });
  ok('a payment that succeeds carries the membership on', r === true && l.log.extended[0][0] === 'a1' && l.log.extended[0][1] === '2027-10-01');
  ok('audited as made, with the new date', l.log.audit[0].action === 'payment_made' && l.log.audit[0].after.paidUntil === '2027-10-01');
  ok('the webhook goes out afterwards', l.log.announced[0][1] === 'payment.succeeded'); }
{ const l = ledger({ lines: [{ id: 'a1', months: 12 }] }); await settle(l).run({ paymentId: 'p1', ok: false, detail: 'declined' });
  ok('a failure renews nothing and says nothing', l.log.extended.length === 0 && l.log.audit[0].action === 'payment_failed' && !l.log.announced); }
{ const l = ledger({ settleRow: null }); ok('already settled → false, no side effects', await settle(l).run({ paymentId: 'p1', ok: true }) === false && l.log.audit.length === 0); }
{ const l = ledger({ lines: [{ id: 'a1', months: 12 }], affiliation: { paid_until: '2027-03-01', status: 'active', today: '2026-10-01' } }); await settle(l).run({ paymentId: 'p1', ok: true });
  ok('paying early loses nothing', l.log.extended[0][1] === '2028-03-01'); }
{ const l = ledger({ lines: [{ id: 'a1', months: 12 }], affiliation: { paid_until: '2026-01-01', status: 'lapsed', today: '2026-10-01' } }); await settle(l).run({ paymentId: 'p1', ok: true });
  ok('paying late is not backdated', l.log.extended[0][1] === '2027-10-01');
  ok('a first payment makes a member: number, trial, referral', l.log.numbers[0] === 'MOK-0042' && l.log.trials.length === 1 && l.log.referrals.length === 1 && l.log.joined[0] === 'kid'); }
{ const l = ledger({ lines: [{ id: 'a1', months: 12 }], number: 'MOK-0001', affiliation: { paid_until: null, status: 'trial', today: '2026-10-01' } }); await settle(l).run({ paymentId: 'p1', ok: true });
  ok('someone who already has a number keeps it', l.log.numbers.length === 0); }
{ const l = ledger({ lines: [{ id: 'gone', months: 12 }], affiliation: null }); ok('a membership that is gone is skipped', await settle(l).run({ paymentId: 'p1', ok: true }) === true && l.log.extended.length === 0); }
{ const l = ledger(); const r = await settle(l, { announce: async () => { throw new Error('down'); } }).run({ paymentId: 'p1', ok: true });
  ok('a webhook that fails cannot undo the payment', r === true); }
{ const l = ledger({ affiliation: { paid_until: null, status: 'lapsed', today: '2026-10-01' } }); const r = await l.atomically((tx) => renewMembership(tx, 'a', 1)); ok('renewMembership reports who became a member', r.becameMember === 'kid' && r.until === '2026-11-01'); }

console.log('\nSeeing payments');
await refuses('a stranger may not see what a child owes', () => new ListPaymentsFor(deps(ledger(), { mayPayFor: async () => false })).execute({ actorId: 'x', personId: 'kid' }), NotPermitted);
ok('a guardian may', (await new ListPaymentsFor(deps(ledger())).execute({ actorId: 'm', personId: 'kid' })).length === 1);
{ const l = ledger(); await new ListOwed({ ...deps(l, { mayPayFor: async (a, id) => id !== 'x' }), peopleOf: async () => [{ id: 'me' }, { id: 'x' }, { id: 'kid' }] }).execute({ actorId: 'm' });
  ok('owed covers those they may pay for, not others', l.log.owedFor.join() === 'me,kid'); }
ok('nobody to pay for → nothing', (await new ListOwed({ ...deps(ledger(), { mayPayFor: async () => false }), peopleOf: async () => [{ id: 'a' }] }).execute({ actorId: 'm' })).length === 0);
await refuses('unknown payment', () => new ViewPayment(deps(ledger({ pay: { id: 'p', person_id: null } }))).execute({ actorId: 'm', paymentId: 'p' }), Missing);
await refuses('received needs MANAGE', () => new PaymentsReceived({ ...deps(ledger()), auth: no }).execute({ actorId: 'a', organisationId: 'club' }), NotPermitted);

console.log('\nPaying');
const provider = (result, name = 'test') => ({ name, async start() { if (result instanceof Error) throw result; return result; } });
{ const l = ledger(); const d = deps(l); const s = new SettlePayment(d);
  const p = new PayPayment({ ...d, settle: (x) => s.execute(x) });
  await p.execute({ actorId: 'm', paymentId: 'p1', input: { method: 'card', card: '4242424242424242' }, provider: provider({ status: 'succeeded', ref: 'r1', detail: 'ok' }) });
  ok('claimed once then settled', l.log.claimed.length === 1 && l.log.settled[0].ok === true && l.log.settled[0].ref === 'r1'); }
{ const l = ledger(); const d = deps(l); const p = new PayPayment({ ...d, settle: async () => {} });
  await p.execute({ actorId: 'm', paymentId: 'p1', input: { method: 'bank', card: '' }, provider: provider({ status: 'pending', ref: 'r2', detail: 'waiting' }) });
  ok('a slow bank is noted, not settled', l.log.progress[0][0] === 'p1' && l.log.progress[0][1] === 'r2'); }
await refuses('pressing twice reaches the provider once', () => new PayPayment({ ...deps(ledger({ claim: false })), settle: async () => {} }).execute({ actorId: 'm', paymentId: 'p1', input: { method: 'bank', card: '' }, provider: provider({}) }), Refused, 'already been paid');
await refuses('no method chosen', () => new PayPayment({ ...deps(ledger()), settle: async () => {} }).execute({ actorId: 'm', paymentId: 'p1', input: { method: '', card: '' }, provider: provider({}) }), Refused, 'Choose how');
{ const l = ledger(); const calls = []; const p = new PayPayment({ ...deps(l), settle: async (x) => calls.push(x) });
  await refuses('a provider outage says nothing was charged', () => p.execute({ actorId: 'm', paymentId: 'p1', input: { method: 'bank', card: '' }, provider: provider(new Error('timeout')) }), Refused, 'Nothing was charged');
  ok('and marks it failed so it can be tried again', calls[0].ok === false && calls[0].detail.includes('timeout')); }
await refuses('test completion only with the test bank', () => new CompleteTestPayment({ ...deps(ledger({ pay: { id: 'p1', person_id: 'kid', status: 'awaiting' } })), settle: async () => {} }).execute({ actorId: 'm', paymentId: 'p1', ok: true, provider: {} }), NotPermitted, 'test payments');
await refuses('nothing waiting', () => new CompleteTestPayment({ ...deps(ledger(), { isTestProvider: () => true }), settle: async () => {} }).execute({ actorId: 'm', paymentId: 'p1', ok: true, provider: {} }), Refused, 'Nothing is waiting');

console.log('\nCash received');
{ const l = ledger(); const d = deps(l); const s = new SettlePayment(d);
  await new RecordManualPayment({ ...d, settle: (x) => s.execute(x) }).execute({ actorId: 'reg', paymentId: 'p1', method: 'cash' });
  ok('numbered receipt, attributed to the registrar', l.log.settled[0].manual.receiptNo === 'R-2026-0007' && l.log.settled[0].manual.actorId === 'reg');
  ok('recorded in the history', l.log.audit[0].action === 'payment_recorded' && l.log.audit[0].after.receipt === 'R-2026-0007'); }
await refuses('card is not a hand method', () => new RecordManualPayment({ ...deps(ledger()), settle: async () => true }).execute({ actorId: 'r', paymentId: 'p1', method: 'card' }), Refused);
await refuses('already paid', () => new RecordManualPayment({ ...deps(ledger({ pay: { id: 'p1', organisation_id: 'club', status: 'succeeded' } })), settle: async () => true }).execute({ actorId: 'r', paymentId: 'p1', method: 'cash' }), Refused, 'already been dealt');
await refuses('lost the race', () => new RecordManualPayment({ ...deps(ledger()), settle: async () => false }).execute({ actorId: 'r', paymentId: 'p1', method: 'cash' }), Refused, 'already been dealt');
await refuses('only the payee may say so', () => new RecordManualPayment({ ...deps(ledger(), {}), auth: no, settle: async () => true }).execute({ actorId: 'r', paymentId: 'p1', method: 'cash' }), NotPermitted);

console.log('\nAsking for money');
const ask = (l, input, extra = {}) => new RequestPayment({ ...deps(l, extra), recordManual: async (x) => (l.log.manual ??= []).push(x) }).execute({ actorId: 'reg', organisationId: 'club', input: { personNumber: 'MOK-0001', kind: 'uniform', amountCents: 4500, ...input } });
{ const l = ledger(); const r = await ask(l, {}); ok('a uniform is the club\'s', l.log.created[0].payeeId === 'club' && l.log.created[0].description === 'Uniform' && r.id === 'new');
  ok('audited at the payee', l.log.audit[0].action === 'payment_requested' && l.log.audit[0].after.person === 'Mia Lee'); }
{ const l = ledger(); await ask(l, { kind: 'dan_grading' }); ok('a black belt grading is the federation\'s', l.log.created[0].payeeId === 'fed'); }
{ const l = ledger(); await ask(l, { received: 'cash' }); ok('cash handed over is recorded straight away', l.log.manual[0].method === 'cash' && l.log.manual[0].paymentId === 'new'); }
await refuses('a club cannot record the federation\'s money', () => ask(ledger(), { kind: 'dan_grading', received: 'cash' }, { auth: { async hasRoleAt(a, org) { return org === 'club'; } } }), Refused, 'belongs to the federation');
await refuses('no such member', () => ask(ledger({ person: null }), {}), Refused, 'no member numbered');
await refuses('member of no club here', () => ask(ledger({ home: null }), {}), Refused, 'no member numbered');
await refuses('too large', () => ask(ledger(), { amountCents: 600000 }), Refused, 'too large');
await refuses('needs REGISTER', () => ask(ledger(), {}, { auth: no }), NotPermitted);

console.log('\nTaking a request back');
{ const l = ledger(); await new CancelPaymentRequest(deps(l)).execute({ actorId: 'r', organisationId: 'club', paymentId: 'p1' }); ok('voided', l.log.voided[0][1] === 'p1'); }
await refuses('already paid cannot be taken back', () => new CancelPaymentRequest(deps(ledger({ voided: false }))).execute({ actorId: 'r', organisationId: 'club', paymentId: 'p1' }), Missing);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
