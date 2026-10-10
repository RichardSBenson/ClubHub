/**
 * USE CASES — correct a person's details, and move a member to another club.
 */

import { problemsWithPerson, problemsWithMembership, normaliseGender } from '../domain/people.mjs';
import { REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, PERSON_REGISTER, AUTHORISATION } from './ports.mjs';

export class UpdatePerson {
  constructor({ register, auth }) {
    this.register = requirePort(register, PERSON_REGISTER);
    this.auth = requirePort(auth, AUTHORISATION);
  }

  async execute({ actorId, personId, fields = {} }) {
    return this.register.inTransaction(async (tx) => {
      const home = await tx.homeOf(personId);
      if (!home) throw new Missing('Person');
      if (!await this.auth.hasRoleAt(actorId, home.organisationId, REGISTER)) throw new NotPermitted('Not permitted');

      const changes = {
        firstName: fields.firstName, lastName: fields.lastName, preferredName: fields.preferredName,
        dateOfBirth: fields.dateOfBirth,
        gender: fields.gender === undefined ? undefined : (normaliseGender(fields.gender) ?? null),
        email: fields.email, phone: fields.phone,
      };
      const touchesPerson = Object.values(changes).some((v) => v !== undefined);
      const touchesEmergency = fields.emergencyName !== undefined || fields.emergencyPhone !== undefined;
      const touchesAffiliation = fields.paidUntil !== undefined || fields.status !== undefined;
      if (!touchesPerson && !touchesEmergency && !touchesAffiliation) throw new Refused('Nothing to change');

      // Judged on the way in, not only at enrolment: a correction is exactly where a bad date of birth gets typed.
      // Only what is being changed; a field left alone keeps what it has, so a missing name is not a problem here.
      const problems = [
        ...problemsWithPerson({
          firstName: fields.firstName ?? 'unchanged', lastName: fields.lastName ?? 'unchanged',
          dateOfBirth: fields.dateOfBirth, email: fields.email, gender: fields.gender,
        }),
        ...problemsWithMembership({ status: fields.status, paidUntil: fields.paidUntil }),
      ];
      if (problems.length) throw new Refused(problems);

      const before = await tx.snapshotOf(personId);
      if (touchesPerson) await tx.changePerson(personId, changes);
      if (touchesEmergency) await tx.changeEmergencyContact(personId, { name: fields.emergencyName, phone: fields.emergencyPhone });
      if (touchesAffiliation) await tx.changeAffiliation(personId, { paidUntil: fields.paidUntil, status: fields.status });
      await tx.audit({ actorId, organisationId: home.organisationId, action: 'update', entity: 'person', entityId: personId, before, after: fields });
    });
  }
}

/**
 * Move someone to another club: close the old membership, open a new one. Their grading history belongs to the
 * person, so it is untouched.
 */
export class TransferMember {
  constructor({ register, auth }) {
    this.register = requirePort(register, PERSON_REGISTER);
    this.auth = requirePort(auth, AUTHORISATION);
  }

  async execute({ actorId, personId, toOrganisationId, on }) {
    return this.register.inTransaction(async (tx) => {
      const current = await tx.currentMembership(personId);
      if (!current) throw new Missing('No current membership');
      if (!await this.auth.hasRoleAt(actorId, current.organisationId, REGISTER)
       || !await this.auth.hasRoleAt(actorId, toOrganisationId, REGISTER)) throw new NotPermitted('Not permitted');
      await tx.endAffiliation(current.id, on);
      return tx.addAffiliation({ personId, organisationId: toOrganisationId, role: 'member', starts: on });
    });
  }
}
