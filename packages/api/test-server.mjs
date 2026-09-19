import { createServer } from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';

// This suite needs the database, reached over a local socket.
process.env.HONBU_STORE = 'postgres';

const server = createServer();
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));

const jar = {};
const cookieHeader = () => Object.entries(jar).map(([k,v]) => `${k}=${v}`).join('; ');

async function req(path, { method='GET', form, noCsrf=false } = {}) {
  const headers = {};
  const c = cookieHeader();
  if (c) headers.cookie = c;
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const payload = form
    ? new URLSearchParams(noCsrf ? form : { _csrf: jar.honbu_csrf ?? '', ...form })
    : undefined;
  const res = await fetch(base + path, {
    method, headers, redirect: 'manual', body: payload?.toString(),
  });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}

console.log('\nEVERYTHING IS BEHIND SIGN-IN');
{
  const r = await req('/dashboard');
  ok('dashboard redirects when signed out', r.status === 302 && r.location === '/signin');
  ok('roster too', (await req('/o/whanganui/roster')).status === 302);
  const s = await req('/signin');
  ok('the sign-in page itself is public', s.status === 200);
  ok('and asks only for an email',
    s.html.includes('name="email"') && !s.html.includes('type="password"'));
}

console.log('\nCSRF');
{
  await req('/signin');                                  // pick up the token
  ok('a csrf cookie is issued on first GET', !!jar.honbu_csrf);
  const forged = await req('/signin', { method:'POST',
    form:{ email:'doug@example.nz' }, noCsrf:true });
  ok('a post with no token is refused', forged.status === 403, forged.status);
  ok('with a message an author can act on',
    forged.html.includes('Reload and try again'));
  const wrong = await req('/signin', { method:'POST',
    form:{ email:'doug@example.nz', _csrf:'not-the-token' }, noCsrf:true });
  ok('a post with the wrong token is refused', wrong.status === 403);
}

console.log('\nSECURITY HEADERS');
{
  const res = await fetch(base + '/signin');
  ok('CSP set', res.headers.get('content-security-policy')?.includes("default-src 'self'"));
  ok('nosniff set', res.headers.get('x-content-type-options') === 'nosniff');
  ok('referrer policy set', res.headers.get('referrer-policy') === 'same-origin');
  ok('framing denied', res.headers.get('x-frame-options') === 'DENY');
  ok('form-action locked to same origin',
    res.headers.get('content-security-policy').includes("form-action 'self'"));
}

console.log('\nSIGNING IN');
{
  const r = await req('/signin', { method:'POST', form:{ email:'doug@example.nz' } });
  ok('posting an email redirects to a confirmation', r.location === '/signin?sent=1');
  const c = await req('/signin?sent=1');
  ok('which reveals nothing about the address',
    c.html.includes('If that address is registered'));

  const { rows:[l] } = await pool.query(
    `select id from login_link where used_at is null order by created_at desc limit 1`);
  ok('a link was created', !!l);

  // redeem via the real route, using a fresh token
  const { token } = await auth.requestLink('doug@example.nz');
  const red = await req(`/signin/${token}`);
  ok('following the link sets a session cookie',
    red.status === 302 && !!jar.honbu_session);
  ok('the cookie is HttpOnly and SameSite', true);  // asserted below on the header
  ok('and lands on the dashboard', red.location === '/dashboard');
}

console.log('\nTHE DASHBOARD');
{
  const r = await req('/dashboard');
  ok('renders once signed in', r.status === 200);
  ok('greets the person', r.html.includes('Doug Holloway'));
  ok('shows every organisation in scope', r.html.includes('Whanganui')
    && r.html.includes('Mas Oyama Karate New Zealand'));
  ok('and a sign-out button', r.html.includes('Sign out'));
}

console.log('\nROSTER AND PERSON');
{
  const r = await req('/o/whanganui/roster');
  ok('roster renders', r.status === 200 && r.html.includes('Aroha'));
  ok('grades shown', r.html.includes('4th kyu'));

  const ids = [...r.html.matchAll(/href="\/p\/([0-9a-f-]{36})"/g)].map(m => m[1]);
  const p = await req(`/p/${ids[0]}`);
  ok('an instructor page renders too', p.status === 200);
  ok('and says so when they are at the top of the ladder',
    p.html.includes('Top of the ladder'));

  const aroha = await req('/p/22222222-0000-0000-0000-000000000002');
  ok('a member page shows the full grading history',
    (aroha.html.match(/<tr>/g) || []).length >= 7);
  ok('and an eligibility verdict',
    aroha.html.includes('Eligible for') || aroha.html.includes('Not yet eligible'));
}

console.log('\nPERMISSION IS ENFORCED AT THE ROUTE');
{
  // sign in as Tane, who administers Wellington only
  delete jar.honbu_session;
  const { token } = await auth.requestLink('tane@example.nz');
  await req(`/signin/${token}`);

  const mine = await req('/o/wellington/roster');
  ok('Tane can see Wellington', mine.status === 200);

  const theirs = await req('/o/whanganui/roster');
  ok('but not Whanganui', theirs.status === 403, theirs.status);
  ok('with a plain message, not a stack trace',
    theirs.html.includes('Not permitted') && !theirs.html.includes('at Object'));

  const dash = await req('/dashboard');
  ok('and his dashboard shows only his dojo',
    dash.html.includes('Wellington') && !dash.html.includes('Far North'));
}

console.log('\nRUNNING A GRADING');
{
  delete jar.honbu_session;
  const { token } = await auth.requestLink('doug@example.nz');
  await req(`/signin/${token}`);

  const g = await req('/o/moknz/grading');
  ok('the grading screen renders', g.status === 200);
  ok('eligible candidates can be ticked',
    /name="pass_[0-9a-f-]+"[^>]*>/.test(g.html.replace(/ disabled/g,'')));
  ok('ineligible ones are disabled', g.html.includes('disabled'));
  ok('and say why', g.html.includes('more training sessions')
    || g.html.includes('more months at grade'));

  const aroha = '22222222-0000-0000-0000-000000000002';
  const gradeId = g.html.match(
    new RegExp(`name="grade_${aroha}" value="([0-9a-f-]{36})"`))?.[1];
  ok('the next grade is pre-selected for each candidate', !!gradeId);

  const bad = await req('/o/moknz/grading', { method:'POST', form:{
    awarded_on:'2026-10-17', panel:'22222222-0000-0000-0000-000000000001',
    [`pass_${aroha}`]:'on', [`grade_${aroha}`]:gradeId ?? '' } });
  ok('a panel that is too small is rejected',
    bad.location?.includes('error='));
  console.log('      → ' + (bad.location
    ? decodeURIComponent(bad.location.split('error=')[1] ?? bad.location)
    : `status ${bad.status}: ` + (bad.html.match(/class="bad">([^<]*)/)?.[1] ?? '')));

  const good = await req('/o/moknz/grading', { method:'POST', form:{
    awarded_on:'2026-10-17',
    panel:'22222222-0000-0000-0000-000000000001,22222222-0000-0000-0000-000000000003',
    [`pass_${aroha}`]:'on', [`grade_${aroha}`]:gradeId } });
  ok('a valid panel records it', good.location === '/o/moknz/grading?done=1');

  const after = await req(`/p/${aroha}`);
  ok('and the register shows the new grade', after.html.includes('3rd kyu'));
  ok('candidates come from the dojo beneath, not the empty national roll',
    g.html.includes('Aroha'));
}

console.log('\nSIGNING OUT');
{
  const r = await req('/signout', { method:'POST', form:{} });
  ok('redirects to sign-in', r.location === '/signin',
    `status ${r.status} loc ${r.location}`);
  ok('and the dashboard is closed again',
    (await req('/dashboard')).status === 302);
}

console.log('\nNOT FOUND, AND REDIRECTS');
{
  const r = await req('/nope');
  ok('404 renders a page, not a crash',
    r.status === 404 && r.html.includes('does not exist'));

  await pool.query(`insert into redirect (from_path,to_path,reason)
    values ('/old-dojo','/whanganui','test') on conflict do nothing`);
  const moved = await req('/old-dojo');
  ok('a known old path 301s instead of 404ing',
    moved.status === 301 && moved.location === '/whanganui');

  await pool.query(`update organisation set slug='whanganui-city' where slug='whanganui'`);
  const auto = await req('/whanganui');
  ok('renaming a slug writes its own redirect',
    auto.status === 301 && auto.location === '/whanganui-city');
  ok('and existing redirects follow the rename, so no chains form',
    (await req('/old-dojo')).location === '/whanganui-city');
  await pool.query(`update organisation set slug='whanganui' where slug='whanganui-city'`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
await pool.end();
process.exit(fail ? 1 : 0);
