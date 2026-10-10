/**
 * USE CASE — give somebody a way into the register: create their account if they have none, grant the role, and hand
 * back what the administrator needs to pass the sign-in link on.
 *
 * Not a way to read somebody's mail, and not a password: the link expires, works once, and this is written to the audit
 * log with who did it. Restricted to the roles that already administer the register, at the organisations they administer.
 */

import { problemsWithSignInAddress, accountClashMessage } from '../domain/people.mjs';
import { MANAGE } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, PERSON_REGISTER, AUTHORISATION } from './ports.mjs';

export class GrantAccess {
  constructor({ register, auth }) {
    this.register = requirePort(register, PERSON_REGISTER);
    this.auth = requirePort(auth, AUTHORISATION);
  }

  async execute({ actorId, personId, role = 'member', email = null, organisationId = null }) {
    return this.register.inTransaction(async (tx) => {
      const person = await tx.personForAccess(personId);
      if (!person) throw new Missing('Person');
      const home = organisationId ?? await tx.defaultHomeFor(personId);
      if (!home) throw new Missing('Person has no current affiliation');
      if (!await this.auth.hasRoleAt(actorId, home, MANAGE)) throw new NotPermitted('Not permitted');

      const address = (email ?? person.email ?? '').trim().toLowerCase();
      const problems = problemsWithSignInAddress(address, person);
      if (problems.length) throw new Refused(problems);

      const owner = await tx.accountByEmail(address);
      if (owner?.person_id && owner.person_id !== personId) {
        throw new Refused(accountClashMessage(address, owner, person));
      }

      const account = await tx.upsertAccount(personId, address);
      await tx.grantRole({ accountId: account.id, organisationId: home, role, grantedBy: actorId });
      await tx.audit({ actorId, organisationId: home, action: 'grant_access', entity: 'account', entityId: account.id,
        after: { personId, role, address } });
      return { account, organisationId: home, role };
    });
  }
}
