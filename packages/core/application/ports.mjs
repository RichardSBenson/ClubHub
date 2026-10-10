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
/** The thing asked about does not exist. */
export class Missing extends Error {
  constructor(what) { super(what); this.name = 'Missing'; }
}

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
 *   audit({ actorId, organisationId, action, entity, entityId, before, after })
 *   homeOf(personId)                        — { organisationId } of their current membership (or first current role), or null
 *   currentMembership(personId)             — { id, organisationId } or null
 *   snapshotOf(personId)                    — the person's editable fields as they are now
 *   changePerson(personId, changes)         — changes: { firstName?, lastName?, preferredName?, dateOfBirth?, gender?, email?, phone? }
 *   changeEmergencyContact(personId, { name?, phone? })  — only what is given
 *   changeAffiliation(personId, { paidUntil?, status? }) — their current affiliations
 *   endAffiliation(id, on)
 *   personForAccess(personId)               — the person row, or null
 *   defaultHomeFor(personId)                — organisation id of their current member (else other) affiliation, or null
 *   accountByEmail(address)                 — { person_id, first_name, last_name, display_number, dob } | null
 *   upsertAccount(personId, address)        — the account (an existing one keeps its person)
 *   grantRole({ accountId, organisationId, role, grantedBy })
 *   recordHeldGrade({ personId, gradeId, awardedOn, organisationId, note })  — a grade already held, recorded as such
 *   rollOf(organisationId)                  — who is on the organisation's roll now, in the shape the import planner compares
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

/**
 * The links between children and their guardians. `inTransaction(work)` as for PersonRegister; `tx` offers:
 *   personById(id)                          — { id, first_name, last_name, date_of_birth, ... } | null
 *   homesOf(personId)                       — organisation ids of their current affiliations
 *   linkById(id)                            — the live link, with g_first/g_last/c_first/c_last names, or null
 *   addLink({ guardianId, childId, relationship, createdBy })  — the new link, or null when already linked
 *   chooseContact(link, { main, copy, fees }) — one main contact and one fee-payer per child
 *   endLink(id)
 *   guardiansOf(childId)                    — the live links with the guardian's details
 *   audit({ actorId, organisationId, action, entity, entityId, after })
 */
export const GUARDIAN_REGISTER = {
  name: 'GuardianRegister',
  methods: ['inTransaction'],
};

/**
 * What the signed-in account may do for whom, read without a transaction:
 *   selfOf(accountId)                       — the account's own person, or null
 *   dependantsOf(guardianPersonId, adultAge) — the children under that age with a live link to them (+ relationship)
 *   feePayersOf(childId)                    — { anySet, guardianIds[] } for the child's live links that look after fees
 *   personIdOf(accountId)
 */
export const SELF_SERVICE_READS = {
  name: 'SelfServiceReads',
  methods: ['selfOf', 'dependantsOf', 'feePayersOf', 'personIdOf'],
};

/**
 * The federation's declaration and who has signed it:
 *   ownerOf(organisationId)                 — the organisation that owns the declaration for this one, or null
 *   currentOf(ownerId)                      — { id, version, body, published_on } | null
 *   firstHomeOf(personId)                   — organisation id | null
 *   signingOf(personId, declarationId)      — { signed_name, guardian, signed_on } | null
 *   ageOf(personId)                         — whole years, or null without a date of birth
 *   addSigning({ personId, declarationId, name, signedBy, guardian, ip })
 *   publish({ ownerId, version, body, publishedBy }) — { id, version }, or null when the version is already used
 *   signedAmong(declarationId, personIds)   — Set of those who have signed
 *   signedCount(declarationId)
 */
export const DECLARATION_STORE = {
  name: 'DeclarationStore',
  methods: ['ownerOf', 'currentOf', 'firstHomeOf', 'signingOf', 'ageOf', 'addSigning', 'publish', 'signedAmong', 'signedCount'],
};

/**
 * Documents members send to their club (certificates, first aid, safeguarding). `atomically(work)` runs `work(store)`
 * as one unit. The store seals and opens the file bytes; the core never sees how they are kept.
 *   homeOf(personId)                        — their club (member roll first) or null
 *   homesOf(personId)                       — every club they are currently on
 *   todayAt(organisationId)                 — 'YYYY-MM-DD' in that organisation's own timezone
 *   qualificationChoices(organisationId)    — [{ id, label }] the club (and those above it) ask for
 *   qualificationAt(organisationId, id)     — { id, label } | null
 *   documentsOf(personId)                   — newest first, without the file
 *   addDocument({ ... })                    — { id }
 *   documentFile(personId, docId)           — { mime, bytes, filename, title } | null (bytes opened)
 *   documentToReview(personId, docId)       — the document row | null
 *   addAward({ personId, qualificationId, awardedOn, expiresOn, reference, recordedBy }) — { id }
 *   markReviewed({ docId, accepted, reviewedBy, note, awardId })
 *   waitingUnder(organisationId)            — pending documents for the organisation and everything beneath it
 *   audit({ actorId, organisationId, action, entityId, after })
 */
export const MEMBER_DOCUMENT_STORE = {
  name: 'MemberDocumentStore',
  methods: ['atomically', 'homeOf', 'homesOf', 'todayAt', 'qualificationChoices', 'qualificationAt', 'documentsOf', 'addDocument',
            'documentFile', 'documentToReview', 'addAward', 'markReviewed', 'waitingUnder', 'audit'],
};

/**
 * A person's photograph and the few words beside it. `atomically(work)` runs `work(store)` as one unit.
 *   homeOf(personId) / homesOf(personId)    — their club (member roll first) / every club they are on
 *   dateOfBirthOf(personId)                 — 'YYYY-MM-DD' | null
 *   nameOf(personId)                        — 'First Last'
 *   addPhotoAsset({ organisationId, bytes, identified, filename, altText, consentRef, uploadedBy }) — { id }
 *   setPhoto(personId, assetId) / clearPhoto(personId) / setAbout(personId, text|null)
 *   photoAssetIdOf(personId)                — asset id | null
 *   photoFile(assetId)                      — { mime, bytes } | null
 *   audit({ actorId, organisationId, action, entityId, after })
 */
export const PHOTO_STORE = {
  name: 'PhotoStore',
  methods: ['atomically', 'homeOf', 'homesOf', 'dateOfBirthOf', 'nameOf', 'addPhotoAsset', 'setPhoto', 'clearPhoto', 'setAbout',
            'photoAssetIdOf', 'photoFile', 'audit'],
};

/**
 * Who is recorded as an instructor, and the switch that makes them one.
 *   homeOf(personId)                        — their club (member roll first) or null
 *   isInstructor(personId)
 *   currentGrade(personId)                  — { label, is_dan } | null
 *   appoint({ personId, organisationId }) / resign(personId)  — resigning also unpublishes their website profile
 *   audit({ actorId, organisationId, action, entityId, after })
 */
export const INSTRUCTOR_STORE = {
  name: 'InstructorStore',
  methods: ['atomically', 'homeOf', 'isInstructor', 'currentGrade', 'appoint', 'resign', 'audit'],
};

/**
 * Instructor profiles for the club website. `atomically(work)` runs `work(store)` as one unit.
 *   personForReadiness(personId)            — { dob, about } | null
 *   settingsOf(organisationId)              — the organisation's settings object
 *   todayAt(organisationId)                 — 'YYYY-MM-DD' in that organisation's timezone
 *   instructorQualifications(clubId)        — [{ id, label }] the federation requires of instructors
 *   awardsOf(personId)                      — their qualification awards, in the shape the clearance rule reads
 *   instructorRows(personIds)               — [{ person_id, club_id, published }] for current instructors
 *   membersWithin(scopeOrgId, personIds)    — Map<personId, clubId> of active members on rolls beneath the scope
 *   nameOf(personId)
 *   profileOf(clubId, personId)             — the stored profile or null
 *   personForProfile(personId, clubId)      — { id, date_of_birth, is_instructor } | null
 *   saveProfile({ clubId, personId, bio, teaches, published, publishedBy, sortOrder, year, showChecks }) — the row
 *   removeProfile(clubId, personId)         — the deleted row | null
 *   siteStatus(personId) / profilesFor(clubId)
 *   audit({ actorId, organisationId, action, entity, entityId, before, after })
 */
export const INSTRUCTOR_PROFILE_STORE = {
  name: 'InstructorProfileStore',
  methods: ['atomically', 'personForReadiness', 'settingsOf', 'todayAt', 'instructorQualifications', 'awardsOf', 'instructorRows',
            'membersWithin', 'nameOf', 'profileOf', 'personForProfile', 'saveProfile', 'removeProfile', 'siteStatus', 'profilesFor', 'audit'],
};

/**
 * The register of organisations, as adding a club needs it:
 *   organisationById(id)                    — the row (path, type, name, country_code, timezone) | null
 *   slugTaken(slug)                         — slugs are looked up on their own in /o/<slug>, so unique means unique everywhere
 *   emailHasAccount(email)
 *   addClub({ parent, name, slug, city, addedBy }) — creates the club (active, inheriting country and timezone), its profile
 *                                             row when a city is given, and the audit entry, all together; returns the club
 */
export const ORGANISATION_REGISTER = {
  name: 'OrganisationRegister',
  methods: ['organisationById', 'slugTaken', 'emailHasAccount', 'addClub'],
};

/**
 * A club's own public page and the times it trains. `atomically(work)` runs `work(store)` as one unit.
 *   clubOf(id)                              — { id, name, slug, type, parent_id } | null
 *   sessionsOf(clubId)                      — training times, in order
 *   profileOf(clubId)                       — the club_profile row | null
 *   ownsAsset(assetId, clubId)
 *   saveProfile(clubId, profile)
 *   sessionIdsOf(clubId) / removeSession(clubId, id) / updateSession(clubId, session, order) / addSession(clubId, session, order)
 *   requestPage(clubId) / takeDown(clubId) / publish(clubId, publishedBy) / decline(clubId, note)
 *   sitsBeneath(deciderId, clubId)          — is the club strictly beneath that organisation
 *   pagesBeneath(organisationId)            — every club beneath it and where its page stands
 *   audit({ actorId, organisationId, action, clubId, before, after })
 */
export const CLUB_PAGE_STORE = {
  name: 'ClubPageStore',
  methods: ['atomically', 'clubOf', 'sessionsOf', 'profileOf', 'ownsAsset', 'saveProfile', 'sessionIdsOf', 'removeSession',
            'updateSession', 'addSession', 'requestPage', 'takeDown', 'publish', 'decline', 'sitsBeneath', 'pagesBeneath', 'audit'],
};

/**
 * School terms and children's enrolment in them. `atomically(work)` runs `work(store)` as one unit.
 *   organisationById(id)                    — the full row (type, timezone, settings...) | null
 *   countryOf(organisationId)               — its own country, or the nearest ancestor's
 *   todayAt(organisation)                   — 'YYYY-MM-DD' in that organisation's timezone
 *   termsOf(organisationId)                 — [{ id, starts, ends }] this organisation's own terms
 *   hasTermsIn(organisationId, year)
 *   addTerm({ organisationId, year, number, name, starts, ends, source }) / nextTermNumber(organisationId, year)
 *   updateTerm({ id, organisationId, name, starts, ends, year }) — the row or null
 *   enrolledCount(termId) / removeTerm(organisationId, termId) — the row or null
 *   setMidTermRule(organisationId, rule)
 *   effectiveTerms(organisationId, year)    — { terms, owner, inherited } its own, or the nearest ancestor's
 *   memberClubOf(personId)                  — the club organisation row they are an active member of, or null
 *   personById(id)                          — { id, first_name, date_of_birth, ... }
 *   trainingWeekdays(clubId, ageYears)      — weekdays on which a child of that age has a class
 *   feeSchedule(clubId)                     — fee rows
 *   enrolmentOf(termId, personId)           — { id, status, paid, fee_cents, price_note } | null
 *   enrol({ termId, personId, clubId, cents, note, today, by }) — the enrolment (revives a withdrawn one)
 *   requestPayment({ clubId, personId, cents, currency, by, description, enrolmentId }) — payment id
 *   enrolmentToWithdraw(termId, personId)   — { id, paid, organisation_id, starts, timezone } | null
 *   voidUnpaidFor(enrolmentId) / markWithdrawn(enrolmentId)
 *   audit({ actorId, organisationId, action, entity, entityId, after })
 */
export const TERM_STORE = {
  name: 'TermStore',
  methods: ['atomically', 'organisationById', 'countryOf', 'todayAt', 'termsOf', 'hasTermsIn', 'addTerm', 'nextTermNumber', 'updateTerm',
            'enrolledCount', 'removeTerm', 'setMidTermRule', 'effectiveTerms', 'memberClubOf', 'personById', 'trainingWeekdays', 'feeSchedule',
            'enrolmentOf', 'enrol', 'requestPayment', 'enrolmentToWithdraw', 'voidUnpaidFor', 'markWithdrawn', 'audit'],
};

/**
 * An organisation's own settings and what is stored on it: site menu, look, crest, home page, club profile.
 * `atomically(work)` runs `work(store)` as one unit.
 *   settingsOf(organisationId)              — the settings object
 *   putSetting(organisationId, key, value) / removeSetting(organisationId, key)
 *   assetOwner(assetId)                     — the organisation that owns the picture, or null
 *   authoredPages(organisationId)           — [{ slug, title }] published pages
 *   clubRow(organisationId)                 — the club row with founded_iso, or null
 *   updateClub(organisationId, { name, shortName, founded, timezone, status }) — the row
 *   clubOverview(organisationId, parentId)  — { administrators, counts, page, parent }
 *   audit({ actorId, organisationId, action, before, after })
 */
export const SETTINGS_STORE = {
  name: 'SettingsStore',
  methods: ['atomically', 'settingsOf', 'putSetting', 'removeSetting', 'assetOwner', 'authoredPages', 'clubRow', 'updateClub', 'clubOverview', 'audit'],
};

/**
 * What the daily term run needs to read and record. (The Postgres term store satisfies this as well as TERM_STORE.)
 *   federationsForCalendars()              — [{ id, name, country_code, settings, timezone }] active top-level organisations with a country
 *   loadedYears(organisationId)            — the years that organisation already has terms for
 *   activeClubs()                          — active club rows
 *   todayAt(organisation)                  — "YYYY-MM-DD" where that organisation is now
 *   effectiveTerms(organisationId, year)   — { terms } its own, or the nearest ancestor's
 *   offerMade(termId, clubId)              — has this term already been offered by this club?
 *   familiesToOffer({ previousTermId, nextTermId, clubId }) — [{ firstName, email, guardians: [email] }] children enrolled last term, still active, not yet in the next
 *   recordOffer(termId, clubId)
 */
export const TERM_OFFER_STORE = {
  name: 'TermOfferStore',
  methods: ['federationsForCalendars', 'loadedYears', 'activeClubs', 'todayAt', 'effectiveTerms', 'offerMade', 'familiesToOffer', 'recordOffer'],
};

/**
 * Money owed and paid: payments, their lines, and what paying them sets in motion (an entry paid, a term place paid, a
 * membership carried on, a first payment making someone a member). `atomically(work)` runs `work(store)` as one unit.
 *   paymentsFor(personId) / owedFor(personIds) / paymentById(id) — payment rows with payee, person and lines
 *   receivedBy(organisationId, limit)        — { rows, totals, methods }
 *   claim({ paymentId, method, actorId, providerName }) — pending/failed → awaiting; false if somebody got there first
 *   noteProgress(paymentId, ref, detail)
 *   settle({ paymentId, ok, detail, ref, manual })      — the settled row { organisation_id, person_id, amount_cents, receipt_no } or null
 *                                                         (manual: { method, receiptNo, actorId })
 *   markFulfilled(paymentId)                 — entries and term places paid; returns [{ id, months }] memberships to carry on
 *   affiliationForRenewal(id)                — { paid_until, status, today } or null
 *   extendMembership(id, until)              — and a lapsed or trial member becomes active
 *   personAndClubOf(affiliationId)           — { person_id, organisation_id } or null
 *   numberOf(personId)                       — the member number (locks the person) / setNumber(personId, number)
 *   federationShortNameFor(organisationId) / lastNumberIn(prefix)
 *   convertTrial(personId, organisationId) / promoteReferral(personId)
 *   referralAwaitingReward(personId)         — the referral id or null
 *   nextReceipt(organisationId)              — { year, number }
 *   voidUnpaid(organisationId, paymentId)    — true if a pending or failed request was taken back
 *   organisationById(id) / personByNumber(number) / clubHomeOf(personId, path) / federationAbove(path)
 *   createRequest({ payeeId, personId, amountCents, currency, actorId, kind, description }) — the payment row
 *   audit({ actorId, organisationId, action, entityId, after })
 */
export const PAYMENT_LEDGER = {
  name: 'PaymentLedger',
  methods: ['atomically', 'paymentsFor', 'owedFor', 'paymentById', 'receivedBy', 'claim', 'noteProgress', 'settle', 'markFulfilled',
    'affiliationForRenewal', 'extendMembership', 'personAndClubOf', 'numberOf', 'setNumber', 'federationShortNameFor', 'lastNumberIn',
    'convertTrial', 'promoteReferral', 'referralAwaitingReward', 'nextReceipt', 'voidUnpaid', 'organisationById', 'personByNumber',
    'clubHomeOf', 'federationAbove', 'createRequest', 'audit'],
};
