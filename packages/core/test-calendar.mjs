/**
 * The calendar's rules, with no database anywhere.
 *
 * Everything here runs against in-memory adapters, which is the point: if a
 * rule needs Postgres to be true, it is in the wrong layer. The same use cases
 * are exercised against the real database in packages/api/test-events.mjs.
 */
import { InMemoryEvents, InMemoryOrganisations, AllowAll, DenyAll, FixedClock }
  from '../infrastructure/memory/repositories.mjs';
import { ScheduleEvent, ReviseEvent, CancelEvent }
  from './application/schedule-event.mjs';
import { Refused, NotPermitted } from './application/ports.mjs';

const orgs = new InMemoryOrganisations([
  { id: 'wh', type: 'club', name: 'Whanganui', federationId: 'moknz' },
]);
const build = (auth = new AllowAll()) => {
  const events = new InMemoryEvents();
  const deps = { events, organisations: orgs, auth, clock: new FixedClock('2026-09-29') };
  return { events, schedule: new ScheduleEvent(deps), revise: new ReviseEvent(deps),
           cancel: new CancelEvent({ events, auth }) };
};
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`));
const throws = async (n, fn, msg) => {
  try { await fn(); ok(n, false, 'did not throw'); }
  catch (e) { ok(n, !msg || e.message.includes(msg), e.message); }
};

console.log('\nPUTTING AN EVENT ON THE CALENDAR');
{
  const { schedule } = build();
  const e = await schedule.execute({ actorId: 'a', organisationId: 'wh',
    kind: 'grading', title: 'Summer Kyu Grading', startsAt: '2026-12-05T09:00+13:00' });
  ok('it is saved with an id', !!e.id);
  ok('the web address comes from the title', String(e.slug) === 'summer-kyu-grading');
  ok('and it starts as a draft', e.status === 'draft');
}

console.log('\nRULES THAT DO NOT DEPEND ON THE DATABASE');
{
  const { schedule } = build();
  await throws('an end before the start is refused', () => schedule.execute({
    actorId: 'a', organisationId: 'wh', kind: 'camp', title: 'Summer camp',
    startsAt: '2026-12-05T09:00Z', endsAt: '2026-12-01T09:00Z' }), 'end is before the start');

  await throws('entries closing after it begins is refused', () => schedule.execute({
    actorId: 'a', organisationId: 'wh', kind: 'tournament', title: 'Open',
    startsAt: '2026-12-05T09:00Z', entriesClose: '2026-12-09T09:00Z' }), 'entries close after');

  await throws('a black belt seminar with no grade range is refused', () => schedule.execute({
    actorId: 'a', organisationId: 'wh', kind: 'seminar', title: 'Black belt seminar',
    startsAt: '2026-12-05T09:00Z', visibility: 'by_grade' }), 'needs a lowest or highest');
}

console.log('\nTWO EVENTS CANNOT SHARE AN ADDRESS');
{
  const { schedule } = build();
  const base = { actorId: 'a', organisationId: 'wh', kind: 'grading',
    title: 'Summer Kyu Grading', startsAt: '2026-12-05T09:00Z' };
  await schedule.execute(base);
  await throws('the second one is refused, by name', () => schedule.execute(base),
    'already has an event at');
}

console.log('\nWHO MAY TOUCH IT');
{
  const { schedule } = build(new DenyAll());
  await throws('someone without the role is stopped', () => schedule.execute({
    actorId: 'a', organisationId: 'wh', kind: 'social', title: 'Quiz night',
    startsAt: '2026-12-05T09:00Z' }), 'may not put events');
}

console.log('\nCHANGING ONE');
{
  const { schedule, revise, events } = build();
  const e = await schedule.execute({ actorId: 'a', organisationId: 'wh',
    kind: 'grading', title: 'Summer Kyu Grading', startsAt: '2026-12-05T09:00+13:00' });

  const published = await revise.execute({ actorId: 'a', eventId: e.id, status: 'published' });
  ok('it can be published', published.status === 'published');
  ok('and keeps its identity', published.id === e.id);

  const moved = await revise.execute({ actorId: 'a', eventId: e.id,
    startsAt: '2026-12-12T09:00+13:00', venueName: 'Springvale Hall' });
  ok('the date and venue can be changed', moved.venueName === 'Springvale Hall'
    && moved.startsAt.toISOString().startsWith('2026-12-11'));
  ok('and it stays published', moved.status === 'published');

  await revise.execute({ actorId: 'a', eventId: e.id, organisationId: 'somewhere-else' });
  ok('it cannot be moved to another organisation',
    (await events.byId(e.id)).organisationId === 'wh');

  await throws('an invented status is refused',
    () => revise.execute({ actorId: 'a', eventId: e.id, status: 'nonsense' }),
    'cannot go from published to nonsense');

  await revise.execute({ actorId: 'a', eventId: e.id, status: 'completed' });
  await throws('and once completed it cannot be reopened',
    () => revise.execute({ actorId: 'a', eventId: e.id, status: 'published' }),
    'from completed to published');
}

console.log('\nCALLING IT OFF KEEPS THE RECORD');
{
  const { schedule, revise, cancel, events } = build();
  const e = await schedule.execute({ actorId: 'a', organisationId: 'wh',
    kind: 'tournament', title: 'Kokoro Cup', startsAt: '2026-12-05T09:00Z' });
  await revise.execute({ actorId: 'a', eventId: e.id, status: 'published' });
  const off = await cancel.execute({ actorId: 'a', eventId: e.id });
  ok('it is cancelled, not deleted', off.status === 'cancelled');
  ok('and it is still there to be seen', !!(await events.byId(e.id)));
  ok('no longer public', off.isPublic === false);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
