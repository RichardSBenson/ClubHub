/**
 * USE CASES — who may be shown on a club's website as an instructor, and the profile shown.
 *
 * The website follows the register, never the other way round. Somebody appears only when they are an instructor, adult,
 * every check the federation requires of instructors is current, and they have written their few words.
 */

import { reasonNotToPublish } from '../domain/instructing.mjs';
import { clearance } from '../domain/qualification.mjs';
import { MANAGE } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, INSTRUCTOR_PROFILE_STORE } from './ports.mjs';

const today = () => new Date().toISOString().slice(0, 10);

class ProfileUseCase {
  /** `validateBio(doc)` → { doc }: the content blocks rule, supplied from outside so the core does not import it. */
  constructor({ store, auth, adultAge, validateBio }) {
    this.store = requirePort(store, INSTRUCTOR_PROFILE_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
    this.adultAge = adultAge;
    this.validateBio = validateBio;
  }

  async mustManage(actorId, organisationId) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, MANAGE)) throw new NotPermitted('Not permitted');
  }
}

/** Why somebody cannot be shown yet: `never` for a reason waiting will not fix, `missing` for what to supply. */
export class InstructorReadiness extends ProfileUseCase {
  async execute({ clubId, personId }) {
    const who = await this.store.personForReadiness(personId);
    const why = reasonNotToPublish({ person: { dateOfBirth: who?.dob }, isInstructor: true, on: today(), settings: await this.store.settingsOf(clubId) });
    if (why) return { never: /under/.test(why) ? `under ${this.adultAge()}` : 'no date of birth recorded', missing: [] };
    const c = clearance(await this.store.instructorQualifications(clubId), await this.store.awardsOf(personId), await this.store.todayAt(clubId));
    const missing = c.barred.map((b) => (b.state === 'expired' ? `${b.label} (expired)` : b.label));
    if (!who?.about) missing.push('a write-up about themselves');
    return { never: null, missing };
  }
}

/** For the roll: who holds the instructor role, whether the website shows them, and what holds them back. */
export class InstructorStates extends ProfileUseCase {
  constructor(deps) { super(deps); this.readiness = new InstructorReadiness(deps); }

  async execute({ personIds }) {
    const out = new Map();
    if (!personIds.length) return out;
    for (const r of await this.store.instructorRows(personIds)) {
      const ready = r.published ? { never: null, missing: [] } : await this.readiness.execute({ clubId: r.club_id, personId: r.person_id });
      out.set(r.person_id, { published: r.published, ...ready });
    }
    return out;
  }
}

export class ListInstructorProfiles extends ProfileUseCase {
  /** Everybody holding the instructor role here, with their profile if any: the screen shows who could be listed and is not. */
  async execute({ actorId, organisationId }) {
    await this.mustManage(actorId, organisationId);
    return this.store.profilesFor(organisationId);
  }
}

/**
 * Add somebody to the site, or change what it says about them. Publishing is checked against the rule every time, not
 * only when the box is first ticked: a federation raising its minimum age should take effect on the next save.
 */
export class SaveInstructorProfile extends ProfileUseCase {
  async execute({ actorId, organisationId, personId, bio, teaches, published, sortOrder = 0, startedYear = null, showChecks = false }) {
    await this.mustManage(actorId, organisationId);
    const person = await this.store.personForProfile(personId, organisationId);
    if (!person) throw new Missing('Person');

    if (published) {
      const why = reasonNotToPublish({ person: { dateOfBirth: person.date_of_birth }, isInstructor: person.is_instructor,
        on: today(), settings: await this.store.settingsOf(organisationId) });
      if (why) throw new Refused(why);
    }
    const { doc } = this.validateBio(bio ?? { blocks: [] });
    const year = startedYear == null || startedYear === '' ? null : Number(startedYear);
    if (year != null && !(Number.isInteger(year) && year >= 1930 && year <= new Date().getFullYear()))
      throw new Refused('"Training since" must be a year, such as 1998.');

    return this.store.atomically(async (store) => {
      const row = await store.saveProfile({ clubId: organisationId, personId, bio: doc, teaches: teaches?.trim() || null, published: !!published,
        publishedBy: published ? actorId : null, sortOrder, year, showChecks: !!showChecks });
      await store.audit({ actorId, organisationId, action: published ? 'instructor_publish' : 'instructor_save', entity: 'instructor_profile',
        entityId: row.id, after: { personId, published: !!published } });
      return row;
    });
  }
}

/**
 * Take somebody off the site. Deletes the profile rather than flipping a flag, because "remove me from your website"
 * should not leave a row somebody can tick again without asking. They remain an instructor on the roll.
 */
export class RemoveInstructorProfile extends ProfileUseCase {
  async execute({ actorId, organisationId, personId }) {
    await this.mustManage(actorId, organisationId);
    return this.store.atomically(async (store) => {
      const row = await store.removeProfile(organisationId, personId);
      if (!row) throw new Missing('Instructor profile');
      await store.audit({ actorId, organisationId, action: 'instructor_remove', entity: 'instructor_profile', entityId: row.id, before: { personId, was: row.published } });
      return row;
    });
  }
}

/**
 * Make several people instructors in one go, optionally showing them on the website, or take the role away. People must be
 * on the roll of a club beneath `scopeOrgId`, and each is dealt with at their own club. Nobody is skipped silently.
 * `setInstructor(actorId, personId, on)` is the one-person switch.
 */
export class BulkInstructors extends ProfileUseCase {
  constructor(deps) {
    super(deps);
    this.readiness = new InstructorReadiness(deps);
    this.save = new SaveInstructorProfile(deps);
    this.setInstructor = deps.setInstructor;
  }

  async execute({ actorId, scopeOrgId, personIds, mode }) {
    await this.mustManage(actorId, scopeOrgId);
    const ids = [...new Set(personIds)];
    const homes = await this.store.membersWithin(scopeOrgId, ids);
    const out = { changed: 0, shown: 0, skipped: [] };
    for (const id of ids) {
      const name = await this.store.nameOf(id);
      const club = homes.get(id);
      if (!name || !club) { out.skipped.push({ name: name ?? 'Someone', reason: 'not on the roll here' }); continue; }
      if (mode === 'off') {
        if ((await this.setInstructor(actorId, id, false)).changed) out.changed += 1;
        continue;
      }
      if ((await this.setInstructor(actorId, id, true)).changed) out.changed += 1;
      if (mode !== 'show') continue;

      // Shown only when ready; anything missing is named, not just refused.
      const r = await this.readiness.execute({ clubId: club, personId: id });
      if (r.never) { out.skipped.push({ name, reason: `an instructor, but not shown on the website: ${r.never}` }); continue; }
      if (r.missing.length) { out.skipped.push({ name, reason: 'an instructor, not shown yet. Still needs ' + r.missing.join(', ') }); continue; }

      const cur = await this.store.profileOf(club, id);
      await this.save.execute({ actorId, organisationId: club, personId: id, bio: cur?.bio ?? { blocks: [] }, teaches: cur?.teaches ?? null, published: true,
        sortOrder: cur?.sort_order ?? 0, startedYear: cur?.started_year ?? null, showChecks: true });
      if (!cur?.published) out.shown += 1;
    }
    return out;
  }
}
