/**
 * APPLICATION — ports
 *
 * The interfaces the core needs, defined BY the core. Infrastructure implements
 * them; the core never imports an implementation.
 *
 * JavaScript has no interface keyword, so these are documented contracts plus a
 * runtime check used when a use case is constructed. That check is worth having:
 * it turns "undefined is not a function" three layers deep into a clear error at
 * wiring time.
 */

import { DomainError } from '../domain/values.mjs';

export const LADDER_REPOSITORY = {
  name: 'LadderRepository',
  methods: [
    /** (federationId) → Grade[] ordered by rankOrder */
    'gradesFor',
    /** (federationId, rankOrder) → GradingAuthority | null */
    'authorityFor',
  ],
};

export const RANK_REPOSITORY = {
  name: 'RankRepository',
  methods: [
    /** (personId) → GradingRecord[] */
    'recordsFor',
    /** (GradingRecord) → GradingRecord, with an id */
    'save',
    /** (personIds[]) → Map<personId, rankOrder | null> */
    'rankOrdersFor',
  ],
};

export const MEMBER_REPOSITORY = {
  name: 'MemberRepository',
  methods: [
    /** (personId) → { id, dateOfBirth, displayNumber, organisationId } | null */
    'byId',
    /** (personId, sinceDate|null) → number */
    'sessionsSince',
  ],
};

export const ORGANISATION_REPOSITORY = {
  name: 'OrganisationRepository',
  methods: [
    /** (orgId) → { id, type, name, federationId } | null */
    'byId',
  ],
};

export const AUTHORISATION = {
  name: 'Authorisation',
  methods: [
    /** (actorId, orgId, roles[]) → boolean */
    'hasRoleAt',
  ],
};

export const PUBLICATION_REPOSITORY = {
  name: 'PublicationRepository',
  methods: [
    /** (entryId, locale) → Publication | null — the one that is live */
    'liveFor',
    /** (path, locale) → Publication | null — what is at this path */
    'atPath',
    /** (Publication) → Publication, with an id */
    'save',
    /**
     * (next, previous|null) → Publication — atomically.
     * The use case decides WHAT supersedes what; the adapter guarantees the
     * two changes happen together. Saving the new one first leaves two live
     * for an instant, which a unique index rightly rejects.
     */
    'replace',
    /** (Publication) → void — status change only, never content */
    'update',
    /** (onDate) → Publication[] — scheduled and due */
    'due',
    /** (entryId) → Publication[] — every publication, newest first */
    'historyFor',
  ],
};

export const ENTRY_REPOSITORY = {
  name: 'EntryRepository',
  methods: [
    /** (entryId) → { id, kind, organisationId, slug, title } | null */
    'byId',
    /** (entryId) → { id, savedAt } | null — the newest revision */
    'latestRevision',
    /** (revisionId) → { id, entryId, savedAt } | null */
    'revision',
  ],
};

export const CONTENT_TYPE_REPOSITORY = {
  name: 'ContentTypeRepository',
  methods: [
    /**
     * (organisationId, name) → ContentType | null
     * Resolves inheritance: a type defined by a parent is visible to everything
     * beneath it, and the nearest definition wins.
     */
    'byName',
    /**
     * (organisationId, name) → ContentType | null
     * Only a type this organisation owns. Overriding an inherited type creates
     * a new one for this organisation; it does not edit the parent's.
     */
    'ownedBy',
    /** (organisationId) → ContentType[] */
    'allFor',
    /** (ContentType) → ContentType, with an id */
    'save',
    /** (typeName, organisationId) → number — entries already using it */
    'countEntries',
  ],
};

export const CONTENT_ENTRY_REPOSITORY = {
  name: 'ContentEntryRepository',
  methods: [
    /** (entryId) → ContentEntry | null */
    'byId',
    /** (organisationId, typeName, slug) → ContentEntry | null */
    'bySlug',
    /** (ContentEntry) → ContentEntry, with an id */
    'save',
    /** (organisationId, typeName, {status}) → ContentEntry[] */
    'list',
    /** (entryId, values, actorId) → revisionId */
    'saveRevision',
  ],
};

export const MESSENGER = {
  name: 'Messenger',
  methods: [
    /**
     * ({ to, subject, text, kind }) → { delivered, id?, detail? }
     *
     * Must resolve only once the message has actually been handed over. A
     * messenger that returns before the provider has accepted is the single
     * most common way sign-in links vanish with clean logs.
     */
    'send',
  ],
};

/**
 * The calendar. An organisation's own events, by id or by slug.
 *
 * `save` takes an Event and returns it with an id, so a caller never has to
 * know whether it was an insert or an update — the entity's own id decides.
 */
export const EVENT_REPOSITORY = {
  name: 'EventRepository',
  methods: [
    /** (id) → Event | null */
    'byId',
    /** (organisationId, slug) → Event | null */
    'bySlug',
    /** (Event) → Event, with an id */
    'save',
    /**
     * (organisationId, { status? }) → Event[], soonest first.
     * What the person running the calendar sees, drafts included. The public
     * site reads events by a different route, because what a visitor may see
     * is a different question from what an administrator may edit.
     */
    'listFor',
    /** (id) → void */
    'remove',
  ],
};

/**
 * Which titles a person holds. Separate from rank because they are separate
 * things: some federations confer a title from a grade, others award it on its
 * own, and several do both. Only the register knows which.
 */
export const TITLE_REPOSITORY = {
  name: 'TitleRepository',
  methods: [
    /** (personIds[]) → Map<personId, titleId[]> */
    'heldBy',
  ],
};

export const EVENT_BUS = {
  name: 'EventBus',
  /** (DomainEvent) → void. Never throws into the caller. */
  methods: ['emit'],
};

export const CLOCK = {
  name: 'Clock',
  /** () → 'YYYY-MM-DD' */
  methods: ['today'],
};

/** Fails loudly at wiring time rather than quietly at call time. */
export function requirePort(impl, contract) {
  if (!impl) throw new DomainError(`${contract.name} was not provided`);
  const missing = contract.methods.filter((m) => typeof impl[m] !== 'function');
  if (missing.length)
    throw new DomainError(`${contract.name} is missing: ${missing.join(', ')}`);
  return impl;
}

export class NotPermitted extends Error {
  constructor(message) { super(message); this.name = 'NotPermitted'; }
}

/** Refusals carry every reason, never just "no". */
export class Refused extends Error {
  constructor(reasons) {
    super(Array.isArray(reasons) ? reasons.join('; ') : reasons);
    this.name = 'Refused';
    this.reasons = Array.isArray(reasons) ? reasons : [reasons];
  }
}

/**
 * The register of people, as the enrolment use case needs it. `inTransaction` runs `work(tx)` as one unit: if it
 * throws, nothing is kept. `tx` offers:
 *   lockEnrolment()                         — one enrolment at a time
 *   peopleNamed(first, last)                — [{ display_number, first_name, last_name, date_of_birth, email }]
 *   federationShortNameFor(organisationId)  — string | null
 *   lastNumberIn(prefix)                    — highest sequence used under the prefix, 0 if none
 *   addPerson(fields)                       — the new person row
 *   addEmergencyContact(personId, name, phone)
 *   addAffiliation({ personId, organisationId, role, starts, paidUntil })
 *   audit({ actorId, organisationId, action, entity, entityId, after })
 */
export const PERSON_REGISTER = {
  name: 'PersonRegister',
  methods: ['inTransaction'],
};

/** Tells the outside world something happened (webhooks, say). Never throws into the caller. */
export const ANNOUNCER = {
  name: 'Announcer',
  /** (organisationId, eventName, data) → void */
  methods: ['announce'],
};
