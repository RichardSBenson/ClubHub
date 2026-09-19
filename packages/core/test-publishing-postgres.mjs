import '../api/reset.mjs';
import { pool } from '../api/data.mjs';
import { PublishRevision } from './application/publish-revision.mjs';
import { WithdrawPublication } from './application/withdraw-publication.mjs';
import { RunScheduledPublications } from './application/run-scheduled-publications.mjs';
import { Refused } from './application/ports.mjs';
import { PublicationStatus, Events } from './domain/publishing.mjs';
import { PostgresPublications, PostgresEntries, PostgresEventBus,
         PostgresAuthorisation, SystemClock }
  from '../infrastructure/postgres/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const throws = async (n,fn,T,m) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — did not throw`); }
  catch (e) { (e instanceof T && (!m || e.message.includes(m)))
    ? (pass++, console.log(`  ✓ ${n} — ${e.message}`))
    : (fail++, console.log(`  ✗ ${n} — ${e.name}: ${e.message}`)); }
};

// Apply the migrations this test needs.
const { execSync } = await import('node:child_process');
for (const f of ['002-revisions','006-publishing'])
  execSync(`su postgres -c "psql -h /tmp/pgrun -p 5433 -U postgres -d honbu -q -f /tmp/${f}.sql"`);

const DOUG = '33333333-0000-0000-0000-000000000001';
const { rows: [page] } = await pool.query(`select id from page limit 1`);
const { rows: [rev] } = await pool.query(
  `insert into page_revision (page_id, title, body)
   select id, title, body from page where id=$1 returning id`, [page.id]);

const deps = {
  publications: new PostgresPublications(pool),
  entries: new PostgresEntries(pool),
  auth: new PostgresAuthorisation(pool),
  events: new PostgresEventBus(pool),
  clock: new SystemClock(),
};
const publish = new PublishRevision(deps);
const withdraw = new WithdrawPublication(deps);
const scheduler = new RunScheduledPublications(deps);

console.log('\nTHE SAME USE CASES, WIRED TO POSTGRES');
{
  const { publication } = await publish.execute({ actorId: DOUG, entryId: page.id });
  ok('a publication is recorded', !!publication.id);
  ok('naming its revision', publication.revisionId === rev.id);
  ok('and it is live', publication.isLive);
  console.log(`      → ${publication.path} rev ${publication.revisionId.slice(0,8)}`);
}

console.log('\nSUPERSEDING WORKS THE SAME');
{
  const { rows: [r2] } = await pool.query(
    `insert into page_revision (page_id, title, body)
     select id, title, body from page where id=$1 returning id`, [page.id]);
  const out = await publish.execute({ actorId: DOUG, entryId: page.id,
    revisionId: r2.id });
  ok('the previous is returned as replaced', !!out.replaced);

  const { rows } = await pool.query(
    `select status, count(*)::int n from publication where entry_id=$1
     group by status`, [page.id]);
  const byStatus = Object.fromEntries(rows.map(r => [r.status, r.n]));
  ok('one live', byStatus.live === 1);
  ok('one superseded', byStatus.superseded === 1);
}

console.log('\nTHE DATABASE ENFORCES ONE LIVE PER PATH');
{
  // Not the application — two code paths publishing at once is exactly when
  // application-level checking would lose.
  const { rows: [other] } = await pool.query(
    `insert into page (organisation_id, slug, title, body, status)
     select organisation_id, 'rival', 'Rival', '{}'::jsonb, 'published'
     from page where id=$1 returning id`, [page.id]);
  const live = await deps.publications.liveFor(page.id, 'en-NZ');

  let blocked = false;
  try {
    await pool.query(`
      insert into publication (entry_id, entry_kind, revision_id, path, locale,
        organisation_id, status, published_at)
      select $1,'page',$2,$3,'en-NZ',organisation_id,'live',current_date
      from page where id=$1`, [other.id, rev.id, live.path.value]);
  } catch (e) { blocked = e.code === '23505'; }
  ok('a second live publication at the same path is rejected by the index',
    blocked);
}

console.log('\nEVENTS ARE STORED');
{
  await new Promise(r => setTimeout(r, 120));   // emit is fire-and-forget
  const { rows } = await pool.query(
    `select name, count(*)::int n from domain_event group by name order by n desc`);
  ok('publication events were written', rows.some(r =>
    r.name === Events.PUBLICATION_CREATED));
  console.log('      → ' + rows.map(r => `${r.name}: ${r.n}`).join(', '));
}

console.log('\nSCHEDULING AGAINST REAL DATES');
{
  const { rows: [p2] } = await pool.query(
    `insert into page (organisation_id, slug, title, body, status)
     select organisation_id, 'later', 'Later', '{}'::jsonb, 'draft'
     from page where id=$1 returning id`, [page.id]);
  const { rows: [r] } = await pool.query(
    `insert into page_revision (page_id, title, body)
     values ($1,'Later','{}'::jsonb) returning id`, [p2.id]);

  const s = await publish.execute({ actorId: DOUG, entryId: p2.id,
    revisionId: r.id, scheduledFor: '2020-01-01' });
  ok('scheduled, not live', !s.publication.isLive);

  const run = await scheduler.execute({ on: '2026-09-19' });
  ok('a past date is due and goes live', run.published.length >= 1);
  ok('and nothing failed', run.failed.length === 0,
    JSON.stringify(run.failed));
}

console.log('\nWITHDRAWING');
{
  const out = await withdraw.execute({ actorId: DOUG, entryId: page.id });
  ok('marked withdrawn', out.publication.status === PublicationStatus.WITHDRAWN);
  ok('nothing live for that entry',
    (await deps.publications.liveFor(page.id, 'en-NZ')) === null);
  ok('but the history is intact',
    (await deps.publications.historyFor(page.id)).length === 2);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
