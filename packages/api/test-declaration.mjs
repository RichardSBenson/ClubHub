/**
 * The federation's one declaration: written once, signed once per person (a parent for a child), and asked for
 * again only when the wording changes. Events do not carry their own copy of it.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import * as auth from './auth.mjs';
import { pool, people, family, declarations } from './data.mjs';
import { needsGuardian, stateOf, problemsWithSigning, problemsWithPublishing, STARTER_DECLARATION } from '../core/domain/declarations.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) { const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jar[k]; else jar[k] = v; } };
async function req(p, { method = 'GET', form } = {}) {
  const headers = {};
  if (cookie()) headers.cookie = cookie();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + p, { method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString() : undefined });
  keep(res);
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e.message ?? String(e); } };
const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`, { method: 'POST', form: {} });
};

const wh = await one(`select * from organisation where slug='whanganui'`);
const root = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob) => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob });
const acc = async (p, email) => (await pool.query(`insert into account (email, person_id) values ($1,$2) returning id`, [email, p.id])).rows[0].id;

console.log('\nTHE RULES');
ok('a child needs a guardian; an adult or unknown age does not', needsGuardian(9) && !needsGuardian(18) && !needsGuardian(null));
ok('nothing published, unsigned, signed', stateOf({ current: null, signed: null }) === 'none' && stateOf({ current: {}, signed: null }) === 'unsigned' && stateOf({ current: {}, signed: {} }) === 'signed');
ok('signing needs the tick and a name', problemsWithSigning({ accepted: false, name: '', isChild: false, how: 'self' }).length === 2);
ok('a child cannot sign for themselves', problemsWithSigning({ accepted: true, name: 'Cleo', isChild: true, how: 'self' }).length === 1);
ok('a parent can sign for a child', problemsWithSigning({ accepted: true, name: 'Pam', isChild: true, how: 'guardian' }).length === 0);
ok('wording needs a version and a body', problemsWithPublishing({ version: '', body: 'short' }).length === 2 && problemsWithPublishing({ version: '1', body: STARTER_DECLARATION }).length === 0);

const adult = await enrol('Ada', 'Adult', '1985-05-05');
const child = await enrol('Cleo', 'Child', new Date(Date.now() - 9 * 365.25 * 864e5).toISOString().slice(0, 10));
const parent = await enrol('Pam', 'Parent', '1980-02-02');
const stranger = await enrol('Sue', 'Stranger', '1990-02-02');
const aa = await acc(adult, 'ada.decl@example.nz'), pa = await acc(parent, 'pam.decl@example.nz'), sa = await acc(stranger, 'sue.decl@example.nz'), ca = await acc(child, 'cleo.decl@example.nz');
await family.link(doug.id, { guardianId: parent.id, childId: child.id, relationship: 'parent' });

console.log('\nBEFORE ANYTHING IS PUBLISHED');
ok('there is nothing to sign', (await declarations.statusFor(adult.id)).state === 'none');
ok('signing says so', /no declaration/.test(await refused(() => declarations.sign(aa, adult.id, { accepted: true, name: 'Ada Adult' })) ?? ''));

console.log('\nPUBLISHING');
ok('an ordinary member cannot publish', !!(await refused(() => declarations.publish(sa, wh.id, { version: '1', body: STARTER_DECLARATION }))));
ok('short wording is refused', /declaration itself/.test(await refused(() => declarations.publish(doug.id, wh.id, { version: '1', body: 'x' })) ?? ''));
await declarations.publish(doug.id, wh.id, { version: '2026.1', body: STARTER_DECLARATION });
ok('the federation\'s official publishes it, from any club', (await declarations.statusFor(adult.id)).current.version === '2026.1');
ok('a version cannot be reused', /already been used/.test(await refused(() => declarations.publish(doug.id, wh.id, { version: '2026.1', body: STARTER_DECLARATION + ' ' })) ?? ''));
ok('now there is something to sign', (await declarations.statusFor(adult.id)).state === 'unsigned');

console.log('\nSIGNING');
ok('no tick, no signature', /Tick the box/.test(await refused(() => declarations.sign(aa, adult.id, { accepted: false, name: 'Ada Adult' })) ?? ''));
ok('a stranger cannot sign for somebody', !!(await refused(() => declarations.sign(sa, adult.id, { accepted: true, name: 'Sue' }))));
await declarations.sign(aa, adult.id, { accepted: true, name: 'Ada Adult', ip: '203.0.113.9' });
const st = await declarations.statusFor(adult.id);
ok('an adult signs their own', st.state === 'signed' && st.signed.signed_name === 'Ada Adult' && st.signed.guardian === false);
await declarations.sign(aa, adult.id, { accepted: true, name: 'Ada Adult' });
ok('signing twice records one signing', (await one(`select count(*)::int n from declaration_signing where person_id=$1`, [adult.id])).n === 1);
ok('a child cannot sign for themselves', /parent or guardian/.test(await refused(() => declarations.sign(ca, child.id, { accepted: true, name: 'Cleo' })) ?? ''));
await declarations.sign(pa, child.id, { accepted: true, name: 'Pam Parent' });
ok('a parent signs for a child, and it says so', (await declarations.statusFor(child.id)).signed.guardian === true);
ok('who has not signed', (await declarations.unsignedAmong(wh.id, [adult.id, child.id, parent.id, stranger.id])).size === 2);

console.log('\nTHE PAGES');
await signIn('pam.decl@example.nz');
{
  let r = await req(`/me/${parent.id}/declaration`);
  ok('the declaration opens, with its wording and version', r.status === 200 && /willingly|physical contact/.test(r.html) && /Version 2026\.1/.test(r.html));
  r = await req(`/me/${parent.id}/declaration`, { method: 'POST', form: { acceptedName: 'Pam Parent' } });
  ok('signing without the tick is refused, in words', r.status === 422 && /Tick the box/.test(r.html));
  const home = await req('/me');
  ok('her home screen asks her to sign', /Please read and sign the federation declaration/.test(home.html) && /Federation declaration not signed/.test(home.html));
  const ev = await one(`insert into event (organisation_id, kind, title, slug, starts_at, status, visibility, entries_open, entries_close)
    values ($1,'seminar','Gate Seminar','gate-seminar', now() + interval '20 days','published','public', now() - interval '1 day', now() + interval '10 days') returning id`, [wh.id]);
  r = await req(`/me/events/${ev.id}/${parent.id}`);
  ok('entering an event first sends her to sign', r.status === 302 && r.location.startsWith(`/me/${parent.id}/declaration?next=`), String(r.location));
  r = await req(`/me/${parent.id}/declaration`, { method: 'POST', form: { accepted: '1', acceptedName: 'Pam Parent', next: `/me/events/${ev.id}/${parent.id}` } });
  ok('after signing she is sent back to the event', r.status === 302 && r.location === `/me/events/${ev.id}/${parent.id}`, String(r.location));
  r = await req(`/me/events/${ev.id}/${parent.id}`);
  ok('and the entry is no longer in the way', r.status === 200);
  r = await req(`/me/${parent.id}/declaration`, { method: 'POST', form: { accepted: '1', acceptedName: 'Pam Parent', next: 'https://evil.example/' } });
  ok('a link to another site is never followed', r.status === 302 && r.location.startsWith('/me/'), String(r.location));
}
await signIn('doug@example.nz');
{
  const r = await req('/o/whanganui/roster');
  ok('the roll marks who has not signed', /Declaration not signed/.test(r.html) && /have not signed the federation declaration|has not signed the federation declaration/.test(r.html));
  const a = await req('/o/whanganui/declaration');
  ok('the official can open the declaration page', a.status === 200 && /Version <strong>2026\.1<\/strong>/.test(a.html));
  const p = await req('/o/whanganui/declaration', { method: 'POST', form: { version: '2026.2', body: STARTER_DECLARATION + '\n\nNew line.' } });
  ok('publishing new wording works', p.status === 302 && /2026\.2/.test(decodeURIComponent(p.location)));
  ok('and everybody is asked again', (await declarations.statusFor(adult.id)).state === 'unsigned');
}
await signIn('sue.decl@example.nz');
{
  const a = await req('/o/whanganui/declaration');
  ok('an ordinary member cannot open it', a.status === 403, String(a.status));
}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
