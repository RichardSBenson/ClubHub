/**
 * USE CASE — enrol somebody on an organisation's register.
 *
 * The rules live here and in the domain, so a row typed into the form, a row read from a spreadsheet and a call from
 * the API are all judged the same way. Storage, the clock and webhooks are ports; this file knows none of them.
 */

import { problemsWithPerson, problemsWithMembership, normaliseGender, findTwin, twinMessage,
         memberNumberPrefix, formatMemberNumber } from '../domain/people.mjs';
import { problemsWithRoleAndGrade } from '../domain/roles.mjs';
import { REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, PERSON_REGISTER, AUTHORISATION, ANNOUNCER } from './ports.mjs';

export class EnrolPerson {
  constructor({ register, auth, announcer }) {
    this.register = requirePort(register, PERSON_REGISTER);
    this.auth = requirePort(auth, AUTHORISATION);
    this.announcer = requirePort(announcer, ANNOUNCER);
  }

  async execute({ actorId, organisationId, firstName, lastName, preferredName = null, dateOfBirth = null, gender = null,
                  email = null, phone = null, role = 'member', starts = null, paidUntil = null,
                  emergencyName = null, emergencyPhone = null }) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, REGISTER)) throw new NotPermitted('Not permitted');

    const problems = [
      ...problemsWithPerson({ firstName, lastName, dateOfBirth, email, gender }),
      ...problemsWithMembership({ role, starts, paidUntil }),
      ...problemsWithRoleAndGrade({ role, hasGrade: false }),
    ];
    if (problems.length) throw new Refused(problems);

    const person = await this.register.inTransaction(async (tx) => {
      // A form submitted twice is judged the second time against the first, not both passing together.
      await tx.lockEnrolment();

      // The same name with the same date of birth or the same email is the same person. Refuse it and say where
      // the first one is, so a second, empty record is never the one somebody opens.
      const twin = findTwin(await tx.peopleNamed(firstName.trim(), lastName.trim()), { dateOfBirth, email });
      if (twin) throw new Refused(twinMessage(twin));

      const prefix = memberNumberPrefix(await tx.federationShortNameFor(organisationId));
      const number = formatMemberNumber(prefix, (await tx.lastNumberIn(prefix)) + 1);

      const added = await tx.addPerson({
        number, firstName: firstName.trim(), lastName: lastName.trim(), preferredName: preferredName || null,
        dateOfBirth: dateOfBirth || null, gender: normaliseGender(gender) ?? null, email: email || null, phone: phone || null,
      });
      if (emergencyName || emergencyPhone) await tx.addEmergencyContact(added.id, emergencyName || null, emergencyPhone || null);
      await tx.addAffiliation({ personId: added.id, organisationId, role, starts: starts || null, paidUntil: paidUntil || null });
      await tx.audit({ actorId, organisationId, action: 'enrol', entity: 'person', entityId: added.id, after: { role, number } });
      return { ...added, number };
    });

    await this.announcer.announce(organisationId, 'member.created',
      { id: person.id, number: person.number, first_name: person.first_name, last_name: person.last_name, role });
    return person;
  }
}
