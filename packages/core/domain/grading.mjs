/**
 * DOMAIN — grading events
 *
 * A grading night has three moments. Clubs ENTER the members they think are
 * ready (the system refuses anyone who has not met the syllabus). The panel
 * sits and the organiser RECORDS what each person earned. FINALISING then
 * writes the results into the register and issues certificate numbers — once,
 * for everybody, or for nobody.
 */
import { isDate } from './attendance.mjs';

export const OUTCOMES = Object.freeze({
  pass: 'Passed', provisional: 'Provisional pass', fail: 'Did not pass', absent: 'Did not attend',
});
/** Outcomes that put a grade in the register. */
export const AWARDS = new Set(['pass', 'provisional']);

export const readPanel = (text) => [...new Set(String(text ?? '').split(/[\s,;]+/)
  .map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 12);

/** Per-row form fields `result_<entryId>` / `note_<entryId>` — see the no-JS admin note. */
export function readResults(form, entryIds) {
  const out = {};
  for (const id of entryIds) {
    const outcome = String(form[`result_${id}`] ?? '');
    if (outcome) out[id] = { outcome, notes: String(form[`note_${id}`] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) };
  }
  return out;
}

export function problemsWithResults({ entries, results, panel, date }, today) {
  const out = [];
  if (!isDate(date)) out.push('The date of the grading should look like 2026-10-02.');
  else if (date > today) out.push('A grading cannot be recorded before it has happened.');
  const live = entries.filter((e) => e.status !== 'withdrawn');
  if (!live.length) out.push('Nobody is entered.');
  const missing = live.filter((e) => !OUTCOMES[results[e.entry_id]?.outcome]);
  if (missing.length) out.push(`Say what happened to ${missing.map((m) => m.name).join(', ')}.`);
  if (live.some((e) => AWARDS.has(results[e.entry_id]?.outcome)) && !panel.length)
    out.push('Name the examining panel (member numbers) — a pass needs one.');
  return out;
}

export const certificateNumber = (prefix, year, n) =>
  `${String(prefix).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'G'}-G-${year}-${String(n).padStart(4, '0')}`;

/** Can entries still be made? Open window, published, not finished. */
export function entriesOpen(ev, nowIso) {
  if (ev.status !== 'published') return { open: false, why: 'This grading is not open for entries.' };
  if (ev.finalised_on) return { open: false, why: 'This grading is finished.' };
  if (ev.entries_open && ev.entries_open > nowIso) return { open: false, why: 'Entries have not opened yet.' };
  if (ev.entries_close && ev.entries_close < nowIso) return { open: false, why: 'Entries have closed.' };
  return { open: true };
}
