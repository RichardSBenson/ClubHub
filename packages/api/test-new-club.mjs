/**
 * Adding a club.
 *
 * Richard: "adding in a new club."
 *
 *   1. The federation adds a club and, in the same step, the person who runs it.
 *   2. That person can sign in and run that club and nothing else.
 *   3. A club cannot add clubs; nobody can take a name the website uses.
 *   4. Mistakes change nothing, and say what to fix.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
const OUT = '/tmp/honbu-new-club';
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
const federation = await one(`select * from organisation where parent_id is null`);
const count = async () => (await one(`select count(*)::int n from organisation`)).n;

await signIn('doug@example.nz');

console.log('\nTHE FEDERATION ADDS A CLUB');
{
  const screen = await req(`/o/${federation.slug}/clubs`);
  ok('the screen opens', screen.status === 200, String(screen.status));
  ok('and lists the clubs already there', /Whanganui/.test(screen.html));

  const before = await count();
  const add = await req(`/o/${federation.slug}/clubs/new`, { method: 'POST', form: {
    name: 'Taupo Karate', city: 'Taupo', adminFirst: 'Aroha', adminLast: 'Ngata',
    adminEmail: 'aroha@example.nz' } });
  ok('adding works', add.status === 200 && /Taupo Karate/.test(add.html) && /is added/.test(add.html),
    String(add.status));
  ok('one organisation more', (await count()) === before + 1);

  const club = await one(`select * from organisation where slug='taupo-karate'`);
  ok('a club, beneath the federation', club?.type === 'club' && club.parent_id === federation.id);
  ok('in the federation\'s tree', club?.path === `${federation.path}.taupo_karate`);
  ok('with the federation\'s timezone', club?.timezone === federation.timezone);
  ok('and no public page until it asks',
    (await one(`select published from dojo_profile where organisation_id=$1`, [club.id]))
      ?.published !== true);

  const link = add.html.match(/\/signin\/[A-Za-z0-9_-]+/)?.[0];
  ok('the administrator is given a sign-in link', !!link);

  const log = await one(`select after from audit_log where action='club_added'
    and entity_id=$1`, [club.id]);
  ok('and it is in the history', log?.after?.name === 'Taupo Karate');

  // ---- the new administrator -------------------------------------------
  const cookieBefore = { ...jar };
  delete jar.honbu_session;
  await req('/signin');
  await req(link, { method: 'POST', form: {} });
  const own = await req('/o/taupo-karate/roster');
  ok('can sign in and open their own club', own.status === 200, String(own.status));
  const other = await req('/o/whanganui/roster');
  ok('cannot open another club', other.status === 403 || other.status === 404, String(other.status));
  const up = await req(`/o/${federation.slug}/clubs`);
  ok('cannot open the federation\'s clubs screen', up.status !== 200 || !/Add a club/.test(up.html),
    String(up.status));
  const nested = await req('/o/taupo-karate/clubs/new', { method: 'POST',
    form: { name: 'Sub Club' } });
  ok('and a club cannot add a club', nested.status === 403
    || (await one(`select 1 from organisation where slug='sub-club'`)) === null);
  Object.assign(jar, cookieBefore);
}

console.log('\nMISTAKES CHANGE NOTHING');
{
  await signIn('doug@example.nz');
  const before = await count();
  const bad = async (name, form, expect) => {
    const r = await req(`/o/${federation.slug}/clubs/new`, { method: 'POST', form });
    ok(`${name} is refused`, r.status === 422, String(r.status));
    ok(`${name} says why`, expect.test(r.html.replace(/&#39;|&quot;/g, '"')));
    ok(`${name} adds nothing`, (await count()) === before);
  };
  await bad('no name', { name: '' }, /needs a name/);
  await bad('a name the website uses', { name: 'Events' }, /used by the website/);
  await bad('a taken address', { name: 'Another Whanganui', slug: 'whanganui' }, /already an organisation/);
  await bad('half an administrator', { name: 'Napier Karate', adminFirst: 'Sam' }, /first and last name/);
  await bad('a bad email', { name: 'Napier Karate', adminFirst: 'Sam', adminLast: 'Lee',
    adminEmail: 'nope' }, /email address does not look right/);
  await bad('an email that already has an account', { name: 'Napier Karate',
    adminFirst: 'Sam', adminLast: 'Lee', adminEmail: 'doug@example.nz' }, /already has an account/);
  await bad('a bad web address', { name: 'Napier Karate', slug: 'Not Valid!' }, /lower-case/);
}

console.log('\nA CLUB CAN BE ADDED WITH NOBODY RUNNING IT YET');
{
  const add = await req(`/o/${federation.slug}/clubs/new`, { method: 'POST',
    form: { name: 'Napier Karate' } });
  ok('added', add.status === 200 && /Napier Karate/.test(add.html));
  const list = await req(`/o/${federation.slug}/clubs`);
  ok('and shown as having nobody yet', /Nobody yet/.test(list.html));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
