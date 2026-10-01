/**
 * The renewal list and the messages, together.
 *
 *   1. A registrar ticks people on the renewal list and writes to them as the club.
 *   2. Children are written to through their guardians; anybody not charged is
 *      left out; somebody from another club cannot be added by a forged id.
 *   3. A fees reminder is a service message: it reaches people who stopped announcements, and says so.
 *   4. Automatic reminders are the club's choice, only an administrator changes it,
 *      and the daily run is careful: due and overdue get different words, nobody
 *      is written to twice in a fortnight, nobody with no date is touched, and
 *      one club's problem does not stop another's.
 *   5. The scheduler's door is shut without the secret — and shut when no secret is set.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, renewals, messages, reminders, Forbidden, Invalid } from './data.mjs';
import { MemoryMessenger } from '../infrastructure/messaging/messengers.mjs';
import { dueForReminder, reminderText } from '../core/domain/membership.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const q = async (sql, a = []) => (await pool.query(sql, a)).rows;
const one = async (sql, a = []) => (await q(sql, a))[0] ?? null;
const rejects = (p, cls, re = /./) => p.then(() => false, (e) => e instanceof cls && re.test(e.message));

console.log('\nTHE WORDS');
{
  ok('due and overdue say different things', reminderText('due').subject !== reminderText('overdue').subject);
  ok('neither names an amount (it differs by person)', !/\$\d/.test(reminderText('due').body + reminderText('overdue').body));
  ok('both carry the club and the way to pay', ['due', 'overdue'].every((k) => /\{club\}/.test(reminderText(k).body) && /\{payLink\}/.test(reminderText(k).body)));
  const rows = [
    { standing: 'due', paid_until: '2026-10-10', fee_exempt: false, last_reminded: null },
    { standing: 'due', paid_until: '2026-10-10', fee_exempt: false, last_reminded: '2026-09-25' },     // 7 days ago
    { standing: 'due', paid_until: '2026-10-10', fee_exempt: false, last_reminded: '2026-09-18' },     // 14 days ago
    { standing: 'overdue', paid_until: '2026-09-01', fee_exempt: false, last_reminded: null },
    { standing: 'overdue', paid_until: '2026-07-01', fee_exempt: false, last_reminded: null },          // 93 days
    { standing: 'unpaid', paid_until: null, fee_exempt: false, last_reminded: null },
    { standing: 'exempt', paid_until: '2026-01-01', fee_exempt: true, last_reminded: null },
    { standing: 'current', paid_until: '2027-06-01', fee_exempt: false, last_reminded: null },
  ];
  const g = dueForReminder(rows, '2026-10-02');
  ok('due: never reminded, and reminded a fortnight ago', g.due.length === 2);
  ok('but not reminded last week', !g.due.some((r) => r.last_reminded === '2026-09-25'));
  ok('overdue: only within 60 days', g.overdue.length === 1 && g.overdue[0].paid_until === '2026-09-01');
  ok('never anybody with no date, not charged, or paid up', g.due.length + g.overdue.length === 3);
}

const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const tane = await one(`select id from account where email='tane@example.nz'`);
await pool.query(`update affiliation set ends='2020-01-01', status='resigned' where organisation_id in ($1,$2)`, [whanganui.id, wellington.id]);
const today = (await one(`select to_char((now() at time zone 'Pacific/Auckland')::date,'YYYY-MM-DD') as d`)).d;
const daysFrom = async (n) => (await one(`select to_char($1::date + $2::int,'YYYY-MM-DD') as d`, [today, n])).d;
const BASE = 'noreply@mail.moknz.test';
for (const [org, mail] of [[whanganui, 'club@whanganui.test'], [wellington, null]])
  await pool.query(`insert into dojo_profile (organisation_id, email) values ($1,$2)
    on conflict (organisation_id) do update set email = $2`, [org.id, mail]);

let seq = 0;
const member = async (first, { years = 30, paidUntil = null, org = whanganui, role = 'member', exempt = false, email = undefined } = {}) => {
  const dob = (await one(`select to_char($1::date - ($2::int * 365 + 90),'YYYY-MM-DD') as d`, [today, years])).d;
  const p = await one(`insert into person (display_number, first_name, last_name, email, date_of_birth)
    values ($1,$2,'Remindtest',$3,$4) returning *`, [`MT-${++seq}`, first, email === undefined ? `${first.toLowerCase()}@remind.test` : email, dob]);
  const a = await one(`insert into affiliation (person_id, organisation_id, role, starts, status, paid_until, fee_exempt, fee_exempt_reason)
    values ($1,$2,$3,'2020-01-01','active',$4,$5,$6) returning *`, [p.id, org.id, role, paidUntil, exempt, exempt ? 'life' : null]);
  const acct = await one(`insert into account (email, person_id) values ($1,$2) returning id`, [`acct-${p.email ?? seq}`, p.id]);
  return { ...p, aff: a.id, accountId: acct.id };
};

console.log('\nREMINDING THE TICKED');
const overdue = await member('Over', { paidUntil: await daysFrom(-10) });
const soon = await member('Soon', { paidUntil: await daysFrom(12) });
const lifer = await member('Lifer', { paidUntil: await daysFrom(-10), exempt: true });
const optOut = await member('Optout', { paidUntil: await daysFrom(-3) });
await pool.query(`insert into email_preference (person_id, token, opted_out) values ($1,'tok-opt',true)`, [optOut.id]);
const kid = await member('Kidd', { years: 9, paidUntil: await daysFrom(5), email: null });
const mum = await member('Mum', { paidUntil: await daysFrom(300) });
await pool.query(`insert into guardian_link (guardian_id, child_id) values ($1,$2)`, [mum.id, kid.id]);
const outsider = await member('Outsider', { paidUntil: await daysFrom(-10), org: wellington });
{
  const text = reminderText('overdue');
  const made = await renewals.remind(doug.id, whanganui.id,
    { affiliationIds: [overdue.aff, soon.aff, lifer.aff, optOut.aff, kid.aff, outsider.aff], subject: text.subject, body: text.body },
    { baseFrom: BASE });
  ok('four are written to (not the exempt one, not the other club\'s), the child through the parent',
    made.recipients === 4, `${made.recipients}`);
  const to = (await q(`select email from message_recipient where message_id=$1 and status='queued'`, [made.message.id])).map((r) => r.email).sort();
  ok('the right addresses', JSON.stringify(to) === JSON.stringify(['mum@remind.test', 'optout@remind.test', 'over@remind.test', 'soon@remind.test'].sort()), to.join());
  ok('it is a fees reminder', (await one('select kind, audience, sent_by from message where id=$1', [made.message.id])).kind === 'renewal');

  const mem = new MemoryMessenger();
  await messages.sendBatch(doug.id, whanganui.id, made.message.id, { messenger: mem, origin: 'https://club.test', trusted: true });
  const got = mem.sent.find((m) => m.to === 'optout@remind.test');
  ok('somebody who stopped announcements still gets it', !!got);
  ok('and is told why', /membership fees, so it is sent whatever your email settings/.test(got.text));
  ok('with no unsubscribe offered for it', !got.headers && !/Stop getting announcements/.test(got.text));
  ok('{club} and {payLink} are filled in', /Whanganui/.test(got.text) && /https:\/\/club\.test\/me\/payments/.test(got.text) && !/\{/.test(got.text), got.text);
  ok('as the club', got.sender.name === 'Whanganui' && got.sender.address === 'whanganui@mail.moknz.test');

  const list = (await renewals.roster(doug.id, whanganui.id)).rows;
  ok('the list now says when they were reminded', list.find((r) => r.affiliation_id === overdue.aff).last_reminded === today);
  ok('a child shows as reminded through the parent', list.find((r) => r.affiliation_id === kid.aff).last_reminded === today);
  ok('and the one not written to does not', list.find((r) => r.affiliation_id === lifer.aff).last_reminded === null);

  ok('a forged id from another club reaches nobody', await rejects(renewals.remind(doug.id, whanganui.id,
    { affiliationIds: [outsider.aff], subject: 's', body: 'b' }, { baseFrom: BASE }), Invalid));
  ok('nobody ticked is refused', await rejects(renewals.remind(doug.id, whanganui.id, { affiliationIds: [], subject: 's', body: 'b' }, { baseFrom: BASE }), Invalid, /Tick/));
  ok('a message with no words is refused', await rejects(renewals.remind(doug.id, whanganui.id, { affiliationIds: [overdue.aff], subject: '', body: '' }, { baseFrom: BASE }), Invalid, /subject/));
  ok('a member cannot', await rejects(renewals.remind(overdue.accountId, whanganui.id, { affiliationIds: [overdue.aff], subject: 's', body: 'b' }, { baseFrom: BASE }), Forbidden));
  ok('another club cannot', await rejects(renewals.remind(tane.id, whanganui.id, { affiliationIds: [overdue.aff], subject: 's', body: 'b' }, { baseFrom: BASE }), Forbidden));
  const reg = await one(`insert into account (email) values ('reg@remind.test') returning id`);
  await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,'registrar')`, [reg.id, whanganui.id]);
  const byReg = await renewals.remind(reg.id, whanganui.id, { affiliationIds: [soon.aff], subject: 'Hi', body: 'Pay at {payLink}' }, { baseFrom: BASE });
  ok('a registrar can: they run renewals', byReg.recipients === 1);
}

console.log('\nTHE COMPOSE SCREEN CANNOT BE USED FOR A FEES REMINDER');
{
  ok('a fees reminder to the whole club is refused', await rejects(messages.prepare(doug.id, whanganui.id,
    { audience: 'members', kind: 'renewal', subject: 's', body: 'b', eventId: null, personNumber: null }, { baseFrom: BASE }), Invalid, /renewals list/));
}

console.log('\nAUTOMATIC REMINDERS ARE THE CLUB\'S CHOICE');
{
  ok('off by default', (await renewals.reminderSetting(whanganui.id)) === false);
  const reg = await one(`select id from account where email='reg@remind.test'`);
  ok('a registrar cannot switch them on', await rejects(renewals.setReminders(reg.id, whanganui.id, true), Forbidden));
  ok('another club cannot', await rejects(renewals.setReminders(tane.id, whanganui.id, true), Forbidden));
  const first = await reminders.run({ messenger: new MemoryMessenger(), origin: 'https://club.test', baseFrom: BASE });
  ok('with it off, the run writes to nobody', first.length === 0 || first.every((l) => l.written === 0));
  await renewals.setReminders(doug.id, whanganui.id, true);
  ok('an administrator can', (await renewals.reminderSetting(whanganui.id)) === true);
  ok('and it is in the history', (await one(`select after from audit_log where action='reminders_setting' order by id desc limit 1`)).after.enabled === true);
}

console.log('\nTHE DAILY RUN');
{
  // A clean slate for the club so the numbers are about this test.
  await pool.query(`delete from message_recipient where message_id in (select id from message where organisation_id=$1)`, [whanganui.id]);
  await pool.query(`delete from message where organisation_id=$1`, [whanganui.id]);
  const never = await member('Never', { paidUntil: null });
  await member('Paidup', { paidUntil: await daysFrom(300) });
  const ancient = await member('Ancient', { paidUntil: await daysFrom(-200) });
  const dueA = await member('Duea', { paidUntil: await daysFrom(20) });
  const lateA = await member('Latea', { paidUntil: await daysFrom(-25) });

  const mem = new MemoryMessenger();
  const rep = await reminders.run({ messenger: mem, origin: 'https://club.test', baseFrom: BASE });
  const line = rep.find((l) => l.club === 'whanganui');
  const msgs = await q(`select subject, sent_by, kind from message where organisation_id=$1 order by subject`, [whanganui.id]);
  ok('two messages: due soon, and run out', msgs.length === 2 && msgs.every((m) => m.kind === 'renewal'), JSON.stringify(msgs));
  ok('sent by nobody in particular', msgs.every((m) => m.sent_by === null));
  ok('due members got the due words', /due soon/.test(mem.to('duea@remind.test')[0]?.subject ?? ''));
  ok('lapsed members got the run-out words', /run out/.test(mem.to('latea@remind.test')[0]?.subject ?? ''));
  ok('nobody with no date was written to', mem.to('never@remind.test').length === 0);
  ok('nobody 200 days overdue was written to', mem.to('ancient@remind.test').length === 0);
  ok('nobody not charged was written to', mem.to('lifer@remind.test').length === 0);
  ok('nobody paid up was written to', mem.to('paidup@remind.test').length === 0);
  ok('the report says how many', line.written >= 4 && line.skipped === null, JSON.stringify(line));

  const again = new MemoryMessenger();
  await reminders.run({ messenger: again, origin: 'https://club.test', baseFrom: BASE });
  ok('running it again writes to nobody twice', again.sent.length === 0, String(again.sent.length));

  // Another club, switched on, with no contact email: its problem is its own.
  await renewals.setReminders(tane.id, wellington.id, true);
  const w = new MemoryMessenger();
  const rep2 = await reminders.run({ messenger: w, origin: 'https://club.test', baseFrom: BASE });
  const wl = rep2.find((l) => l.club === 'wellington');
  ok('a club with no contact email is skipped, with the reason', wl && /contact email/.test(wl.skipped ?? ''), JSON.stringify(wl));
  ok('and does not stop the others', rep2.some((l) => l.club === 'whanganui'));

  // Resuming: something queued and never sent is finished by the next run.
  const left = await member('Leftover', { paidUntil: await daysFrom(-4) });
  const queued = await messages.prepare(null, whanganui.id, { audience: 'selected', kind: 'renewal', personIds: [left.id],
    subject: 'Left behind', body: 'Hello {club}', eventId: null, personNumber: null }, { baseFrom: BASE, trusted: true });
  const resumed = new MemoryMessenger();
  await reminders.run({ messenger: resumed, origin: 'https://club.test', baseFrom: BASE });
  ok('a half-sent message is finished, not remade', resumed.to('leftover@remind.test').length === 1
    && (await one('select count(*)::int as n from message where subject=$1', ['Left behind'])).n === 1);
  ok('and that is in the record', (await one(`select status from message_recipient where message_id=$1`, [queued.message.id])).status === 'sent');
}

console.log('\nTHE SCHEDULER\'S DOOR');
{
  const get = (headers = {}) => fetch(`${base}/cron/renewals`, { headers, redirect: 'manual' });
  delete process.env.CRON_SECRET;
  ok('shut when no secret is set, even with a guess', (await get({ authorization: 'Bearer ' })).status === 403);
  ok('shut when no secret is set, with nothing', (await get()).status === 403);
  process.env.CRON_SECRET = 'the-real-secret';
  ok('shut without the secret', (await get()).status === 403);
  ok('shut with the wrong one', (await get({ authorization: 'Bearer nope-nope-nope!' })).status === 403);
  ok('shut with one of a different length', (await get({ authorization: 'Bearer x' })).status === 403);
  const open = await get({ authorization: 'Bearer the-real-secret' });
  ok('open with the right one', open.status === 200, String(open.status));
  ok('and reports what it did', /"club"/.test(await open.text()));
}

console.log('\nTHE SCREEN');
{
  const jarC = {};
  const cookie = () => Object.entries(jarC).map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) { const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jarC[k]; else jarC[k] = v; } };
  const req = async (p, { method = 'GET', form } = {}) => {
    const headers = {}; if (cookie()) headers.cookie = cookie();
    if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(base + p, { method, headers, redirect: 'manual',
      body: form ? new URLSearchParams({ _csrf: jarC.honbu_csrf ?? '', ...form }).toString() : undefined });
    keep(res); return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  };
  const auth = await import('./auth.mjs');
  await req('/signin'); const { token } = await auth.requestLink('doug@example.nz'); await req(`/signin/${token}`);

  const s = await req('/o/whanganui/renewals');
  ok('the renewals screen offers a reminder', s.status === 200 && /Remind the ticked/.test(s.html) && /Last reminded/.test(s.html));
  ok('with words already written', /membership fees are due soon/.test(s.html));
  ok('and the automatic switch', /Automatic reminders/.test(s.html));
  const target = await member('Screenremind', { paidUntil: await daysFrom(-2) });
  const go = await req('/o/whanganui/renewals', { method: 'POST', form: { action: 'remind', [`pick_${target.aff}`]: '1', subject: 'Pay up', body: 'Please see {payLink}' } });
  ok('sending goes to the message, which shows who it reached', go.status === 302 && /\/messages\/[0-9a-f-]{36}$/.test(go.location ?? ''), `${go.status} ${go.location}`);
  const d = await req(go.location);
  ok('and shows them', /Screenremind|Remindtest/.test(d.html));
  const forged = await req('/o/whanganui/messages', { method: 'POST', form: { audience: 'selected', kind: 'renewal', subject: 'Sneaky', body: 'Whole club please' } });
  ok('the compose screen cannot be bent into a fees reminder to anybody it likes', forged.status === 422, `${forged.status}`);
  ok('nor can a fees reminder go to the whole club from there', (await req('/o/whanganui/messages', { method: 'POST', form: { audience: 'members', kind: 'renewal', subject: 'Sneaky', body: 'x' } })).status === 422);
  ok('and nothing was sent', (await one(`select count(*)::int as n from message where subject='Sneaky'`)).n === 0);
  const none = await req('/o/whanganui/renewals', { method: 'POST', form: { action: 'remind', subject: 'x', body: 'y' } });
  ok('ticking nobody says so', none.status === 422 && /Tick the people/.test(none.html));
  const off = await req('/o/whanganui/renewals/reminders', { method: 'POST', form: { enabled: '0' } });
  ok('the switch works from the screen', off.status === 302 && (await renewals.reminderSetting(whanganui.id)) === false);
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
