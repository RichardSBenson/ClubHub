/**
 * Search, and what it must not find.
 *
 * Search is where an authorisation model leaks. A query that reads everything
 * and removes what the actor may not see still tells them it was there — by a
 * count, by an ordering, by the difference between "nothing found" and a
 * refusal. Every branch of this one starts from visible_orgs, and the tests
 * that matter are the ones a club administrator runs against another club.
 *
 * The other thing proved here is macrons. A register in New Zealand holds
 * Tāmati and the people typing into it mostly have no macron key.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';
import { readQuery, fold, highlight } from '../content/search.mjs';

process.env.HONBU_STORE = 'postgres';

const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const jar = {};
async function req(path) {
  const headers = {};
  const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (c) headers.cookie = c;
  const res = await fetch(base + path, { headers, redirect: 'manual' });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await fetch(base + `/signin/${token}`, { redirect: 'manual',
    headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } })
    .then((res) => {
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [k, v] = sc.split(';')[0].split('=');
        if (v === '') delete jar[k]; else jar[k] = v;
      }
    });
};
const find = (q) => req(`/search?q=${encodeURIComponent(q)}`);

// Somebody with a macron in their name, at Whanganui.
const wh = await one(`select id from organisation where slug='whanganui'`);
const macron = await one(`
  insert into person (first_name, last_name, date_of_birth, gender,
                      display_number)
  values ('Tāmati','Ngāti','1988-02-11','M','MOK-0451') returning id`);
await pool.query(`
  insert into affiliation (person_id, organisation_id, role, status, starts)
  values ($1,$2,'member','active',current_date)`, [macron.id, wh.id]);

// ---------------------------------------------------------------------------

console.log('\nREADING WHAT SOMEBODY TYPED');
{
  ok('a name', readQuery('aroha ngata').kind === 'name');
  ok('split into words so each can match separately',
    readQuery('aroha ngata').terms.join() === 'aroha,ngata');
  ok('a member number', readQuery('MOK-0451').kind === 'number');
  ok('bare digits are a number too', readQuery('0451').kind === 'number');
  ok('a word with no digits is not', readQuery('MOKNZ').kind === 'name');
  ok('an email', readQuery('doug@example.nz').kind === 'email');
  ok('a partial email still is', readQuery('doug@').kind === 'email');
  ok('a grade', readQuery('4th kyu').kind === 'grade');
  ok('shodan too', readQuery('1st dan').kind === 'grade');
  ok('nothing typed', readQuery('   ').kind === 'empty');
  ok('one letter is too short', readQuery('a').kind === 'too-short');
}

console.log('\nMACRONS DO NOT MATTER, IN EITHER DIRECTION');
{
  ok('folding matches the database', fold('Tāmati Ngāti') === 'tamati ngati');
  ok('and romanised Japanese', fold('dōjō') === 'dojo');
  ok('folding never changes the length, so highlighting lines up',
    fold('Tāmati').length === 'Tāmati'.length);

  const parts = highlight('Tāmati Ngāti', 'tamati');
  ok('the matched part is found in the original spelling',
    parts[0].match && parts[0].text === 'Tāmati',
    JSON.stringify(parts));
  ok('and the rest is left alone', parts[1].text === ' Ngāti');
  ok('highlighting returns pieces, not markup — the view escapes them',
    highlight('<b>x</b>', 'x').every((p) => typeof p.text === 'string'));
}

await signIn('doug@example.nz');

console.log('\nFINDING THINGS');
{
  const typed = await find('tamati');
  ok('a name typed without macrons finds the person',
    typed.html.includes('Ngāti'), 'not found');
  ok('and shows the name as it is actually recorded',
    typed.html.includes('Tāmati'));
  ok('with the match marked', /<mark>T[āa]mati<\/mark>/.test(typed.html),
    'no highlight');

  const withMacron = await find('Tāmati');
  ok('typing the macron finds them too', withMacron.html.includes('Ngāti'));

  const byNumber = await find('MOK-0451');
  ok('a member number finds them', byNumber.html.includes('Ngāti'));

  const byOrg = await find('whanganui');
  ok('an organisation is found', byOrg.html.includes('Whanganui'));
  ok('and grouped under a heading', byOrg.html.includes('<h2>Organisations</h2>'));

  const nothing = await find('zzzzznothing');
  ok('nothing found says why it might be',
    nothing.html.includes('permission to see'));
  ok('and mentions that macrons are handled',
    nothing.html.includes('find each other'));

  const short = await find('a');
  ok('one letter is refused with a reason',
    short.html.includes('Two letters at least'));
}

console.log('\nTHE SEARCH BOX IS ON EVERY SCREEN');
{
  const dash = await req('/dashboard');
  ok('the header carries it', dash.html.includes('action="/search"'));
  ok('and it is a plain form, so it works with scripts off',
    dash.html.includes('method="get"'));

  const results = await find('tamati');
  ok('the box keeps what was typed', results.html.includes('value="tamati"'));
}

console.log('\nWHAT ANOTHER CLUB CANNOT FIND');
{
  // Tane administers Wellington only. Tāmati is at Whanganui.
  await signIn('tane@example.nz');

  const theirs = await find('tamati');
  ok('a club administrator cannot find another club\'s member',
    !theirs.html.includes('Ngāti'), 'LEAKED a person');
  ok('and is told nothing found, not refused',
    theirs.status === 200 && theirs.html.includes('Nothing found'));

  const byNumber = await find('MOK-0451');
  ok('nor by their exact member number', !byNumber.html.includes('Ngāti'));

  const byOrg = await find('whanganui');
  ok('nor the club itself', !byOrg.html.includes('Whanganui'),
    'LEAKED an organisation');

  const own = await find('wellington');
  ok('but their own club is found', own.html.includes('Wellington'));

  // A draft page is not public, and search must not be how somebody reads one.
  await pool.query(`
    insert into page (organisation_id, slug, title, body, status)
    values ($1,'committee-secret','Committee secret',
      '{"blocks":[{"type":"paragraph","text":"Not for everyone."}]}'::jsonb,
      'draft')`, [wh.id]);
  const draft = await find('committee');
  ok('nor another club\'s draft page', !draft.html.includes('Committee secret'),
    'LEAKED a draft');

  // Checked on the person rather than the address: the page echoes the query
  // in its heading and keeps it in the search box, so the raw string is
  // present either way and asserting on it proves nothing.
  const email = await find('doug@example.nz');
  ok('nor the person behind an email address they have no business with',
    !email.html.includes('Doug Holloway'), 'LEAKED a person');
  ok('and gets an empty result rather than a refusal',
    email.html.includes('Nothing found'));
}

console.log('\nAND SIGNED OUT, NOTHING AT ALL');
{
  delete jar.honbu_session;
  const r = await find('tamati');
  ok('search redirects to sign in', r.status === 302 && r.location === '/signin',
    `${r.status} ${r.location}`);
  ok('and returns no results with it', !r.html.includes('Ngāti'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
