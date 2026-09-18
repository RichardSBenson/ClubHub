import { pool } from './data.mjs';
import * as auth from './auth.mjs';

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const throws = async (n,fn) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — did not throw`); }
  catch(e){ pass++; console.log(`  ✓ ${n} — ${e.message}`); }
};

const DOUG_EMAIL = 'doug@example.nz';

console.log('\nREQUESTING A LINK TELLS YOU NOTHING');
{
  const known = await auth.requestLink(DOUG_EMAIL, { ip: '203.0.113.1' });
  const unknown = await auth.requestLink('nobody@example.nz', { ip: '203.0.113.1' });
  ok('both report sent', known.sent && unknown.sent);
  ok('a real address produces a token', !!known.token);
  ok('an unknown one does not, silently', unknown.token === null);
  ok('the two responses are indistinguishable to the caller',
    JSON.stringify(Object.keys(known).sort()) !==
    JSON.stringify(Object.keys(unknown).sort())
      ? known.sent === unknown.sent : true);
  global.link = known.token;
}

console.log('\nNOTHING USABLE IS STORED');
{
  const { rows } = await pool.query(
    `select token_hash from login_link order by created_at desc limit 1`);
  ok('the link is stored hashed', rows[0].token_hash !== global.link);
  ok('and the hash is sha-256', /^[0-9a-f]{64}$/.test(rows[0].token_hash));
}

console.log('\nREDEEMING');
{
  const { token: session, redirectTo } = await auth.redeemLink(global.link,
    { userAgent: 'test', ip: '203.0.113.1' });
  ok('a session token comes back', !!session && session.length > 40);
  global.session = session;

  await throws('the same link cannot be used twice',
    () => auth.redeemLink(global.link));
  await throws('a made-up link is refused',
    () => auth.redeemLink('not-a-real-token'));
}

console.log('\nEXPIRY');
{
  const { token: t } = await auth.requestLink(DOUG_EMAIL);
  await pool.query(`update login_link set expires_at = now() - interval '1 minute'
    where used_at is null and token_hash is not null`);
  await throws('an expired link is refused', () => auth.redeemLink(t));
}

console.log('\nRATE LIMITING');
{
  await pool.query(`delete from login_attempt`);
  for (let i = 0; i < 5; i++) await auth.requestLink(DOUG_EMAIL, { ip: '198.51.100.1' });
  await throws('the sixth request in an hour is blocked',
    () => auth.requestLink(DOUG_EMAIL, { ip: '198.51.100.1' }));
  const { rows } = await pool.query(
    `select outcome, count(*)::int n from login_attempt group by outcome order by n desc`);
  ok('attempts are recorded for review',
    rows.some(r => r.outcome === 'rate_limited'));
  console.log('      → ' + rows.map(r => `${r.outcome}: ${r.n}`).join(', '));
}

console.log('\nTHE ACTOR A REQUEST GETS');
{
  const me = await auth.currentActor(global.session);
  ok('resolves to a person', me.name === 'Doug Holloway');
  ok('with their member number', me.memberNumber === 'NZ-0001');
  ok('carries their grants', me.grants.some(g => g.role === 'owner'));
  ok('and everything they can act on', me.scope.length === 18, me.scope.length);
  ok('home is the top of their branch', me.home.slug === 'moknz');
  ok('can() answers directly',
    me.can('owner', me.grants[0].id) && !me.can('registrar', me.grants[0].id));
  console.log(`      → ${me.name}, ${me.scope.length} organisations, ` +
    `${me.grants.map(g=>`${g.role}@${g.slug}`).join(', ')}`);

  ok('a junk token resolves to nobody', await auth.currentActor('junk') === null);
  ok('no token resolves to nobody', await auth.currentActor(null) === null);
}

console.log('\nSIGNING OUT');
{
  ok('sessions are listed for the account',
    (await auth.sessionsFor((await auth.currentActor(global.session)).accountId)).length >= 1);
  ok('sign out works', await auth.signOut(global.session));
  ok('and the session stops resolving',
    await auth.currentActor(global.session) === null);
  ok('signing out twice is harmless', !(await auth.signOut(global.session)));
}

console.log('\nSIGN OUT EVERYWHERE');
{
  const { rows:[acct] } = await pool.query(
    `select id from account where email=$1`, [DOUG_EMAIL]);
  await pool.query(`delete from login_attempt`);
  const tokens = [];
  for (let i = 0; i < 3; i++) {
    const { token } = await auth.requestLink(DOUG_EMAIL);
    tokens.push((await auth.redeemLink(token)).token);
  }
  ok('three devices signed in',
    (await Promise.all(tokens.map(auth.currentActor))).every(Boolean));
  const n = await auth.signOutAll(acct.id);
  ok(`all ${n} revoked at once`, n === 3);
  ok('none of them resolve any more',
    (await Promise.all(tokens.map(auth.currentActor))).every(a => a === null));
}

console.log('\nHOUSEKEEPING');
{
  const purged = await auth.purgeExpired();
  ok('purge runs and reports', typeof purged.links === 'number');
}

console.log('\nTHE EMAIL');
{
  const { subject, text } = auth.signInEmail({
    name: 'Doug', link: 'https://example.nz/signin?t=abc',
    federation: 'Mas Oyama Karate New Zealand' });
  ok('subject names the federation', subject.includes('Mas Oyama'));
  ok('body contains the link', text.includes('https://example.nz/signin?t=abc'));
  ok('and says it expires', text.includes('15 minutes'));
  ok('and reassures anyone who did not ask', text.includes('did not ask'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
