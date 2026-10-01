/**
 * DOMAIN — newcomers
 *
 * Somebody walks in off the street to try a class. They are not a member, and
 * must not look like one: they stay out of the roll, the grading lists, search
 * and the member numbers until they join. What a club needs on the day is
 * small and specific — who they are, how to reach them, who to call if
 * something goes wrong, anything medical the instructor should know, and that
 * they (or, for a child, their parent) accepted the club's waiver.
 *
 * Their details are kept only while they might join. A newcomer who stops
 * coming is deleted — see RETAIN_DAYS — because a child's medical notes should
 * not outlive the reason for collecting them.
 */
import { isRealDate } from './people.mjs';

export const ADULT_AT = 18;
/** After this many classes the club should be talking to them about joining. */
export const TALK_ABOUT_JOINING_AFTER = 3;
export const RETAIN_DAYS = 180;

const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function readNewcomer(form = {}) {
  const t = (k, n) => String(form[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    firstName: t('firstName', 60), lastName: t('lastName', 60),
    email: t('email', 120).toLowerCase(), phone: t('phone', 30),
    dateOfBirth: t('dateOfBirth', 10),
    guardianName: t('guardianName', 100), guardianPhone: t('guardianPhone', 30),
    emergencyName: t('emergencyName', 100), emergencyPhone: t('emergencyPhone', 30),
    medicalNotes: String(form.medicalNotes ?? '').replace(/\r\n/g, '\n').trim().slice(0, 1000),
    consentName: t('consentName', 100),
    consentGiven: form.consent === '1',
  };
}

export function ageToday(dateOfBirth, today) {
  if (!dateOfBirth || !isRealDate(dateOfBirth)) return null;
  let y = +today.slice(0, 4) - +dateOfBirth.slice(0, 4);
  if (today.slice(5) < dateOfBirth.slice(5)) y -= 1;
  return y;
}

export const isChild = (dateOfBirth, today) => {
  const a = ageToday(dateOfBirth, today);
  return a != null && a < ADULT_AT;
};

export function problemsWithNewcomer(n, today) {
  const out = [];
  if (!n.firstName) out.push('A first name is needed.');
  if (!n.lastName) out.push('A last name is needed.');
  if (!n.email && !n.phone && !(isChild(n.dateOfBirth, today) && n.guardianPhone)) out.push('An email or a phone number is needed, so the club can reach them (a parent\'s phone will do for a child).');
  if (n.email && !EMAIL.test(n.email)) out.push('That email does not look right.');

  if (!n.dateOfBirth) out.push('A date of birth is needed — it decides whether a parent has to agree.');
  else if (!isRealDate(n.dateOfBirth)) out.push('The date of birth should look like 2015-03-14.');
  else if (n.dateOfBirth > today) out.push('The date of birth is in the future.');
  else if (n.dateOfBirth < '1900-01-01') out.push('The date of birth is before 1900.');
  else if (isChild(n.dateOfBirth, today)) {
    if (!n.guardianName) out.push('A parent or guardian\'s name is needed for somebody under 18.');
    if (!n.guardianPhone) out.push('A parent or guardian\'s phone number is needed for somebody under 18.');
  }
  if (!n.emergencyPhone && !(isChild(n.dateOfBirth, today) && n.guardianPhone))
    out.push('Somebody to call in an emergency is needed.');
  if (!n.consentGiven) out.push('They (or their parent or guardian) need to accept the waiver.');
  if (!n.consentName) out.push('Who accepted the waiver? Enter their name.');
  return out;
}

/** "Visit 2", "2 classes" — and when it is time to talk about joining. */
export const timeToTalk = (visits) => visits >= TALK_ABOUT_JOINING_AFTER;
