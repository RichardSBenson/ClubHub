/**
 * USE CASES — link a child to a parent or guardian, choose who the club writes to, end a link, list a child's guardians.
 *
 * Every one of them is a registrar's act, at one of the child's own clubs.
 */

import { problemsWithGuardianLink } from '../domain/family.mjs';
import { REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, GUARDIAN_REGISTER, AUTHORISATION } from './ports.mjs';

class GuardianUseCase {
  constructor({ register, auth }) {
    this.register = requirePort(register, GUARDIAN_REGISTER);
    this.auth = requirePort(auth, AUTHORISATION);
  }

  /** The child's club at which this actor may keep the register, or a refusal. */
  async registrarHome(tx, actorId, childId) {
    for (const home of await tx.homesOf(childId)) {
      if (await this.auth.hasRoleAt(actorId, home, REGISTER)) return home;
    }
    throw new NotPermitted('Not permitted');
  }
}

export class LinkGuardian extends GuardianUseCase {
  constructor({ register, auth, adultAge }) { super({ register, auth }); this.adultAge = adultAge; }

  async execute({ actorId, guardianId, childId, relationship = 'parent' }) {
    return this.register.inTransaction(async (tx) => {
      const guardian = await tx.personById(guardianId);
      const child = await tx.personById(childId);
      if (!guardian || !child) throw new Missing('Person');
      const home = await this.registrarHome(tx, actorId, childId);

      const problems = problemsWithGuardianLink({ guardian, child, relationship }, { adultAge: this.adultAge() });
      if (problems.length) throw new Refused(problems.join(' '));

      const link = await tx.addLink({ guardianId, childId, relationship, createdBy: actorId });
      if (!link) throw new Refused(`${guardian.first_name} is already linked to ${child.first_name}.`);

      await tx.audit({ actorId, organisationId: home, action: 'guardian_link', entity: 'person', entityId: childId,
        after: { guardian: `${guardian.first_name} ${guardian.last_name}`, child: `${child.first_name} ${child.last_name}`, relationship } });
      return link;
    });
  }
}

/**
 * Choose who a child's club mail goes to. `main` makes this parent the main contact (and removes the mark from the
 * child's other links); `copy` marks a non-main parent as also copied in; `fees` marks who looks after the fees.
 */
export class SetGuardianContact extends GuardianUseCase {
  async execute({ actorId, linkId, main = false, copy = false, fees = false }) {
    return this.register.inTransaction(async (tx) => {
      const link = await tx.linkById(linkId);
      if (!link) throw new Missing('Link');
      const home = await this.registrarHome(tx, actorId, link.child_id);
      await tx.chooseContact(link, { main: !!main, copy: !main && !!copy, fees: !!fees });
      await tx.audit({ actorId, organisationId: home, action: 'guardian_contact', entity: 'person', entityId: link.child_id,
        after: { linkId, main: !!main, copy: !main && !!copy, fees: !!fees } });
    });
  }
}

export class UnlinkGuardian extends GuardianUseCase {
  async execute({ actorId, linkId }) {
    return this.register.inTransaction(async (tx) => {
      const link = await tx.linkById(linkId);
      if (!link) throw new Missing('Link');
      const home = await this.registrarHome(tx, actorId, link.child_id);
      await tx.endLink(linkId);
      await tx.audit({ actorId, organisationId: home, action: 'guardian_unlink', entity: 'person', entityId: link.child_id,
        after: { guardian: `${link.g_first} ${link.g_last}`, child: `${link.c_first} ${link.c_last}` } });
    });
  }
}

export class ListGuardians extends GuardianUseCase {
  async execute({ actorId, childId }) {
    return this.register.inTransaction(async (tx) => {
      await this.registrarHome(tx, actorId, childId);
      return tx.guardiansOf(childId);
    });
  }
}
