/**
 * DOMAIN — somebody who is not on any roll, entering an open event
 *
 * They are a real person, once. What identifies them is the email or mobile
 * they give; nothing here creates a second record for somebody already known.
 */
import { normaliseGender, isRealDate } from './people.mjs';

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;
const oneLine = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** The last eight digits: enough to recognise +64 21 555 1234 and 021 555 1234 as one number. */
export function phoneKey(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
}

export function readOutsider(form = {}) {
  return {
    firstName: oneLine(form.firstName, 60), lastName: oneLine(form.lastName, 60),
    dateOfBirth: oneLine(form.dateOfBirth, 10), gender: oneLine(form.gender, 1).toUpperCase(),
    email: oneLine(form.email, 120).toLowerCase(), phone: oneLine(form.phone, 30),
  };
}

export function problemsWithOutsider(i = {}, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const out = [];
  if (!i.firstName) out.push('please give a first name');
  if (!i.lastName) out.push('please give a last name');
  if (!EMAIL.test(i.email ?? '')) out.push('that email address does not look right');
  // Entry rules depend on age and sex, so for a new person both are required here.
  if (!i.dateOfBirth || !isRealDate(i.dateOfBirth)) out.push('please give a date of birth as YYYY-MM-DD');
  else if (i.dateOfBirth > today || i.dateOfBirth < '1900-01-01') out.push('that date of birth cannot be right');
  if (!['M', 'F'].includes(normaliseGender(i.gender) ?? '')) out.push('please choose M or F');
  return out;
}
