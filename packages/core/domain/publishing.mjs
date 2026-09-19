/**
 * DOMAIN — publishing
 *
 * A publication has an identity and a version. That is the whole point: the
 * system must be able to answer "what is live right now, and which revision is
 * it" — and answer it without regenerating anything or guessing.
 *
 * Without this entity there is no rollback, no scheduling, and no honest basis
 * for cache invalidation. Everything downstream depends on it existing.
 *
 * Imports only ./values.mjs.
 */

import { GradingDate, DomainError } from './values.mjs';

// ---------------------------------------------------------------------------
// value objects
// ---------------------------------------------------------------------------

/**
 * A URL path segment. The rule lives here so it is enforced once, instead of
 * being re-checked in the importer, the schema and three controllers.
 */
export class Slug {
  #value;

  constructor(value) {
    const v = String(value ?? '').trim().toLowerCase();
    if (!v) throw new DomainError('A slug cannot be empty');
    if (v.length > 80) throw new DomainError(`Slug is too long: "${v}"`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v))
      throw new DomainError(
        `Slug must be lowercase words joined by hyphens, got "${value}"`);
    this.#value = v;
  }

  /** Turns a title into a slug. "Summer Products" → "summer-products". */
  static from(text) {
    const v = String(text ?? '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')  // strip accents
      .toLowerCase()
      .replace(/['']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '');
    return new Slug(v);
  }

  static of(value) { return new Slug(value); }
  get value() { return this.#value; }
  equals(other) { return other instanceof Slug && other.value === this.#value; }
  toString() { return this.#value; }
  toJSON() { return this.#value; }
}

/** A BCP 47 language tag, narrowed to what a federation actually uses. */
export class Locale {
  #value;

  constructor(value) {
    const v = String(value ?? '').trim();
    if (!/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/.test(v))
      throw new DomainError(`Not a locale: "${value}" — expected en-NZ, mi, ja`);
    this.#value = v;
  }

  static of(value) { return new Locale(value); }
  static get DEFAULT() { return new Locale('en-NZ'); }
  get value() { return this.#value; }
  get language() { return this.#value.split('-')[0]; }
  equals(other) { return other instanceof Locale && other.value === this.#value; }
  toString() { return this.#value; }
  toJSON() { return this.#value; }
}

/** A path on the site. Always absolute, never trailing-slashed. */
export class RoutePath {
  #value;

  constructor(value) {
    let v = String(value ?? '').trim();
    if (!v.startsWith('/')) throw new DomainError(`Path must start with /: "${value}"`);
    if (v.length > 1) v = v.replace(/\/+$/, '');
    if (/\/\//.test(v)) throw new DomainError(`Path has an empty segment: "${value}"`);
    if (/[?#\s]/.test(v)) throw new DomainError(`Path has illegal characters: "${value}"`);
    this.#value = v;
  }

  static of(value) { return new RoutePath(value); }
  static forSlugs(...slugs) {
    return new RoutePath('/' + slugs.map((s) => Slug.of(s).value).join('/'));
  }
  get value() { return this.#value; }
  get segments() { return this.#value.split('/').filter(Boolean); }
  equals(other) { return other instanceof RoutePath && other.value === this.#value; }
  toString() { return this.#value; }
  toJSON() { return this.#value; }
}

// ---------------------------------------------------------------------------
// publication
// ---------------------------------------------------------------------------

export const PublicationStatus = Object.freeze({
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  SUPERSEDED: 'superseded',
  WITHDRAWN: 'withdrawn',
});

/**
 * One act of publishing: this revision of this entry, at this path, in this
 * locale, from this moment.
 *
 * Publications are never edited. Publishing again creates a new one and marks
 * the old superseded — which is what makes rollback a matter of re-publishing a
 * previous revision rather than reconstructing anything.
 */
export class Publication {
  constructor({ id = null, entryId, entryKind, revisionId, path, locale = 'en-NZ',
                organisationId, status = PublicationStatus.LIVE,
                publishedAt = null, scheduledFor = null, publishedBy = null,
                supersededAt = null, withdrawnAt = null }) {
    if (!entryId) throw new DomainError('A publication needs an entry');
    if (!revisionId)
      throw new DomainError('A publication needs a revision — publishing "the ' +
        'current version" is how nobody can tell what is live');
    if (!Object.values(PublicationStatus).includes(status))
      throw new DomainError(`Unknown publication status "${status}"`);

    this.id = id;
    this.entryId = entryId;
    this.entryKind = entryKind;
    this.revisionId = revisionId;
    this.path = RoutePath.of(path);
    this.locale = Locale.of(locale);
    this.organisationId = organisationId;
    this.status = status;
    this.publishedAt = publishedAt;
    this.scheduledFor = scheduledFor ? GradingDate.of(scheduledFor) : null;
    this.publishedBy = publishedBy;
    this.supersededAt = supersededAt;
    this.withdrawnAt = withdrawnAt;

    if (status === PublicationStatus.SCHEDULED && !this.scheduledFor)
      throw new DomainError('A scheduled publication needs a date');
  }

  get isLive() { return this.status === PublicationStatus.LIVE; }
  get isVisible() { return this.isLive; }

  /** Is this scheduled publication due on the given day? */
  isDue(on) {
    return this.status === PublicationStatus.SCHEDULED
      && this.scheduledFor != null
      && !this.scheduledFor.isAfter(GradingDate.of(on));
  }

  supersededBy(at) {
    if (!this.isLive)
      throw new DomainError(`A ${this.status} publication cannot be superseded`);
    return new Publication({ ...this, path: this.path.value,
      locale: this.locale.value, scheduledFor: this.scheduledFor?.value ?? null,
      status: PublicationStatus.SUPERSEDED, supersededAt: at });
  }

  withdraw(at) {
    if (this.status === PublicationStatus.WITHDRAWN)
      throw new DomainError('Already withdrawn');
    return new Publication({ ...this, path: this.path.value,
      locale: this.locale.value, scheduledFor: this.scheduledFor?.value ?? null,
      status: PublicationStatus.WITHDRAWN, withdrawnAt: at });
  }

  goLive(at) {
    if (this.status !== PublicationStatus.SCHEDULED)
      throw new DomainError(`Only a scheduled publication can go live, not a ` +
        `${this.status} one`);
    return new Publication({ ...this, path: this.path.value,
      locale: this.locale.value, scheduledFor: this.scheduledFor?.value ?? null,
      status: PublicationStatus.LIVE, publishedAt: at });
  }
}

// ---------------------------------------------------------------------------
// domain events
// ---------------------------------------------------------------------------

/**
 * The domain says what happened. It does not know or care who listens.
 *
 * That is the decoupling: publishing emits PublicationCreated, and whether that
 * rebuilds a page, warms a cache, notifies a dojo or does nothing at all is an
 * adapter's business.
 */
export class DomainEvent {
  constructor(name, payload = {}) {
    this.name = name;
    this.payload = payload;
    this.at = new Date().toISOString();
  }
}

export const Events = Object.freeze({
  PUBLICATION_CREATED: 'publication.created',
  PUBLICATION_WITHDRAWN: 'publication.withdrawn',
  PUBLICATION_SCHEDULED: 'publication.scheduled',
  PATH_CHANGED: 'path.changed',
});

export const publicationCreated = (pub, previous = null) =>
  new DomainEvent(Events.PUBLICATION_CREATED, {
    publicationId: pub.id, entryId: pub.entryId, entryKind: pub.entryKind,
    revisionId: pub.revisionId, path: pub.path.value, locale: pub.locale.value,
    organisationId: pub.organisationId,
    supersededId: previous?.id ?? null,
    // Adapters that invalidate caches need to know what stopped being current.
    previousPath: previous && !previous.path.equals(pub.path)
      ? previous.path.value : null,
  });

export const publicationWithdrawn = (pub) =>
  new DomainEvent(Events.PUBLICATION_WITHDRAWN, {
    publicationId: pub.id, entryId: pub.entryId, path: pub.path.value,
    locale: pub.locale.value });

export const publicationScheduled = (pub) =>
  new DomainEvent(Events.PUBLICATION_SCHEDULED, {
    publicationId: pub.id, entryId: pub.entryId, path: pub.path.value,
    scheduledFor: pub.scheduledFor?.value ?? null });

export const pathChanged = (from, to, entryId) =>
  new DomainEvent(Events.PATH_CHANGED, {
    from: RoutePath.of(from).value, to: RoutePath.of(to).value, entryId });
