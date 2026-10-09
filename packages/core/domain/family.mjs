/**
 * HONBU — FAMILIES
 *
 * A parent or guardian is a person linked to a child, and may act for that
 * child for as long as the child is a minor. That "as long as" is worked out
 * from the child's date of birth whenever it matters; it is never a stored
 * flag that somebody has to remember to turn off.
 *
 * Pure: no database, no request.
 */
import { ageOn } from './people.mjs';

import { ADULT_AGE } from './defaults.mjs';

export const AGE_OF_MAJORITY = ADULT_AGE;

export const RELATIONSHIPS = Object.freeze({
  parent: 'Parent',
  step_parent: 'Step-parent',
  guardian: 'Legal guardian',
  grandparent: 'Grandparent',
  aunt_uncle: 'Aunt or uncle',
  other_family: 'Other family',
  carer: 'Carer',
});

export const isMinor = (dateOfBirth, on = null) => {
  const age = ageOn(dateOfBirth, on);
  return age !== null && age < AGE_OF_MAJORITY;
};

/** What is wrong with a proposed link, as sentences. */
export function problemsWithGuardianLink({ guardian, child, relationship }, { today = null } = {}) {
  const out = [];
  if (!guardian || !child) return ['Choose both the parent or guardian and the child.'];
  if (guardian.id === child.id) out.push('Somebody cannot be their own guardian.');
  if (!Object.hasOwn(RELATIONSHIPS, relationship))
    out.push('Choose how they are related.');
  if (!child.date_of_birth)
    out.push(`${child.first_name} has no date of birth on record. Add it first — `
      + 'a guardian\'s authority depends on the child being under 18.');
  else if (!isMinor(child.date_of_birth, today))
    out.push(`${child.first_name} is 18 or over, so nobody can act for them. They `
      + 'can be given their own access.');
  if (guardian.date_of_birth && isMinor(guardian.date_of_birth, today))
    out.push(`${guardian.first_name} is under 18 and cannot be a guardian.`);
  return out;
}

/**
 * What a person may change about themselves. Name, date of birth, grade and
 * membership are the register's — a member who could edit their own grade
 * would not be a register.
 */
export const SELF_EDITABLE = Object.freeze({
  person: ['preferred_name', 'phone', 'email'],
  private: ['address_line', 'suburb', 'city', 'postcode',
            'emergency_name', 'emergency_phone', 'medical_notes'],
});

const clean = (v, n) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n) || null;

export function readSelfEdit(form = {}) {
  return {
    preferred_name: clean(form.preferred_name, 60),
    phone: clean(form.phone, 40),
    email: clean(form.email, 160)?.toLowerCase() ?? null,
    address_line: clean(form.address_line, 160),
    suburb: clean(form.suburb, 80),
    city: clean(form.city, 80),
    postcode: clean(form.postcode, 12),
    emergency_name: clean(form.emergency_name, 80),
    emergency_phone: clean(form.emergency_phone, 40),
    medical_notes: clean(form.medical_notes, 2000),
    about: clean(form.about, 280),
  };
}

export function problemsWithSelfEdit(e) {
  const out = [];
  if (e.email && !/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(e.email))
    out.push('That email address does not look right.');
  if ((e.emergency_name && !e.emergency_phone) || (!e.emergency_name && e.emergency_phone))
    out.push('An emergency contact needs both a name and a phone number.');
  return out;
}
