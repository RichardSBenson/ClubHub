/**
 * DOMAIN — who goes in which division, and what it costs
 *
 * This file must never learn what a kata is.
 *
 * A tournament's shape is configuration: the organiser says a division admits
 * white belt to 7th kyu, or 70.01–85 kg, or women over 35, and this works out
 * who fits. It has no opinion about what any of those mean, which is the only
 * reason the same code can run a karate tournament, a BJJ open and a taekwondo
 * championship without being rewritten for each.
 *
 * Every bound is optional and an absent bound means no limit that way, so a
 * division with no bounds at all admits everybody — which is precisely what an
 * open or absolute division is. That falls out of the rule rather than being a
 * special case, which is how you can tell the rule is the right one.
 *
 * Three outcomes matter and all three are ordinary:
 *
 *   one division fits    the usual case
 *   several fit          the organiser's bands overlap; say so, place nobody
 *   none fits            "If no match available, your instructor will be
 *                        advised" — printed on the real form. A state to
 *                        report, not an error to throw.
 *
 * Imports nothing but the age calculation, which is shared with the register
 * so that a competitor's age means the same thing in both places.
 */

import { ageOn, isRealDate } from './people.mjs';

// ---------------------------------------------------------------------------
// the facts about a competitor, at a moment
// ---------------------------------------------------------------------------

/**
 * What a division may be judged on.
 *
 * Deliberately a flat set of plain facts rather than a person: the entry is
 * judged on what was true on the day, and weight and height are measured for
 * the event, not read from a profile. Correcting somebody's details a year
 * later must not silently rewrite the division last year's draw was made from.
 */
export class Competitor {
  constructor({
    personId = null, name = '', dateOfBirth = null, gender = null,
    rankOrder = null, weightKg = null, heightCm = null,
    yearsTraining = null, priorEvents = null, clubName = null,
    isMember = true,
  } = {}) {
    this.personId = personId;
    this.name = name;
    this.dateOfBirth = dateOfBirth && isRealDate(dateOfBirth) ? dateOfBirth : null;
    this.gender = gender ? String(gender).trim().toLowerCase() : null;
    this.rankOrder = num(rankOrder);
    this.weightKg = num(weightKg);
    this.heightCm = num(heightCm);
    this.yearsTraining = num(yearsTraining);
    this.priorEvents = num(priorEvents);
    this.clubName = clubName;
    this.isMember = !!isMember;
  }

  /**
   * Age ON THE DAY OF THE EVENT, not today.
   *
   * A child who is twelve when their club enters them in August and thirteen
   * by the November tournament competes as a thirteen-year-old. Using today's
   * age would put them in the wrong division, and it would do it differently
   * depending on which day somebody happened to open the entry list.
   */
  ageAt(eventDate) { return ageOn(this.dateOfBirth, eventDate); }
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// a division
// ---------------------------------------------------------------------------

/**
 * A set of bounds and a label somebody chose.
 *
 * `options` is carried and shown and never read as a rule — the permitted kata
 * for this division live there, and the moment this file looks inside them to
 * make a decision, it has started to know what a kata is.
 */
export class Division {
  constructor({
    id = null, disciplineId = null, label, summary = null,
    minRankOrder = null, maxRankOrder = null,
    minAge = null, maxAge = null,
    minWeightKg = null, maxWeightKg = null,
    gender = null,
    minYearsTraining = null, maxYearsTraining = null,
    minPriorEvents = null, maxPriorEvents = null,
    options = {}, sortOrder = 0, capacity = null,
  } = {}) {
    this.id = id;
    this.disciplineId = disciplineId;
    this.label = String(label ?? '').trim();
    this.summary = summary;
    this.minRankOrder = num(minRankOrder);
    this.maxRankOrder = num(maxRankOrder);
    this.minAge = num(minAge);
    this.maxAge = num(maxAge);
    this.minWeightKg = num(minWeightKg);
    this.maxWeightKg = num(maxWeightKg);
    this.gender = gender ? String(gender).trim().toLowerCase() : null;
    this.minYearsTraining = num(minYearsTraining);
    this.maxYearsTraining = num(maxYearsTraining);
    this.minPriorEvents = num(minPriorEvents);
    this.maxPriorEvents = num(maxPriorEvents);
    this.options = options ?? {};
    this.sortOrder = sortOrder;
    this.capacity = num(capacity);
  }

  /** Which facts this division actually judges on. */
  get judgesOn() {
    const on = [];
    if (this.minRankOrder != null || this.maxRankOrder != null) on.push('grade');
    if (this.minAge != null || this.maxAge != null) on.push('age');
    if (this.minWeightKg != null || this.maxWeightKg != null) on.push('weight');
    if (this.gender) on.push('gender');
    if (this.minYearsTraining != null || this.maxYearsTraining != null)
      on.push('years training');
    if (this.minPriorEvents != null || this.maxPriorEvents != null)
      on.push('previous events');
    return on;
  }

  /** A division with no bounds at all. An open, or an absolute. */
  get isOpen() { return this.judgesOn.length === 0; }

  /**
   * Whether this competitor belongs here, and if not, why not.
   *
   * Returns { admits, missing, failed }. `missing` is what the division needs
   * to know and was not told — a weight class cannot judge a competitor whose
   * weight nobody recorded, and pretending it can is how somebody ends up in
   * the wrong bracket. Missing is not the same as failing, and the two are
   * reported separately because the fix is different: one is a question to
   * ask the competitor, the other is an answer.
   */
  considers(competitor, eventDate) {
    const missing = [];
    const failed = [];

    const age = competitor.ageAt(eventDate);
    check('age', age, this.minAge, this.maxAge,
      this.minAge != null || this.maxAge != null);
    check('grade', competitor.rankOrder, this.minRankOrder, this.maxRankOrder,
      this.minRankOrder != null || this.maxRankOrder != null);
    check('weight', competitor.weightKg, this.minWeightKg, this.maxWeightKg,
      this.minWeightKg != null || this.maxWeightKg != null);
    check('years training', competitor.yearsTraining,
      this.minYearsTraining, this.maxYearsTraining,
      this.minYearsTraining != null || this.maxYearsTraining != null);
    check('previous events', competitor.priorEvents,
      this.minPriorEvents, this.maxPriorEvents,
      this.minPriorEvents != null || this.maxPriorEvents != null);

    if (this.gender) {
      if (!competitor.gender) missing.push('gender');
      else if (!sameGender(competitor.gender, this.gender))
        failed.push(`this division is ${this.gender}`);
    }

    function check(what, value, min, max, required) {
      if (!required) return;
      if (value == null) { missing.push(what); return; }
      // Lower bound exclusive is wrong here: "70.01–85 kg" on the real form
      // means a competitor at exactly 85.00 is in it and one at 85.01 is not.
      // Both ends inclusive, and the organiser writes 70.01 as the lower
      // bound of the next band up, exactly as the paper does.
      if (min != null && value < min)
        failed.push(`${what} ${value} is below ${min}`);
      if (max != null && value > max)
        failed.push(`${what} ${value} is above ${max}`);
    }

    return { admits: missing.length === 0 && failed.length === 0, missing, failed };
  }
}

/**
 * Gender matched loosely enough to be usable and strictly enough to be right.
 *
 * The register stores what somebody told it, in their words; a division says
 * what the organiser typed. 'M', 'male' and 'Male' are one thing. Anything
 * this does not recognise is compared as written rather than guessed at, so a
 * federation running divisions this does not anticipate still gets exact
 * matching rather than a wrong answer.
 */
function sameGender(a, b) {
  const norm = (g) => {
    const s = String(g).trim().toLowerCase();
    if (['m', 'male', 'man', 'men', 'boy', 'boys'].includes(s)) return 'male';
    if (['f', 'female', 'woman', 'women', 'girl', 'girls'].includes(s)) return 'female';
    return s;
  };
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------------------
// placing somebody
// ---------------------------------------------------------------------------

/**
 * Which division of ONE discipline this competitor falls in.
 *
 * Returns { outcome, division, candidates, missing, reasons }:
 *
 *   'placed'    exactly one fits — `division`
 *   'ambiguous' more than one fits — `candidates`, and nobody is placed. The
 *               organiser's bands overlap, which is their decision to make,
 *               not this code's to break arbitrarily.
 *   'unknown'   a division cannot judge without a fact nobody supplied —
 *               `missing` says which. Asking for a weight is a far better
 *               answer than quietly leaving somebody out of the draw.
 *   'none'      no division fits — `reasons` says why each was refused.
 */
export function placeIn(divisions, competitor, eventDate) {
  const considered = divisions.map((d) => ({ division: d,
    ...d.considers(competitor, eventDate) }));

  const fits = considered.filter((c) => c.admits);
  if (fits.length === 1)
    return { outcome: 'placed', division: fits[0].division, candidates: [],
             missing: [], reasons: [] };

  if (fits.length > 1) {
    return { outcome: 'ambiguous', division: null,
             candidates: fits.map((c) => c.division), missing: [],
             reasons: [`${fits.length} divisions admit this competitor: `
               + fits.map((c) => c.division.label).join(', ')] };
  }

  // Nothing fits. If the only thing standing in the way is a fact nobody
  // supplied, that is a question, not a refusal.
  const blocked = considered.filter((c) => c.missing.length && !c.failed.length);
  if (blocked.length) {
    const missing = [...new Set(blocked.flatMap((c) => c.missing))];
    return { outcome: 'unknown', division: null,
             candidates: blocked.map((c) => c.division), missing,
             reasons: [`needs ${missing.join(' and ')}`] };
  }

  return { outcome: 'none', division: null, candidates: [], missing: [],
           reasons: considered.map((c) =>
             `${c.division.label}: ${[...c.failed, ...c.missing.map((m) => `no ${m}`)]
               .join(', ')}`) };
}

/**
 * The whole entry: every discipline they are entering, placed.
 *
 * `wanted` is the discipline ids they ticked. Disciplines they did not tick
 * are not considered at all — entering somebody in something they did not ask
 * for is worse than leaving them out.
 */
export function placeEntry({ disciplines, divisionsByDiscipline }, competitor,
                           { eventDate, wanted = [] } = {}) {
  const asked = new Set(wanted.map(String));
  const placements = [];

  for (const discipline of disciplines) {
    if (!asked.has(String(discipline.id))) continue;
    const divisions = divisionsByDiscipline[discipline.id] ?? [];

    if (!divisions.length) {
      placements.push({ discipline, outcome: 'none', division: null,
        candidates: [], missing: [],
        reasons: [`${discipline.name} has no divisions set up yet`] });
      continue;
    }
    placements.push({ discipline, ...placeIn(divisions, competitor, eventDate) });
  }

  return {
    placements,
    // What to do next, in the order somebody would want to hear it.
    needs: [...new Set(placements.flatMap((p) => p.missing))],
    unplaced: placements.filter((p) => p.outcome !== 'placed'),
    ready: placements.length > 0
      && placements.every((p) => p.outcome === 'placed'),
  };
}

// ---------------------------------------------------------------------------
// what it costs
// ---------------------------------------------------------------------------

/**
 * The price of entering `count` disciplines.
 *
 * $60 for one, $70 for any two, $80 for all three — a price for a COUNT, not
 * a price each. Adding up per-discipline fees gives the wrong answer at every
 * count above one, and it is the answer a competitor would notice.
 *
 * `prices` is [{ forCount, amountCents, membersOnly }]. The best matching
 * price is the one for the highest count at or below what they entered, so an
 * organiser who sets 1, 2 and 3 does not also have to set 4, 5 and 6 for a
 * competitor who enters more than they expected — the top band simply holds.
 */
export function priceFor(count, prices = [], { isMember = true } = {}) {
  if (!count) return { amountCents: 0, matched: null, reason: 'nothing entered' };

  const usable = prices
    .filter((p) => !p.membersOnly || isMember)
    .filter((p) => p.forCount <= count)
    .sort((a, b) => b.forCount - a.forCount);

  if (!usable.length) {
    return { amountCents: null, matched: null,
      reason: prices.length
        ? `no price is set for entering ${count}`
        : 'no entry prices are set for this event' };
  }

  const best = usable[0];
  return {
    amountCents: best.amountCents,
    matched: best,
    // Said out loud, because a competitor charged the three-event price for
    // four entries should be able to see why rather than assume a bug.
    reason: best.forCount === count ? null
      : `${count} entered; the ${best.forCount}-event price is the highest set`,
  };
}

import { money } from './money.mjs';
export { money };

// ---------------------------------------------------------------------------
// consent
// ---------------------------------------------------------------------------

/**
 * Whether a guardian has to sign, and what is still missing.
 *
 * The Kokoro Cup wants a parent or guardian for anyone under SIXTEEN. Plenty
 * of events say eighteen. Nobody's threshold belongs in this code, so the
 * event carries it and this only applies it — and an event that has not set
 * one asks for nobody's guardian rather than guessing at a number.
 */
export function consentNeeded(competitor, { eventDate, guardianUnder = null,
                                            version = null } = {}) {
  const age = competitor.ageAt(eventDate);
  const guardian = guardianUnder != null && age != null && age < guardianUnder;

  return {
    version,
    guardian,
    // An event that requires a guardian for under-16s cannot tell whether
    // somebody is under 16 without a date of birth. Silence is not consent.
    unknown: guardianUnder != null && age == null,
    whose: guardian ? 'a parent or guardian' : 'the competitor',
  };
}

/**
 * What is wrong with a consent about to be recorded.
 *
 * A consent that does not say what was agreed to, by whom and when proves
 * nothing at the only moment it would ever be needed.
 */
export function problemsWithConsent(consent = {}, need = {}) {
  const out = [];
  if (!consent.accepted) out.push('the declaration has not been agreed to');
  if (!String(consent.acceptedName ?? '').trim())
    out.push('the name of whoever agreed to it is required');
  if (!String(consent.version ?? '').trim())
    out.push('there is no declaration version to record against');

  if (need.unknown)
    out.push('a date of birth is needed to know whether a guardian must sign');

  if (need.guardian) {
    if (!String(consent.guardianName ?? '').trim())
      out.push('a parent or guardian must be named');
    if (!String(consent.guardianContact ?? '').trim())
      out.push('a contact for the parent or guardian is required');
  }
  return out;
}
