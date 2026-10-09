/**
 * DOMAIN — when somebody is next due to grade
 *
 * A guide, not a gate: the usual gap between gradings, which each federation sets per grade on its own ladder
 * (grade.usual_months_to_next, grade.next_by_invitation). Whether somebody actually grades is their instructor's call.
 * Pure: dates in, words out.
 */
import { addMonths } from './membership.mjs';

/** "twice a year", "about every 3 years", … in words, from a number of months. */
export function rhythmWords(months, byInvitation = false) {
  if (months == null) return 'no set timetable';
  const base = months === 6 ? 'about twice a year'
    : months === 12 ? 'about once a year'
    : months % 12 === 0 ? `about every ${months / 12} years`
    : `about every ${months} months`;
  return byInvitation ? `${base}, by invitation` : base;
}

/**
 * @param held  { awardedOn, usualMonths, byInvitation }  the current grade, with the federation's own gap for it
 * @param next  { label } | null                           the grade above it on the ladder
 * @returns null when there is nothing useful to say, else { nextLabel, dueFrom, due, byInvitation, rhythm }
 */
export function nextGrading({ held, next, today }) {
  if (!held) return null;
  const nextLabel = next?.label ?? null;
  const months = held.usualMonths ?? null;
  const byInvitation = !!held.byInvitation;
  if (months == null) return { nextLabel, dueFrom: null, due: false, byInvitation, rhythm: rhythmWords(null) };
  if (!nextLabel) return null;
  const dueFrom = held.awardedOn ? addMonths(String(held.awardedOn).slice(0, 10), months) : null;
  return { nextLabel, dueFrom, due: !!dueFrom && dueFrom <= today, byInvitation, rhythm: rhythmWords(months, byInvitation) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

/** One sentence for the page. */
export function nextGradingWords(n) {
  if (!n) return '';
  if (!n.dueFrom) return n.nextLabel ? `Next: ${n.nextLabel}, ${n.rhythm}.` : `Grading from here: ${n.rhythm}.`;
  const when = n.due ? 'due now' : `due from ${niceDay(n.dueFrom)}`;
  return `Next: ${n.nextLabel} — ${when} (${n.rhythm}).`;
}

/** The timetable form: one row per grade, `months_<id>` (blank = no set timetable) and `invite_<id>`. */
export function readTimetable(form = {}, ladder = []) {
  const rows = [], problems = [];
  for (const g of ladder) {
    const raw = String(form[`months_${g.id}`] ?? '').trim();
    const months = raw === '' ? null : Number.parseInt(raw, 10);
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > 240))
      problems.push(`${g.label}: months should be a whole number from 1 to 240, or blank for no set timetable.`);
    rows.push({ gradeId: g.id, months, byInvitation: months !== null && form[`invite_${g.id}`] === 'on' });
  }
  return { rows, problems };
}
