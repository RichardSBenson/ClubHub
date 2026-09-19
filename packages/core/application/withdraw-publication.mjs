/**
 * USE CASE — take something off the site.
 *
 * Withdrawing is recorded, not deleted. A page that was live for two years and
 * is now gone is a fact worth keeping — not least because someone will ask why
 * the link stopped working.
 */

import { publicationWithdrawn } from '../domain/publishing.mjs';
import { requirePort, Refused, NotPermitted,
         PUBLICATION_REPOSITORY, ENTRY_REPOSITORY, AUTHORISATION,
         EVENT_BUS, CLOCK } from './ports.mjs';

const MAY_PUBLISH = ['owner', 'administrator'];

export class WithdrawPublication {
  constructor({ publications, entries, auth, events, clock }) {
    this.publications = requirePort(publications, PUBLICATION_REPOSITORY);
    this.entries = requirePort(entries, ENTRY_REPOSITORY);
    this.auth = requirePort(auth, AUTHORISATION);
    this.events = requirePort(events, EVENT_BUS);
    this.clock = requirePort(clock, CLOCK);
  }

  async execute({ actorId, entryId, locale = 'en-NZ' }) {
    const live = await this.publications.liveFor(entryId, locale);
    if (!live) throw new Refused('Nothing is live for that entry');

    if (!await this.auth.hasRoleAt(actorId, live.organisationId, MAY_PUBLISH))
      throw new NotPermitted('You may not publish for that organisation');

    const withdrawn = live.withdraw(this.clock.today());
    await this.publications.update(withdrawn);
    this.events.emit(publicationWithdrawn(withdrawn));
    return { publication: withdrawn, path: withdrawn.path.value };
  }
}
