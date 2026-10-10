/**
 * Finding the event a request is about, and the facts about it the competition screens share.
 */
import { lookups, competition, NotFound } from './data.mjs';
import { toLocalInput } from './zones.mjs';
import { Division } from '../core/domain/competition.mjs';
import { calendar, organisationFor } from './access.mjs';

/** The event named in the path, on an organisation the actor may be at. */
export async function eventFor(ctx, { toSchedule = false } = {}) {
  const org = await organisationFor(ctx, { toSchedule });
  const { repo } = await calendar();
  const event = await repo.bySlug(org.id, ctx.params.eventSlug);
  if (!event) throw new NotFound('Event');
  return { org, event };
}

/** The day the event runs, as a calendar day in the organisation's zone. */
export const dayOf = (event, zone) => toLocalInput(event.startsAt, zone).slice(0, 10);

/** The organiser's configuration, turned into what the engine takes. */
export async function engineSetupFor(eventId) {
  const setup = await competition.setupFor(eventId);
  const byDiscipline = {};
  for (const [id, rows] of Object.entries(setup.byDiscipline)) {
    byDiscipline[id] = rows.map((d) => new Division({
      id: d.id, disciplineId: d.discipline_id, label: d.label, summary: d.summary,
      minRankOrder: d.min_rank_order, maxRankOrder: d.max_rank_order,
      minAge: d.min_age, maxAge: d.max_age,
      minWeightKg: d.min_weight_kg, maxWeightKg: d.max_weight_kg,
      gender: d.gender,
      minYearsTraining: d.min_years_training, maxYearsTraining: d.max_years_training,
      minPriorEvents: d.min_prior_events, maxPriorEvents: d.max_prior_events,
      options: d.options, sortOrder: d.sort_order, capacity: d.capacity,
    }));
  }
  const prices = setup.prices.map((p) => ({ forCount: p.for_count,
    amountCents: p.amount_cents, membersOnly: p.members_only,
    currency: p.currency }));
  return { ...setup, engineDivisions: byDiscipline, enginePrices: prices };
}

/**
 * The event may belong to somebody else.
 *
 * A club enters its people in the federation's tournament, and it has no role
 * at the federation. So the organisation in the path is the CLUB doing the
 * entering — checked for the registrar role there — and the event is found by
 * looking up the tree from it. Requiring a grant at the host would mean only
 * the federation could ever enter anybody.
 */
export async function entryContextFor(ctx) {
  const org = await organisationFor(ctx, { toRegister: true });
  const host = await lookups.eventHost(org.id, ctx.params.eventSlug);
  if (!host) throw new NotFound('Event');

  const { repo } = await calendar();
  const event = await repo.bySlug(host.id, ctx.params.eventSlug);
  if (!event) throw new NotFound('Event');
  return { org, host, event };
}
