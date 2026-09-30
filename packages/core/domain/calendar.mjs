/**
 * DOMAIN — the calendar
 *
 * An Event is an entity: it has an identity that survives every edit, and it
 * carries the rules about itself that must hold however it was created — from
 * the admin, from an import, from a script at two in the morning.
 *
 * Named calendar.mjs rather than events.mjs because "event" already means
 * something else one folder over: a DomainEvent is a thing that HAPPENED and
 * is broadcast. This is a thing that is SCHEDULED. Two different nouns wearing
 * the same word is how a codebase starts lying to you.
 *
 * What is an entity here, and what is not:
 *
 *   Event        an entity. Identity, a life cycle, rules of its own.
 *   EventKind    not an entity. A federation's own list of what it runs —
 *                configuration, and different for every art.
 *   Visibility   a value object. Who may see this, expressed as a rule.
 *   Fees         a separate entity, because a fee is argued about, changed
 *                and refunded on its own timeline. Not modelled here.
 *   Entries      a separate entity for the same reason.
 *
 * Imports nothing but values and the slug rules.
 */

import { DomainError } from './values.mjs';
import { Slug } from './publishing.mjs';

// ---------------------------------------------------------------------------

/**
 * What a federation runs. Deliberately a plain list, not a hierarchy: a
 * federation adds 'fight_night' or 'instructor_course' and the platform does
 * not need to learn what either means.
 */
export const EventKind = Object.freeze({
  all: ['grading', 'tournament', 'camp', 'seminar', 'fight_night',
        'training', 'social', 'other'],
  isValid(k) { return EventKind.all.includes(k); },
});

/**
 * Who can see it.
 *
 *   public    anybody, including the website
 *   members   anybody affiliated, anywhere in the federation
 *   own_org   only people at the organisation that owns it
 *   by_grade  only people within a rank range — the black belt seminar
 *   invite    only people explicitly invited
 */
export const Visibility = Object.freeze({
  all: ['public', 'members', 'own_org', 'by_grade', 'invite'],
  isValid(v) { return Visibility.all.includes(v); },
});

/**
 * draft → published → cancelled
 *                  ↘ completed
 *
 * A cancelled event is never quietly deleted: people have it in their diaries
 * and a federation has to be able to say it was called off rather than that it
 * never existed.
 */
const NEXT = Object.freeze({
  draft: ['published', 'cancelled'],
  published: ['cancelled', 'completed', 'draft'],
  cancelled: ['draft'],
  completed: [],
});

const instant = (v, what) => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new DomainError(`${what} is not a date`);
  return d;
};

const smallint = (v, what) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new DomainError(`${what} must be a whole number`);
  return n;
};

const coordinate = (v, what, limit) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new DomainError(`${what} is not a number`);
  if (Math.abs(n) > limit)
    throw new DomainError(`${what} must be between -${limit} and ${limit}`);
  return n;
};

// ---------------------------------------------------------------------------

export class Event {
  constructor({
    id = null, organisationId, kind, title, slug = null, summary = null,
    body = null, startsAt, endsAt = null, allDay = false,
    venueName = null, addressLine = null, latitude = null, longitude = null,
    visibility = 'public', minRankOrder = null, maxRankOrder = null,
    minAge = null, maxAge = null,
    publishDown = false, publishUp = false, publishUpState = 'none',
    entriesOpen = null, entriesClose = null, capacity = null,
    guardianUnder = null, consentVersion = null, consentText = null,
    guestsAllowed = false,
    status = 'draft',
  } = {}) {
    if (!organisationId) throw new DomainError('An event belongs to an organisation');
    if (!title || !String(title).trim()) throw new DomainError('An event needs a title');
    if (!EventKind.isValid(kind)) throw new DomainError(`"${kind}" is not an event kind`);
    if (!Visibility.isValid(visibility))
      throw new DomainError(`"${visibility}" is not a visibility`);
    if (!Object.hasOwn(NEXT, status)) throw new DomainError(`"${status}" is not a status`);

    this.id = id;
    this.organisationId = organisationId;
    this.kind = kind;
    this.title = String(title).trim();
    // Slug.of demands a well-formed slug; Slug.from makes one out of a title.
    // A title typed into a form is not a slug, and treating it as one is how
    // "National Kyu Grading" becomes an error instead of a page.
    this.slug = slug ? Slug.of(slug) : Slug.from(this.title);
    this.summary = summary?.trim() || null;
    this.body = body;
    this.allDay = !!allDay;
    this.venueName = venueName?.trim() || null;
    this.addressLine = addressLine?.trim() || null;
    // Carried, not ruled on. They exist so that editing an event does not
    // silently discard a pin somebody dropped on the map — a field the entity
    // does not know about is a field the next save overwrites with null.
    this.latitude = coordinate(latitude, 'The latitude', 90);
    this.longitude = coordinate(longitude, 'The longitude', 180);
    this.visibility = visibility;
    this.publishDown = !!publishDown;
    this.publishUp = !!publishUp;
    this.publishUpState = publishUpState;
    this.status = status;

    // Entry settings. The Kokoro Cup wants a parent or guardian to sign for
    // anyone under SIXTEEN; plenty of events say eighteen. Nobody's threshold
    // belongs in the code, so the event carries its own and an event that has
    // not set one asks for nobody's guardian rather than guessing a number.
    this.guardianUnder = smallint(guardianUnder, 'The guardian age');
    this.consentVersion = consentVersion?.trim() || null;
    this.consentText = consentText ?? null;
    this.guestsAllowed = !!guestsAllowed;

    this.startsAt = instant(startsAt, 'The start');
    if (!this.startsAt) throw new DomainError('An event needs a start');
    this.endsAt = instant(endsAt, 'The end');
    this.entriesOpen = instant(entriesOpen, 'Entries opening');
    this.entriesClose = instant(entriesClose, 'Entries closing');

    this.minRankOrder = smallint(minRankOrder, 'The lowest grade');
    this.maxRankOrder = smallint(maxRankOrder, 'The highest grade');
    this.minAge = smallint(minAge, 'The youngest age');
    this.maxAge = smallint(maxAge, 'The oldest age');
    this.capacity = smallint(capacity, 'The capacity');

    const wrong = this.problems();
    if (wrong.length) throw new DomainError(wrong.join('; '));
  }

  /**
   * Every problem at once, the way the grading rules do it. Somebody filling
   * in a form should be told all of what is wrong, not made to discover it one
   * field at a time.
   */
  problems() {
    const out = [];

    if (this.endsAt && this.endsAt < this.startsAt)
      out.push('the end is before the start');

    if (this.entriesClose && this.entriesClose > this.startsAt)
      out.push('entries close after the event starts');

    if (this.entriesOpen && this.entriesClose && this.entriesOpen > this.entriesClose)
      out.push('entries open after they close');

    if (this.minRankOrder != null && this.maxRankOrder != null
        && this.minRankOrder > this.maxRankOrder)
      out.push('the lowest grade is above the highest');

    if (this.minAge != null && this.maxAge != null && this.minAge > this.maxAge)
      out.push('the youngest age is above the oldest');

    if (this.capacity != null && this.capacity < 1)
      out.push('the capacity is less than one place');

    // A by-grade event that names no grades is visible to nobody, which is
    // never what anyone meant.
    if (this.visibility === 'by_grade'
        && this.minRankOrder == null && this.maxRankOrder == null)
      out.push('a by-grade event needs a lowest or highest grade');

    if (this.guardianUnder != null
        && (this.guardianUnder < 1 || this.guardianUnder > 30))
      out.push('the age a guardian must sign below should be between 1 and 30');

    // A version with nothing behind it records agreement to a document that
    // does not exist, which is worse than recording nothing.
    if (this.consentVersion && !String(this.consentText ?? '').trim())
      out.push('a declaration version needs the declaration text to go with it');

    // own_org means "mine only", so sending it down the tree contradicts it.
    if (this.visibility === 'own_org' && this.publishDown)
      out.push('an event for this organisation only cannot also publish downwards');

    return out;
  }

  /** A new Event with these fields changed. The entity is never mutated. */
  revisedWith(changes = {}) {
    return new Event({ ...this.toJSON(), ...changes, id: this.id });
  }

  movedTo(status) {
    if (status === this.status) return this;
    if (!NEXT[this.status].includes(status))
      throw new DomainError(
        `An event cannot go from ${this.status} to ${status}`);
    return this.revisedWith({ status });
  }

  get isPublic() { return this.visibility === 'public' && this.status === 'published'; }
  get isOpenForEntries() {
    if (this.status !== 'published') return false;
    if (this.entriesClose && this.entriesClose < new Date()) return false;
    if (this.entriesOpen && this.entriesOpen > new Date()) return false;
    return this.entriesOpen != null || this.entriesClose != null;
  }

  toJSON() {
    return {
      id: this.id, organisationId: this.organisationId, kind: this.kind,
      title: this.title, slug: String(this.slug), summary: this.summary,
      body: this.body, startsAt: this.startsAt, endsAt: this.endsAt,
      allDay: this.allDay, venueName: this.venueName,
      addressLine: this.addressLine,
      latitude: this.latitude, longitude: this.longitude,
      visibility: this.visibility,
      minRankOrder: this.minRankOrder, maxRankOrder: this.maxRankOrder,
      minAge: this.minAge, maxAge: this.maxAge,
      publishDown: this.publishDown, publishUp: this.publishUp,
      publishUpState: this.publishUpState, entriesOpen: this.entriesOpen,
      entriesClose: this.entriesClose, capacity: this.capacity,
      guardianUnder: this.guardianUnder, consentVersion: this.consentVersion,
      consentText: this.consentText, guestsAllowed: this.guestsAllowed,
      status: this.status,
    };
  }
}
