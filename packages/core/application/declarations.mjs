/**
 * USE CASES — the federation's declaration: publish new wording, see where one person stands, sign it.
 *
 * A child's declaration is signed by a parent or guardian, never by the child; whoever signs is recorded, with how.
 */

import { stateOf, problemsWithSigning, problemsWithPublishing, needsGuardian } from '../domain/declarations.mjs';
import { REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, AUTHORISATION, DECLARATION_STORE } from './ports.mjs';

/** Nothing to sign, to sign, or signed. */
export class DeclarationStanding {
  constructor({ store }) { this.store = requirePort(store, DECLARATION_STORE); }

  async execute({ personId }) {
    const home = await this.store.firstHomeOf(personId);
    if (!home) return { state: 'none' };
    const owner = await this.store.ownerOf(home);
    const current = owner ? await this.store.currentOf(owner.id) : null;
    if (!current) return { state: 'none', owner };
    const signed = await this.store.signingOf(personId, current.id);
    return { state: stateOf({ current, signed }), owner, current, signed };
  }
}

export class PublishDeclaration {
  constructor({ store, auth }) {
    this.store = requirePort(store, DECLARATION_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
  }

  async execute({ actorId, organisationId, version, body }) {
    const owner = await this.store.ownerOf(organisationId);
    if (!await this.auth.hasRoleAt(actorId, owner.id, REGISTER)) throw new NotPermitted('Not permitted');
    const problems = problemsWithPublishing({ version, body });
    if (problems.length) throw new Refused(problems.join(' '));
    const published = await this.store.publish({ ownerId: owner.id, version: String(version).trim(), body: String(body).trim(), publishedBy: actorId });
    if (!published) throw new Refused(`Version ${String(version).trim()} has already been used. Give the new wording a new version.`);
    return published;
  }
}

export class SignDeclaration {
  /** `howMayActFor(accountId, personId)` → 'self' | 'guardian' | null — the self-service door. */
  constructor({ store, standing, howMayActFor, adultAge }) {
    this.store = requirePort(store, DECLARATION_STORE);
    this.standing = standing;
    this.howMayActFor = howMayActFor;
    this.adultAge = adultAge;
  }

  async execute({ actorId, personId, accepted, name, ip = null }) {
    const how = await this.howMayActFor(actorId, personId);
    if (!how) throw new NotPermitted('Not permitted');
    const st = await this.standing.execute({ personId });
    if (st.state === 'none') throw new Refused('There is no declaration to sign yet.');
    if (st.state === 'signed') return st;
    const age = await this.store.ageOf(personId);
    const problems = problemsWithSigning({ accepted, name, isChild: needsGuardian(age, this.adultAge()), how });
    if (problems.length) throw new Refused(problems.join(' '));
    await this.store.addSigning({ personId, declarationId: st.current.id, name: String(name).trim(), signedBy: actorId, guardian: how !== 'self', ip });
    return this.standing.execute({ personId });
  }
}
