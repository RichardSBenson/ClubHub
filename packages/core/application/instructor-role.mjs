/**
 * USE CASE — tick or untick "is an instructor" for somebody.
 *
 * Done at their own club by an owner or administrator there, or by one above (a region or the federation). Unticking ends
 * the role today and keeps the history; it also takes them off the public website, because a profile for someone who no
 * longer instructs would be a claim nobody is making.
 */

import { whyNotInstructor } from '../domain/roles.mjs';
import { MANAGE } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, INSTRUCTOR_STORE } from './ports.mjs';

export class SetInstructor {
  constructor({ store, auth }) {
    this.store = requirePort(store, INSTRUCTOR_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
  }

  async execute({ actorId, personId, on }) {
    const club = await this.store.homeOf(personId);
    if (!club) throw new Missing('Person has no current affiliation');
    if (!await this.auth.hasRoleAt(actorId, club, MANAGE)) throw new NotPermitted('Not permitted');

    return this.store.atomically(async (store) => {
      const now = await store.isInstructor(personId);
      if (on && !now) {
        const why = whyNotInstructor(await store.currentGrade(personId));
        if (why) throw new Refused(why);
        await store.appoint({ personId, organisationId: club });
      } else if (!on && now) {
        await store.resign(personId);
      } else return { changed: false };
      await store.audit({ actorId, organisationId: club, action: on ? 'instructor_on' : 'instructor_off', entityId: personId, after: { instructor: !!on } });
      return { changed: true };
    });
  }
}
