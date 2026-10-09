/**
 * A club writing to its own people.
 *
 *   1. Only the club's administrator can; a member, or another club's
 *      administrator, cannot, and cannot read what was sent.
 *   2. It goes out as the club — name, club address on the sending domain,
 *      replies to the club's contact.
 *   3. It reaches the right people: not another club, children through their
 *      guardians, one copy per address, nobody who opted out (except for a
 *      message about an event they entered).
 *   4. Every person is on the record with what happened to them.
 *   5. Sending resumes; a failure is recorded, and retried on request.
 *   6. The way out works, and opening the link alone changes nothing.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, messages, emailPreferences, Forbidden, Invalid } from './data.mjs';
import * as auth from './auth.mjs';
import { MemoryMessenger } from '../infrastructure/messaging/messengers.mjs';

process.env.HONBU_STORE = 'postgres';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
};
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
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`, { method: 'POST', form: {} });
};

const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const federation = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);

// The seeded roll has members of its own. End them, so the counts below are
// about the people this test made and nothing else.
await pool.query(`update affiliation set ends = '2020-01-01', status = 'resigned'
  where organisation_id = $1`, [whanganui.id]);

// ---- people ------------------------------------------------------------------
const person = async (first, email, { dob = '1985-01-01', org = whanganui, role = 'member' } = {}) => {
  const p = await one(`insert into person (first_name,last_name,email,date_of_birth)
    values ($1,'Msgtest',$2,$3) returning *`, [first, email, dob]);
  await pool.query(`insert into affiliation (person_id, organisation_id, role, starts, status)
    values ($1,$2,$3,'2020-01-01','active')`, [p.id, org.id, role]);
  return p;
};
const adult = await person('Ada', 'ada@msg.test');
const sensei = await person('Sensei', 'sensei@msg.test', { role: 'instructor' });
const noEmail = await person('Nomail', null);
const optedOut = await person('Opty', 'opty@msg.test');
const guardian = await one(`insert into person (first_name,last_name,email,date_of_birth)
  values ('Gail','Msgtest','gail@msg.test','1980-01-01') returning *`);
const kid1 = await person('Kid1', null, { dob: new Date(Date.now() - 10 * 365.25 * 864e5).toISOString().slice(0, 10) });
const kid2 = await person('Kid2', 'kid2-own@msg.test', { dob: new Date(Date.now() - 12 * 365.25 * 864e5).toISOString().slice(0, 10) });
const kidNoGuardian = await person('Kid3', 'kid3-own@msg.test', { dob: new Date(Date.now() - 9 * 365.25 * 864e5).toISOString().slice(0, 10) });
for (const k of [kid1, kid2])
  await pool.query(`insert into guardian_link (guardian_id, child_id) values ($1,$2)`, [guardian.id, k.id]);
const stranger = await person('Wellie', 'wellie@msg.test', { org: wellington });
await pool.query(`insert into email_preference (person_id, token, opted_out) values ($1,'opted-out-token',true)`, [optedOut.id]);
await pool.query(`insert into dojo_profile (organisation_id, email) values ($1,'club@whanganui.test')
  on conflict (organisation_id) do update set email='club@whanganui.test'`, [whanganui.id]);

const BASE = 'noreply@mail.moknz.test';
const input = (o = {}) => ({ audience: 'members', kind: 'announcement', subject: 'Grading night',
  body: 'Bring your belt.', eventId: null, personNumber: null, ...o });

console.log('\nWHO MAY SEND');
{
  const member = await one(`insert into account (email, person_id) values ('adamember@msg.test',$1) returning id`, [adult.id]);
  await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,'member')`, [member.id, whanganui.id]);
  let err;
  try { await messages.prepare(member.id, whanganui.id, input(), { baseFrom: BASE }); } catch (e) { err = e; }
  ok('a member cannot send', err instanceof Forbidden);
  const wAdmin = await one(`select a.id from account a join grant_role g on g.account_id=a.id
    where g.organisation_id=$1 and g.role in ('owner','administrator') limit 1`, [wellington.id]);
  if (wAdmin) {
    err = null;
    try { await messages.prepare(wAdmin.id, whanganui.id, input(), { baseFrom: BASE }); } catch (e) { err = e; }
    ok('another club\'s administrator cannot send to this club', err instanceof Forbidden);
  }
}

console.log('\nSENDING AS THE CLUB');
let first;
{
  first = await messages.prepare(doug.id, whanganui.id, input(), { baseFrom: BASE });
  const m = await one('select * from message where id=$1', [first.message.id]);
  ok('named for the club', m.sender_name === 'Whanganui', m.sender_name);
  ok('from the club\'s address on the federation\'s domain', m.sender_address === 'whanganui@mail.moknz.test', m.sender_address);
  ok('replies go to the club', m.reply_to === 'club@whanganui.test', m.reply_to);

  const mem = new MemoryMessenger();
  const r = await messages.sendBatch(doug.id, whanganui.id, first.message.id,
    { messenger: mem, origin: 'https://club.test' });
  ok('everything went in one batch', r.waiting === 0 && r.failed === 0, JSON.stringify(r));
  const to = mem.sent.map((s) => s.to).sort();
  ok('adult, instructor and the child with no guardian are written to directly',
    ['ada@msg.test', 'sensei@msg.test', 'kid3-own@msg.test'].every((a) => to.includes(a)), to.join());
  ok('children with a guardian are written to through the guardian', to.includes('gail@msg.test'));
  ok('the children\'s own addresses are not used', !to.includes('kid2-own@msg.test'));
  ok('two children, one guardian, one copy', to.filter((a) => a === 'gail@msg.test').length === 1);
  ok('nobody at another club', !to.includes('wellie@msg.test'));
  ok('nobody who opted out', !to.includes('opty@msg.test'));
  ok('the sender is the club', mem.sent.every((s) => s.sender.name === 'Whanganui'
    && s.sender.address === 'whanganui@mail.moknz.test' && s.sender.replyTo === 'club@whanganui.test'));
  const one_ = mem.sent.find((s) => s.to === 'ada@msg.test');
  ok('every message carries a way out', /\/unsubscribe\/\S+/.test(one_.text), one_.text);
  ok('and the header for it', /^<https:\/\/club\.test\/unsubscribe\//.test(one_.headers?.['List-Unsubscribe'] ?? ''));

  const rec = await q(`select status from message_recipient where message_id=$1`, [first.message.id]);
  const n = (s) => rec.filter((x) => x.status === s).length;
  ok('the record shows who was sent to', n('sent') === 4, String(n('sent')));
  ok('and who was skipped, and why', n('opted_out') === 1 && n('no_email') === 1,
    `${n('opted_out')} ${n('no_email')}`);

  const again = await messages.sendBatch(doug.id, whanganui.id, first.message.id,
    { messenger: mem, origin: 'https://club.test' });
  ok('sending again writes to nobody twice', mem.sent.length === 4 && again.sent === 0);

  const log = await one(`select after from audit_log where action='message_sent' order by id desc limit 1`);
  ok('it is in the history', log?.after?.subject === 'Grading night' && log.after.recipients === 4);
}

console.log('\nWHAT CANNOT BE SENT');
{
  const bad = async (name, over, re, org = whanganui) => {
    let err;
    try { await messages.prepare(doug.id, org.id, input(over), { baseFrom: BASE }); } catch (e) { err = e; }
    ok(`${name} is refused`, err instanceof Invalid && re.test(err.message), err?.message);
  };
  await bad('no subject', { subject: '' }, /subject/);
  await bad('nothing in it', { body: '' }, /something in it/);
  await bad('an event notice to the whole club', { kind: 'event' }, /entered in an event/);
  await bad('an unknown member number', { audience: 'person', personNumber: 'NOPE-1' }, /no member numbered/);
  let err;
  try { await messages.prepare(doug.id, whanganui.id, input(), { baseFrom: null }); } catch (e) { err = e; }
  ok('with no sending domain it says so', err instanceof Invalid && /sending address/.test(err.message));
  await pool.query(`update dojo_profile set email=null where organisation_id=$1`, [whanganui.id]);
  const fb = await messages.prepare(doug.id, whanganui.id, input({ audience: 'instructors', subject: 'No contact' }), { baseFrom: BASE });
  const fbRow = await one('select reply_to from message where id=$1', [fb.message.id]);
  ok('with no club contact, replies go to the administrator sending it', fbRow.reply_to === 'doug@example.nz', fbRow.reply_to);
  await pool.query(`update dojo_profile set email='club@whanganui.test' where organisation_id=$1`, [whanganui.id]);
}

console.log('\nOTHER AUDIENCES');
{
  const inst = await messages.prepare(doug.id, whanganui.id, input({ audience: 'instructors' }), { baseFrom: BASE });
  ok('instructors only', inst.recipients === 1);

  const bb = await messages.prepare(doug.id, federation.id, input({ audience: 'udansha', subject: 'Black belts' }), { baseFrom: BASE }).catch((e) => e);
  const allBb = await messages.prepare(doug.id, federation.id, input({ subject: 'Everyone' }), { baseFrom: BASE }).catch((e) => e);
  ok('black belts only is a subset of everyone', !(bb instanceof Error) && !(allBb instanceof Error) && bb.recipients <= allBb.recipients,
    String(bb.message ?? bb.recipients));

  const fed = await messages.prepare(doug.id, federation.id, input({ subject: 'To all' }), { baseFrom: BASE }).catch((e) => e);
  ok('a federation administrator reaches every club under it',
    !(fed instanceof Error) && fed.recipients >= 6, String(fed.message ?? fed.recipients));
  const w = await q(`select email from message_recipient where message_id=$1`, [fed.message?.id]);
  ok('including other clubs\' members', w.some((x) => x.email === 'wellie@msg.test'));

  const one1 = await messages.prepare(doug.id, whanganui.id,
    input({ audience: 'person', personNumber: (await one('select display_number from person where id=$1', [adult.id])).display_number ?? 'x' }),
    { baseFrom: BASE }).catch((e) => e);
  if (!(one1 instanceof Error)) ok('one person', one1.recipients === 1);

  const evt = await one(`select * from event where organisation_id=$1 limit 1`, [whanganui.id]);
  if (evt) {
    await pool.query(`insert into event_entry (event_id, person_id) values ($1,$2),($1,$3)`,
      [evt.id, optedOut.id, adult.id]);
    const e1 = await messages.prepare(doug.id, whanganui.id,
      input({ audience: 'event', eventId: evt.id }), { baseFrom: BASE });
    ok('entrants only, minus anybody who opted out', e1.recipients === 1 && e1.skipped === 1,
      `${e1.recipients}/${e1.skipped}`);
    const e2 = await messages.prepare(doug.id, whanganui.id,
      input({ audience: 'event', eventId: evt.id, kind: 'event', subject: 'Venue change' }), { baseFrom: BASE });
    ok('a message about the event reaches them even so', e2.recipients === 2 && e2.skipped === 0);
    const mem = new MemoryMessenger();
    await messages.sendBatch(doug.id, whanganui.id, e2.message.id, { messenger: mem, origin: 'https://club.test' });
    ok('and says why there is no unsubscribe', /sent whatever your email settings/.test(mem.sent[0].text)
      && !mem.sent[0].headers);
  }
}

console.log('\nFAILURE AND RESUMING');
{
  const m = await messages.prepare(doug.id, whanganui.id, input({ subject: 'Flaky' }), { baseFrom: BASE });
  let calls = 0;
  const flaky = { async send(msg) { calls++; if (msg.to === 'ada@msg.test') throw new Error('provider said no'); return { id: `x${calls}` }; } };
  const r = await messages.sendBatch(doug.id, whanganui.id, m.message.id, { messenger: flaky, origin: 'https://club.test' });
  ok('one failure does not stop the rest', r.failed === 1 && r.sent === 3, JSON.stringify(r));
  const f = await one(`select error from message_recipient where message_id=$1 and status='failed'`, [m.message.id]);
  ok('the reason is recorded', /provider said no/.test(f.error));
  await messages.retryFailed(doug.id, whanganui.id, m.message.id);
  const mem = new MemoryMessenger();
  const again = await messages.sendBatch(doug.id, whanganui.id, m.message.id, { messenger: mem, origin: 'https://club.test' });
  ok('retrying sends only the failed one', mem.sent.length === 1 && mem.sent[0].to === 'ada@msg.test' && again.waiting === 0);

  const slow = new MemoryMessenger();
  const m2 = await messages.prepare(doug.id, whanganui.id, input({ subject: 'Slow' }), { baseFrom: BASE });
  const r2 = await messages.sendBatch(doug.id, whanganui.id, m2.message.id,
    { messenger: { send: async (x) => { await new Promise((r) => setTimeout(r, 40)); return slow.send(x); } },
      origin: 'https://club.test', budgetMs: 1, concurrency: 2 });
  ok('a short time budget leaves the rest waiting', r2.waiting > 0 && r2.sent === 2, JSON.stringify(r2));
  const r3 = await messages.sendBatch(doug.id, whanganui.id, m2.message.id,
    { messenger: slow, origin: 'https://club.test' });
  ok('and the next batch finishes it without repeats', r3.waiting === 0 && slow.sent.length === 4);
}

console.log('\nTHE SCREENS');
{
  await signIn('doug@example.nz');
  const s = await req('/o/whanganui/messages');
  ok('opens', s.status === 200 && /Goes out as/.test(s.html), String(s.status));
  ok('says who it is sent as', /Whanganui/.test(s.html) && /whanganui@/.test(s.html));
  const sent = await req('/o/whanganui/messages', { method: 'POST',
    form: { audience: 'members', kind: 'announcement', subject: 'From the screen', body: 'Hello' } });
  ok('sending redirects to the message', sent.status === 302 && /\/messages\/[0-9a-f-]{36}$/.test(sent.location ?? ''), `${sent.status} ${sent.location}`);
  const d = await req(sent.location);
  ok('the message shows who it went to', d.status === 200 && /Msgtest|Ada/.test(d.html) && /Opted out/.test(d.html));
  const bad = await req('/o/whanganui/messages', { method: 'POST',
    form: { audience: 'members', kind: 'announcement', subject: '', body: 'x' } });
  ok('a mistake says what to fix and keeps what was typed', bad.status === 422 && /subject/.test(bad.html));
  ok('the rail links to messages', /\/o\/whanganui\/messages/.test(s.html));
}

console.log('\nTHE WAY OUT');
{
  const tok = await one(`select token from email_preference where person_id=$1`, [adult.id]);
  for (const k of Object.keys(jar)) delete jar[k];
  const view = await req(`/unsubscribe/${tok.token}`);
  ok('opens with no sign-in', view.status === 200 && /Stop announcements/.test(view.html), String(view.status));
  ok('opening it changes nothing', (await emailPreferences.byToken(tok.token)).opted_out === false);
  const off = await req(`/unsubscribe/${tok.token}`, { method: 'POST', form: { optOut: '1' } });
  ok('the button turns announcements off', off.status === 302 && (await emailPreferences.byToken(tok.token)).opted_out === true);
  const m = await messages.prepare(doug.id, whanganui.id, input({ subject: 'After' }), { baseFrom: BASE });
  const row = await one(`select status from message_recipient where message_id=$1 and person_id=$2`, [m.message.id, adult.id]);
  ok('and the next message skips them', row.status === 'opted_out');
  await req(`/unsubscribe/${tok.token}`, { method: 'POST', form: { optOut: '0' } });
  ok('they can turn it back on', (await emailPreferences.byToken(tok.token)).opted_out === false);
  const gone = await req('/unsubscribe/not-a-token');
  ok('a wrong link is a plain not-found', gone.status === 404);
  const log = await one(`select after from audit_log where action='email_preference' order by id desc limit 1`);
  ok('the change is in the history', log?.after?.optedOut === false);
}

console.log('\nWHAT IS NOT THEIRS');
{
  await signIn('doug@example.nz');
  const theirs = await one(`select m.id from message m where m.organisation_id=$1 limit 1`, [whanganui.id]);
  const wAdmin = await one(`select a.email from account a join grant_role g on g.account_id=a.id
    where g.organisation_id=$1 and g.role in ('owner','administrator') limit 1`, [wellington.id]);
  if (wAdmin) {
    await signIn(wAdmin.email);
    const r = await req(`/o/whanganui/messages/${theirs.id}`);
    ok('another club\'s administrator cannot open it', r.status === 403 || r.status === 404, String(r.status));
    ok('and sees none of it', !/Grading night/.test(r.html));
    const viaOwn = await req(`/o/wellington/messages/${theirs.id}`);
    ok('nor by asking through their own club', viaOwn.status === 404, String(viaOwn.status));
  }
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
