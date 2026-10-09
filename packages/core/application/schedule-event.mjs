/**
 * USE CASE — put an event on the calendar, change it, or call it off.
 *
 * Three operations on one entity, in one file because they share every rule
 * about who may do it and what a clash means. Splitting them would mean three
 * copies of the same permission check drifting apart.
 *
 * The rules that live HERE rather than in the entity are the ones that need to
 * look at the world: who is asking, and whether the slug is already taken.
 * Everything that is true of an event on its own is in the entity.
 */

import { Event } from '../domain/calendar.mjs';
import { REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted,
         EVENT_REPOSITORY, ORGANISATION_REPOSITORY, AUTHORISATION,
         CLOCK } from './ports.mjs';

/**
 * Who may run the calendar. An instructor can teach; they cannot schedule.
 *
 * Exported because the screens need the same answer: a form somebody is shown
 * and then not allowed to submit is a worse experience than not being offered
 * it, and two copies of this list would eventually disagree about which.
 */
export const MAY_SCHEDULE = REGISTER;

/** The local calendar day of an instant, as 2026-11-14, in the organisation's own time zone. */
function dayIn(date, zone) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'UTC' }).format(date); }
  catch { return date.toISOString().slice(0, 10); }
}

/**
 * Is this the same event twice? Decided by WHEN it is and what kind it is, never by its title:
 * a dojo runs several gradings a year, for juniors and for seniors, and they are all called
 * "Kyu Grading". Two events of one kind starting at the same moment is a slip of the finger.
 * `exceptId` lets an event be saved over itself.
 */
async function sameTimeAndKind(events, organisationId, event, exceptId = null) {
  const mine = await events.listFor(organisationId);
  return mine.find((e) => e.id !== exceptId && e.status !== 'cancelled'
    && e.kind === event.kind && new Date(e.startsAt).getTime() === event.startsAt.getTime()) ?? null;
}

export class ScheduleEvent {
  constructor({ events, organisations, auth, clock }) {
    this.events = requirePort(events, EVENT_REPOSITORY);
    this.organisations = requirePort(organisations, ORGANISATION_REPOSITORY);
    this.auth = requirePort(auth, AUTHORISATION);
    this.clock = requirePort(clock, CLOCK);
  }

  async execute({ actorId, organisationId, ...fields }) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, MAY_SCHEDULE))
      throw new NotPermitted('You may not put events on that calendar');

    const org = await this.organisations.byId(organisationId);
    if (!org) throw new Refused('No such organisation');

    // Built before the clash is checked, so a malformed event is refused for
    // being malformed rather than for a slug collision it never reached.
    let event = new Event({ ...fields, organisationId });

    const twin = await sameTimeAndKind(this.events, organisationId, event);
    if (twin) {
      throw new Refused(
        `${org.name} already has "${twin.title}" at that date and time. `
        + 'If it is a different event, change the time.');
    }

    // A web address nobody asked for is made unique for them: the title, then the date, then a
    // number. One that somebody typed themselves is theirs, so a clash with it is reported.
    const wanted = String(fields.slug ?? '').trim();
    const taken = async (slug) => !!await this.events.bySlug(organisationId, slug);
    if (await taken(String(event.slug))) {
      if (wanted) {
        throw new Refused(`${org.name} already has an event at "${event.slug}". Choose another web address.`);
      }
      const base = String(event.slug);
      const day = dayIn(event.startsAt, org.timezone);
      let candidate = `${base}-${day}`;
      for (let n = 2; await taken(candidate); n += 1) candidate = `${base}-${day}-${n}`;
      event = new Event({ ...fields, organisationId, slug: candidate });
    }

    return this.events.save(event);
  }
}

export class ReviseEvent {
  constructor({ events, organisations, auth, clock }) {
    this.events = requirePort(events, EVENT_REPOSITORY);
    this.organisations = requirePort(organisations, ORGANISATION_REPOSITORY);
    this.auth = requirePort(auth, AUTHORISATION);
    this.clock = requirePort(clock, CLOCK);
  }

  async execute({ actorId, eventId, ...changes }) {
    const existing = await this.events.byId(eventId);
    if (!existing) throw new Refused('No such event');

    if (!await this.auth.hasRoleAt(actorId, existing.organisationId, MAY_SCHEDULE))
      throw new NotPermitted('You may not change that event');

    // An event does not move between organisations. Whose calendar it is on is
    // not an editable field — it decides who may touch it at all.
    delete changes.organisationId;

    const status = changes.status;
    delete changes.status;

    let revised = existing.revisedWith(changes);
    if (status) revised = revised.movedTo(status);

    if (revised.startsAt.getTime() !== existing.startsAt.getTime() || revised.kind !== existing.kind) {
      const twin = await sameTimeAndKind(this.events, existing.organisationId, revised, existing.id);
      if (twin) throw new Refused(`There is already "${twin.title}" at that date and time.`);
    }

    if (String(revised.slug) !== String(existing.slug)) {
      const clash = await this.events.bySlug(
        existing.organisationId, String(revised.slug));
      if (clash && clash.id !== existing.id)
        throw new Refused(`Another event already uses "${revised.slug}".`);
    }

    return this.events.save(revised);
  }
}

/**
 * Calling something off is not deleting it.
 *
 * People have it in their diaries and have paid for it. A federation has to be
 * able to say it was cancelled, not that it never existed — so this moves the
 * status and keeps the record. Deleting is a separate, deliberate act, and it
 * is refused once anybody has entered.
 */
export class CancelEvent {
  constructor({ events, auth }) {
    this.events = requirePort(events, EVENT_REPOSITORY);
    this.auth = requirePort(auth, AUTHORISATION);
  }

  async execute({ actorId, eventId }) {
    const existing = await this.events.byId(eventId);
    if (!existing) throw new Refused('No such event');

    if (!await this.auth.hasRoleAt(actorId, existing.organisationId, MAY_SCHEDULE))
      throw new NotPermitted('You may not cancel that event');

    return this.events.save(existing.movedTo('cancelled'));
  }
}
