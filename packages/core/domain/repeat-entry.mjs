/**
 * DOMAIN — entering again, in one click
 *
 * A returning competitor should not retype their life. What is reused is what
 * they gave last time (weight, height, which disciplines). What is NEVER
 * reused is what can be worked out afresh: age on the day, current grade,
 * experience. They are calculated, so they cannot be stale.
 *
 * One click is offered only when nothing about the entry would be different
 * from last time. Anything that is different is shown to the person and asked
 * about, rather than quietly carried forward.
 */

/** How long a weight stays trustworthy for choosing a division. Organisations may change this. */
export const WEIGHT_VALID_DAYS = 60;

const norm = (s) => String(s ?? '').trim().toLowerCase();

const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
export const daysBetween = (fromIso, toIso) => dayNumber(toIso) - dayNumber(fromIso);

/**
 * What last time's entry says to do this time.
 *
 * `last`: { weightKg, heightCm, enteredOn: 'YYYY-MM-DD', picks: [{ discipline, division }] } or null
 * `disciplines`: this event's [{ id, name }]
 */
export function repeatFromLast(last, disciplines, today, { validDays = WEIGHT_VALID_DAYS } = {}) {
  // Nothing to choose: a grading, a seminar, a camp. Turning up is the entry.
  if (!disciplines.length)
    return { oneClick: true, chosen: [], weightKg: null, heightCm: null, reasons: [], ageDays: null };

  const reasons = [];
  if (!last) return { oneClick: false, chosen: [], weightKg: null, heightCm: null,
    reasons: ['first_time'], ageDays: null };

  const ageDays = last.enteredOn ? daysBetween(last.enteredOn, today) : null;
  if (last.weightKg == null) reasons.push('no_weight');
  else if (ageDays == null || ageDays > validDays) reasons.push('weight_old');

  const byName = new Map(disciplines.map((d) => [norm(d.name), d]));
  const chosen = [];
  let missing = false;
  for (const p of last.picks ?? []) {
    const d = byName.get(norm(p.discipline));
    if (d) { if (!chosen.includes(d.id)) chosen.push(d.id); } else missing = true;
  }
  if (!chosen.length) reasons.push('no_matching_discipline');
  else if (missing) reasons.push('discipline_missing');

  return { oneClick: reasons.length === 0, chosen, weightKg: last.weightKg ?? null,
    heightCm: last.heightCm ?? null, reasons, ageDays };
}

/**
 * Decide whether the whole entry can be made with one press.
 *
 * `placements`: what the engine worked out now, [{ discipline: {name}, division: {label}|null, outcome }]
 * `ready`: the engine says every wanted discipline was placed
 * `problems`: anything else that blocks (a guardian is needed, nothing chosen)
 */
export function decideQuick({ repeat, last, placements = [], ready = true, problems = [] }) {
  const reasons = [...repeat.reasons];
  if (!repeat.oneClick && repeat.reasons.length) return { ok: false, reasons, changed: [] };

  if (problems.length) reasons.push('problems');
  if (!ready) reasons.push('not_placed');

  // A division that is different from last time is a change the person should see.
  const changed = [];
  for (const p of placements) {
    const before = (last?.picks ?? []).find((x) => norm(x.discipline) === norm(p.discipline.name));
    const was = norm(before?.division), now = norm(p.division?.label);
    if (last && before && was !== now)
      changed.push({ discipline: p.discipline.name, was: before.division ?? null, now: p.division?.label ?? null });
  }
  if (changed.length) reasons.push('division_changed');

  return { ok: reasons.length === 0, reasons, changed };
}

/** Plain words for each reason, for the screen above a prefilled form. */
export const REASON_WORDS = Object.freeze({
  first_time: 'This is your first entry here, so we need a few details.',
  no_weight: 'We do not have a weight from last time.',
  weight_old: 'Your last weight is a while ago. Please check it is still right.',
  no_matching_discipline: 'This event offers different things to last time. Choose what you are entering.',
  discipline_missing: 'Something you entered last time is not offered here. Check what you want.',
  not_placed: 'We could not place you in a division with these details.',
  division_changed: 'Your division is different from last time.',
  grade_unknown: 'Please say what grade you are. It is not checked against a register, so it is marked as your own word.',
  problems: 'A few things need your attention.',
});
