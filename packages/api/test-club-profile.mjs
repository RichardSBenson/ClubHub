/**
 * A club's own details screen.
 *
 *   1. The club's administrator sees and edits their club's name, dates and
 *      timezone, and nothing of another club's.
 *   2. Mistakes change nothing and say what to fix.
 *   3. A rename reaches the website; a change that does not, does not ask for a rebuild.
 *   4. Every change is in the history.
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
const OUT = '/tmp/honbu-club-profile';
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
const club = await one(`select * from organisation where slug='whanganui'`);
const row = () => one(`select *, to_char(founded,'YYYY-MM-DD') as founded_iso from organisation where id=$1`, [club.id]);
const full = (over = {}) => ({ name: club.name, shortName: '', founded: '2009-03-14',
  timezone: 'Pacific/Auckland', status: 'active', ...over });

await signIn('doug@example.nz');

console.log('\nTHE SCREEN');
{
  const s = await req('/o/whanganui/profile');
  ok('opens', s.status === 200, String(s.status));
  ok('shows the club and its counts', /Whanganui/.test(s.html) && /members/.test(s.html));
  ok('links to the page editor', /club-page/.test(s.html));
  const up = await req('/o/moknz/profile');
  ok('a federation is sent to its clubs screen',
    up.status === 302 && /\/clubs$/.test(up.location ?? ''), `${up.status} ${up.location}`);
}

console.log('\nSAVING');
{
  const r = await req('/o/whanganui/profile', { method: 'POST', form: full() });
  ok('saves', r.status === 302 && /done=/.test(r.location ?? ''), `${r.status} ${r.location}`);
  ok('keeps the date', (await row()).founded_iso === '2009-03-14');
  ok('and says nothing on the website changed', /Nothing on the website changed/.test(decodeURIComponent(r.location ?? '')));

  const rn = await req('/o/whanganui/profile', { method: 'POST', form: full({ name: 'Whanganui Karate' }) });
  ok('a rename saves', (await row()).name === 'Whanganui Karate');
  ok('and asks for a rebuild', !/Nothing on the website changed/.test(decodeURIComponent(rn.location ?? '')));
  const log = await one(`select before, after from audit_log
    where action='club_profile_saved' and entity_id=$1 order by id desc limit 1`, [club.id]);
  ok('the history has before and after', log?.before?.name === 'Whanganui' && log?.after?.name === 'Whanganui Karate');

  await req('/o/whanganui/profile', { method: 'POST', form: full({ name: 'Whanganui', status: 'dormant' }) });
  ok('a break is saved', (await row()).status === 'dormant');
  await req('/o/whanganui/profile', { method: 'POST', form: full({ name: 'Whanganui' }) });
}

console.log('\nMISTAKES CHANGE NOTHING');
{
  const before = JSON.stringify(await row());
  const bad = async (name, over, expect) => {
    const r = await req('/o/whanganui/profile', { method: 'POST', form: full(over) });
    ok(`${name} is refused`, r.status === 422, String(r.status));
    ok(`${name} says why`, expect.test(r.html));
    ok(`${name} changes nothing`, JSON.stringify(await row()) === before);
  };
  await bad('no name', { name: '' }, /needs a name/);
  await bad('a bad date', { founded: '14/03/2009' }, /should look like/);
  await bad('a date in the future', { founded: '2999-01-01' }, /future/);
  await bad('a made-up timezone', { timezone: 'Mars/Olympus' }, /timezone/);
  await bad('a made-up state', { status: 'closed' }, /running or on a break/);
}

console.log('\nWHO MAY');
{
  await pool.query(`delete from grant_role where account_id in
    (select id from account where email='tane@example.nz') and organisation_id=$1`, [club.id]);
  const other = await one(`select id from organisation where slug='wellington'`);
  await signIn('tane@example.nz');
  const own = await req('/o/wellington/profile');
  ok('another club\'s administrator opens their own', own.status === 200, String(own.status));
  const theirs = await req('/o/whanganui/profile');
  ok('but not Whanganui\'s', theirs.status === 403 || theirs.status === 404, String(theirs.status));
  const post = await req('/o/whanganui/profile', { method: 'POST', form: full({ name: 'Hijacked' }) });
  ok('and cannot change it', (await row()).name === 'Whanganui' && post.status !== 302);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
