/**
 * DOMAIN — when somebody is next due to grade
 *
 * A guide, not a gate: the usual gap between gradings in the federation. Whether somebody actually grades is
 * their instructor's call (and, from sandan, an invitation). Pure: dates in, words out.
 *
 *   10th–7th kyu   twice a year (about every 6 months, working up to 6th kyu)
 *   6th–1st kyu    once a year
 *   shodan         about 3 years to nidan
 *   nidan–yondan   about 4 years each, by invitation (depends on training and teaching)
 *   godan and up   no timetable: time and contribution
 */
import { addMonths } from './membership.mjs';

const DAN = { shodan: 1, nidan: 2, sandan: 3, yondan: 4, godan: 5 };
const ORDINAL = /(\d+)\s*(?:st|nd|rd|th)?\s*(kyu|dan)/i;

/** { kind: 'kyu'|'dan', n } from a grade label such as "6th kyu", "1st dan" or "Sandan"; null if unreadable. */
export function readGrade(label) {
  const s = String(label ?? '').trim().toLowerCase();
  if (DAN[s]) return { kind: 'dan', n: DAN[s] };
  const m = ORDINAL.exec(s);
  if (m) return { kind: m[2].toLowerCase(), n: Number(m[1]) };
  if (/^(shihan|renshi|kyoshi|hanshi)/.test(s)) return { kind: 'dan', n: 6 };
  return null;
}

/**
 * @param held  { label, awardedOn }  the current grade (null if none)
 * @param next  { label } | null      the grade above it on the ladder
 * @returns null when there is nothing useful to say, else
 *   { nextLabel, dueFrom, due, byInvitation, rhythm }
 */
export function nextGrading({ held, next, today }) {
  if (!held) return null;
  const g = readGrade(held.label);
  if (!g) return null;
  const nextLabel = next?.label ?? null;

  let months = null, rhythm, byInvitation = false;
  if (g.kind === 'kyu') {
    months = g.n >= 7 ? 6 : 12;
    rhythm = g.n >= 7 ? 'twice a year' : 'once a year';
  } else if (g.n === 1) {
    months = 36; rhythm = 'about every 3 years';
  } else if (g.n <= 4) {
    months = 48; byInvitation = true; rhythm = 'about every 4 years, by invitation';
  } else {
    return { nextLabel, dueFrom: null, due: false, byInvitation: true, rhythm: 'by time and contribution' };
  }
  if (!nextLabel) return null;
  const dueFrom = held.awardedOn ? addMonths(String(held.awardedOn).slice(0, 10), months) : null;
  return { nextLabel, dueFrom, due: !!dueFrom && dueFrom <= today, byInvitation, rhythm };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

/** One sentence for the page. */
export function nextGradingWords(n) {
  if (!n) return '';
  if (!n.dueFrom) return n.nextLabel ? `Next: ${n.nextLabel}, ${n.rhythm}.` : `Grading from here is ${n.rhythm}.`;
  const when = n.due ? 'due now' : `due from ${niceDay(n.dueFrom)}`;
  return `Next: ${n.nextLabel} — ${when} (${n.rhythm}).`;
}
