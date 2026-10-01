/**
 * Appearance: a federation chooses, imports and exports its theme.
 *
 *   1. Only the federation can; a club's administrator cannot.
 *   2. A hostile or malformed file changes nothing and says why.
 *   3. What is saved is what the site builds with, and survives a round trip.
 *   4. The built-in files on disk are the built-in modules, not a drifted copy.
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
import { BUILT_IN } from '../site/builtin-themes.mjs';
import { readTheme, serialise } from '../site/theme.mjs';

process.env.HONBU_STORE = 'postgres';
const OUT = '/tmp/honbu-appearance';
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
const federation = await one(`select * from organisation where parent_id is null`);
const stored = async () => (await one('select settings from organisation where id=$1',
  [federation.id])).settings?.theme ?? null;

console.log('\nA CLUB CANNOT CHANGE THE FEDERATION\'S LOOK');
{
  await signIn('tane@example.nz');
  const get = await req(`/o/${federation.slug}/appearance`);
  const post = await req(`/o/${federation.slug}/appearance`, { method: 'POST',
    form: { builtin: 'slate' } });
  ok('cannot open the screen', get.status >= 300, String(get.status));
  ok('cannot post a theme', post.status >= 300 && post.status !== 302
    ? true : post.status === 302 && /signin|dashboard|error/.test(post.location ?? '')
      || post.status === 403 || post.status === 404, String(post.status));
  ok('and nothing was stored', (await stored()) === null);
}

console.log('\nTHE FEDERATION CHOOSES');
{
  await signIn('doug@example.nz');
  const screen = await req(`/o/${federation.slug}/appearance`);
  ok('the screen opens', screen.status === 200, String(screen.status));
  ok('offers every built-in', Object.values(BUILT_IN).every((t) => screen.html.includes(t.name)));

  const pick = await req(`/o/${federation.slug}/appearance`, { method: 'POST',
    form: { builtin: 'slate' } });
  ok('choosing a built-in redirects with a confirmation',
    pick.status === 302 && /done=/.test(pick.location ?? ''), `${pick.status} ${pick.location}`);
  ok('it is stored', (await stored())?.name === 'Slate');

  const history = await one(`select action, after from audit_log
    where organisation_id=$1 and action='theme_apply' order by id desc limit 1`, [federation.id]);
  ok('and is in the history', history?.after?.name === 'Slate');

  await build();
  const home = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8')
    + fs.readFileSync(path.join(OUT, 'theme.css'), 'utf8');
  ok('the built site uses its colours', /#2543B8/i.test(home));
  ok('and its fonts', /Archivo/.test(home));
  ok('and not another theme\'s', !/#CE372C/i.test(home));
}

console.log('\nAN IMPORTED FILE IS CHECKED BEFORE ANYTHING CHANGES');
{
  const before = JSON.stringify(await stored());
  const bad = async (name, text, expect) => {
    const r = await req(`/o/${federation.slug}/appearance`, { method: 'POST',
      form: { theme_json: text } });
    ok(`${name} is refused`, r.status === 422, String(r.status));
    ok(`${name} says why`, expect.test(r.html.replace(/&#39;|&quot;/g, '"')), '');
    ok(`${name} changes nothing`, JSON.stringify(await stored()) === before);
  };
  const good = JSON.parse(serialise(readTheme(BUILT_IN.ink).theme));
  await bad('not JSON', '{nope', /not valid JSON/);
  await bad('somebody else\'s format', '{"format":"other"}', /not a Honbu theme/);
  await bad('a theme carrying CSS', JSON.stringify({ ...good, css: 'body{display:none}' }),
    /css.*not something a theme can carry/);
  await bad('a theme carrying a script address',
    JSON.stringify({ ...good, fonts: { display: 'x;}</style><script>', body: 'Inter' } }),
    /fonts\.display/);
  await bad('an unreadable palette',
    JSON.stringify({ ...good, colours: { ...good.colours, ink: '#FFFFFF', canvas: '#FFFFFF' } }),
    /Colours:/);
  await bad('a club page without its facts',
    JSON.stringify({ ...good, dojoPage: { sections: ['hero'] } }), /facts/);
  await bad('an enormous file', ' '.repeat(30 * 1024), /KB|too large/);
}

console.log('\nEXPORT, THEN IMPORT, GIVES THE SAME THEME');
{
  const down = await req(`/o/${federation.slug}/appearance/export`);
  ok('export downloads', down.status === 200
    && /attachment/.test(down.headers.get('content-disposition') ?? ''));
  const text = down.html;
  ok('and is a valid theme', readTheme(text).ok);

  const imp = await req(`/o/${federation.slug}/appearance`, { method: 'POST',
    form: { theme_json: text.replace('"Slate"', '"Slate Copy"') } });
  ok('importing the export works', imp.status === 302, String(imp.status));
  ok('under its own name', (await stored())?.name === 'Slate Copy');

  const reset = await req(`/o/${federation.slug}/appearance/reset`, { method: 'POST', form: {} });
  ok('reset returns to the default', reset.status === 302 && (await stored()) === null);
  await build();
  const home = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8')
    + fs.readFileSync(path.join(OUT, 'theme.css'), 'utf8');
  ok('and a federation with no theme is not anybody\'s red',
    !/#2543B8/i.test(home));
}

console.log('\nTHE FILES ON DISK ARE THE BUILT-INS');
for (const [key, doc] of Object.entries(BUILT_IN)) {
  const file = path.join(import.meta.dirname, '../../themes', `${key}.json`);
  const want = serialise(readTheme(doc).theme);
  ok(`themes/${key}.json is current (run node tools/export-themes.mjs)`,
    fs.existsSync(file) && fs.readFileSync(file, 'utf8') === want);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
