/**
 * Members, parents and children.
 *
 * Richard: "entries into events by members, and a members profile."
 *
 *   1. A parent is a person linked to a child; the link is made by the club.
 *   2. A signed-in member sees themselves and their own children and nobody else.
 *   3. They may change contact and safety details, and nothing the register owns.
 *   4. The authority ends on the child's eighteenth birthday without anybody ending it.
 *   5. A member can reach no administrator screen.
 */
import { open as unseal } from '../infrastructure/crypto/vault.mjs';
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
const OUT = '/tmp/honbu-family';
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
  await req(`/signin/${token}`, { method: 'POST', form: {} });
};
const build = async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await run(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..') });
};
const wh = await one(`select * from organisation where slug='whanganui'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, {
  organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });

const parent = await enrol('Pania', 'Parent', '1984-02-01', 'pania@example.nz');
const kid = await enrol('Kahu', 'Parent', '2015-05-05');
const kid2 = await enrol('Mere', 'Parent', '2012-09-09');
const otherKid = await enrol('Tama', 'Stranger', '2014-01-01');
const adult = await enrol('Hemi', 'Adult', '1990-01-01');
const teen = await enrol('Ana', 'Young', '2010-01-01');
const noDob = await enrol('Noa', 'Nodob', null);

const link = (child, number, relationship = 'parent') =>
  req(`/p/${child.id}/guardians`, { method: 'POST',
    form: { guardian_number: number, relationship } });
const guardianRows = async () =>
  (await pool.query(`select * from guardian_link where ended_on is null`)).rows;

await signIn('doug@example.nz');

console.log('\nTHE CLUB LINKS A PARENT TO A CHILD');
{
  const page = await req(`/p/${kid.id}`);
  ok('a child\'s record offers parents and guardians', /Parents and guardians/.test(page.html));
  const adultPage = await req(`/p/${adult.id}`);
  ok('an adult\'s does not', !/Parents and guardians/.test(adultPage.html));

  const r = await link(kid, parent.display_number);
  ok('linking works', r.status === 302, String(r.status));
  await link(kid2, parent.display_number, 'guardian');
  ok('two children, one parent', (await guardianRows()).length === 2);
  const shown = await req(`/p/${kid.id}`);
  ok('the child\'s record names the parent', /Pania Parent/.test(shown.html));
  const log = await one(`select after from audit_log where action='guardian_link' and entity_id=$1 order by id desc limit 1`, [kid.id]);
  ok('and it is in the history', log?.after?.child === 'Kahu Parent');
}

console.log('\nBAD LINKS CHANGE NOTHING');
{
  const before = (await guardianRows()).length;
  const bad = async (name, res, expect) => {
    ok(`${name} is refused`, res.status === 422, String(res.status));
    ok(`${name} says why`, expect.test(res.html.replace(/&#39;/g, "'")), '');
    ok(`${name} adds nothing`, (await guardianRows()).length === before);
  };
  await bad('an adult child', await link(adult, parent.display_number), /18 or over/);
  await bad('no date of birth', await link(noDob, parent.display_number), /no date of birth/);
  await bad('an unknown number', await link(kid, 'NOPE-9999'), /nobody with the member number/);
  await bad('somebody as their own guardian', await link(kid, kid.display_number), /own guardian/);
  await bad('a child as a guardian', await link(otherKid, teen.display_number), /under 18/);
  await bad('the same link twice', await link(kid, parent.display_number), /already linked/);
}

console.log('\nTHE PARENT SIGNS IN');
let parentJar;
{
  const access = await req(`/p/${parent.id}/access`, { method: 'POST',
    form: { role: 'member', email: 'pania@example.nz' } });
  const url = access.html.match(/\/signin\/[A-Za-z0-9_-]+/)?.[0];
  ok('given a sign-in link', !!url);
  delete jar.honbu_session;
  await req('/signin');
  const used = await req(url, { method: 'POST', form: {} });
  ok('it signs her in', used.status === 302, String(used.status));
  const dash = await req('/dashboard');
  ok('and her home is her own details', dash.status === 302 && dash.location === '/me',
    `${dash.status} ${dash.location}`);

  const home = await req('/me');
  ok('she sees herself', home.status === 200 && /Kia ora, Pania/.test(home.html));
  ok('and both her children', /Kahu Parent/.test(home.html) && /Mere Parent/.test(home.html));
  ok('and nobody else\'s', !/Tama/.test(home.html) && !/Hemi/.test(home.html));
  parentJar = { ...jar };
}

console.log('\nSHE SEES AND CHANGES HER CHILD\'S SAFETY DETAILS');
{
  const own = await req(`/me/${kid.id}`);
  ok('opens her child\'s details', own.status === 200 && /you look after this person/.test(own.html));
  const save = await req(`/me/${kid.id}`, { method: 'POST', form: {
    phone: '021 000 000', emergency_name: 'Nana Rose', emergency_phone: '027 111 222',
    medical_notes: 'Asthma - inhaler in bag',
    // fields the register owns, which must be ignored
    first_name: 'Hacked', date_of_birth: '1990-01-01', rank_order: '99' } });
  ok('saves', save.status === 302, `${save.status}`);
  const row = await one(`select p.first_name, p.date_of_birth::text dob, p.phone,
    pp.emergency_name, pp.medical_notes from person p
    join person_private pp on pp.person_id=p.id where p.id=$1`, [kid.id]);
  ok('what she changed is saved', row.phone === '021 000 000' && row.emergency_name === 'Nana Rose'
    && /Asthma/.test(unseal(row.medical_notes)));
  ok('what the register owns is not', row.first_name === 'Kahu' && row.dob === '2015-05-05');
  const log = await one(`select after from audit_log where action='self_update' and entity_id=$1
    order by id desc limit 1`, [kid.id]);
  ok('the history says which fields, as a guardian', log?.after?.by === 'guardian'
    && log.after.fields.includes('medical_notes'));
  ok('and never what the medical notes said', !JSON.stringify(log.after).includes('Asthma'));

  const bad = await req(`/me/${kid.id}`, { method: 'POST', form: {
    email: 'not-an-email', emergency_name: 'Only a name' } });
  ok('a bad email is refused', bad.status === 422 && /email address does not look right/.test(bad.html));
  ok('a half emergency contact is refused', /needs both a name and a phone/.test(bad.html));
}

console.log('\nSHE SEES NOBODY ELSE AND NO ADMINISTRATION');
{
  const refused = async (name, res) => ok(name, res.status === 403 || res.status === 404 || res.status === 302
    && /signin|\/me/.test(res.location ?? ''), `${res.status} ${res.location ?? ''}`);
  await refused('another family\'s child', await req(`/me/${otherKid.id}`));
  await refused('an adult member', await req(`/me/${adult.id}`));
  const post = await req(`/me/${otherKid.id}`, { method: 'POST', form: { phone: '000' } });
  ok('cannot change another family\'s child', (await one('select phone from person where id=$1',
    [otherKid.id])).phone !== '000' && post.status !== 302);

  for (const p of [`/p/${kid.id}`, `/p/${otherKid.id}`, '/o/whanganui/roster', '/o/whanganui/members/new',
      '/o/whanganui/events/new', '/o/whanganui/grading', '/o/whanganui/history', '/o/whanganui/news',
      '/o/whanganui/pages', '/o/whanganui/club-page', '/o/whanganui/profile', `/p/${kid.id}/edit`]) {
    const r = await req(p);
    ok(`cannot open ${p}`, r.status !== 200, String(r.status));
  }
  const before = (await guardianRows()).length;
  await link(otherKid, parent.display_number);
  ok('cannot link herself to a child', (await guardianRows()).length === before);
}

console.log('\nTHE AUTHORITY ENDS BY ITSELF');
{
  await pool.query(`update person set date_of_birth = (current_date - interval '18 years' - interval '1 day')::date
    where id=$1`, [kid2.id]);
  Object.assign(jar, parentJar);
  const home = await req('/me');
  ok('a child who turns 18 drops off her list', !/Mere Parent/.test(home.html) && /Kahu Parent/.test(home.html));
  const r = await req(`/me/${kid2.id}`);
  ok('and she can no longer open their details', r.status === 403, String(r.status));
}

console.log('\nTHE CLUB CAN END A LINK');
{
  await signIn('doug@example.nz');
  const id = (await one(`select id from guardian_link where child_id=$1 and ended_on is null`, [kid.id])).id;
  const r = await req(`/p/${kid.id}/guardians/${id}/end`, { method: 'POST', form: {} });
  ok('removed', r.status === 302 && (await one('select ended_on from guardian_link where id=$1', [id])).ended_on !== null);
  Object.assign(jar, parentJar);
  const gone = await req(`/me/${kid.id}`);
  ok('and the parent loses access at once', gone.status === 403, String(gone.status));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
