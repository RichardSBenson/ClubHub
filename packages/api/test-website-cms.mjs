/**
 * Website CMS: enquiries from public forms, and scheduled publishing.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, pages, news, enquiries, scheduledPublishing, TooMany, Forbidden, Invalid } from './data.mjs';
import * as auth from './auth.mjs';
import { MemoryMessenger } from '../infrastructure/messaging/messengers.mjs';
import { documentFromText } from '../content/document-text.mjs';

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

const whanganui = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const doug = (await one(`select id from account where email='doug@example.nz'`)).id;
const today = (await one(`select to_char((now() at time zone 'Pacific/Auckland')::date,'YYYY-MM-DD') as d`)).d;
const day = async (n) => (await one(`select to_char($1::date + $2::int,'YYYY-MM-DD') as d`, [today, n])).d;
await pool.query(`update organisation set timezone='Pacific/Auckland' where id in ($1,$2)`, [whanganui.id, wellington.id]);

let seq = 0;
const account = async (org, role) => {
  const p = await one(`insert into person (display_number, first_name, last_name, email) values ($1,$2,'Webtest',$3) returning id`,
    [`WC-${++seq}`, role, `${role}${seq}@web.test`]);
  const a = await one(`insert into account (email, person_id) values ($1,$2) returning id`, [`${role}${seq}@web.test`, p.id]);
  await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,$3)`, [a.id, org.id, role]);
  return a.id;
};
const admin = await account(whanganui, 'administrator');
const registrar = await account(whanganui, 'registrar');
const wellReg = await account(wellington, 'registrar');
await pool.query(`insert into dojo_profile (organisation_id, email) values ($1,'club@whanganui.test') on conflict (organisation_id) do update set email='club@whanganui.test'`, [whanganui.id]);

console.log('\nENQUIRIES');
const mail = new MemoryMessenger();
const good = { kind: 'trial', name: 'Kiri', email: 'kiri@example.nz', phone: '021 555', who: 'my son, 8', message: 'Do you have a Tuesday class?' };
const r = await enquiries.submit({ slug: 'whanganui', input: good, ipHash: 'ip-a', messenger: mail, baseFrom: 'noreply@honbu.test' });
ok('stored and emailed', r.emailed && mail.sent.length === 1);
ok('goes to the club contact address', mail.sent[0].to === 'club@whanganui.test');
ok('replies go to the visitor', mail.sent[0].sender?.replyTo === 'kiri@example.nz');
ok('visitor text only in the body, not the headers', !/Kiri/.test(mail.sent[0].sender?.address ?? ''));

await pool.query(`delete from dojo_profile where organisation_id=$1`, [whanganui.id]);
const m2 = new MemoryMessenger();
await enquiries.submit({ slug: 'whanganui', input: { ...good, name: 'Hemi', email: 'hemi@example.nz' }, ipHash: 'ip-b', messenger: m2, baseFrom: 'noreply@honbu.test' });
ok('falls back to owners and administrators when no contact address', m2.sent.length >= 1 && m2.sent.every((m) => m.to !== 'club@whanganui.test'));

const failing = { send: async () => { throw new Error('provider down'); } };
const r3 = await enquiries.submit({ slug: 'whanganui', input: { ...good, name: 'Aroha', email: 'aroha@example.nz' }, ipHash: 'ip-c', messenger: failing, baseFrom: 'noreply@honbu.test' });
ok('kept even when email fails', !r3.emailed && !!(await one(`select 1 from enquiry where id=$1`, [r3.id])));
ok('an invalid enquiry is refused', await rejects(enquiries.submit({ slug: 'whanganui', input: { ...good, email: 'nope' }, ipHash: 'x', messenger: mail, baseFrom: 'a@b.nz' }), Invalid));
ok('an unknown club is not found', await rejects(enquiries.submit({ slug: 'nowhere', input: good, ipHash: 'x', messenger: mail, baseFrom: 'a@b.nz' }), Error));
let limited = false;
for (let i = 0; i < 6; i++) {
  try { await enquiries.submit({ slug: 'whanganui', input: { ...good, name: `Spam${i}` }, ipHash: 'ip-spam', messenger: mail, baseFrom: 'a@b.nz' }); }
  catch (e) { limited = e instanceof TooMany && e.status === 429; }
}
ok('one visitor is rate limited', limited);

console.log('\nINBOX');
const inbox = await enquiries.inbox(registrar, whanganui.id);
ok('registrar sees them, new first', inbox.rows.length >= 3 && inbox.waiting === inbox.rows.length);
ok('another club sees none of them', (await enquiries.inbox(wellReg, wellington.id)).rows.length === 0);
ok('a registrar elsewhere cannot read this club', await rejects(enquiries.inbox(wellReg, whanganui.id), Forbidden));
await enquiries.mark(registrar, whanganui.id, inbox.rows[0].id, true);
ok('marked handled', (await enquiries.inbox(registrar, whanganui.id)).waiting === inbox.waiting - 1);
await enquiries.remove(registrar, whanganui.id, inbox.rows[0].id);
ok('deleted and audited', !(await one(`select 1 from enquiry where id=$1`, [inbox.rows[0].id])) && !!(await one(`select 1 from audit_log where action='enquiry_deleted'`)));
ok("cannot delete another club's", await rejects(enquiries.remove(wellReg, wellington.id, inbox.rows[1].id), Error, /Enquiry/));

console.log('\nTIDY');
await pool.query(`update enquiry set created_at = now() - interval '3 days'`);
await enquiries.tidy();
ok('visitor address forgotten after two days', (await one(`select count(*)::int n from enquiry where ip_hash is not null`)).n === 0);
await pool.query(`update enquiry set created_at = now() - interval '400 days'`);
await enquiries.tidy();
ok('old enquiries deleted after a year', (await one(`select count(*)::int n from enquiry`)).n === 0);

console.log('\nPUBLIC DOOR');
const post = (path, form, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(form).toString() });
const g = await fetch(base + '/enquire/whanganui');
ok('form page loads', g.status === 200 && /name="website"/.test(await g.text()));
ok('unknown club 404', (await fetch(base + '/enquire/nowhere')).status === 404);
const host = new URL(base).host;
let res = await post('/enquire/whanganui', { kind: 'contact', name: 'Web', email: 'web@example.nz', message: 'Hello' }, { origin: base });
ok('same-site post redirects to thanks', res.status === 302 && /thanks/.test(res.headers.get('location')));
ok('...and is stored', !!(await one(`select 1 from enquiry where name='Web'`)));
res = await post('/enquire/whanganui', { kind: 'contact', name: 'Evil', email: 'e@example.nz', message: 'Hi' }, { origin: 'https://evil.example' });
ok('cross-site post refused', res.status === 403 && !(await one(`select 1 from enquiry where name='Evil'`)));
res = await post('/enquire/whanganui', { kind: 'contact', name: 'Bot', email: 'b@example.nz', message: 'Hi', website: 'http://spam' }, { origin: base });
ok('honeypot: looks like success, stores nothing', res.status === 302 && !(await one(`select 1 from enquiry where name='Bot'`)));
res = await post('/enquire/whanganui', { kind: 'contact', name: '', email: 'bad', message: '' }, { origin: base });
ok('invalid shows a message', res.status === 422 && /name/i.test(await res.text()));

console.log('\nSCHEDULED PUBLISHING');
const doc = documentFromText('Hello there.');
const mk = async () => (await pages.save(admin, { pageId: null, organisationId: whanganui.id, slug: `sched-${++seq}`, title: `Sched ${seq}`, body: doc, note: 'x' })).page;
const pg = await mk();
ok('schedules a draft', (await pages.schedule(admin, pg.id, await day(3))).date === await day(3));
ok('scheduledFor reads it back', (await pages.scheduledFor(pg.id)) === await day(3));
ok('a past date is refused', await rejects(pages.schedule(admin, pg.id, await day(-1)), Invalid, /gone/));
ok('too far ahead refused', await rejects(pages.schedule(admin, pg.id, await day(400)), Invalid, /year/));
ok('nonsense refused', await rejects(pages.schedule(admin, pg.id, '2026-13-45'), Invalid));
ok('a registrar cannot schedule', await rejects(pages.schedule(registrar, pg.id, await day(3)), Forbidden));
ok('not due yet: run does nothing', (await scheduledPublishing.run()).length === 0);
await pool.query(`update page set publish_at = now() - interval '1 minute' where id=$1`, [pg.id]);
const made = await scheduledPublishing.run();
ok('due draft goes live', made.length === 1 && (await one(`select status from page where id=$1`, [pg.id])).status === 'published');
ok('schedule cleared after', (await one(`select publish_at from page where id=$1`, [pg.id])).publish_at === null);
ok('audited with no account', !!(await one(`select 1 from audit_log where action='published_on_schedule' and account_id is null`)));
ok('a live page cannot be scheduled', await rejects(pages.schedule(admin, pg.id, await day(2)), Invalid, /already live/));

const pg2 = await mk();
await pages.schedule(admin, pg2.id, await day(2));
await pages.unschedule(admin, pg2.id);
ok('unscheduled', (await pages.scheduledFor(pg2.id)) === null);
await pages.schedule(admin, pg2.id, await day(2));
await pages.publish(admin, pg2.id);
ok('publishing by hand clears the schedule', (await one(`select publish_at from page where id=$1`, [pg2.id])).publish_at === null);

const art = (await news.save(admin, { articleId: null, organisationId: whanganui.id, slug: 'sched-news', title: 'Sched news', summary: null, body: doc, heroAssetId: null, tags: [] })).article;
await news.schedule(admin, art.id, await day(1));
await pool.query(`update article set publish_at = now() - interval '1 minute' where id=$1`, [art.id]);
await scheduledPublishing.run();
ok('news goes live on schedule too', (await one(`select status from article where id=$1`, [art.id])).status === 'published');

console.log('\nCRON DOOR');
delete process.env.CRON_SECRET;
ok('shut when no secret is set', (await fetch(base + '/cron/publish')).status === 403);
process.env.CRON_SECRET = 'sekrit';
ok('shut with wrong secret', (await fetch(base + '/cron/publish', { headers: { authorization: 'Bearer nope' } })).status === 403);
ok('open with the secret', (await fetch(base + '/cron/publish', { headers: { authorization: 'Bearer sekrit' } })).status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
