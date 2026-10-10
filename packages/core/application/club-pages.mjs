/**
 * USE CASES — a club's own public page: what it says and when it trains, asking to go live, coming down, and the
 * federation's answer.
 *
 * Putting a page up needs a second party; taking it down does not. The answer belongs to somebody STRICTLY above the club,
 * or a club's own administrator could approve its own request.
 */

import { readinessProblems, readinessGaps, ClubPageNotReady, stateOf } from '../domain/club-page.mjs';
import { MANAGE, WRITE } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, CLUB_PAGE_STORE } from './ports.mjs';

class ClubPageUseCase {
  constructor({ store, auth }) {
    this.store = requirePort(store, CLUB_PAGE_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
  }

  async may(actorId, organisationId, roles) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, roles)) throw new NotPermitted('Not permitted');
  }

  async club(clubId, store = this.store) {
    const club = await store.clubOf(clubId);
    if (!club) throw new Missing('Club');
    if (club.type !== 'club') throw new Refused('Only a club has a page of its own.');
    return club;
  }
}

/** The club's profile and times, for its own screen. */
export class ViewClubPage extends ClubPageUseCase {
  async execute({ actorId, clubId }) {
    await this.may(actorId, clubId, WRITE);
    const club = await this.club(clubId);
    const profile = await this.store.profileOf(clubId) ?? {};
    const sessions = await this.store.sessionsOf(clubId);
    return { club, profile, sessions, state: stateOf(profile), problems: readinessProblems(profile, sessions) };
  }
}

/**
 * Save what the club has said about itself. Does not touch whether the page is live, but does refuse an edit that would
 * leave a live page half empty: the checks on the way in only mean something if they also hold on the way through.
 */
export class SaveClubPage extends ClubPageUseCase {
  async execute({ actorId, clubId, profile, sessions, removed = [] }) {
    await this.may(actorId, clubId, WRITE);
    await this.club(clubId);
    if (profile.hero_asset_id && !await this.store.ownsAsset(profile.hero_asset_id, clubId))
      throw new Refused("That picture is not in this club's library. Upload it here first.");

    const was = await this.store.profileOf(clubId);
    if (was?.published) {
      const problems = readinessProblems(profile, sessions);
      if (problems.length) throw new ClubPageNotReady(['Your page is live, so this would leave it unfinished.', ...problems]);
    }

    await this.store.atomically(async (store) => {
      await store.saveProfile(clubId, profile);
      // Times are edited in place, never deleted and recreated, because attendance points at them. An emptied row is a
      // time the club has stopped running; only that one goes.
      const mine = await store.sessionIdsOf(clubId);
      for (const id of removed.filter((r) => mine.includes(r))) await store.removeSession(clubId, id);
      let order = 0;
      for (const s of sessions) {
        order += 1;
        if (s.id && mine.includes(s.id)) await store.updateSession(clubId, s, order);
        else await store.addSession(clubId, s, order);
      }
      await store.audit({ actorId, organisationId: clubId, action: 'club_page_saved', clubId,
        before: { venue: was?.venue_name ?? null }, after: { venue: profile.venue_name } });
    });
  }
}

/** The club asks to be on the federation's website. */
export class RequestClubPage extends ClubPageUseCase {
  async execute({ actorId, clubId }) {
    await this.may(actorId, clubId, MANAGE);
    const club = await this.club(clubId);
    if (!club.parent_id) throw new Refused('This club has no federation to ask.');
    const profile = await this.store.profileOf(clubId) ?? {};
    const problems = readinessProblems(profile, await this.store.sessionsOf(clubId));
    if (problems.length) throw new ClubPageNotReady(problems);
    if (profile.published) throw new Refused('Your page is already live.');
    await this.store.atomically(async (store) => {
      await store.requestPage(clubId);
      await store.audit({ actorId, organisationId: clubId, action: 'club_page_requested', clubId, before: {}, after: { state: 'requested' } });
    });
  }
}

/** The club takes its own page down, or withdraws a request, whenever it likes. */
export class TakeDownClubPage extends ClubPageUseCase {
  async execute({ actorId, clubId }) {
    await this.may(actorId, clubId, MANAGE);
    await this.club(clubId);
    const was = await this.store.profileOf(clubId);
    await this.store.atomically(async (store) => {
      await store.takeDown(clubId);
      await store.audit({ actorId, organisationId: clubId, action: 'club_page_taken_down', clubId, before: { state: stateOf(was) }, after: { state: 'off' } });
    });
  }
}

/** The federation answers, or switches a club on without being asked (equally legitimate). */
export class DecideClubPage extends ClubPageUseCase {
  async execute({ actorId, clubId, approve, decidedBy, note = null }) {
    await this.may(actorId, decidedBy, MANAGE);
    await this.club(clubId);
    if (!await this.store.sitsBeneath(decidedBy, clubId)) throw new Refused('That club does not sit beneath this organisation.');
    const profile = await this.store.profileOf(clubId) ?? {};
    if (approve) {
      const problems = readinessProblems(profile, await this.store.sessionsOf(clubId));
      if (problems.length) throw new ClubPageNotReady(problems);
    }
    await this.store.atomically(async (store) => {
      if (approve) await store.publish(clubId, actorId);
      else await store.decline(clubId, (note ?? '').trim().slice(0, 400) || null);
      await store.audit({ actorId, organisationId: decidedBy, action: approve ? 'club_page_approved' : 'club_page_declined', clubId,
        before: { state: stateOf(profile) }, after: { state: approve ? 'live' : 'off' } });
    });
  }
}

/** Every club beneath this organisation and where its page stands. Only for somebody who can decide. */
export class ClubPagesBeneath extends ClubPageUseCase {
  async execute({ actorId, organisationId }) {
    await this.may(actorId, organisationId, MANAGE);
    return (await this.store.pagesBeneath(organisationId)).map((r) => ({
      ...r, state: stateOf(r),
      gaps: readinessGaps(r, Array.from({ length: r.sessions }, () => ({}))).map((g) => g.short),
    }));
  }
}
