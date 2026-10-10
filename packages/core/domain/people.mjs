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
 * them here rather than inline in the form handler: a club joining brings a
 * spreadsheet, and a row typed into the form and a row read out of a CSV must
 * be judged identically. If the form rejects a date of birth in the future,
 * the import cannot quietly accept a hundred of them.
 *
 * Every function returns EVERY problem, never the first one. Somebody
 * correcting a spreadsheet should be told all of what is wrong with a row.
 */

/** A person's own details. Everything here is optional except the name. */
/**
 * Gender is M or F, nothing else: it exists to place people in divisions that
 * are men's and women's. Spreadsheets and old records say "male", "Female",
 * "m" — all of those are read, and everything is stored as a single letter.
 * Blank is allowed (not everybody's roll has it). Anything else is not
 * guessed at: it is reported so a registrar can fix it.
 */
import { todayIso, ADULT_AGE } from './defaults.mjs';

export const GENDERS = Object.freeze({ M: 'M', F: 'F' });
export function normaliseGender(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['m', 'male', 'man', 'men', 'boy', 'boys'].includes(s)) return 'M';
  if (['f', 'female', 'woman', 'women', 'girl', 'girls'].includes(s)) return 'F';
  return undefined;   // present but not understood
}

export function problemsWithPerson(fields = {}, { today = null } = {}) {
  const out = [];
  const now = today ?? todayIso();

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

  if (normaliseGender(fields.gender) === undefined)
    out.push(`gender should be M or F, not "${String(fields.gender).trim()}"`);

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
  const day = on ?? todayIso();
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
export function needsGuardian(dateOfBirth, on = null, { adultAt = ADULT_AGE } = {}) {
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

/**
 * Is this person already on the register?
 *
 * The same name with the same date of birth, or with the same email, is the same person. (A parent's email shared with
 * a child is fine: the names differ.) `candidates` are people who already have this name, as the database found them:
 * { display_number, first_name, last_name, date_of_birth ('YYYY-MM-DD' or null), email }. Returns the first match or null.
 */
export function findTwin(candidates, { dateOfBirth = null, email = null } = {}) {
  const mail = String(email ?? '').trim().toLowerCase();
  return candidates.find((c) =>
    (dateOfBirth && String(c.date_of_birth ?? '').slice(0, 10) === dateOfBirth)
    || (mail && String(c.email ?? '').toLowerCase() === mail)) ?? null;
}

/** What to tell somebody who is about to add a person twice. */
export const twinMessage = (twin) =>
  `${twin.first_name} ${twin.last_name} is already on the register as ${twin.display_number}. Open that record instead of adding them again.`;

/**
 * The letters a federation's member numbers start with: its short name (or slug), capitals only, at most five.
 * A federation with nothing usable gets "M".
 */
export function memberNumberPrefix(shortNameOrSlug) {
  return (shortNameOrSlug ?? 'M').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'M';
}

/** MOK-0042: the prefix, a dash, and the sequence number padded to four digits. */
export function formatMemberNumber(prefix, sequence) {
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}
