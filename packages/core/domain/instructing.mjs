/**
 * HONBU — WHO APPEARS ON A PUBLIC WEBSITE
 *
 * Being an instructor and being on the internet are different facts. The
 * register knows the first because somebody recorded a role. The second is a
 * decision about a person — their name, their photograph and their grade,
 * readable by anybody, indefinitely — and the register should never infer it.
 *
 * Two rules live here rather than in a route, because a rule in a route is a
 * rule that holds until somebody adds a second route.
 */
import { Age, DomainError } from './values.mjs';

/**
 * The age below which this platform will not publish a person to a public
 * website at all, whatever anybody ticks.
 *
 * Eighteen is the default and a federation may raise it. It may not lower it:
 * a configuration file is not the right place to decide that a fifteen-year-old
 * assistant instructor's photograph belongs on the open web. Teenagers do
 * assist in classes, and the answer for them is to be in the register, not on
 * the website.
 */
import { ADULT_AGE } from './defaults.mjs';

export const PUBLIC_PROFILE_MINIMUM_AGE = ADULT_AGE;

export function minimumAgeFor(settings = {}) {
  const asked = Number(settings?.publicProfileMinimumAge);
  return Number.isFinite(asked) && asked > PUBLIC_PROFILE_MINIMUM_AGE
    ? Math.floor(asked)
    : PUBLIC_PROFILE_MINIMUM_AGE;
}

/**
 * Why this person may not be published, or null if they may.
 *
 * Returns a reason rather than a boolean so the screen can say what is wrong.
 * "Cannot publish" with no explanation is how somebody ends up editing the
 * database by hand.
 */
export function reasonNotToPublish({ person, isInstructor, on, settings = {} }) {
  if (!person) return 'There is no such person.';

  if (!isInstructor)
    return 'That person is not recorded as an instructor here. Give them the '
      + 'instructor role on the roll first — the website follows the register, '
      + 'not the other way round.';

  // An unknown date of birth is not an adult. A register that does not know
  // somebody's age cannot be the thing that decides they are old enough.
  if (!person.dateOfBirth)
    return 'Their date of birth is not recorded, so the system cannot tell '
      + 'whether they are old enough to appear on a public website. Add it to '
      + 'their record first.';

  const minimum = minimumAgeFor(settings);
  const age = Age.onDate(person.dateOfBirth, on);
  if (age < minimum)
    return `They are ${age}. This platform does not publish a public profile `
      + `for anybody under ${minimum} — name, photograph and grade on a page `
      + 'anybody can read is not something to decide on a minor\'s behalf. '
      + 'They can hold the instructor role on the roll without being on the '
      + 'website.';

  return null;
}

/** Throws unless this person may be published. */
export function assertMayPublish(args) {
  const reason = reasonNotToPublish(args);
  if (reason) throw new DomainError(reason);
}
