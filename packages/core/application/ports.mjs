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
