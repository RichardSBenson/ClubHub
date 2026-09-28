process.env.HONBU_STORE = 'postgres';
process.env.PGDATABASE = 'fresh';
import http from 'node:http';
import handler from './server.mjs';
import { pool } from '../infrastructure/postgres/pool.mjs';
import * as auth from './auth.mjs';

const server = http.createServer(handler);
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const jar = {};
const take = (r) => { for (const sc of r.headers.getSetCookie?.() ?? []) {
  const [k,v] = sc.split(';')[0].split('='); if (v==='') delete jar[k]; else jar[k]=v; } };
const ch = () => Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; ');
const get = async (p) => { const r = await fetch(base+p,
  { headers: ch() ? { cookie: ch() } : {}, redirect:'manual' });
  take(r); return { status:r.status, location:r.headers.get('location'),
                    html: await r.text() }; };

const SECRET = 'a-long-enough-bootstrap-secret-value';

console.log('\nOFF UNLESS THE VARIABLE IS SET');
{
  delete process.env.HONBU_BOOTSTRAP;
  const r = await get('/bootstrap/anything');
  ok('the route refuses', r.status === 403);
  ok('and says nothing about why', r.html.includes('Not available'));
  ok('helper agrees it is off', auth.bootstrapEnabled() === false);
}

console.log('\nA SHORT SECRET IS REFUSED, LOUDLY');
{
  process.env.HONBU_BOOTSTRAP = 'letmein';
  const r = await get('/bootstrap/letmein');
  ok('even the correct short value fails', r.status === 403);
  ok('with an explanation for whoever set it',
    r.html.includes('at least 24 characters'));
  console.log('      → ' + (r.html.match(/class="bad">([^<]*)/)?.[1] ?? ''));
}

console.log('\nTHE WRONG SECRET LOOKS LIKE A DISABLED ROUTE');
{
  process.env.HONBU_BOOTSTRAP = SECRET;
  const r = await get('/bootstrap/' + 'x'.repeat(SECRET.length));
  ok('refused', r.status === 403);
  ok('with the same message as when it is off',
    r.html.includes('Not available'));
  ok('and no session issued', !jar.honbu_session);
}

console.log('\nTHE RIGHT SECRET SIGNS YOU IN');
{
  const r = await get('/bootstrap/' + SECRET);
  ok('redirects to the dashboard', r.status === 302 && r.location === '/dashboard');
  ok('a session cookie is set', !!jar.honbu_session);

  const dash = await get('/dashboard');
  ok('and the dashboard renders', dash.status === 200);
  ok('as a real person with real data', dash.html.includes('Doug Holloway'));
  ok('seeing the whole federation', dash.html.includes('Whanganui'));
}

console.log('\nIT GRANTS NOTHING IT DID NOT FIND');
{
  const me = await auth.currentActor(jar.honbu_session);
  ok('signs in an existing account', !!me.accountId);
  ok('with the roles it already had',
    me.grants.length > 0 && me.grants[0].role === 'owner');

  const { rows:[n] } = await pool.query(`select count(*)::int n from account`);
  ok('no account was created', n.n === 2, n.n);
}

console.log('\nEVERY USE IS RECORDED');
{
  const { rows } = await pool.query(
    `select email, outcome from login_attempt where email like 'bootstrap%'
     order by at desc`);
  ok('successes are logged with the account',
    rows.some(r => r.outcome === 'sent' && r.email.includes('@')));
  ok('and failed attempts too',
    rows.some(r => r.outcome === 'unknown_email'));
  console.log('      → ' + rows.slice(0,3).map(r=>`${r.email} ${r.outcome}`).join(', '));

  const { rows:[s] } = await pool.query(
    `select user_agent, expires_at::date - now()::date as days from session
     where user_agent like 'bootstrap:%' order by created_at desc limit 1`);
  ok('the session is marked as a bootstrap one', !!s);
  ok('and expires in two days, not thirty', s.days === 2, s.days);
}

console.log('\nNORMAL SIGN-IN IS UNAFFECTED');
{
  delete jar.honbu_session;
  const { token } = await auth.requestLink('doug@example.nz');
  const r = await get('/signin/' + token);
  ok('magic links still work', r.location === '/dashboard' && !!jar.honbu_session);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
await pool.end();
process.exit(fail ? 1 : 0);
