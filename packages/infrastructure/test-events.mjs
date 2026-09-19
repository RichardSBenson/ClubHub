/**
 * Proof that the event system earns its place: publishing moves a page and a
 * redirect appears, without the publishing use case knowing redirects exist.
 */

import '../api/reset.mjs';
import { execSync } from 'node:child_process';
import { pool } from './postgres/pool.mjs';
import { PublishRevision } from '../core/application/publish-revision.mjs';
import { WithdrawPublication } from '../core/application/withdraw-publication.mjs';
import { PostgresPublications, PostgresEntries, PostgresAuthorisation,
         SystemClock } from './postgres/repositories.mjs';
import { DispatchingEventBus, RedirectWriter, RebuildQueue }
  from './events/subscribers.mjs';

for (const f of ['002-revisions','004-routing','006-publishing','007-rebuild-queue'])
  execSync(`su postgres -c "psql -h /tmp/pgrun -p 5433 -U postgres -d honbu -q -f /tmp/${f}.sql"`);

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const settle = () => new Promise(r => setTimeout(r, 150));

const DOUG = '33333333-0000-0000-0000-000000000001';
const { rows: [page] } = await pool.query(`select id from page limit 1`);
const { rows: [rev] } = await pool.query(
  `insert into page_revision (page_id, title, body)
   select id, title, body from page where id=$1 returning id`, [page.id]);

const events = new DispatchingEventBus(pool,
  [new RedirectWriter(pool), new RebuildQueue(pool)]);
const deps = {
  publications: new PostgresPublications(pool),
  entries: new PostgresEntries(pool),
  auth: new PostgresAuthorisation(pool),
  events, clock: new SystemClock(),
};
const publish = new PublishRevision(deps);
const withdraw = new WithdrawPublication(deps);

console.log('\nMOVING A PAGE LEAVES A REDIRECT');
{
  await publish.execute({ actorId: DOUG, entryId: page.id, path: '/about' });
  await settle();
  await publish.execute({ actorId: DOUG, entryId: page.id, path: '/about-us' });
  await settle();

  const { rows } = await pool.query(
    `select from_path, to_path, permanent, reason from redirect`);
  ok('a redirect was written', rows.length === 1, JSON.stringify(rows));
  ok('from the old path to the new', rows[0]?.from_path === '/about'
    && rows[0]?.to_path === '/about-us');
  ok('permanent, because the page moved', rows[0]?.permanent === true);
  console.log(`      → ${rows[0]?.from_path} → ${rows[0]?.to_path} (${rows[0]?.reason})`);
}

console.log('\nAND THE USE CASE KNOWS NOTHING ABOUT REDIRECTS');
{
  const src = await import('node:fs').then(fs =>
    fs.readFileSync(new URL('../core/application/publish-revision.mjs',
      import.meta.url), 'utf8'));
  ok('the word "redirect" does not appear in the publishing use case',
    !/redirect/i.test(src));
  ok('nor in the domain',
    !/redirect/i.test(await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../core/domain/publishing.mjs', import.meta.url),
        'utf8'))));
}

console.log('\nMOVING AGAIN DOES NOT CREATE A CHAIN');
{
  await publish.execute({ actorId: DOUG, entryId: page.id, path: '/who-we-are' });
  await settle();

  const { rows } = await pool.query(
    `select from_path, to_path from redirect order by from_path`);
  ok('both old paths are kept', rows.length === 2);
  ok('and both point at the current one',
    rows.every(r => r.to_path === '/who-we-are'),
    JSON.stringify(rows));
  console.log('      → ' + rows.map(r => `${r.from_path} → ${r.to_path}`).join(', '));
}

console.log('\nWITHDRAWING RECORDS THE GAP');
{
  await withdraw.execute({ actorId: DOUG, entryId: page.id });
  await settle();
  const { rows: [r] } = await pool.query(
    `select * from redirect where from_path='/who-we-are'`);
  ok('a withdrawn page gets a temporary redirect', r && r.permanent === false);
  ok('with a reason someone can read', r?.reason?.startsWith('withdrawn'));
}

console.log('\nTHE REBUILD QUEUE KNOWS WHAT CHANGED');
{
  const { rows } = await pool.query(
    `select path, reason from rebuild_queue order by path`);
  ok('affected paths are queued, not the whole site', rows.length === 3,
    rows.length);
  console.log('      → ' + rows.map(r => r.path).join(', '));
}

console.log('\nEVENTS ARE STORED AND MARKED HANDLED');
{
  const { rows } = await pool.query(`
    select name, count(*)::int as n,
           count(*) filter (where handled_at is not null)::int as done
    from domain_event group by name order by n desc`);
  ok('every event was stored', rows.length >= 2);
  ok('and all were handled without error',
    rows.every(r => r.done === r.n), JSON.stringify(rows));
  rows.forEach(r => console.log(`      → ${r.name}: ${r.n} (${r.done} handled)`));
}

console.log('\nA FAILING SUBSCRIBER DOES NOT BREAK PUBLISHING');
{
  class Broken {
    get subscribes() { return ['publication.created']; }
    async handle() { throw new Error('deliberately broken'); }
  }
  const fragile = new DispatchingEventBus(pool, [new Broken()]);
  const p = new PublishRevision({ ...deps, events: fragile });

  let threw = false;
  try {
    await p.execute({ actorId: DOUG, entryId: page.id, path: '/back-again' });
  } catch { threw = true; }
  await settle();

  ok('publishing still succeeded', !threw);
  const { rows: [live] } = await pool.query(
    `select path from publication where entry_id=$1 and status='live'`, [page.id]);
  ok('and the page is live', live?.path === '/back-again');

  const { rows: [bad] } = await pool.query(
    `select last_error, attempts from domain_event
     where last_error is not null order by id desc limit 1`);
  ok('the failure was recorded, not swallowed',
    bad?.last_error?.includes('deliberately broken'));
  console.log(`      → ${bad?.last_error}`);

  const retry = await fragile.retryFailed();
  ok('and it can be retried', retry.tried >= 1);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
