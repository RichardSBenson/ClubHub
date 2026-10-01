/**
 * HONBU — A CLUB'S PAGE ON THE FEDERATION'S WEBSITE
 *
 * A club's page is the federation speaking on the club's behalf, in the
 * federation's design, so two decisions are involved and they belong to
 * different people. What the page says is the club's. Whether it appears
 * under the federation's name is the federation's.
 *
 * Three states, derived rather than stored, because a stored state can
 * disagree with the facts it summarises:
 *
 *   live        the federation has switched it on
 *   requested   the club has asked and nobody has answered
 *   off         neither — the default, and what every new club is
 *
 * Declining is not a fourth state. It returns the club to "off" with the
 * federation's reason attached, which is what the club needs to see.
 *
 * Nothing in here touches a database or a request.
 */
import { DomainError } from './values.mjs';

export const LIMITS = Object.freeze({
  blurb: 1200, whoTrains: 400, directions: 400, label: 80, sessions: 12,
});

/** Monday first, because that is how a training week is read here. */
export const WEEK = Object.freeze([
  [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'],
  [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday'],
]);

export function stateOf(profile) {
  if (profile?.published) return 'live';
  if (profile?.page_requested_at) return 'requested';
  return 'off';
}

const text = (v, max) => {
  const t = String(v ?? '').replace(/\r\n/g, '\n').trim();
  return t ? t.slice(0, max) : null;
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const flag = (v) => v === 'on' || v === 'true' || v === true;

/**
 * Whatever came out of the form, as the shape the database takes.
 *
 * Never throws: a person who mistyped a time should be told which row, and
 * that is problemsWith()'s job. This only reads.
 */
export function readClubPage(form = {}) {
  const sessions = [];
  const removed = [];
  for (let i = 0; i < LIMITS.sessions; i++) {
    const label = text(form[`session_label_${i}`], LIMITS.label);
    const starts = String(form[`session_starts_${i}`] ?? '').trim();
    const ends = String(form[`session_ends_${i}`] ?? '').trim();
    const day = form[`session_day_${i}`];
    const id = text(form[`session_id_${i}`], 40);
    // A row nobody touched is not an error, it is an empty row. One that was
    // there and has been emptied is a time the club has stopped running.
    if (!label && !starts && !ends) {
      if (id) removed.push(id);
      continue;
    }
    sessions.push({
      id, row: i + 1, label, starts, ends,
      weekday: day === '' || day == null ? null : Number(day),
      minAge: form[`session_min_${i}`] ? Number(form[`session_min_${i}`]) : null,
      maxAge: form[`session_max_${i}`] ? Number(form[`session_max_${i}`]) : null,
    });
  }

  return {
    profile: {
      venue_name: text(form.venue_name, 120),
      address_line: text(form.address_line, 160),
      suburb: text(form.suburb, 80),
      city: text(form.city, 80),
      postcode: text(form.postcode, 12),
      directions: text(form.directions, LIMITS.directions),
      phone: text(form.phone, 40),
      email: text(form.email, 160),
      blurb: text(form.blurb, LIMITS.blurb),
      who_trains: text(form.who_trains, LIMITS.whoTrains),
      first_class_free: flag(form.first_class_free),
      accepts_beginners: flag(form.accepts_beginners),
      hero_asset_id: text(form.hero_asset_id, 40),
    },
    sessions,
    removed,
  };
}

/** What is wrong with what was typed, as sentences naming the row. */
export function problemsWithClubPage({ profile, sessions }) {
  const out = [];
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))
    out.push('That email address does not look right.');
  if (profile.hero_asset_id
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(profile.hero_asset_id))
    out.push('Choose a picture from the list, or leave it blank.');

  for (const s of sessions) {
    const at = `Training time ${s.row}`;
    if (!s.label) out.push(`${at} needs a name, like "Juniors" or "Adults".`);
    if (s.weekday == null || !Number.isInteger(s.weekday)
        || s.weekday < 0 || s.weekday > 6)
      out.push(`${at} needs a day.`);
    if (!TIME.test(s.starts) || !TIME.test(s.ends))
      out.push(`${at} needs a start and an end time, like 18:30.`);
    else if (s.ends <= s.starts)
      out.push(`${at} ends before it starts.`);
    if (s.minAge != null && s.maxAge != null && s.maxAge < s.minAge)
      out.push(`${at} has a top age lower than its bottom age.`);
  }
  return out;
}

/**
 * What is still missing before this page could go on a public website.
 *
 * The schema has said "never publish a half-filled page" since the first
 * migration. This is the half-filled test: enough for a stranger to find the
 * place and turn up, and nothing that reads like an instruction to the person
 * who is meant to replace it.
 */
export function readinessGaps(profile = {}, sessions = []) {
  const out = [];
  if (!profile.venue_name)
    out.push({ short: 'a venue', say: 'Where do you train? Add the name of the venue.' });
  if (!profile.city)
    out.push({ short: 'a town', say: 'Add the town or city.' });
  if (!profile.phone && !profile.email)
    out.push({ short: 'a contact',
      say: 'Add a phone number or an email address so people can ask a question.' });
  if (!sessions.length)
    out.push({ short: 'a training time', say: 'Add at least one training time.' });
  if (['blurb', 'who_trains'].some((f) => /^\s*\[/.test(profile[f] ?? '')))
    out.push({ short: 'its placeholder text replaced',
      say: 'Your description still has the placeholder text in it — '
        + 'replace it with a sentence or two in your own words.' });
  return out;
}

/** The same gaps as sentences, for the club's own screen. */
export const readinessProblems = (profile, sessions) =>
  readinessGaps(profile, sessions).map((g) => g.say);

export class ClubPageNotReady extends DomainError {
  constructor(problems) {
    super(problems.join(' '));
    this.problems = problems;
  }
}
