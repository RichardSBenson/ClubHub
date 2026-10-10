/**
 * USE CASE — add a club beneath a federation or region.
 *
 * The club starts with no public page (that is the club's to ask for and the federation's to approve) and, if an
 * administrator is named, with that person enrolled and able to sign in. The administrator goes through the same two
 * operations a registrar uses for anybody, so there is one way to enrol a person and one way to give them access.
 */

import { problemsWithNewClub, clubSlugFrom, hasAdministrator } from '../domain/new-club.mjs';
import { MANAGE } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, ORGANISATION_REGISTER } from './ports.mjs';

export class AddClub {
  /**
   * `enrol(actorId, fields)` and `grantAccess(actorId, personId, fields)` are the register's own operations, supplied from outside.
   */
  constructor({ organisations, auth, enrol, grantAccess }) {
    this.organisations = requirePort(organisations, ORGANISATION_REGISTER);
    this.auth = requirePort(auth, AUTHORISATION);
    this.enrol = enrol;
    this.grantAccess = grantAccess;
  }

  async execute({ actorId, parentId, input }) {
    if (!await this.auth.hasRoleAt(actorId, parentId, MANAGE)) throw new NotPermitted('Not permitted');
    const parent = await this.organisations.organisationById(parentId);
    if (!parent) throw new Missing('Organisation');
    if (parent.type === 'club') throw new Refused('A club cannot have clubs beneath it.');

    const problems = problemsWithNewClub(input);
    if (problems.length) throw new Refused(problems.join(' '));

    const slug = input.slug ?? clubSlugFrom(input.name);
    if (await this.organisations.slugTaken(slug)) throw new Refused(`There is already an organisation at "${slug}". Choose a different web address.`);
    if (hasAdministrator(input) && await this.organisations.emailHasAccount(input.adminEmail))
      throw new Refused(`${input.adminEmail} already has an account. Add the club first, then give that person access to it from their own record.`);

    const club = await this.organisations.addClub({ parent, name: input.name, slug, city: input.city || null, addedBy: actorId });

    let admin = null;
    if (hasAdministrator(input)) {
      try {
        const person = await this.enrol(actorId, { organisationId: club.id, firstName: input.adminFirst, lastName: input.adminLast, email: input.adminEmail, role: 'member' });
        admin = await this.grantAccess(actorId, person.id, { role: 'administrator', email: input.adminEmail, organisationId: club.id });
      } catch (e) {
        // The club exists; say so, and say what did not happen, rather than leaving a half-finished club behind a generic error.
        e.club = club;
        throw e;
      }
    }
    return { club, admin };
  }
}
