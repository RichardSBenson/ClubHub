/**
 * USE CASE — publish a revision.
 *
 * Publishing is not "save and hope". It is an act with a record: this revision,
 * at this path, in this locale, from this moment — and the one it replaced is
 * marked superseded rather than overwritten.
 *
 * That record is what makes rollback possible, what lets a scheduler work, and
 * what tells a cache adapter exactly which paths stopped being current.
 */

import { Publication, PublicationStatus, Slug, RoutePath, Locale,
         publicationCreated, publicationScheduled, pathChanged }
  from '../domain/publishing.mjs';
import { requirePort, Refused, NotPermitted,
         PUBLICATION_REPOSITORY, ENTRY_REPOSITORY, AUTHORISATION,
         EVENT_BUS, CLOCK } from './ports.mjs';

const MAY_PUBLISH = ['owner', 'administrator'];

export class PublishRevision {
  constructor({ publications, entries, auth, events, clock }) {
    this.publications = requirePort(publications, PUBLICATION_REPOSITORY);
    this.entries = requirePort(entries, ENTRY_REPOSITORY);
    this.auth = requirePort(auth, AUTHORISATION);
    this.events = requirePort(events, EVENT_BUS);
    this.clock = requirePort(clock, CLOCK);
  }

  async execute({ actorId, entryId, revisionId = null, path = null,
                  locale = 'en-NZ', scheduledFor = null }) {
    const entry = await this.entries.byId(entryId);
    if (!entry) throw new Refused('No such entry');

    if (!await this.auth.hasRoleAt(actorId, entry.organisationId, MAY_PUBLISH))
      throw new NotPermitted('You may not publish for that organisation');

    // Publishing "the current version" is how nobody can tell what is live.
    // If no revision is named, pin the newest one NOW, and record which.
    let revision;
    if (revisionId) {
      revision = await this.entries.revision(revisionId);
      if (!revision) throw new Refused('No such revision');
      if (revision.entryId !== entryId)
        throw new Refused('That revision belongs to a different entry');
    } else {
      revision = await this.entries.latestRevision(entryId);
      if (!revision) throw new Refused('That entry has never been saved');
    }

    const target = RoutePath.of(path ?? `/${Slug.of(entry.slug).value}`);
    const loc = Locale.of(locale);

    // Two entries cannot occupy one path in one locale.
    const occupant = await this.publications.atPath(target.value, loc.value);
    if (occupant && occupant.entryId !== entryId)
      throw new Refused(
        `${target.value} is already published by another entry`);

    const previous = await this.publications.liveFor(entryId, loc.value);
    const now = this.clock.today();

    if (scheduledFor) {
      const pub = await this.publications.save(new Publication({
        entryId, entryKind: entry.kind, revisionId: revision.id,
        path: target.value, locale: loc.value,
        organisationId: entry.organisationId,
        status: PublicationStatus.SCHEDULED, scheduledFor, publishedBy: actorId,
      }));
      this.events.emit(publicationScheduled(pub));
      return { publication: pub, scheduled: true, replaced: null };
    }

    // Superseding the old and publishing the new must happen together. Doing
    // them in sequence means a moment with two live publications for one entry,
    // which is wrong even if nothing observes it.
    const pub = await this.publications.replace(
      new Publication({
        entryId, entryKind: entry.kind, revisionId: revision.id,
        path: target.value, locale: loc.value,
        organisationId: entry.organisationId,
        status: PublicationStatus.LIVE, publishedAt: now, publishedBy: actorId,
      }),
      previous ? previous.supersededBy(now) : null);

    this.events.emit(publicationCreated(pub, previous));
    if (previous && !previous.path.equals(target))
      this.events.emit(pathChanged(previous.path.value, target.value, entryId));

    return { publication: pub, scheduled: false, replaced: previous ?? null };
  }
}
