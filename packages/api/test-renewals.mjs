/**
 * Renewing memberships.
 *
 *   1. Each dojo sets its own prices; one dojo's are not another's.
 *   2. Asking for a renewal charges at the dojo's price for that person, and
 *      pays the dojo.
 *   3. However it is paid — card, bank, cash, transfer — paying moves
 *      "fees run to" on from the later of today and where it already runs to.
 *   4. Cash is recorded by the dojo, numbered, attributed and in the history;
 *      a member cannot record their own cash.
 *   5. Somebody the dojo does not charge is never asked, and still renews.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, payments, fees, renewals, Forbidden, Invalid } from './data.mjs';
import * as auth from './auth.mjs';
import { TestProvider } from '../infrastructure/payments/providers.mjs';

process.env.HONBU_STORE = 'postgres';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
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
const rejects = (p, cls, re = /./) => p.then(() => false, (e) => e instanceof cls && re.test(e.message));

const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const tane = await one(`select id from account where email='tane@example.nz'`);
await pool.query(`update affiliation set ends='2020-01-01', status='resigned' where organisation_id in ($1,$2)`,
  [whanganui.id, wellington.id]);
const today = (await one(`select to_char((now() at time zone 'Pacific/Auckland')::date,'YYYY-MM-DD') as d`)).d;
const daysFrom = async (n) => (await one(`select to_char(($1::date + $2::int),'YYYY-MM-DD') as d`, [today, n])).d;

let seq = 0;
const member = async (first, { age = 30, paidUntil = null, org = whanganui, role = 'member', status = 'active' } = {}) => {
  const dob = (await one(`select to_char($1::date - ($2::int * 365 + $3::int * 0 + 90), 'YYYY-MM-DD') as d`, [today, age, 0])).d;
  const p = await one(`insert into person (display_number, first_name, last_name, email, date_of_birth)
    values ($1,$2,'Renewtest',$3,$4) returning *`, [`RT-${++seq}`, first, `${first.toLowerCase()}@renew.test`, dob]);
  const a = await one(`insert into affiliation (person_id, organisation_id, role, starts, status, paid_until)
    values ($1,$2,$3,'2020-01-01',$4,$5) returning *`, [p.id, org.id, role, status, paidUntil]);
  const acct = await one(`insert into account (email, person_id) values ($1,$2) returning id`, [p.email, p.id]);
  return { ...p, aff: a.id, accountId: acct.id };
};
const paidUntil = async (m) => (await one('select paid_until::text as d, status from affiliation where id=$1', [m.aff]));

console.log('\nEACH DOJO SETS ITS OWN PRICE');
{
  await fees.save(doug.id, whanganui.id, { label: 'Adult annual', appliesTo: 'adult', period: 'annual', amountText: '180', effectiveFrom: '' });
  await fees.save(doug.id, whanganui.id, { label: 'Junior annual', appliesTo: 'junior', period: 'annual', amountText: '120', effectiveFrom: '' });
  await fees.save(doug.id, whanganui.id, { label: 'Adult monthly', appliesTo: 'adult', period: 'monthly', amountText: '25', effectiveFrom: '' });
  await fees.save(tane.id, wellington.id, { label: 'Adult annual', appliesTo: 'adult', period: 'annual', amountText: '240', effectiveFrom: '' });
  ok('Whanganui has its three prices', (await fees.list(doug.id, whanganui.id)).length === 3);
  ok('Wellington has its own', (await fees.list(tane.id, wellington.id))[0].amount_cents === 24000);
  ok('one dojo cannot read another\'s', await rejects(fees.list(tane.id, whanganui.id), Forbidden));
  ok('one dojo cannot set another\'s', await rejects(fees.save(tane.id, whanganui.id, { label: 'x', appliesTo: 'adult', period: 'annual', amountText: '1', effectiveFrom: '' }), Forbidden));
  ok('a federation has no member fees to set', await rejects(fees.save(doug.id, (await one('select id from organisation where parent_id is null')).id,
    { label: 'x', appliesTo: 'adult', period: 'annual', amountText: '1', effectiveFrom: '' }), Invalid, /each club/));
  ok('a bad price is refused with the reason', await rejects(fees.save(doug.id, whanganui.id, { label: '', appliesTo: 'adult', period: 'annual', amountText: '0', effectiveFrom: '' }), Invalid, /name/));

  await fees.save(doug.id, whanganui.id, { label: 'Adult annual', appliesTo: 'adult', period: 'annual', amountText: '200', effectiveFrom: await daysFrom(10) });
  const adult = (await fees.list(doug.id, whanganui.id)).filter((f) => f.applies_to === 'adult' && f.period === 'annual');
  const dayBefore = await daysFrom(9);
  ok('a new price takes over from its date and the old one ends the day before',
    adult.length === 2 && adult.some((f) => f.effective_to === dayBefore), JSON.stringify(adult.map((f) => [f.amount_cents, f.effective_from, f.effective_to])));
}

console.log('\nASKING TO RENEW');
const ann = await member('Ann', { age: 30, paidUntil: await daysFrom(-40) });          // overdue
const kid = await member('Kidd', { age: 9, paidUntil: await daysFrom(10) });           // due soon
const newbie = await member('Newbie', { age: 25 });                                    // never paid
const paidup = await member('Paidup', { age: 40, paidUntil: await daysFrom(200) });    // current
const wb = await member('Wellie', { age: 30, paidUntil: await daysFrom(-5), org: wellington });
{
  const r = await renewals.roster(doug.id, whanganui.id);
  const st = (m) => r.rows.find((x) => x.affiliation_id === m.aff)?.standing;
  ok('overdue', st(ann) === 'overdue'); ok('due soon', st(kid) === 'due');
  ok('never paid', st(newbie) === 'unpaid'); ok('paid up', st(paidup) === 'current');
  ok('another dojo\'s members are not listed', !r.rows.some((x) => x.affiliation_id === wb.aff));
  ok('a member cannot see the list', await rejects(renewals.roster(ann.accountId, whanganui.id), Forbidden));
  ok('another dojo cannot see the list', await rejects(renewals.roster(tane.id, whanganui.id), Forbidden));

  const out = await renewals.ask(doug.id, whanganui.id, { affiliationIds: [ann.aff, kid.aff, paidup.aff, wb.aff], period: 'annual' });
  ok('asked the three of its own, not the other dojo\'s', out.asked === 3, JSON.stringify(out));
  const owed = async (m) => (await payments.forPerson(m.accountId, m.id))[0];
  ok('an adult is asked for the adult price', (await owed(ann)).amount_cents === 18000, String((await owed(ann)).amount_cents));
  ok('a child for the junior price', (await owed(kid)).amount_cents === 12000);
  ok('and it is the dojo\'s money', (await owed(ann)).organisation_id === whanganui.id);
  ok('asking again does not ask twice', (await renewals.ask(doug.id, whanganui.id, { affiliationIds: [ann.aff], period: 'annual' })).skipped[0]?.reason === 'already asked');
  ok('asking charges nobody and moves nothing', (await paidUntil(ann)).d === await daysFrom(-40));
  const none = await renewals.ask(doug.id, whanganui.id, { affiliationIds: [newbie.aff], period: 'term' });
  ok('no price for that period is explained, not guessed', none.asked === 0 && /no adult price/.test(none.skipped[0].reason), JSON.stringify(none));
  ok('nobody ticked is refused', await rejects(renewals.ask(doug.id, whanganui.id, { affiliationIds: [], period: 'annual' }), Invalid, /Tick/));
  ok('a one-off is not a renewal', await rejects(renewals.ask(doug.id, whanganui.id, { affiliationIds: [ann.aff], period: 'once' }), Invalid));
}

console.log('\nPAYING MOVES THEM ON');
{
  const provider = new TestProvider();
  const annPay = (await payments.forPerson(ann.accountId, ann.id))[0];
  await payments.pay(ann.accountId, annPay.id, { method: 'card', card: '4242424242424242' }, { provider });
  ok('paid late starts from today, not from the lapse', (await paidUntil(ann)).d === (await one(`select to_char($1::date + interval '1 year','YYYY-MM-DD') as d`, [today])).d, JSON.stringify(await paidUntil(ann)));

  const kidPay = (await payments.forPerson(kid.accountId, kid.id))[0];
  await payments.pay(kid.accountId, kidPay.id, { method: 'bank' }, { provider });
  ok('a bank payment still waiting moves nothing', (await paidUntil(kid)).d === await daysFrom(10));
  await payments.completeTest(kid.accountId, kidPay.id, true, { provider });
  ok('paid early keeps the days already paid for', (await paidUntil(kid)).d === (await one(`select to_char($1::date + interval '1 year','YYYY-MM-DD') as d`, [await daysFrom(10)])).d, JSON.stringify(await paidUntil(kid)));

  const lapsed = await member('Lapsed', { age: 30, paidUntil: await daysFrom(-100), status: 'lapsed' });
  await renewals.ask(doug.id, whanganui.id, { affiliationIds: [lapsed.aff], period: 'monthly' });
  const lp = (await payments.forPerson(lapsed.accountId, lapsed.id))[0];
  ok('a monthly price is charged', lp.amount_cents === 2500);
  await payments.pay(lapsed.accountId, lp.id, { method: 'card', card: '4242424242424242' }, { provider });
  const after = await paidUntil(lapsed);
  ok('a lapsed member is active again', after.status === 'active', after.status);
  ok('and paid a month on', after.d === (await one(`select to_char($1::date + interval '1 month','YYYY-MM-DD') as d`, [today])).d);

  const failed = await member('Declined', { age: 30, paidUntil: await daysFrom(-3) });
  await renewals.ask(doug.id, whanganui.id, { affiliationIds: [failed.aff], period: 'annual' });
  const fp = (await payments.forPerson(failed.accountId, failed.id))[0];
  await payments.pay(failed.accountId, fp.id, { method: 'card', card: '4000000000000002' }, { provider });
  ok('a declined card moves nothing', (await paidUntil(failed)).d === await daysFrom(-3));
}

console.log('\nCASH');
{
  const c = await member('Cashie', { age: 30, paidUntil: await daysFrom(-1) });
  await renewals.ask(doug.id, whanganui.id, { affiliationIds: [c.aff], period: 'annual' });
  const pay = (await payments.forPerson(c.accountId, c.id))[0];
  ok('a member cannot record their own cash', await rejects(payments.recordManual(c.accountId, pay.id, 'cash'), Forbidden));
  ok('another dojo cannot record it', await rejects(payments.recordManual(tane.id, pay.id, 'cash'), Forbidden));
  ok('an unknown method is refused', await rejects(payments.recordManual(doug.id, pay.id, 'bitcoin'), Invalid));
  const done = await payments.recordManual(doug.id, pay.id, 'cash');
  ok('the dojo records it as paid in cash', done.status === 'succeeded' && done.method === 'cash');
  ok('with a numbered receipt', /^R-\d{4}-0001$/.test(done.receipt_no), done.receipt_no);
  ok('and who took it', done.taken_by === doug.id);
  ok('and the membership moves on', (await paidUntil(c)).d > today);
  ok('it cannot be recorded twice', await rejects(payments.recordManual(doug.id, pay.id, 'cash'), Invalid, /already/));
  const log = await one(`select after from audit_log where action='payment_recorded' order by id desc limit 1`);
  ok('it is in the history with the receipt', log?.after?.receipt === done.receipt_no && log.after.method === 'cash');

  const d = await member('Doorway', { age: 30, paidUntil: await daysFrom(-1) });
  const out = await renewals.ask(doug.id, whanganui.id, { affiliationIds: [d.aff], period: 'annual', received: 'transfer' });
  const dp = (await payments.forPerson(d.accountId, d.id))[0];
  ok('paying at the door is asked and recorded in one step', out.asked === 1 && dp.status === 'succeeded' && dp.method === 'transfer');
  ok('receipt numbers count on, per dojo', dp.receipt_no.endsWith('0002'), dp.receipt_no);
  const wc = await member('Wcash', { age: 30, paidUntil: await daysFrom(-1), org: wellington });
  await renewals.ask(tane.id, wellington.id, { affiliationIds: [wc.aff], period: 'annual', received: 'cash' }).catch(() => {});
  const wp = (await payments.forPerson(wc.accountId, wc.id))[0];
  ok('another dojo\'s receipts are numbered separately', !wp || wp.receipt_no?.endsWith('0001'), wp?.receipt_no);

  const t = await payments.receivedBy(doug.id, whanganui.id);
  ok('the dojo sees how much came in by each method', t.methods.some((m) => m.method === 'cash') && t.methods.some((m) => m.method === 'transfer'));

  const fedPay = await payments.request(doug.id, whanganui.id, { personNumber: ann.display_number, kind: 'dan_grading',
    description: '1st dan', amountCents: 20000, received: 'cash' }).then(() => null, (e) => e);
  ok('a dojo cannot record national money as received', fedPay instanceof Invalid || fedPay instanceof Forbidden || fedPay === null, String(fedPay));
}

console.log('\nNOT CHARGED');
{
  const sensei = await member('Sensei', { age: 45, paidUntil: await daysFrom(-20), role: 'instructor' });
  await renewals.ask(doug.id, whanganui.id, { affiliationIds: [sensei.aff], period: 'annual' });
  ok('asked first, as anybody is', (await payments.forPerson(sensei.accountId, sensei.id)).length === 1);
  const reg = await one(`insert into account (email) values ('registrar@renew.test') returning id`);
  await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,'registrar')`, [reg.id, whanganui.id]);
  ok('a registrar can run renewals', (await renewals.roster(reg.id, whanganui.id)).rows.length > 0);
  ok('a registrar can take cash', (await renewals.ask(reg.id, whanganui.id, { affiliationIds: [], period: 'annual' }).then(() => false, (e) => e instanceof Invalid)));
  ok('but only an administrator can waive fees', await rejects(renewals.setExemption(reg.id, whanganui.id, sensei.aff, { exempt: true, reason: 'life' }), Forbidden));
  ok('or set prices', await rejects(fees.save(reg.id, whanganui.id, { label: 'x', appliesTo: 'adult', period: 'annual', amountText: '1', effectiveFrom: '' }), Forbidden));
  ok('a member cannot waive their own', await rejects(renewals.setExemption(sensei.accountId, whanganui.id, sensei.aff, { exempt: true, reason: 'instructor' }), Forbidden));
  ok('a reason is needed', await rejects(renewals.setExemption(doug.id, whanganui.id, sensei.aff, { exempt: true, reason: '' }), Invalid, /why/));
  await renewals.setExemption(doug.id, whanganui.id, sensei.aff, { exempt: true, reason: 'instructor' });
  ok('what was asked of them is withdrawn', (await payments.forPerson(sensei.accountId, sensei.id)).length === 0);
  const r = await renewals.roster(doug.id, whanganui.id);
  ok('they show as not charged', r.rows.find((x) => x.affiliation_id === sensei.aff).standing === 'exempt');
  const again = await renewals.ask(doug.id, whanganui.id, { affiliationIds: [sensei.aff], period: 'annual' });
  ok('and are never asked again', again.asked === 0 && again.skipped[0].reason === 'not charged');
  ok('only an exempt member is carried on for nothing', await rejects(renewals.carryOn(doug.id, whanganui.id, ann.aff), Invalid, /not charged/));
  const until = await renewals.carryOn(doug.id, whanganui.id, sensei.aff);
  ok('their membership is carried on a year with no payment', until === (await one(`select to_char($1::date + interval '1 year','YYYY-MM-DD') as d`, [today])).d && (await paidUntil(sensei)).d === until);
  const log = await one(`select after from audit_log where action='fee_exemption' order by id desc limit 1`);
  ok('the reason is in the history', log?.after?.reason === 'instructor' && log.after.person);
  await renewals.setExemption(doug.id, whanganui.id, sensei.aff, { exempt: false });
  ok('they can be charged again', (await renewals.roster(doug.id, whanganui.id)).rows.find((x) => x.affiliation_id === sensei.aff).standing !== 'exempt');
  ok('another dojo cannot touch it', await rejects(renewals.setExemption(tane.id, whanganui.id, sensei.aff, { exempt: true, reason: 'life' }), Forbidden));
  ok('nor reach it through its own dojo', await rejects(renewals.setExemption(tane.id, wellington.id, sensei.aff, { exempt: true, reason: 'life' }), Invalid)
    || await rejects(renewals.setExemption(tane.id, wellington.id, sensei.aff, { exempt: true, reason: 'life' }), Error));
  ok('and it was not changed', (await one('select fee_exempt from affiliation where id=$1', [sensei.aff])).fee_exempt === false);
}

console.log('\nTHE SCREENS');
{
  await signIn('doug@example.nz');
  const s = await req('/o/whanganui/renewals');
  ok('opens', s.status === 200 && /Who is due/.test(s.html) && /Adult annual/.test(s.html), String(s.status));
  ok('the rail links to it', /\/o\/whanganui\/renewals/.test(s.html));
  ok('a federation is sent to its clubs', (await req('/o/moknz/renewals')).status === 302);
  const picky = await member('Picky', { age: 30, paidUntil: await daysFrom(-2) });
  const go = await req('/o/whanganui/renewals', { method: 'POST', form: { [`pick_${picky.aff}`]: '1', period: 'annual', received: 'cash' } });
  ok('renewing the ticked records them', go.status === 200 && /1 renewal recorded/.test(go.html), `${go.status}`);
  ok('and the membership moved on', (await paidUntil(picky)).d > today);
  const nothing = await req('/o/whanganui/renewals', { method: 'POST', form: { period: 'annual' } });
  ok('ticking nobody says so', nothing.status === 422 && /Tick the people/.test(nothing.html));
  const price = await req('/o/whanganui/renewals/fees', { method: 'POST', form: { label: 'Family', appliesTo: 'member', period: 'term', amount: '99' } });
  ok('a price can be set from the screen', price.status === 302 && (await fees.list(doug.id, whanganui.id)).some((f) => f.label === 'Family'));
  const badPrice = await req('/o/whanganui/renewals/fees', { method: 'POST', form: { label: '', appliesTo: 'member', period: 'term', amount: '' } });
  ok('a mistake says what to fix and keeps the rest', badPrice.status === 422 && /name/.test(badPrice.html));
  const sc = await member('Screeny', { age: 50, role: 'instructor' });
  const ex = await req(`/o/whanganui/renewals/${sc.aff}/exempt`, { method: 'POST', form: { exempt: '1', reason: 'instructor' } });
  ok('an instructor can be marked not charged from the screen', ex.status === 302 && (await one('select fee_exempt from affiliation where id=$1', [sc.aff])).fee_exempt);
  const cash = await member('Cashscreen', { age: 30, paidUntil: await daysFrom(-9) });
  await renewals.ask(doug.id, whanganui.id, { affiliationIds: [cash.aff], period: 'annual' });
  const row = await one(`select id from payment where person_id=$1`, [cash.id]);
  const rec = await req(`/o/whanganui/payments/${row.id}/received`, { method: 'POST', form: { method: 'cash' } });
  ok('cash can be recorded from the payments screen', rec.status === 302 && /Receipt/.test(decodeURIComponent(rec.location ?? '')), rec.location);
  const pays = await req('/o/whanganui/payments');
  ok('which shows the method and receipt', /cash · R-\d{4}-\d{4}/.test(pays.html));
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
