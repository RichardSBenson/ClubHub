/**
 * DOMAIN — value objects
 *
 * This file imports nothing. Not Postgres, not HTTP, not Node. If that ever
 * changes, tools/check-dependencies.mjs fails the build.
 *
 * The point of these is that a rule gets enforced once, here, instead of being
 * re-checked in every controller that touches the value.
 */

export class DomainError extends Error {
  constructor(message) { super(message); this.name = 'DomainError'; }
}

/**
 * Where a grade sits on a federation's ladder. Kyu count down and dan count up
 * in the labels people use, but underneath there is one ascending scale — which
 * is the only way "is this person senior enough to sit on that panel" stays a
 * comparison rather than a special case.
 */
export class RankOrder {
  #value;

  constructor(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1)
      throw new DomainError(`Rank order must be a positive whole number, got ${value}`);
    this.#value = n;
  }

  static of(value) { return new RankOrder(value); }
  get value() { return this.#value; }

  isAtLeast(other) { return this.#value >= RankOrder.of(other).value; }
  isAbove(other) { return this.#value > RankOrder.of(other).value; }
  next() { return new RankOrder(this.#value + 1); }
  equals(other) { return other instanceof RankOrder && other.value === this.#value; }
  toString() { return String(this.#value); }
  toJSON() { return this.#value; }
}

/**
 * A member number is permanent and never reissued. It carries a country prefix
 * so numbers stay distinct once a second country affiliates.
 */
export class MemberNumber {
  #value;

  constructor(value) {
    const v = String(value ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}-\d{4,6}$/.test(v))
      throw new DomainError(
        `Member number must look like NZ-0417, got "${value}"`);
    this.#value = v;
  }

  static of(value) { return new MemberNumber(value); }
  get value() { return this.#value; }
  get countryCode() { return this.#value.slice(0, 2); }
  equals(other) { return other instanceof MemberNumber && other.value === this.#value; }
  toString() { return this.#value; }
  toJSON() { return this.#value; }
}

/**
 * A date with no time and no zone. A grading happened on a day; the hour it was
 * written down is not part of the fact, and carrying a timestamp across time
 * zones is how a grading slides to the previous evening.
 */
export class GradingDate {
  #iso;

  constructor(value) {
    const iso = value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
      throw new DomainError(`Not a date: "${value}"`);
    if (Number.isNaN(Date.parse(iso)))
      throw new DomainError(`Not a real date: "${iso}"`);
    this.#iso = iso;
  }

  static of(value) { return new GradingDate(value); }
  static from(value) { return value == null ? null : new GradingDate(value); }

  get value() { return this.#iso; }
  isAfter(other) { return this.#iso > GradingDate.of(other).value; }
  isBefore(other) { return this.#iso < GradingDate.of(other).value; }

  monthsUntil(other) {
    const a = new Date(this.#iso), b = new Date(GradingDate.of(other).value);
    let months = (b.getFullYear() - a.getFullYear()) * 12
      + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) months -= 1;
    return months;
  }

  toString() { return this.#iso; }
  toJSON() { return this.#iso; }
}

/** Whole years on a given day. Never stored — always derived. */
export class Age {
  static onDate(dateOfBirth, on) {
    const dob = GradingDate.of(dateOfBirth);
    const d = GradingDate.of(on);
    let years = Math.floor(dob.monthsUntil(d) / 12);
    return Math.max(0, years);
  }
}

/** The organisation types a federation tree can contain, most senior first. */
export const OrgType = Object.freeze({
  INTERNATIONAL: 'international',
  COUNTRY: 'country',
  REGION: 'region',
  DOJO: 'dojo',
  all: ['international', 'country', 'region', 'dojo'],
  isValid(t) { return OrgType.all.includes(t); },
});
