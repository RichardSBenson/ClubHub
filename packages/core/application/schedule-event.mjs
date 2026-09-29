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
export const MAY_SCHEDULE = ['owner', 'administrator', 'registrar'];

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
    const event = new Event({ ...fields, organisationId });

    const clash = await this.events.bySlug(organisationId, String(event.slug));
    if (clash) {
      throw new Refused(
        `${org.name} already has an event at "${event.slug}". `
        + 'Change the title, or give this one its own web address.');
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
