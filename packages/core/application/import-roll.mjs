/**
 * USE CASES — add a planned set of people to a roll, and read the roll the planner compares against.
 *
 * The planning (which rows are new, which are twins) is the domain's; this applies the rows that were planned as "add".
 */

import { normaliseGender, memberNumberPrefix, formatMemberNumber } from '../domain/people.mjs';
import { REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, PERSON_REGISTER, AUTHORISATION } from './ports.mjs';

// A grade the club already holds is RECORDED, not awarded. It did not happen here, there was no panel, and nothing
// ratified it; writing it as though this system conferred it would put a fiction in the one place a federation has to
// be able to trust. The note says where it came from.
const HELD_GRADE_NOTE = "Held on joining. Imported from the club's own records; not graded through this system.";

class RollUseCase {
  constructor({ register, auth }) {
    this.register = requirePort(register, PERSON_REGISTER);
    this.auth = requirePort(auth, AUTHORISATION);
  }
  async mustKeepRegister(actorId, organisationId) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, REGISTER)) throw new NotPermitted('Not permitted');
  }
}

export class ImportRoll extends RollUseCase {
  async execute({ actorId, organisationId, rows = [] }) {
    await this.mustKeepRegister(actorId, organisationId);
    const adding = rows.filter((r) => r.action === 'add');
    if (!adding.length) throw new Refused('There is nothing to import');

    return this.register.inTransaction(async (tx) => {
      await tx.lockEnrolment();
      const prefix = memberNumberPrefix(await tx.federationShortNameFor(organisationId));
      let last = await tx.lastNumberIn(prefix);

      const created = [];
      let graded = 0;
      for (const row of adding) {
        const v = row.values;
        last += 1;
        const number = formatMemberNumber(prefix, last);
        const person = await tx.addPerson({
          number, firstName: v.firstName.trim(), lastName: v.lastName.trim(), preferredName: v.preferredName || null,
          dateOfBirth: v.dateOfBirth || null, gender: normaliseGender(v.gender) ?? null, email: v.email || null, phone: v.phone || null,
        });
        if (v.emergencyName || v.emergencyPhone) await tx.addEmergencyContact(person.id, v.emergencyName || null, v.emergencyPhone || null);
        await tx.addAffiliation({ personId: person.id, organisationId, role: v.role ?? 'member', starts: v.starts || null, paidUntil: v.paidUntil || null });
        if (v.gradeId) {
          await tx.recordHeldGrade({ personId: person.id, gradeId: v.gradeId, awardedOn: v.gradedOn, organisationId, note: HELD_GRADE_NOTE });
          graded += 1;
        }
        created.push({ id: person.id, number, line: row.line, name: `${v.firstName} ${v.lastName}`.trim() });
      }

      await tx.audit({ actorId, organisationId, action: 'import', entity: 'organisation', entityId: organisationId,
        after: { added: created.length, graded, numbers: created.map((c) => c.number) } });
      return { added: created.length, graded, created };
    });
  }
}

export class ReadRoll extends RollUseCase {
  async execute({ actorId, organisationId }) {
    await this.mustKeepRegister(actorId, organisationId);
    return this.register.inTransaction((tx) => tx.rollOf(organisationId));
  }
}
