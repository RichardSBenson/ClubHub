/**
 * Getting somebody in without email.
 *
 * Sign-in is a link in an email, which is right, and which means nobody can
 * get into a fresh install until that federation's own mail is configured —
 * a wall in front of the first thing a new install has to do, which is add a
 * second administrator. Microsoft closing SMTP on personal Outlook accounts
 * is what made that concrete.
 *
 * So an administrator can create the link and hand it over. This checks it is
 * a real sign-in link and not a weaker one, and that it cannot be used to
 * reach anybody an administrator does not already administer.
 */

import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';

const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const jar = {};
async function req(path, { method = 'GET', form } = {}) {
  const headers = {};
  const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (c) headers.cookie = c;
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + path, { method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
               : undefined });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const linkIn = (html) => (html.match(/\/signin\/([A-Za-z0-9_-]{20,})/) ?? [])[1];

console.log('\nSIGNED IN AS THE OWNER');
{
  await req('/signin');
  const { token } = await auth.requestLink('doug@example.nz');
  ok('session is live', (await req(`/signin/${token}`, { method: 'POST', form: {} })).status === 302);
}

const member = await one(`
  select p.* from affiliation a join person p on p.id = a.person_id
  join organisation o on o.id = a.organisation_id
  where o.slug = 'whanganui' and a.ends is null and a.role = 'member'
  and p.email is not null limit 1`);

console.log('\nSOMEBODY ON THE ROLL WITH NO WAY IN');
{
  ok('they exist', !!member, 'no member with an email at whanganui');
  ok('and have no account yet',
    await one('select 1 from account where person_id=$1', [member.id]) === null);

  const page = await req(`/p/${member.id}`);
  ok('their record says so', page.html.includes('no account'), 'not stated');
  ok('and offers to give them one', page.html.includes('/access'));
}

console.log('\nGIVING THEM ACCESS');
{
  const r = await req(`/p/${member.id}/access`,
    { method: 'POST', form: { role: 'registrar' } });
  ok('it works', r.status === 200, String(r.status));
  ok('the link is shown once, in full', !!linkIn(r.html), 'no link on the page');
  ok('with how long it lasts', /\d+ minutes/.test(r.html));
  ok('and a warning to copy it now', r.html.includes('shown once'));

  const account = await one('select * from account where person_id=$1', [member.id]);
  ok('an account exists now', !!account);
  ok('under their own address', account.email === member.email.toLowerCase());
  ok('with the role that was chosen',
    !!await one(`select 1 from grant_role where account_id=$1 and role='registrar'`,
      [account.id]));
  ok('and it is written down who did it', !!await one(
    `select 1 from audit_log where action='grant_access' and entity_id=$1`,
    [account.id]));

  globalThis.__link = linkIn(r.html);
}

console.log('\nTHE LINK IS A REAL SIGN-IN LINK, NOT A WEAKER ONE');
{
  const theirs = {};
  const asThem = async (path, post = false) => {
    const headers = {};
    const c = Object.entries(theirs).map(([k, v]) => `${k}=${v}`).join('; ');
    if (c) headers.cookie = c;
    if (post) headers['content-type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(base + path, { headers, redirect: 'manual', ...(post ? { method: 'POST', body: new URLSearchParams({ _csrf: theirs.honbu_csrf ?? '' }).toString() } : {}) });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [k, v] = sc.split(';')[0].split('=');
      if (v === '') delete theirs[k]; else theirs[k] = v;
    }
    return { status: res.status, location: res.headers.get('location'),
             html: await res.text() };
  };

  const prefetched = await asThem(`/signin/${globalThis.__link}`);
  ok('opening the link only shows a button: a mail scanner cannot spend it', prefetched.status === 200 && /<button/.test(prefetched.html) && !theirs.honbu_session);
  const used = await asThem(`/signin/${globalThis.__link}`, true);
  ok('following it signs them in',
    used.status === 302 && !!theirs.honbu_session, String(used.status));
  ok('and lands on the dashboard', used.location === '/dashboard');

  const dash = await asThem('/dashboard');
  ok('they can see their club', dash.status === 200 && dash.html.includes('Whanganui'));

  const again = await asThem(`/signin/${globalThis.__link}`, true);
  ok('it works ONCE — a second use is refused',
    again.status !== 302 || again.location !== '/dashboard',
    `${again.status} ${again.location}`);
}

console.log('\nA SECOND LINK CAN ALWAYS BE MADE');
{
  const r = await req(`/p/${member.id}/access`,
    { method: 'POST', form: { role: 'registrar' } });
  ok('it is offered', r.status === 200);
  ok('a fresh link comes back',
    !!linkIn(r.html) && linkIn(r.html) !== globalThis.__link);
  ok('and the page now says they have an account',
    r.html.includes(member.email.toLowerCase()), 'address not shown');
}

console.log('\nSOMEBODY WITH NO ADDRESS ON FILE');
{
  const nameless = await one(`
    insert into person (first_name, last_name) values ('No','Address')
    returning *`);
  await pool.query(`
    insert into affiliation (person_id, organisation_id, role, starts, status)
    select $1, o.id, 'member', current_date, 'active'
    from organisation o where o.slug = 'whanganui'`, [nameless.id]);

  const r = await req(`/p/${nameless.id}/access`, { method: 'POST', form: {} });
  ok('it is refused', r.status === 422, String(r.status));
  ok('saying why, by name', r.html.includes('has no email address'), 'no reason');
  ok('and nothing was created',
    await one('select 1 from account where person_id=$1', [nameless.id]) === null);

  // Supplying one on the spot is the fix, and it works.
  const fixed = await req(`/p/${nameless.id}/access`,
    { method: 'POST', form: { email: 'no.address@example.nz', role: 'member' } });
  ok('giving an address there and then works', fixed.status === 200
    && !!linkIn(fixed.html), String(fixed.status));
}

console.log('\nAN ADDRESS THAT IS SOMEBODY ELSE\'S');
{
  const other = await one(`select * from person where email is not null
    and id <> $1 limit 1`, [member.id]);
  const r = await req(`/p/${member.id}/access`,
    { method: 'POST', form: { email: other.email, role: 'member' } });
  ok('taking over another account is refused', r.status === 422, String(r.status));
  ok('and says so plainly',
    r.html.includes('already belongs to somebody else'), 'no explanation');
}

console.log('\nONLY PEOPLE YOU ALREADY ADMINISTER');
{
  const saved = { ...jar };
  for (const k of Object.keys(jar)) delete jar[k];
  await req('/signin');
  const { token } = await auth.requestLink('tane@example.nz');
  await req(`/signin/${token}`, { method: 'POST', form: {} });

  const r = await req(`/p/${member.id}/access`,
    { method: 'POST', form: { role: 'owner' } });
  ok('another club\'s member is refused', r.status === 403, String(r.status));
  ok('and no role was granted', await one(`
    select 1 from grant_role gr join account a on a.id = gr.account_id
    where a.person_id = $1 and gr.role = 'owner'`, [member.id]) === null);

  for (const k of Object.keys(jar)) delete jar[k];
  Object.assign(jar, saved);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
await pool.end();
process.exit(fail ? 1 : 0);
