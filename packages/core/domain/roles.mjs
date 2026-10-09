/**
 * DOMAIN — what each kind of person on the roll may be
 *
 * Four rules the federation holds to, written once so a form, a spreadsheet
 * import and a screen all judge them the same way:
 *
 *  1. Only someone who holds a dan grade (a black belt) can be an instructor.
 *  2. A supporter is not a member. Supporters are friends of the club: they
 *     have no membership, no fees, no standing.
 *  3. A child is under a parent or guardian: a person under eighteen has to
 *     be linked to one.
 *  4. A supporter has nothing to do with rank: no gradings, no recognised
 *     grades, no titles.
 *
 * Pure functions. They return reasons (text), never booleans, so a screen can
 * say what is wrong.
 */
import { needsGuardian } from './people.mjs';

/** Roles that stand for "a member of the club" (a supporter is deliberately absent). */
export const MEMBER_ROLES = Object.freeze(['member', 'instructor', 'assistant']);

export const isSupporterRole = (role) => role === 'supporter';

/** Rule 1. `grade` is { is_dan } or null (no grade held). */
export function whyNotInstructor(grade) {
  if (grade?.is_dan) return null;
  return 'Only someone who holds a dan grade (a black belt) can be an instructor.'
    + (grade ? ` ${grade.label ?? 'Their current grade'} is below that.` : ' They do not hold a dan grade on the record.');
}

/** Rules 2 and 4: reasons a supporter cannot take part in anything ranked. */
export const SUPPORTER_NO_RANK = 'A supporter is not a member and has nothing to do with grades or rankings.';

/** Role against grade at enrolment or import. Returns a list of problems. */
export function problemsWithRoleAndGrade({ role, grade = null, hasGrade = !!grade }) {
  const out = [];
  if (role === 'instructor') {
    const why = whyNotInstructor(hasGrade ? grade : null);
    if (why) out.push(why);
  }
  if (isSupporterRole(role) && hasGrade) out.push(SUPPORTER_NO_RANK);
  return out;
}

/** Rule 3. True if this person is a child with no current guardian link. */
export function needsGuardianLink({ dateOfBirth, on = null, guardianCount = 0, adultAge }) {
  return needsGuardian(dateOfBirth, on, adultAge ? { adultAt: adultAge } : {}) && guardianCount === 0;
}
