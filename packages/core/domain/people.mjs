/**
 * DOMAIN — what has to be true of a person on the roll
 *
 * Pure checks, no I/O. They exist as functions rather than as an entity
 * because person and affiliation already have working, transactional,
 * audited operations in the adapter that allocates member numbers and writes
 * the audit log. Re-implementing those as an entity would be a second version
 * of code that works, and two versions of the rules is how they start
 * disagreeing.
 *
 * What was missing is the rules themselves, and there is one reason to put
 * them here rather than inline in the form handler: a dojo joining brings a
 * spreadsheet, and a row typed into the form and a row read out of a CSV must
 * be judged identically. If the form rejects a date of birth in the future,
 * the import cannot quietly accept a hundred of them.
 *
 * Every function returns EVERY problem, never the first one. Somebody
 * correcting a spreadsheet should be told all of what is wrong with a row.
 */

/** A person's own details. Everything here is optional except the name. */
export function problemsWithPerson(fields = {}, { today = null } = {}) {
  const out = [];
  const now = today ?? new Date().toISOString().slice(0, 10);

  if (!String(fields.firstName ?? '').trim()) out.push('a first name is required');
  if (!String(fields.lastName ?? '').trim()) out.push('a last name is required');

  const born = String(fields.dateOfBirth ?? '').trim();
  if (born) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(born)) {
      out.push(`"${born}" is not a date of birth — it needs to be YYYY-MM-DD`);
    } else if (!isRealDate(born)) {
      out.push(`there is no such date as ${born}`);
    } else if (born > now) {
      // Caught because a spreadsheet exported as US dates turns 03/04/2015
      // into 2015-04-03 or 2015-03-04 depending on who wrote it, and a
      // two-digit year turns 65 into 2065.
      out.push(`the date of birth ${born} is in the future`);
    } else if (born < '1900-01-01') {
      out.push(`the date of birth ${born} is before 1900`);
    }
  }

  const email = String(fields.email ?? '').trim();
  // Deliberately loose. The only address that is definitely wrong is one that
  // cannot be delivered to at all, and anything stricter rejects real
  // addresses — which, for a system whose entire sign-in is an emailed link,
  // means locking a real member out.
  if (email && !/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email))
    out.push(`"${email}" does not look like an email address`);

  return out;
}

/** The relationship between that person and a club. */
export function problemsWithMembership(fields = {}, { roles = ROLES } = {}) {
  const out = [];

  if (fields.role && !roles.includes(fields.role))
    out.push(`"${fields.role}" is not a role`);

  const starts = String(fields.starts ?? '').trim();
  const ends = String(fields.ends ?? '').trim();
  const paid = String(fields.paidUntil ?? '').trim();

  for (const [value, what] of [[starts, 'The start date'],
                               [ends, 'The end date'],
                               [paid, 'The paid-until date']]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !isRealDate(value)))
      out.push(`${what.toLowerCase()} "${value}" is not a date`);
  }

  if (starts && ends && isRealDate(starts) && isRealDate(ends) && ends < starts)
    out.push('the membership ends before it starts');

  if (fields.status && !STATUSES.includes(fields.status))
    out.push(`"${fields.status}" is not a membership status`);

  return out;
}

export const ROLES = Object.freeze(
  ['member', 'instructor', 'assistant', 'official', 'supporter']);

export const STATUSES = Object.freeze(
  ['pending', 'active', 'lapsed', 'suspended', 'resigned']);

/**
 * Age on a given day, from a date of birth.
 *
 * Derived, never stored — an age in a column is wrong within a year of being
 * written, and it is the sort of wrong nobody notices until a child is entered
 * in the wrong division at a tournament.
 *
 * Done with string comparison rather than Date arithmetic on purpose. A date
 * of birth is a calendar day with no time and no timezone; turning it into a
 * Date is how it acquires both, and how somebody's birthday lands a day early
 * for half the world.
 */
export function ageOn(dateOfBirth, on) {
  if (!dateOfBirth || !isRealDate(dateOfBirth)) return null;
  const day = on ?? new Date().toISOString().slice(0, 10);
  if (!isRealDate(day) || day < dateOfBirth) return null;

  let years = +day.slice(0, 4) - +dateOfBirth.slice(0, 4);
  // Not had this year's birthday yet.
  if (day.slice(5) < dateOfBirth.slice(5)) years -= 1;
  return years;
}

/**
 * Whether a guardian's consent is needed.
 *
 * Eighteen here, not because every federation says eighteen, but because
 * somewhere has to. Where a federation's own threshold differs it belongs in
 * that organisation's settings, and this becomes its default rather than its
 * definition — which is a change to make when a federation actually asks for
 * it, not before.
 */
export function needsGuardian(dateOfBirth, on = null, { adultAt = 18 } = {}) {
  const age = ageOn(dateOfBirth, on);
  return age == null ? false : age < adultAt;
}

/** A real day, not just four digits and two dashes. 31 February is not one. */
export function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
