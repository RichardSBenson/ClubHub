/**
 * HONBU — DOMAIN
 *
 * The innermost circle. This file imports nothing. Not Postgres, not HTTP, not
 * Node's standard library. It does not know it is running in Node.
 *
 * Everything here is a rule a federation would recognise if you read it aloud
 * to them, expressed without reference to how anything is stored or displayed.
 */

// ===========================================================================
//  Value objects
// ===========================================================================

export class DomainError extends Error {
  constructor(message) { super(message); this.name = 'DomainError'; }
}

/** A URL-safe name. Invalid values cannot exist — the constructor refuses. */
export class Slug {
  #value;
  constructor(value) {
    const v = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(v))
      throw new DomainError(
        `"${value}" is not a valid slug — lowercase letters, numbers and hyphens`);
    this.#value = v;
  }
  toString() { return this.#value; }
  get value() { return this.#value; }
  equals(other) { return other instanceof Slug && other.value === this.#value; }

  /** Best effort from free text. Throws if nothing usable remains. */
  static from(text) {
    return new Slug(String(text ?? '').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
  }
}

/** Permanent, never reissued. 'NZ-0417'. */
export class MemberNumber {
  #value;
  constructor(value) {
    const v = String(value ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}-\d{3,6}$/.test(v))
      throw new DomainError(`"${value}" is not a valid member number`);
    this.#value = v;
  }
  toString() { return this.#value; }
  get value() { return this.#value; }
  get countryCode() { return this.#value.slice(0, 2); }
}

/**
 * A point on a federation's ladder. `order` is the only thing compared —
 * labels differ between arts and mean nothing to the rules.
 */
export class Grade {
  constructor({ id, label, order, isDan = false,
                minMonthsAtPrevious = null, minAge = null, minSessions = null }) {
    if (!Number.isInteger(order) || order < 1)
      throw new DomainError('A grade needs a positive order');
    Object.assign(this, { id, label, order, isDan,
      minMonthsAtPrevious, minAge, minSessions });
    Object.freeze(this);
  }
  isAbove(other) { return this.order > other.order; }
  isBelow(other) { return this.order < other.order; }
}

/**
 * A teaching title. Deliberately a separate scale from Grade: Renshi, Kyoshi,
 * Hanshi in Japanese arts. Holding 7th dan does not make you Kyoshi.
 */
export class Title {
  constructor({ id, label, order, minGradeOrder = null }) {
    if (!Number.isInteger(order) || order < 1)
      throw new DomainError('A title needs a positive order');
    Object.assign(this, { id, label, order, minGradeOrder });
    Object.freeze(this);
  }
}

/**
 * Ordered ranks for one federation. Karate types kyu and dan, taekwondo types
 * geup and dan, Brazilian jiu-jitsu types belts and stripes. The ladder does
 * not care.
 */
export class Ladder {
  #byOrder;
  constructor(grades) {
    if (!grades?.length) throw new DomainError('A ladder needs at least one grade');
    this.grades = [...grades].sort((a, b) => a.order - b.order);
    this.#byOrder = new Map(this.grades.map((g) => [g.order, g]));
  }
  lowest() { return this.grades[0]; }
  highest() { return this.grades[this.grades.length - 1]; }
  at(order) { return this.#byOrder.get(order) ?? null; }
  /** Null at the top of the ladder — a real state, not an error. */
  after(grade) { return grade ? this.at(grade.order + 1) : this.lowest(); }
}

// ===========================================================================
//  Entities
// ===========================================================================

/**
 * A node in the federation tree. Ancestry is expressed as an ordered list of
 * ids, so the rule "you can see down your own branch, never sideways" is
 * decidable here rather than in a query.
 */
export class Organisation {
  constructor({ id, name, slug, type, ancestry = [], countryCode = null }) {
    if (!['international', 'country', 'region', 'dojo'].includes(type))
      throw new DomainError(`"${type}" is not an organisation type`);
    Object.assign(this, {
      id, name, type, countryCode,
      slug: slug instanceof Slug ? slug : new Slug(slug),
      ancestry: [...ancestry],
    });
    Object.freeze(this);
  }
  /** Is `other` this organisation, or beneath it? */
  contains(other) {
    return other.id === this.id || other.ancestry.includes(this.id);
  }
  isDescendantOf(other) { return this.ancestry.includes(other.id); }
  get depth() { return this.ancestry.length; }
}

/** A dated grading. Immutable once recorded — a register is a record, not state. */
export class GradingRecord {
  constructor({ id, personId, grade, awardedOn, awardedByOrgId,
                result = 'pass', panel = [], ratifiedOn = null }) {
    if (!(grade instanceof Grade)) throw new DomainError('A grading needs a Grade');
    if (!awardedOn) throw new DomainError('A grading needs a date');
    Object.assign(this, { id, personId, grade, awardedOn: new Date(awardedOn),
      awardedByOrgId, result, panel: [...panel], ratifiedOn });
    Object.freeze(this);
  }
  get counts() { return this.result === 'pass' || this.result === 'provisional'; }
}

/**
 * A person with their history. Current grade is DERIVED here, the same way it
 * is derived in the database — one rule, stated once.
 */
export class Member {
  constructor({ id, firstName, lastName, dateOfBirth = null,
                memberNumber = null, gradings = [], titles = [] }) {
    Object.assign(this, { id, firstName, lastName,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      memberNumber: memberNumber
        ? (memberNumber instanceof MemberNumber ? memberNumber : new MemberNumber(memberNumber))
        : null,
      gradings: [...gradings], titles: [...titles] });
  }

  get name() { return `${this.firstName} ${this.lastName}`; }

  currentGrade() {
    return this.gradings.filter((g) => g.counts)
      .reduce((best, g) => (!best || g.grade.isAbove(best.grade) ? g : best), null)
      ?.grade ?? null;
  }

  currentTitle() {
    return this.titles.reduce((best, t) => (!best || t.order > best.order ? t : best), null);
  }

  lastGradedOn() {
    const g = this.gradings.filter((x) => x.counts)
      .reduce((latest, x) => (!latest || x.awardedOn > latest.awardedOn ? x : latest), null);
    return g?.awardedOn ?? null;
  }

  /** Age on a given date. Never stored — it is wrong the day after you store it. */
  ageOn(date = new Date()) {
    if (!this.dateOfBirth) return null;
    const d = new Date(date);
    let age = d.getFullYear() - this.dateOfBirth.getFullYear();
    const m = d.getMonth() - this.dateOfBirth.getMonth();
    if (m < 0 || (m === 0 && d.getDate() < this.dateOfBirth.getDate())) age--;
    return age;
  }
}

// ===========================================================================
//  Policies — the rules a federation would recognise
// ===========================================================================

/**
 * Who may award which grades, with what panel, ratified by whom.
 *
 * Every style organisation has rules of this shape and every one differs.
 * Until this existed they were enforced by someone remembering.
 */
export class GradingAuthority {
  constructor(rules = []) { this.rules = [...rules]; }

  ruleFor(grade) {
    return this.rules.find((r) =>
      grade.order >= r.fromOrder && grade.order <= r.toOrder) ?? null;
  }

  /**
   * Returns every reason the grading may not proceed. A list, not a boolean —
   * whoever is running the grading has to be told what is wrong.
   */
  check({ grade, awardingOrg, panel = [] }) {
    const problems = [];
    const rule = this.ruleFor(grade);
    if (!rule) return [`No authority rule covers ${grade.label}`];

    if (rule.awardedByType !== awardingOrg.type)
      problems.push(
        `${grade.label} must be awarded by a ${rule.awardedByType}, not a ${awardingOrg.type}`);

    if (panel.length < rule.minPanelSize)
      problems.push(
        `${grade.label} requires a panel of ${rule.minPanelSize}, got ${panel.length}`);

    if (rule.minPanelOrder != null) {
      const tooJunior = panel.filter((m) => {
        const g = m.currentGrade();
        return !g || g.order < rule.minPanelOrder;
      });
      if (tooJunior.length)
        problems.push(
          `Every examiner must hold order ${rule.minPanelOrder} or above` +
          (tooJunior.length ? ` — ${tooJunior.map((m) => m.name).join(', ')} does not` : ''));
    }
    return problems;
  }
}

/**
 * Time at grade, attendance and age. Reports what is missing, not merely that
 * something is — a dojo operator has to tell the student.
 */
export class EligibilityPolicy {
  constructor({ ladder }) { this.ladder = ladder; }

  assess({ member, sessionsSinceLastGrading = 0, on = new Date() }) {
    const holds = member.currentGrade();
    const next = this.ladder.after(holds);
    if (!next) {
      return { holds, next: null, eligible: false, unmet: [],
        reason: 'Top of the ladder' };
    }

    const since = member.lastGradedOn();
    const months = since ? monthsBetween(since, on) : Infinity;
    const age = member.ageOn(on);
    const unmet = [];

    if (next.minMonthsAtPrevious != null && months < next.minMonthsAtPrevious)
      unmet.push(`${next.minMonthsAtPrevious - months} more months at grade`);

    if (next.minSessions != null && sessionsSinceLastGrading < next.minSessions)
      unmet.push(`${next.minSessions - sessionsSinceLastGrading} more training sessions`);

    if (next.minAge != null && age != null && age < next.minAge)
      unmet.push(`minimum age ${next.minAge}`);

    return {
      holds, next, unmet, eligible: unmet.length === 0,
      months: { has: months === Infinity ? null : months, needs: next.minMonthsAtPrevious },
      sessions: { has: sessionsSinceLastGrading, needs: next.minSessions },
      age: { has: age, needs: next.minAge },
    };
  }
}

/**
 * Who may see an event, and who may enter it.
 *
 * Deliberately separate questions. A parent may see that a black belt seminar
 * exists without their child being able to enter it.
 */
export class EventVisibilityPolicy {
  /** `viewer` may be null — that is the public. */
  canSee({ event, viewingOrg, viewer = null }) {
    const ownedByAncestorOrSelf =
      event.organisationId === viewingOrg.id || event.publishDown;
    if (!ownedByAncestorOrSelf) return false;

    switch (event.visibility) {
      case 'public': return true;
      case 'members': return !!viewer?.isMember;
      case 'own_org': return !!viewer?.isMember
        && event.organisationId === viewingOrg.id;
      case 'by_grade': {
        const g = viewer?.member?.currentGrade();
        return !!g && g.order >= (event.minGradeOrder ?? 0);
      }
      case 'invite': return !!viewer?.invited;
      default: return false;
    }
  }

  /** Every reason someone may not enter. Empty means they may. */
  blockedFrom({ event, member, isMember, on = new Date() }) {
    const blocked = [];
    if (event.entriesClose && new Date(event.entriesClose) < on)
      blocked.push('Entries have closed');
    if (event.visibility !== 'public' && !isMember)
      blocked.push('Members only');

    const grade = member?.currentGrade();
    if (event.minGradeOrder != null && (grade?.order ?? 0) < event.minGradeOrder)
      blocked.push(`Requires a higher grade — holds ${grade?.label ?? 'none'}`);
    if (event.maxGradeOrder != null && (grade?.order ?? 0) > event.maxGradeOrder)
      blocked.push('Above the grade limit for this event');

    const age = member?.ageOn(on);
    if (event.minAge != null && age != null && age < event.minAge)
      blocked.push(`Minimum age ${event.minAge}`);
    if (event.maxAge != null && age != null && age > event.maxAge)
      blocked.push(`Maximum age ${event.maxAge}`);

    return blocked;
  }
}

/**
 * Down your own branch, never sideways. The single rule the whole permission
 * model rests on, stated once, in the domain.
 */
export class AccessPolicy {
  constructor(grants = []) { this.grants = [...grants]; }

  /** grants: [{ role, organisation }] */
  holds(roles, targetOrg) {
    const wanted = Array.isArray(roles) ? roles : [roles];
    return this.grants.some((g) =>
      wanted.includes(g.role) && g.organisation.contains(targetOrg));
  }

  canManage(org) { return this.holds(['owner', 'administrator'], org); }
  canRegister(org) { return this.holds(['owner', 'administrator', 'registrar'], org); }
  canTeach(org) {
    return this.holds(['owner', 'administrator', 'registrar', 'instructor'], org);
  }
}

/**
 * A qualification that lapses. Rank never does; a referee licence, a first aid
 * certificate and a police vet all do, and the federation's real question is
 * whose has.
 */
export class Qualification {
  constructor({ id, code, label, category = 'other',
                validMonths = null, requiredFor = [] }) {
    Object.assign(this, { id, code, label, category, validMonths,
      requiredFor: [...requiredFor] });
    Object.freeze(this);
  }
  expiryFor(awardedOn) {
    if (this.validMonths == null) return null;
    const d = new Date(awardedOn);
    d.setMonth(d.getMonth() + this.validMonths);
    return d;
  }
  statusOn(awardedOn, expiresOn, on = new Date(), warnDays = 60) {
    if (expiresOn == null) return 'permanent';
    const days = Math.floor((new Date(expiresOn) - on) / 86400000);
    if (days < 0) return 'expired';
    if (days <= warnDays) return 'expiring';
    return 'current';
  }
}

// ===========================================================================

function monthsBetween(from, to) {
  const a = new Date(from), b = new Date(to);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m--;
  return Math.max(0, m);
}

export { monthsBetween };
