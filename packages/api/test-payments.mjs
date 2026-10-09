/**
 * Who gets paid, and paying.
 *
 *   club fee / kyu grading / uniform / equipment → the member's club
 *   tournament entry                              → whoever runs the tournament
 *   black belt grading                            → the federation
 *
 * And: only the person (or their guardian) can pay; a club sees only what it
 * was paid; pressing pay twice charges once; asynchronous methods wait for the
 * bank; a declined card can be retried.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, payments, Forbidden, Invalid } from './data.mjs';
import * as auth from './auth.mjs';
import { payeeFor, groupByPayee, centsFrom, KINDS } from '../core/domain/payments.mjs';
import { TestProvider, ScriptedProvider } from '../infrastructure/payments/providers.mjs';

process.env.HONBU_STORE = 'postgres';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) {
  const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jar[k]; else jar[k] = v; } };
async function req(p, { method = 'GET', form } = {}) {
  const headers = {};
  if (cookie()) headers.cookie = cookie();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + p, { method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString() : undefined });
  keep(res);
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}
const q = async (sql, a = []) => (await pool.query(sql, a)).rows;
const one = async (sql, a = []) => (await q(sql, a))[0] ?? null;
const signIn = async (email) => {
  for (const k of Object.keys(jar)) delete jar[k];
  await req('/signin'); const { token } = await auth.requestLink(email); await req(`/signin/${token}`, { method: 'POST', form: {} });
};

console.log('\nTHE RULES');
{
  const ids = { clubId: 'club', organiserId: 'organiser', federationId: 'fed' };
  const to = (k) => payeeFor(k, ids);
  ok('dojo fees go to the dojo', to('club_fee') === 'club');
  ok('kyu grading goes to the dojo', to('kyu_grading') === 'club');
  ok('uniform goes to the dojo', to('uniform') === 'club');
  ok('other equipment goes to the dojo', to('equipment') === 'club');
  ok('a tournament entry goes to whoever runs it', to('tournament_entry') === 'organiser');
  ok('a black belt grading goes to the federation', to('dan_grading') === 'fed');
  let err; try { payeeFor('club_fee', { federationId: 'fed' }); } catch (e) { err = e; }
  ok('no club means no payee, not "the federation"', !!err && /not in a club/.test(err.message));
  try { payeeFor('mystery', ids); err = null; } catch (e) { err = e; }
  ok('an unknown kind is refused', !!err);
  const g = groupByPayee([{ payeeId: 'a', amountCents: 100 }, { payeeId: 'b', amountCents: 50 }, { payeeId: 'a', amountCents: 25 }]);
  ok('a basket with two payees is two payments', g.length === 2 && g.find((x) => x.payeeId === 'a').amountCents === 125);
  ok('every kind has a payee rule', Object.values(KINDS).every((k) => ['club', 'organiser', 'federation'].includes(k.payee)));
  ok('amounts read as cents', centsFrom('45') === 4500 && centsFrom('$45.50') === 4550 && centsFrom('0') === null
    && centsFrom('-5') === null && centsFrom('12.345') === null && centsFrom('abc') === null);
}

const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const federation = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);
let seq = 0;
const person = async (first, { dob = '1985-01-01', org = whanganui } = {}) => {
  const p = await one(`insert into person (display_number, first_name,last_name,email,date_of_birth)
    values ($1,$2,'Paytest',$3,$4) returning *`, [`PT-${++seq}`, first, `${first.toLowerCase()}@pay.test`, dob]);
  await pool.query(`insert into affiliation (person_id, organisation_id, role, starts, status)
    values ($1,$2,'member','2020-01-01','active')`, [p.id, org.id]);
  const a = await one(`insert into account (email, person_id) values ($1,$2) returning id`, [p.email, p.id]);
  return { ...p, accountId: a.id };
};
const ada = await person('Ada');
const bob = await person('Bob', { org: wellington });
const kidDob = new Date(Date.now() - 10 * 365.25 * 864e5).toISOString().slice(0, 10);
const kid = await person('Kid', { dob: kidDob });
const mum = await person('Mum');
await pool.query(`insert into guardian_link (guardian_id, child_id) values ($1,$2)`, [mum.id, kid.id]);

const ask = (over = {}) => ({ personNumber: ada.display_number, kind: 'uniform', description: 'Gi, size 170',
  amountCents: 6500, amountText: '65', ...over });

console.log('\nASKING FOR MONEY');
let uniform, dan;
{
  uniform = await payments.request(doug.id, whanganui.id, ask());
  ok('a uniform is the dojo\'s', uniform.organisation_id === whanganui.id);
  ok('a kyu grading is the dojo\'s', (await payments.request(doug.id, whanganui.id, ask({ kind: 'kyu_grading', amountCents: 3000 }))).organisation_id === whanganui.id);
  dan = await payments.request(doug.id, whanganui.id, ask({ kind: 'dan_grading', amountCents: 20000, description: '1st dan' }));
  ok('a black belt grading is the federation\'s, even though the dojo asked',
    dan.organisation_id === federation.id, dan.organisation_id);
  ok('nobody is asked for what is not theirs to be asked',
    await payments.request(doug.id, whanganui.id, ask({ personNumber: bob.display_number })).then(() => false, (e) => e instanceof Invalid && /no member numbered/.test(e.message)));
  const bad = (over, re) => payments.request(doug.id, whanganui.id, ask(over)).then(() => false, (e) => e instanceof Invalid && re.test(e.message));
  ok('no amount is refused', await bad({ amountCents: null }, /amount/));
  ok('a tournament entry cannot be asked for by hand', await bad({ kind: 'tournament_entry' }, /what the payment is for/));
  ok('an enormous amount is refused', await bad({ amountCents: 9_999_999 }, /too large/));
  const aud = await one(`select after from audit_log where action='payment_requested' order by id desc limit 1`);
  ok('it is in the history', aud?.after?.kind === 'dan_grading');
  ok('a member cannot ask for payment', await payments.request(ada.accountId, whanganui.id, ask()).then(() => false, (e) => e instanceof Forbidden));
}

console.log('\nWHO CAN SEE AND PAY');
{
  ok('the person sees what they owe', (await payments.forPerson(ada.accountId, ada.id)).length === 3);
  ok('another member cannot read it', await payments.forPerson(bob.accountId, ada.id).then(() => false, (e) => e instanceof Forbidden));
  ok('another member cannot pay it', await payments.pay(bob.accountId, uniform.id, { method: 'bank', card: '' }, { provider: new TestProvider() }).then(() => false, (e) => e instanceof Forbidden));
  const k = await payments.request(doug.id, whanganui.id, ask({ personNumber: kid.display_number, kind: 'club_fee', amountCents: 4000 }));
  ok('a parent sees their child\'s', (await payments.forPerson(mum.accountId, kid.id)).length === 1);
  ok('and what they owe altogether', (await payments.owedBy(mum.accountId)).some((p) => p.id === k.id));
  const paid = await payments.pay(mum.accountId, k.id, { method: 'card', card: '4242424242424242' }, { provider: new TestProvider() });
  ok('a parent can pay for their child', paid.status === 'succeeded');
}

console.log('\nPAYING');
{
  const provider = new TestProvider();
  const declined = await payments.pay(ada.accountId, uniform.id, { method: 'card', card: '4000 0000 0000 0002' }, { provider });
  ok('a declined card says so', declined.status === 'failed' && /declined/.test(declined.detail));
  ok('and can be tried again', (await payments.pay(ada.accountId, uniform.id, { method: 'card', card: '4242424242424242' }, { provider })).status === 'succeeded');
  ok('the payment records who and how', (await one('select paid_by, method, provider, settled_at from payment where id=$1', [uniform.id])).paid_by === ada.accountId);
  ok('a paid payment cannot be paid again',
    await payments.pay(ada.accountId, uniform.id, { method: 'card', card: '4242424242424242' }, { provider }).then(() => false, (e) => e instanceof Invalid));
  ok('the card number is never stored', !JSON.stringify(await q('select * from payment where id=$1', [uniform.id])).includes('4242'));

  const bank = await payments.pay(ada.accountId, dan.id, { method: 'bank' }, { provider });
  ok('internet banking waits for the bank', bank.status === 'awaiting');
  ok('and is not yet paid', (await payments.forPerson(ada.accountId, ada.id)).find((p) => p.id === dan.id).status === 'awaiting');
  ok('it cannot be paid a second time while waiting',
    await payments.pay(ada.accountId, dan.id, { method: 'card', card: '4242424242424242' }, { provider }).then(() => false, (e) => e instanceof Invalid));
  ok('completing needs the test provider', await payments.completeTest(ada.accountId, dan.id, true, { provider: new ScriptedProvider(() => ({})) }).then(() => false, (e) => e instanceof Forbidden));
  ok('the bank confirming settles it', (await payments.completeTest(ada.accountId, dan.id, true, { provider })).status === 'succeeded');

  const dd = await payments.request(doug.id, whanganui.id, ask({ kind: 'equipment', amountCents: 2500, description: 'Shin pads' }));
  ok('a direct debit waits too', (await payments.pay(ada.accountId, dd.id, { method: 'direct_debit' }, { provider })).status === 'awaiting');
  ok('and can be refused by the bank', (await payments.completeTest(ada.accountId, dd.id, false, { provider })).status === 'failed');

  const bad = (inp) => payments.pay(ada.accountId, dd.id, inp, { provider }).then(() => false, (e) => e instanceof Invalid);
  ok('no method is refused', await bad({ method: '', card: '' }));
  ok('a card payment with no number is refused', await bad({ method: 'card', card: '' }));
  ok('and nothing was claimed by the refusal', (await one('select status from payment where id=$1', [dd.id])).status === 'failed');

  let calls = 0;
  const slow = new ScriptedProvider(async () => { calls++; await new Promise((r) => setTimeout(r, 60)); return { ref: 'x', status: 'succeeded', detail: '' }; });
  const again = await payments.request(doug.id, whanganui.id, ask({ kind: 'club_fee', amountCents: 1000 }));
  const both = await Promise.allSettled([1, 2].map(() => payments.pay(ada.accountId, again.id, { method: 'card', card: '4242424242424242' }, { provider: slow })));
  ok('pressing pay twice reaches the provider once', calls === 1 && both.filter((b) => b.status === 'fulfilled').length === 1, `${calls} calls`);

  const broken = new ScriptedProvider(() => { throw new Error('socket hang up'); });
  const b2 = await payments.request(doug.id, whanganui.id, ask({ kind: 'club_fee', amountCents: 1100 }));
  ok('an unreachable provider charges nothing and says so',
    await payments.pay(ada.accountId, b2.id, { method: 'card', card: '4242424242424242' }, { provider: broken }).then(() => false, (e) => e instanceof Invalid && /Nothing was charged/.test(e.message)));
  ok('and it can be tried again', (await one('select status from payment where id=$1', [b2.id])).status === 'failed');
}

console.log('\nWHAT A CLUB SEES');
{
  const mine = await payments.receivedBy(doug.id, whanganui.id);
  ok('the dojo sees what it was paid', mine.rows.some((r) => r.id === uniform.id && r.status === 'succeeded'));
  ok('but not the federation\'s black belt money', !mine.rows.some((r) => r.id === dan.id));
  ok('totals are by kind', mine.totals.some((t) => t.kind === 'uniform' && t.status === 'succeeded' && t.cents === 6500));
  const fed = await one(`select a.id from account a join grant_role g on g.account_id=a.id
    where g.organisation_id=$1 and g.role in ('owner','administrator') limit 1`, [federation.id]);
  if (fed) {
    const f = await payments.receivedBy(fed.id, federation.id);
    ok('the federation sees the black belt grading', f.rows.some((r) => r.id === dan.id && r.status === 'succeeded'));
    ok('and none of the dojo\'s money', !f.rows.some((r) => r.id === uniform.id));
  }
  const tane = await one(`select id from account where email='tane@example.nz'`);
  ok('another club cannot read it', tane && await payments.receivedBy(tane.id, whanganui.id).then(() => false, (e) => e instanceof Forbidden));
  ok('a member cannot read it', await payments.receivedBy(ada.accountId, whanganui.id).then(() => false, (e) => e instanceof Forbidden));
}

console.log('\nENTRY FEES');
{
  const ev = await one(`select * from event where organisation_id=$1 limit 1`, [whanganui.id]);
  if (ev) {
    const { competition } = await import('./data.mjs');
    const entry = await competition.enterCompetitor(doug.id, ev.id, {
      personId: ada.id, enteredForOrg: whanganui.id, amountCents: 6000, allowNoPlacements: true });
    const pay = await one(`select py.*, l.kind from payment py join payment_line l on l.payment_id=py.id where py.event_entry_id=$1`, [entry.id]);
    ok('an entry with a fee makes a payment to whoever runs the event',
      pay?.organisation_id === ev.organisation_id && pay.kind === 'tournament_entry' && pay.amount_cents === 6000);
    await payments.pay(ada.accountId, pay.id, { method: 'card', card: '4242424242424242' }, { provider: new TestProvider() });
    ok('paying marks the entry paid', (await one('select paid from event_entry where id=$1', [entry.id])).paid === true);

    const kidEntry = await competition.enterCompetitor(doug.id, ev.id, {
      personId: kid.id, enteredForOrg: whanganui.id, amountCents: 6000, allowNoPlacements: true });
    await competition.withdraw(doug.id, kidEntry.id, 'unwell');
    ok('withdrawing cancels what was not yet paid',
      (await one('select status from payment where event_entry_id=$1', [kidEntry.id])).status === 'void');
    const free = await competition.enterCompetitor(doug.id, ev.id, {
      personId: mum.id, enteredForOrg: whanganui.id, amountCents: 0, allowNoPlacements: true });
    ok('a free entry asks for nothing', !(await one('select 1 as x from payment where event_entry_id=$1', [free.id])));
  }
}

console.log('\nTHE SCREENS');
{
  await signIn('ada@pay.test');
  const owed = await req('/me/payments');
  ok('opens', owed.status === 200 && /Payments/.test(owed.html), String(owed.status));
  ok('says these are test payments', /Test payments/.test(owed.html));
  const mineRow = await payments.request(doug.id, whanganui.id, ask({ kind: 'uniform', amountCents: 1234, description: 'Belt' }));
  const form = await req(`/me/payments/${mineRow.id}`);
  ok('the pay screen shows the amount and who it goes to', form.status === 200 && /\$12\.34/.test(form.html) && /Whanganui/.test(form.html));
  const go = await req(`/me/payments/${mineRow.id}`, { method: 'POST', form: { method: 'bank' } });
  ok('paying by bank leaves it waiting', go.status === 302);
  const waiting = await req(`/me/payments/${mineRow.id}`);
  ok('the screen says so', /Waiting for the bank/.test(waiting.html));
  await req(`/me/payments/${mineRow.id}/complete`, { method: 'POST', form: { ok: '1' } });
  ok('and the test button settles it', (await one('select status from payment where id=$1', [mineRow.id])).status === 'succeeded');
  const bad = await req(`/me/payments/${(await payments.request(doug.id, whanganui.id, ask({ amountCents: 500 }))).id}`, { method: 'POST', form: { method: 'card', card: '' } });
  ok('a mistake says what to fix', bad.status === 422 && /card number/i.test(bad.html));
  const theirs = await req(`/me/payments/${dan.id}x`);
  ok('a made-up id is not found', theirs.status === 404);

  await signIn('doug@example.nz');
  const adm = await req('/o/whanganui/payments');
  ok('the club\'s screen opens', adm.status === 200 && /Ask a member for a payment/.test(adm.html));
  ok('the rail links to it', /\/o\/whanganui\/payments/.test(adm.html));
  const made = await req('/o/whanganui/payments', { method: 'POST', form: { personNumber: ada.display_number, kind: 'equipment', amount: '19.95', description: 'Mitts' } });
  ok('asking redirects with a note', made.status === 302 && /done=/.test(made.location ?? ''), `${made.status}`);
  const nope = await req('/o/whanganui/payments', { method: 'POST', form: { personNumber: '', kind: 'equipment', amount: 'x' } });
  ok('a mistake says what to fix', nope.status === 422 && /Enter the member number/.test(nope.html));
  const row = await one(`select id from payment where status='pending' and organisation_id=$1 order by created_at desc limit 1`, [whanganui.id]);
  const cancel = await req(`/o/whanganui/payments/${row.id}/cancel`, { method: 'POST', form: {} });
  ok('an unpaid request can be taken back', cancel.status === 302 && (await one('select status from payment where id=$1', [row.id])).status === 'void');
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
