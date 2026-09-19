/**
 * USE CASE — bring due publications live.
 *
 * Runs on a schedule. No actor, because nobody is present — which is exactly
 * why the authorisation happened when the publication was scheduled, not now.
 *
 * Deliberately tolerant: one failure must not stop the rest, or a single bad
 * entry silently holds back everything behind it.
 */

import { publicationCreated } from '../domain/publishing.mjs';
import { requirePort, PUBLICATION_REPOSITORY, EVENT_BUS, CLOCK }
  from './ports.mjs';

export class RunScheduledPublications {
  constructor({ publications, events, clock }) {
    this.publications = requirePort(publications, PUBLICATION_REPOSITORY);
    this.events = requirePort(events, EVENT_BUS);
    this.clock = requirePort(clock, CLOCK);
  }

  async execute({ on = null } = {}) {
    const today = on ?? this.clock.today();
    const due = await this.publications.due(today);

    const published = [], failed = [];

    for (const pub of due) {
      try {
        const previous = await this.publications.liveFor(
          pub.entryId, pub.locale.value);
        const live = await this.publications.replace(
          pub.goLive(today),
          previous ? previous.supersededBy(today) : null);
        this.events.emit(publicationCreated(live, previous));
        published.push(live);
      } catch (e) {
        failed.push({ publicationId: pub.id, path: pub.path.value,
                      reason: e.message });
      }
    }

    return { on: today, published, failed };
  }
}
