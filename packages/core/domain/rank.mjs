/**
 * DOMAIN — entities
 *
 * Imports only ./values.mjs. Nothing here knows how it is stored or displayed.
 *
 * These carry the rules that make this a martial arts system rather than a
 * membership database: what a grade requires, who may award it, and what a
 * grading history means.
 */

import { RankOrder, GradingDate, Age, DomainError, OrgType } from './values.mjs';

// ---------------------------------------------------------------------------

/** One rung of a federation's ladder. */
export class Grade {
  constructor({ id, label, rankOrder, isDan = false, beltColour = null,
                minMonthsAtPrevious = null, minAge = null, minSessions = null }) {
    if (!label) throw new DomainError('A grade needs a label');
    this.id = id;
    this.label = label;
    this.rankOrder = RankOrder.of(rankOrder);
    this.isDan = !!isDan;
    this.beltColour = beltColour;
    this.minMonthsAtPrevious = minMonthsAtPrevious;
    this.minAge = minAge;
    this.minSessions = minSessions;
  }

  /**
   * Every requirement this grade places on a candidate, each answered
   * independently — a dojo operator has to tell a student what is missing, not
   * just that something is.
   */
  requirementsFor({ heldSince, sessionsSince, dateOfBirth, on }) {
    const checks = [];
    const when = GradingDate.of(on);

    if (this.minMonthsAtPrevious != null) {
      const months = heldSince ? GradingDate.of(heldSince).monthsUntil(when) : 0;
      checks.push({
        name: 'time at grade', has: months, needs: this.minMonthsAtPrevious,
        met: months >= this.minMonthsAtPrevious,
        shortfall: Math.max(0, this.minMonthsAtPrevious - months),
        unit: 'months',
      });
    }

    if (this.minSessions != null) {
      const n = Number(sessionsSince ?? 0);
      checks.push({
        name: 'training sessions', has: n, needs: this.minSessions,
        met: n >= this.minSessions,
        shortfall: Math.max(0, this.minSessions - n),
        unit: 'sessions',
      });
    }

    if (this.minAge != null) {
      const age = dateOfBirth ? Age.onDate(dateOfBirth, when) : null;
      checks.push({
        name: 'age', has: age, needs: this.minAge,
        met: age != null && age >= this.minAge,
        shortfall: age == null ? null : Math.max(0, this.minAge - age),
        unit: 'years',
      });
    }

    return checks;
  }
}

// ---------------------------------------------------------------------------

/**
 * Who may award which grades, with what panel, ratified by whom.
 *
 * This is the rule every federation has, every federation's differs, and every
 * federation currently enforces by someone remembering.
 */
export class GradingAuthority {
  constructor({ fromRankOrder, toRankOrder, awardedByType, ratifiedByType = null,
                minPanelSize = 1, minPanelRank = null }) {
    this.from = RankOrder.of(fromRankOrder);
    this.to = RankOrder.of(toRankOrder);
    if (this.from.isAbove(this.to))
      throw new DomainError('Authority range runs backwards');
    if (!OrgType.isValid(awardedByType))
      throw new DomainError(`Unknown organisation type "${awardedByType}"`);
    this.awardedByType = awardedByType;
    this.ratifiedByType = ratifiedByType;
    this.minPanelSize = minPanelSize;
    this.minPanelRank = minPanelRank == null ? null : RankOrder.of(minPanelRank);
  }

  covers(rankOrder) {
    const r = RankOrder.of(rankOrder);
    return r.isAtLeast(this.from) && this.to.isAtLeast(r);
  }

  /**
   * Returns every reason this grading may not proceed. A list, not a boolean —
   * a registrar needs to know all of it, not the first thing that failed.
   *
   * `panel` is an array of { personId, rankOrder }.
   */
  objectionsTo({ grade, awardingOrgType, panel = [] }) {
    const out = [];

    if (awardingOrgType !== this.awardedByType) {
      out.push(`${grade.label} must be awarded by a ${this.awardedByType}, ` +
        `not a ${awardingOrgType}`);
    }

    if (panel.length < this.minPanelSize) {
      out.push(`${grade.label} requires a panel of ${this.minPanelSize}, ` +
        `got ${panel.length}`);
    }

    if (this.minPanelRank) {
      const unknown = panel.filter((p) => p.rankOrder == null);
      if (unknown.length)
        out.push(`${unknown.length} examiner(s) have no grade on record`);

      const tooJunior = panel.filter((p) => p.rankOrder != null
        && !RankOrder.of(p.rankOrder).isAtLeast(this.minPanelRank));
      if (tooJunior.length)
        out.push(`${tooJunior.length} examiner(s) are below the minimum rank ` +
          `for ${grade.label}`);
    }

    return out;
  }

  get needsRatification() { return this.ratifiedByType != null; }
}

// ---------------------------------------------------------------------------

/** One grading that happened. Permanent, dated, belongs to the person. */
export class GradingRecord {
  constructor({ id = null, personId, gradeId, awardedOn, awardedByOrgId,
                result = 'pass', panel = [], ratifiedOn = null,
                certificateNo = null }) {
    if (!personId) throw new DomainError('A grading needs a person');
    if (!gradeId) throw new DomainError('A grading needs a grade');
    if (!['pass', 'provisional', 'fail', 'withdrawn'].includes(result))
      throw new DomainError(`Unknown grading result "${result}"`);
    this.id = id;
    this.personId = personId;
    this.gradeId = gradeId;
    this.awardedOn = GradingDate.of(awardedOn);
    this.awardedByOrgId = awardedByOrgId;
    this.result = result;
    this.panel = panel;
    this.ratifiedOn = GradingDate.from(ratifiedOn);
    this.certificateNo = certificateNo;
  }

  get counts() { return this.result === 'pass' || this.result === 'provisional'; }
  get isRatified() { return this.ratifiedOn != null; }
}

// ---------------------------------------------------------------------------

/**
 * A person's rank, as read from their history.
 *
 * Current grade is DERIVED here, in the domain, from the records. It is never a
 * stored value, so it cannot drift from the register.
 */
export class RankHistory {
  #records;
  #gradesById;

  constructor(records, gradesById) {
    this.#records = records.filter((r) => r.counts);
    this.#gradesById = gradesById;
  }

  get current() {
    let best = null;
    for (const r of this.#records) {
      const g = this.#gradesById.get(r.gradeId);
      if (!g) continue;
      if (!best || g.rankOrder.isAbove(best.grade.rankOrder)
          || (g.rankOrder.equals(best.grade.rankOrder)
              && r.awardedOn.isAfter(best.record.awardedOn))) {
        best = { grade: g, record: r };
      }
    }
    return best;
  }

  get heldSince() { return this.current?.record.awardedOn ?? null; }
  get rankOrder() { return this.current?.grade.rankOrder ?? null; }
  get isEmpty() { return this.current == null; }

  /** In order, oldest first — what goes on the back of a certificate. */
  timeline() {
    return this.#records
      .map((r) => ({ record: r, grade: this.#gradesById.get(r.gradeId) }))
      .filter((x) => x.grade)
      .sort((a, b) => a.grade.rankOrder.value - b.grade.rankOrder.value);
  }
}
