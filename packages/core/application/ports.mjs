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
