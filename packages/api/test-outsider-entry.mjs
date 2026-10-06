/**
 * Entering an open event from outside: no roll, no club, no account yet.
 *
 *   1. Only an event its organiser opened to outsiders can be reached.
 *   2. "Have you entered before?" answers identically for known and unknown.
 *   3. A known person gets a sign-in link; an unknown one a link to register once.
 *   4. A person is created once; the same address never makes a second.
 *   5. A returning outsider gets the one-click screen, with grade and club remembered.
 *   6. A tampered, wrong-event or expired token is refused.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people, competition } from './data.mjs';
import * as auth from './auth.mjs';
import { sharedMemoryMessenger } from '../infrastructure/messaging/messengers.mjs';
import { signEntryToken } from './entry-token.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CRON_SECRET = 'test-secret';
const OUT = '/tmp/honbu-member-entries';
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
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
               : undefined });
  keep(res);
  return { status: res.status, location: res.headers.get('location'),
           headers: res.headers, html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`);
};
const build = async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await run(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..') });
};
const wh = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, {
  organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });


const addEvent = async (org, over = {}) => one(`
  insert into event (organisation_id, kind, title, slug, starts_at, visibility, status,
    entries_open, entries_close, guardian_under, consent_version, consent_text)
  values ($1,$2,$3,$4, now() + interval '40 days', $5, $6,
    now() - interval '1 day', $7, $8, $9, $10) returning *`,
  [org.id, over.kind ?? 'grading', over.title, over.slug, over.visibility ?? 'public',
   over.status ?? 'published',
   over.close ?? new Date(Date.now() + 30 * 864e5).toISOString(),
   over.guardianUnder ?? 16, over.consent === null ? null : 'v1',
   over.consent === null ? null : 'I accept the risks of training.']);



const mail = sharedMemoryMessenger();
const tourney = async (title, slug, { consent = null, open = true, divisions } = {}) => {
  const e = await addEvent(wh, { title, slug, kind: 'tournament', guardianUnder: 18, consent });
  await pool.query(`update event set guests_allowed=$2 where id=$1`, [e.id, open]);
  const d = await competition.addDiscipline(doug.id, e.id, { name: 'Kumite' });
  for (const dv of divisions ?? [{ label: 'Open 60-80', minWeightKg: 60, maxWeightKg: 80 }])
    await competition.addDivision(doug.id, d.id, dv);
  await competition.setPrice(doug.id, e.id, { forCount: 1, amountCents: 2000, membersOnly: true });
  await competition.setPrice(doug.id, e.id, { forCount: 1, amountCents: 3000 });
  return e;
};
const signOut = () => { delete jar.honbu_session; };
const linkFor = (to) => mail.to(to).at(-1)?.text.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/^https?:\/\/[^/]+/, '') ?? null;

const open1 = await tourney('Open Door One', 'open-door-1');
const closedToOutsiders = await tourney('Members Only Cup', 'members-cup', { open: false });
const E = `/enter/whanganui/${open1.slug}`;

console.log('\nONLY WHAT IS OPEN TO OUTSIDERS');
{
  ok('an open event has a front door', (await req(E)).status === 200);
  ok('a members-only event does not', (await req(`/enter/whanganui/${closedToOutsiders.slug}`)).status === 404);
  ok('nor an unknown club', (await req(`/enter/nowhere/${open1.slug}`)).status === 404);
  ok('nor a draft', (await req('/enter/whanganui/wh-draft')).status === 404);
}

console.log('\nTHE QUESTION ANSWERS THE SAME FOR EVERYBODY');
// Somebody seen at an earlier event who is on no roll: a person, an email, a mobile.
const known = await one(`insert into person (first_name, last_name, date_of_birth, gender, email, phone)
  values ('Hone','Known','1991-04-04','M','hone.known@example.nz','021 555 1234') returning *`);
{
  mail.clear();
  const a = await req(E, { method: 'POST', form: { contact: 'hone.known@example.nz' } });
  const b = await req(E, { method: 'POST', form: { contact: 'brand.new@example.nz' } });
  const c = await req(E, { method: 'POST', form: { contact: '0299999999' } });
  ok('known, unknown and unknown mobile get the same redirect', a.status === 302 && a.location === b.location && b.location === c.location, `${a.location} ${b.location} ${c.location}`);
  ok('known: a sign-in link', /\/signin\//.test(linkFor('hone.known@example.nz') ?? ''));
  ok('unknown: a link to register', /\/new\?t=/.test(linkFor('brand.new@example.nz') ?? ''));
  ok('an unknown mobile has nowhere to send, and nothing is sent', mail.sent.length === 2);
  ok('nobody was created by asking', !(await one(`select 1 from person where email='brand.new@example.nz'`)));
  const empty = await req(E, { method: 'POST', form: { contact: '' } });
  ok('empty is asked again', empty.status === 422);
  const robot = await req(E, { method: 'POST', form: { contact: 'bot@example.nz', website: 'x' } });
  ok('the honeypot looks like success and sends nothing', robot.status === 302 && !mail.to('bot@example.nz').length);
}

console.log('\nA MOBILE FINDS THE SAME PERSON');
{
  mail.clear();
  await req(E, { method: 'POST', form: { contact: '+64 21 555 1234' } });
  ok('a differently written number reaches the email on file', mail.to('hone.known@example.nz').length === 1);
}

console.log('\nA KNOWN PERSON COMES BACK THROUGH THE LINK');
{
  const link = linkFor('hone.known@example.nz');
  const r = await req(link);
  ok('the link signs them in and sends them to the entry', r.status === 302 && /\/enter\/whanganui\/open-door-1\/go/.test(r.location ?? ''), r.location);
  const go = await req(r.location);
  ok('and on to their own screen', go.status === 302 && new RegExp(`/me/events/${open1.id}/${known.id}`).test(go.location ?? ''), go.location);
  const form = await req(go.location);
  ok('first time: the form, with club and grade asked', form.status === 200 && /name="club"/.test(form.html) && /name="grade"/.test(form.html));
  signOut();
}

console.log('\nTOKENS');
const bad = signEntryToken({ email: 'x@example.nz', eventId: open1.id });
{
  ok('a good token opens the form', (await req(`${E}/new?t=${bad}`)).status === 200);
  ok('a tampered token is refused', (await req(`${E}/new?t=${bad.slice(0, -3)}abc`)).status === 403);
  ok('no token is refused', (await req(`${E}/new`)).status === 403);
  const other = signEntryToken({ email: 'x@example.nz', eventId: closedToOutsiders.id });
  ok('a token for another event is refused', (await req(`${E}/new?t=${other}`)).status === 403);
  const old = signEntryToken({ email: 'x@example.nz', eventId: open1.id }, Date.now() - 3 * 3600000);
  ok('an expired token is refused', (await req(`${E}/new?t=${old}`)).status === 403);
}

console.log('\nREGISTERING ONCE');
let newbie;
{
  const t = signEntryToken({ email: 'nia.newbie@example.nz', eventId: open1.id });
  const fields = { t, firstName: 'Nia', lastName: 'Newbie', dateOfBirth: '1995-06-06', gender: 'F', phone: '027 111 2222' };
  const miss = await req(`${E}/new`, { method: 'POST', form: { ...fields, dateOfBirth: '' } });
  ok('missing details are refused with a reason', miss.status === 422 && /date of birth/.test(miss.html));
  const forged = await req(`${E}/new`, { method: 'POST', form: { ...fields, t: 'x.y' } });
  ok('a forged token cannot register', forged.status === 403);
  ok('so nobody is created', !(await one(`select 1 from person where email='nia.newbie@example.nz'`)));
  const r = await req(`${E}/new`, { method: 'POST', form: fields });
  ok('registered, signed in, sent to the entry', r.status === 302 && /\/me\/events\//.test(r.location ?? ''), `${r.status} ${r.location}`);
  newbie = await one(`select * from person where email='nia.newbie@example.nz'`);
  ok('a person exists', !!newbie && newbie.last_name === 'Newbie');
  ok('on no roll', !(await one(`select 1 from affiliation where person_id=$1`, [newbie.id])));
  ok('with a sign-in of their own', !!(await one(`select 1 from account where person_id=$1`, [newbie.id])));
  ok('the address already used is refused a second time', (await req(`${E}/new`, { method: 'POST', form: fields })).status === 422);
  ok('and still only one person', (await pool.query(`select 1 from person where email='nia.newbie@example.nz'`)).rowCount === 1);
}

console.log('\nFIRST ENTRY, NON-MEMBER PRICE');
{
  const disc = (await competition.setupFor(open1.id)).disciplines[0];
  const entryUrl = `/me/events/${open1.id}/${newbie.id}`;
  const form = await req(entryUrl);
  ok('the form opens', form.status === 200 && /Your grade/.test(form.html));
  const noClub = await req(entryUrl, { method: 'POST', form: { [`disc_${disc.id}`]: '1', weight: '70' } });
  ok('club and grade are required', noClub.status === 422 && /club/i.test(noClub.html));
  const grade = (await one(`select rank_order from grade order by rank_order limit 1`)).rank_order;
  const send = { [`disc_${disc.id}`]: '1', weight: '70', height: '170', club: 'Garage Gym', grade: String(grade) };
  const preview = await req(entryUrl, { method: 'POST', form: send });
  ok('checked, at the non-member price', preview.status === 200 && /\$30\.00/.test(preview.html) && !/\$20\.00/.test(preview.html), preview.html.match(/\$\d+\.\d\d/g)?.join(','));
  const done = await req(entryUrl, { method: 'POST', form: { ...send, confirm: 'yes' } });
  ok('entered', done.status === 302, `${done.status} ${done.location}`);
  const e = await one(`select * from event_entry where person_id=$1`, [newbie.id]);
  ok('club and grade kept as their own word', e.club_name === 'Garage Gym' && !!e.declared_grade);
  ok('for no club', e.entered_for_org === null);
  ok('a payment is waiting', !!(await one(`select 1 from payment where event_entry_id=$1 and status='pending'`, [e.id])));
  signIn.last = null;
  await signIn('doug@example.nz');
  const list = await req(`/o/whanganui/events/${open1.slug}/entries`);
  ok('the organiser sees them on the list', list.status === 200 && /Nia/.test(list.html) && /Newbie/.test(list.html));
}

console.log('\nCOMING BACK: ONE CLICK');
const open2 = await tourney('Open Door Two', 'open-door-2');
{
  signOut();
  mail.clear();
  await req(`/enter/whanganui/${open2.slug}`, { method: 'POST', form: { contact: 'nia.newbie@example.nz' } });
  const link = linkFor('nia.newbie@example.nz');
  ok('she is sent a sign-in link, not a registration', /\/signin\//.test(link ?? ''));
  const r = await req(link);
  const go = await req(r.location);
  const screen = await req(go.location);
  ok('the one-click screen, nothing to retype', screen.status === 200 && /Open 60-80/.test(screen.html) && /70(\.\d+)? kg/.test(screen.html) && !/name="club"/.test(screen.html), screen.html.slice(0, 300));
  const list = await req('/me/events');
  ok('and the list has the direct button', new RegExp(`action="/me/events/${open2.id}/${newbie.id}/quick"`).test(list.html));
  const press = await req(`/me/events/${open2.id}/${newbie.id}/quick`, { method: 'POST', form: {} });
  ok('one press enters', press.status === 302, `${press.status} ${press.location}`);
  const e2 = await one(`select * from event_entry where person_id=$1 and event_id=$2`, [newbie.id, open2.id]);
  ok('same weight, same club, same declared grade', Number(e2.weight_kg) === 70 && e2.club_name === 'Garage Gym' && !!e2.declared_grade);
}

console.log('\nA CHILD, ENTERED BY THEIR PARENT');
{
  signOut();
  const open3 = await tourney('Open Door Three', 'open-door-3', { consent: 'v1',
    divisions: [{ label: 'Juniors under 40kg', minAge: 6, maxAge: 17, maxWeightKg: 40 }] });
  const T = `/enter/whanganui/${open3.slug}`;
  const t = signEntryToken({ email: 'parent.of.kid@example.nz', eventId: open3.id });
  const r = await req(`${T}/new`, { method: 'POST', form: { t, firstName: 'Tiny', lastName: 'Fighter', dateOfBirth: '2013-02-02', gender: 'M' } });
  ok('registered', r.status === 302);
  const kid = await one(`select * from person where email='parent.of.kid@example.nz'`);
  const disc = (await competition.setupFor(open3.id)).disciplines[0];
  const grade = (await one(`select rank_order from grade order by rank_order limit 1`)).rank_order;
  const url = `/me/events/${open3.id}/${kid.id}`;
  const form = await req(url);
  ok('the declaration is shown, to be agreed as a guardian', /parent or guardian/.test(form.html));
  const send = { [`disc_${disc.id}`]: '1', weight: '35', club: 'none', grade: String(grade) };
  const unsigned = await req(url, { method: 'POST', form: send });
  ok('unsigned is refused', unsigned.status === 422 && /declaration has not been agreed/.test(unsigned.html));
  const signed = { ...send, accepted: '1', acceptedName: 'Parent Fighter' };
  await req(url, { method: 'POST', form: { ...signed } });
  const done = await req(url, { method: 'POST', form: { ...signed, confirm: 'yes' } });
  ok('entered once the parent agrees', done.status === 302, `${done.status} ${(done.html.match(/<li>[^<]*<\/li>/g) ?? []).join(' ')} ${done.html.match(/class="bad"[^]*?<\/div>/)?.[0]?.replace(/<[^>]+>/g,' ')}`);
  const e = await one(`select * from event_entry where person_id=$1`, [kid.id]);
  const c = e ? await one(`select * from entry_consent where entry_id=$1`, [e.id]) : null;
  ok('recorded as a declared guardian', c?.guardian?.relationship === 'declared guardian' && c.guardian.name === 'Parent Fighter');
}

console.log('\nA MEMBER IS NOT OFFERED THE OUTSIDERS\' LIST');
{
  const list = await (async () => { await signIn('rua.member@example.nz').catch(() => {}); return null; })();
  const { memberEvents } = await import('./data.mjs');
  const m = await enrol('Mem', 'Ber', '1988-08-08', 'mem.ber@example.nz');
  const open = await memberEvents.openFor(m.id);
  ok('a member sees their own club\'s offers (and each only once)', new Set(open.map((x) => x.id)).size === open.length);
  const stranger = await one(`select id from person where email='nia.newbie@example.nz'`);
  const theirs = await memberEvents.openFor(stranger.id);
  ok('an outsider sees only open-to-outsiders events', theirs.every((x) => x.home_org === null));
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
