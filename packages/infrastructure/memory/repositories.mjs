/**
 * INFRASTRUCTURE — in-memory adapters
 *
 * These exist to prove the inversion is real. The same use cases run against
 * these and against Postgres with no change, which is the only way to know the
 * core is genuinely independent rather than merely arranged to look that way.
 *
 * They also make the domain testable in microseconds with no database at all.
 */

import { Grade, GradingAuthority, GradingRecord }
  from '../../core/domain/rank.mjs';

export class InMemoryLadder {
  constructor({ grades = [], authorities = [] } = {}) {
    this.grades = grades.map((g) => (g instanceof Grade ? g : new Grade(g)));
    this.authorities = authorities.map((a) =>
      a instanceof GradingAuthority ? a : new GradingAuthority(a));
  }

  async gradesFor() {
    return [...this.grades].sort((a, b) => a.rankOrder.value - b.rankOrder.value);
  }

  async authorityFor(_federationId, rankOrder) {
    return this.authorities.find((a) => a.covers(rankOrder)) ?? null;
  }
}

export class InMemoryRanks {
  constructor(records = [], gradeOrders = new Map()) {
    this.records = records.map((r) =>
      r instanceof GradingRecord ? r : new GradingRecord(r));
    this.gradeOrders = gradeOrders;
    this.nextId = 1;
  }

  async recordsFor(personId) {
    return this.records.filter((r) => r.personId === personId);
  }

  async save(record) {
    const saved = new GradingRecord({
      id: `mem-${this.nextId++}`,
      personId: record.personId, gradeId: record.gradeId,
      awardedOn: record.awardedOn.value, awardedByOrgId: record.awardedByOrgId,
      result: record.result, panel: record.panel,
    });
    this.records.push(saved);
    return saved;
  }

  async rankOrdersFor(personIds) {
    const out = new Map();
    for (const id of personIds) {
      let best = null;
      for (const r of this.records) {
        if (r.personId !== id || !r.counts) continue;
        const order = this.gradeOrders.get(r.gradeId) ?? null;
        if (order != null && (best == null || order > best)) best = order;
      }
      out.set(id, best);
    }
    return out;
  }
}

export class InMemoryMembers {
  constructor(people = [], sessions = {}) {
    this.people = new Map(people.map((p) => [p.id, p]));
    this.sessions = sessions;
  }
  async byId(id) { return this.people.get(id) ?? null; }
  async sessionsSince(id) { return this.sessions[id] ?? 0; }
}

export class InMemoryOrganisations {
  constructor(orgs = []) { this.orgs = new Map(orgs.map((o) => [o.id, o])); }
  async byId(id) { return this.orgs.get(id) ?? null; }
}

export class AllowAll { async hasRoleAt() { return true; } }
export class DenyAll { async hasRoleAt() { return false; } }
export class FixedClock {
  constructor(date) { this.date = date; }
  today() { return this.date; }
}
