/**
 * DOMAIN — attendance
 *
 * A class is a time the club trains (its timetable, kept on the club's page).
 * Attendance is who came to it on a given day. Nothing is marked as absent:
 * the record is the people who turned up, and everybody else is simply not in
 * it. That is also what grading eligibility counts — "sessions since the last
 * grade" — so a roll that is kept is what makes that rule work.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s) => {
  if (!DATE.test(s ?? '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  // Month 13 or day 40 is an Invalid Date, whose toISOString throws.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** 0 = Sunday … 6 = Saturday, the same numbering the timetable uses. */
export const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

export const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** How far back a roll may be filled in. A register made up months later is not a register. */
export const BACKFILL_DAYS = 60;

export function problemsWithSheet({ date, sessionWeekday }, today) {
  if (!isDate(date)) return ['The date should look like 2026-10-02.'];
  if (date > today) return ['A class that has not happened yet has no roll.'];
  if (date < addDays(today, -BACKFILL_DAYS)) return [`A roll can be filled in for up to ${BACKFILL_DAYS} days back.`];
  if (sessionWeekday != null && weekdayOf(date) !== sessionWeekday)
    return ['That class does not run on that day.'];
  return [];
}

/** Which of the club's classes run on this day. */
export const classesOn = (sessions, day) => sessions.filter((s) => s.weekday === weekdayOf(day));

/**
 * Who has not been seen lately. A member nobody has marked present in `days`
 * — and who has been a member long enough to have been expected — is worth a
 * kind word, not a penalty.
 */
export function notSeenSince(members, today, days = 30) {
  const cutoff = addDays(today, -days);
  return members.filter((m) => m.joined <= cutoff && (!m.last_seen || m.last_seen < cutoff));
}

/** Sessions a week, over a window, to one decimal. */
export const perWeek = (count, days) => Math.round((count / (days / 7)) * 10) / 10;

/** Member numbers typed for visitors: any separators, no duplicates, no blanks. */
export const readVisitors = (text) => [...new Set(String(text ?? '').split(/[\s,;]+/)
  .map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 30);
