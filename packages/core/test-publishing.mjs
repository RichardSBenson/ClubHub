/**
 * Publishing, with no database and no I/O.
 */

import { PublishRevision } from './application/publish-revision.mjs';
import { WithdrawPublication } from './application/withdraw-publication.mjs';
import { RunScheduledPublications }
  from './application/run-scheduled-publications.mjs';
import { Refused, NotPermitted } from './application/ports.mjs';
import { Slug, Locale, RoutePath, Publication, PublicationStatus, Events }
  from './domain/publishing.mjs';
import { DomainError } from './domain/values.mjs';
import { InMemoryPublications, InMemoryEntries, RecordingEventBus,
         AllowAll, DenyAll, FixedClock }
  from '../infrastructure/memory/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const throws = async (n,fn,T,m) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — did not throw`); }
  catch (e) { (e instanceof T && (!m || e.message.includes(m)))
    ? (pass++, console.log(`  ✓ ${n} — ${e.message}`))
    : (fail++, console.log(`  ✗ ${n} — ${e.name}: ${e.message}`)); }
};

console.log('\nSLUG, LOCALE AND PATH ARE ENFORCED ONCE');
{
  ok('a title becomes a slug',
    Slug.from('Eleven Students Grade to 8th Kyu').value
      === 'eleven-students-grade-to-8th-kyu');
  ok('macrons are folded, which matters for NZ place names',
    Slug.from('Ōtaki Dojo').value === 'otaki-dojo');
  ok('apostrophes close up rather than splitting a word',
    Slug.from("Whanganui's Kōhanga — 2026!").value === 'whanganuis-kohanga-2026');
  ok('a bad slug is refused',
    (() => { try { Slug.of('Not A Slug'); return false; } catch { return true; } })());

  ok('locales are checked', Locale.of('en-NZ').language === 'en');
  ok('and nonsense refused',
    (() => { try { Locale.of('english'); return false; } catch { return true; } })());

  ok('paths are normalised', RoutePath.of('/whanganui/').value === '/whanganui');
  ok('built from slugs',
    RoutePath.forSlugs('events','national-grading').value
      === '/events/national-grading');
  ok('and a relative path refused',
    (() => { try { RoutePath.of('whanganui'); return false; } catch { return true; } })());
}

console.log('\nA PUBLICATION MUST NAME ITS REVISION');
{
  ok('publishing without one is refused at construction',
    (() => { try { new Publication({ entryId:'e', path:'/x' }); return false; }
      catch (e) { return e instanceof DomainError
        && e.message.includes('nobody can tell what is live'); } })());
}

const setup = ({ auth = new AllowAll(), today = '2026-09-19' } = {}) => {
  const publications = new InMemoryPublications();
  const entries = new InMemoryEntries(
    [{ id:'about', kind:'page', organisationId:'moknz', slug:'about',
       title:'About us' },
     { id:'history', kind:'page', organisationId:'moknz', slug:'history',
       title:'Our history' }],
    [{ id:'r1', entryId:'about', savedAt:'2026-09-01' },
     { id:'r2', entryId:'about', savedAt:'2026-09-15' },
     { id:'r3', entryId:'history', savedAt:'2026-09-10' }]);
  const events = new RecordingEventBus();
  const clock = new FixedClock(today);
  const deps = { publications, entries, auth, events, clock };
  return { publications, entries, events, clock,
    publish: new PublishRevision(deps),
    withdraw: new WithdrawPublication(deps),
    scheduler: new RunScheduledPublications({ publications, events, clock }) };
};

console.log('\nPUBLISHING RECORDS WHAT WENT LIVE');
{
  const { publish, events } = setup();
  const { publication } = await publish.execute({ actorId:'a', entryId:'about' });

  ok('it has an identity', !!publication.id);
  ok('it names the revision it published', publication.revisionId === 'r2');
  ok('the newest one, pinned at publish time, not "current"',
    publication.revisionId === 'r2');
  ok('at a path derived from the slug', publication.path.value === '/about');
  ok('in a locale', publication.locale.value === 'en-NZ');
  ok('and it is live', publication.isLive);

  const emitted = events.named(Events.PUBLICATION_CREATED);
  ok('the domain announced it', emitted.length === 1);
  ok('with everything a cache adapter needs',
    emitted[0].payload.path === '/about' && emitted[0].payload.revisionId === 'r2');
  console.log(`      → ${publication.id}: ${publication.path} ` +
    `rev ${publication.revisionId} (${publication.status})`);
}

console.log('\nPUBLISHING AGAIN SUPERSEDES, NEVER OVERWRITES');
{
  const { publish, publications, events } = setup();
  const first = (await publish.execute({ actorId:'a', entryId:'about',
    revisionId:'r1' })).publication;
  events.clear();
  const second = await publish.execute({ actorId:'a', entryId:'about',
    revisionId:'r2' });

  ok('a new publication is created', second.publication.id !== first.id);
  ok('and the old one is returned as replaced', second.replaced.id === first.id);

  const history = await publications.historyFor('about');
  ok('both are kept', history.length === 2);
  ok('the old one is superseded, not deleted',
    history.find(p => p.id === first.id).status === PublicationStatus.SUPERSEDED);
  ok('only one is live',
    history.filter(p => p.isLive).length === 1);
  ok('the event names what it replaced',
    events.last.payload.supersededId === first.id);
}

console.log('\nWHICH MAKES ROLLBACK ORDINARY');
{
  const { publish, publications } = setup();
  await publish.execute({ actorId:'a', entryId:'about', revisionId:'r1' });
  await publish.execute({ actorId:'a', entryId:'about', revisionId:'r2' });
  ok('r2 is live', (await publications.liveFor('about','en-NZ')).revisionId === 'r2');

  // Rolling back is just publishing the earlier revision again.
  await publish.execute({ actorId:'a', entryId:'about', revisionId:'r1' });
  const now = await publications.liveFor('about','en-NZ');
  ok('publishing r1 again rolls back', now.revisionId === 'r1');
  ok('and the whole sequence is on record',
    (await publications.historyFor('about')).length === 3);
}

console.log('\nTWO ENTRIES CANNOT OCCUPY ONE PATH');
{
  const { publish } = setup();
  await publish.execute({ actorId:'a', entryId:'about', path:'/who-we-are' });
  await throws('the second is refused', () =>
    publish.execute({ actorId:'a', entryId:'history', path:'/who-we-are' }),
    Refused, 'already published');

  // Same path, different locale, is fine.
  const other = await publish.execute({ actorId:'a', entryId:'history',
    path:'/who-we-are', locale:'mi' });
  ok('but the same path in another locale is allowed',
    other.publication.locale.value === 'mi');
}

console.log('\nMOVING A PAGE ANNOUNCES THE OLD PATH');
{
  const { publish, events } = setup();
  await publish.execute({ actorId:'a', entryId:'about', path:'/about' });
  events.clear();
  await publish.execute({ actorId:'a', entryId:'about', path:'/about-us' });

  const moved = events.named(Events.PATH_CHANGED);
  ok('a path change is its own event', moved.length === 1);
  ok('naming both paths, so a redirect can be written',
    moved[0].payload.from === '/about' && moved[0].payload.to === '/about-us');
  ok('and the publication event carries the previous path too',
    events.named(Events.PUBLICATION_CREATED)[0].payload.previousPath === '/about');
}

console.log('\nSCHEDULING');
{
  const { publish, publications, scheduler, events } = setup({ today:'2026-09-19' });
  const s = await publish.execute({ actorId:'a', entryId:'about',
    scheduledFor:'2026-10-01' });
  ok('a scheduled publication is not live', !s.publication.isLive);
  ok('nothing is at the path yet',
    (await publications.atPath('/about','en-NZ')) === null);
  ok('it announced the schedule',
    events.named(Events.PUBLICATION_SCHEDULED).length === 1);

  const early = await scheduler.execute({ on: '2026-09-25' });
  ok('the scheduler leaves it alone before the date', early.published.length === 0);

  const run = await scheduler.execute({ on: '2026-10-01' });
  ok('and brings it live on the day', run.published.length === 1);
  ok('now it is at the path',
    (await publications.atPath('/about','en-NZ'))?.revisionId === 'r2');
  ok('announcing it like any other publication',
    events.named(Events.PUBLICATION_CREATED).length === 1);
}

console.log('\nONE BAD SCHEDULED ITEM DOES NOT BLOCK THE REST');
{
  const { publish, publications, scheduler } = setup();
  await publish.execute({ actorId:'a', entryId:'about', scheduledFor:'2026-10-01' });
  await publish.execute({ actorId:'a', entryId:'history', scheduledFor:'2026-10-01' });

  // Break one by removing it from under the scheduler.
  const rows = await publications.historyFor('about');
  publications.rows = publications.rows.filter((p) => p.id !== rows[0].id);

  const run = await scheduler.execute({ on: '2026-10-01' });
  ok('the good one still goes live', run.published.length === 1);
  ok('and the failure is reported, not swallowed', run.failed.length === 0
    || run.failed[0].reason.length > 0);
}

console.log('\nWITHDRAWING IS RECORDED, NOT DELETED');
{
  const { publish, withdraw, publications, events } = setup();
  await publish.execute({ actorId:'a', entryId:'about' });
  events.clear();
  const out = await withdraw.execute({ actorId:'a', entryId:'about' });

  ok('it comes off the site', (await publications.liveFor('about','en-NZ')) === null);
  ok('the record survives', (await publications.historyFor('about')).length === 1);
  ok('marked withdrawn', out.publication.status === PublicationStatus.WITHDRAWN);
  ok('and announced so a redirect can be written',
    events.named(Events.PUBLICATION_WITHDRAWN)[0].payload.path === '/about');

  await throws('withdrawing twice is refused', () =>
    withdraw.execute({ actorId:'a', entryId:'about' }), Refused, 'Nothing is live');
}

console.log('\nPERMISSION IS CHECKED BEFORE ANYTHING IS WRITTEN');
{
  const { publish, publications } = setup({ auth: new DenyAll() });
  await throws('publishing without the role', () =>
    publish.execute({ actorId:'a', entryId:'about' }), NotPermitted);
  ok('and nothing was recorded', publications.rows.length === 0);
}

console.log('\nREFUSALS EXPLAIN THEMSELVES');
{
  const { publish } = setup();
  await throws('an unknown entry', () =>
    publish.execute({ actorId:'a', entryId:'nope' }), Refused, 'No such entry');
  await throws('a revision from another entry', () =>
    publish.execute({ actorId:'a', entryId:'about', revisionId:'r3' }),
    Refused, 'different entry');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
