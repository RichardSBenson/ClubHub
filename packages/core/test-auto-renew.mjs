/** Automatic renewal with no database and no provider. */
import { AutoRenewStanding, StartAutoRenew, CancelAutoRenew, AutoRenewForClub, RunAutoRenewals } from './application/auto-renew.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const yes = { async hasRoleAt() { return true; } }, no = { async hasRoleAt() { return false; } };
const FEES = [{ id: 'f', label: 'Adult annual', amount_cents: 18000, period: 'annual', applies_to: 'adult', effective_from: '2026-01-01', effective_to: null, currency: 'NZD' }];
const AGREEMENT = { id: 'g1', organisation_id: 'club', affiliation_id: 'a1', person_id: 'p1', period: 'annual', method: 'card', status: 'active', failures: 0, next_attempt_on: null, paid_until: '2026-10-02', fee_exempt: false, club: 'Taupo', person_name: 'Ann Adult' };

function store(o = {}) {
  const log = { added: [], cancelled: [], created: [], claimed: [], progress: [], worked: [], failed: [], audit: [] };
  const t = { log, async atomically(w) { return w(t); },
    async personById() { return { id: 'p1', first_name: 'Ann', dob: o.dob ?? '1990-01-01' }; }, async todayAtClub() { return '2026-10-01'; }, async feeRows() { return o.fees ?? FEES; },
    async renewableMemberships() { return [{ affiliation_id: 'a1', organisation_id: 'club', club: 'Taupo' }]; }, async liveAgreementsOf() { return o.live ?? []; },
    async membershipForSetup() { return o.membership === undefined ? { id: 'a1', organisation_id: 'club', fee_exempt: false, type: 'club' } : o.membership; },
    async hasLiveAgreement() { return o.already ?? false; }, async addAgreement(x) { log.added.push(x); return 'g-new'; },
    async cancelAgreement(x) { log.cancelled.push(x); return o.cancelled === undefined ? 'club' : o.cancelled; }, async agreementsOfClub() { return [AGREEMENT]; },
    async activeAgreements() { return o.agreements ?? [AGREEMENT]; }, async waitingRenewalPayment() { return o.waiting ?? null; },
    async createRenewalPayment(x) { log.created.push(x); return 'pay1'; }, async claimAttempt(x) { log.claimed.push(x); return o.claim ?? true; },
    async savedMethodOf() { return 'tok_1'; }, async noteProgress(...a) { log.progress.push(a); }, async chargeWorked(id) { log.worked.push(id); },
    async chargeFailed(x) { log.failed.push(x); }, async audit(a) { log.audit.push(a); } };
  return t;
}
const deps = (st, extra = {}) => ({ store: st, auth: yes, mustActFor: async () => 'self', adultAge: () => 18, currency: () => 'NZD', clubWord: () => 'dojo', ...extra });
const saves = (status = 'saved') => ({ name: 'test', async saveMethod() { return { status, ref: 'tok_9', detail: 'no thanks' }; } });
const setup = { method: 'card', period: 'annual', agreed: true, card: '4242424242424242' };

console.log('\nStanding');
{ const r = await new AutoRenewStanding(deps(store())).execute({ actorId: 'm', personId: 'p1' });
  ok('each membership with what it would cost', r.memberships[0].prices.annual.amount_cents === 18000 && !r.memberships[0].prices.monthly && r.memberships[0].agreement === null); }
await refuses('a stranger sees nothing', () => new AutoRenewStanding(deps(store(), { mustActFor: async () => { throw new NotPermitted('no'); } })).execute({ actorId: 'x', personId: 'p1' }), NotPermitted);

console.log('\nAgreeing');
{ const st = store(); const id = await new StartAutoRenew(deps(st)).execute({ actorId: 'm', personId: 'p1', affiliationId: 'a1', input: setup, provider: saves() });
  ok('only the token and the last four are kept', id === 'g-new' && st.log.added[0].providerRef === 'tok_9' && st.log.added[0].label === 'Card ending 4242' && !JSON.stringify(st.log.added[0]).includes('4242424242424242'));
  ok('recorded in the history', st.log.audit[0].action === 'auto_renew_start'); }
await refuses('must tick the box', () => new StartAutoRenew(deps(store())).execute({ actorId: 'm', personId: 'p1', affiliationId: 'a1', input: { ...setup, agreed: false }, provider: saves() }), Refused, 'agree');
await refuses('not a membership of theirs', () => new StartAutoRenew(deps(store({ membership: null }))).execute({ actorId: 'm', personId: 'p1', affiliationId: 'zz', input: setup, provider: saves() }), Missing);
await refuses('not charged here', () => new StartAutoRenew(deps(store({ membership: { id: 'a1', organisation_id: 'club', fee_exempt: true, type: 'club' } }))).execute({ actorId: 'm', personId: 'p1', affiliationId: 'a1', input: setup, provider: saves() }), Refused, 'nothing to renew');
await refuses('no price set yet', () => new StartAutoRenew(deps(store({ fees: [] }))).execute({ actorId: 'm', personId: 'p1', affiliationId: 'a1', input: setup, provider: saves() }), Refused, 'dojo has not set a price');
await refuses('already set up', () => new StartAutoRenew(deps(store({ already: true }))).execute({ actorId: 'm', personId: 'p1', affiliationId: 'a1', input: setup, provider: saves() }), Refused, 'already set up');
await refuses('provider down saves nothing', () => new StartAutoRenew(deps(store())).execute({ actorId: 'm', personId: 'p1', affiliationId: 'a1', input: setup, provider: { name: 't', async saveMethod() { throw new Error('x'); } } }), Refused, 'Nothing was saved');
await refuses('method not accepted', () => new StartAutoRenew(deps(store())).execute({ actorId: 'm', personId: 'p1', affiliationId: 'a1', input: setup, provider: saves('declined') }), Refused, 'no thanks');

console.log('\nStopping');
{ const st = store(); await new CancelAutoRenew(deps(st)).execute({ actorId: 'm', personId: 'p1', agreementId: 'g1' }); ok('one press, in the history', st.log.cancelled.length === 1 && st.log.audit[0].action === 'auto_renew_stop'); }
await refuses('nothing to stop', () => new CancelAutoRenew(deps(store({ cancelled: null }))).execute({ actorId: 'm', personId: 'p1', agreementId: 'zz' }), Missing);
ok('a club sees who is renewing', (await new AutoRenewForClub(deps(store())).execute({ actorId: 'r', organisationId: 'club' })).length === 1);
await refuses('only the club\'s registrars', () => new AutoRenewForClub(deps(store(), { auth: no })).execute({ actorId: 'x', organisationId: 'club' }), NotPermitted);

console.log('\nThe daily run');
const run = async (o = {}, provider, extra = {}) => {
  const st = store(o); const settled = [], told = [];
  const report = await new RunAutoRenewals({ ...deps(st), settle: async (x) => settled.push(x), ...extra }).execute({ provider: provider ?? { name: 'test', async charge() { return { status: 'succeeded', ref: 'c1', detail: 'ok' }; } }, tell: async (x) => told.push(x) });
  return { st, settled, told, report };
};
{ const { st, settled, report } = await run();
  ok('charges the saved method at the club\'s price', report.charged === 1 && st.log.created[0].cents === 18000 && settled[0].ok === true && settled[0].ref === 'c1');
  ok('and clears earlier failures', st.log.worked[0] === 'g1'); }
{ const { report } = await run({ agreements: [{ ...AGREEMENT, paid_until: '2027-06-01' }] }); ok('not due yet → left alone', report.skipped === 1 && report.charged === 0); }
{ const { report } = await run({ agreements: [{ ...AGREEMENT, fee_exempt: true }] }); ok('exempt → never charged', report.skipped === 1); }
{ const { report } = await run({ agreements: [{ ...AGREEMENT, next_attempt_on: '2026-10-05' }] }); ok('waiting on a retry date', report.skipped === 1); }
{ const { report } = await run({ fees: [] }); ok('no price → skipped, not guessed', report.skipped === 1); }
{ const { st } = await run({ waiting: 'pay0' }); ok('reuses an attempt already waiting', st.log.created.length === 0 && st.log.claimed[0].paymentId === 'pay0'); }
{ const { report, st } = await run({ claim: false }); ok('another run got there first → no charge', report.skipped === 1 && report.charged === 0 && st.log.worked.length === 0); }
{ const { st, report } = await run({}, { name: 'test', async charge() { return { status: 'awaiting', ref: 'c2', detail: 'bank' }; } }); ok('a slow bank is noted, not settled', report.charged === 1 && st.log.progress[0][1] === 'c2'); }
{ const { st, settled, told, report } = await run({}, { name: 'test', async charge() { return { status: 'failed', detail: 'Card declined' }; } });
  ok('a decline is recorded and retried in 3 days', report.failed === 1 && settled[0].ok === false && st.log.failed[0].failures === 1 && st.log.failed[0].nextAttemptOn === '2026-10-04' && st.log.failed[0].status === 'active');
  ok('and the person is told when', told[0].email.body.includes('2026-10-04') && told[0].push.url === '/me/p1/auto-renew'); }
{ const { st, told, report } = await run({ agreements: [{ ...AGREEMENT, failures: 2 }] }, { name: 'test', async charge() { return { status: 'failed', detail: 'No funds' }; } });
  ok('the third failure pauses it', report.paused === 1 && st.log.failed[0].status === 'paused' && st.log.failed[0].nextAttemptOn === null);
  ok('and says it has stopped', told[0].email.subject === 'Automatic renewal has stopped'); }
{ const { report, settled } = await run({}, { name: 'test', async charge() { throw new Error('timeout'); } }); ok('an unreachable provider is a failure, not a crash', report.failed === 1 && settled[0].detail.includes('could not be reached')); }
{ const st = store(); const told = [];
  const report = await new RunAutoRenewals({ ...deps(st), settle: async () => {} }).execute({ provider: { name: 't', async charge() { return { status: 'failed', detail: 'x' }; } }, tell: async () => { throw new Error('mail down'); } });
  ok('a message that cannot be sent never stops the run', report.failed === 1); }
{ let t = 0; const many = [AGREEMENT, { ...AGREEMENT, id: 'g2' }, { ...AGREEMENT, id: 'g3' }];
  const st = store({ agreements: many }); const report = await new RunAutoRenewals({ ...deps(st), settle: async () => {}, now: () => (t += 6000) }).execute({ provider: { name: 't', async charge() { return { status: 'succeeded', ref: 'c' }; } }, tell: async () => {}, budgetMs: 9000 });
  ok('stops when the time budget is spent', report.charged < 3); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
