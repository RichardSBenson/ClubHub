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

// ---------------------------------------------------------------------------
// publishing
// ---------------------------------------------------------------------------

import { Publication, PublicationStatus } from '../../core/domain/publishing.mjs';

export class InMemoryPublications {
  constructor(rows = []) {
    this.rows = rows.map((r) => (r instanceof Publication ? r : new Publication(r)));
    this.nextId = 1;
  }

  #plain(p) {
    return { ...p, path: p.path.value, locale: p.locale.value,
             scheduledFor: p.scheduledFor?.value ?? null };
  }

  async liveFor(entryId, locale) {
    return this.rows.find((p) => p.entryId === entryId
      && p.locale.value === locale && p.isLive) ?? null;
  }

  async atPath(path, locale) {
    return this.rows.find((p) => p.path.value === path
      && p.locale.value === locale && p.isLive) ?? null;
  }

  async save(pub) {
    const saved = new Publication({ ...this.#plain(pub), id: `pub-${this.nextId++}` });
    this.rows.push(saved);
    return saved;
  }

  async update(pub) {
    const i = this.rows.findIndex((p) => p.id === pub.id);
    if (i === -1) throw new Error(`No publication ${pub.id}`);
    this.rows[i] = pub;
    return pub;
  }

  /** Both changes, or neither. */
  async replace(next, previous) {
    if (previous) await this.update(previous);
    return next.id ? this.update(next) : this.save(next);
  }

  async due(on) {
    return this.rows.filter((p) => p.isDue(on));
  }

  async historyFor(entryId) {
    return this.rows.filter((p) => p.entryId === entryId).reverse();
  }
}

export class InMemoryEntries {
  constructor(entries = [], revisions = []) {
    this.entries = new Map(entries.map((e) => [e.id, e]));
    this.revisions = revisions;
  }
  async byId(id) { return this.entries.get(id) ?? null; }
  async latestRevision(entryId) {
    const mine = this.revisions.filter((r) => r.entryId === entryId);
    return mine.length ? mine[mine.length - 1] : null;
  }
  async revision(id) { return this.revisions.find((r) => r.id === id) ?? null; }
}

/** Collects events so a test can assert what the domain announced. */
export class RecordingEventBus {
  constructor() { this.events = []; }
  emit(event) { this.events.push(event); }
  named(name) { return this.events.filter((e) => e.name === name); }
  get last() { return this.events.at(-1) ?? null; }
  clear() { this.events = []; return this; }
}

// ---------------------------------------------------------------------------
// content types
// ---------------------------------------------------------------------------

import { ContentType, ContentEntry } from '../../core/domain/content-types.mjs';

export class InMemoryContentTypes {
  constructor(types = []) {
    this.types = types.map((t) => (t instanceof ContentType ? t : new ContentType(t)));
    this.entryCounts = new Map();
    this.nextId = 1;
  }
  async byName(organisationId, name) {
    return this.types.find((t) => t.organisationId === organisationId
      && t.name === name) ?? null;
  }
  async ownedBy(organisationId, name) {
    return this.types.find((t) => t.organisationId === organisationId
      && t.name === name) ?? null;
  }
  async allFor(organisationId) {
    return this.types.filter((t) => t.organisationId === organisationId);
  }
  async save(type) {
    const built = new ContentType({ ...type,
      id: type.id ?? `type-${this.nextId++}` });
    const i = this.types.findIndex((t) => t.id === built.id);
    if (i === -1) this.types.push(built); else this.types[i] = built;
    return built;
  }
  async countEntries(name) { return this.entryCounts.get(name) ?? 0; }
}

export class InMemoryContentEntries {
  constructor(entries = []) {
    this.entries = entries.map((e) =>
      e instanceof ContentEntry ? e : new ContentEntry(e));
    this.revisions = [];
    this.nextId = 1;
  }
  async byId(id) { return this.entries.find((e) => e.id === id) ?? null; }
  async bySlug(organisationId, typeName, slug) {
    return this.entries.find((e) => e.organisationId === organisationId
      && e.typeName === typeName && e.slug?.value === slug) ?? null;
  }
  async save(entry) {
    const built = new ContentEntry({ ...entry,
      slug: entry.slug?.value ?? null, id: entry.id ?? `entry-${this.nextId++}` });
    const i = this.entries.findIndex((e) => e.id === built.id);
    if (i === -1) this.entries.push(built); else this.entries[i] = built;
    return built;
  }
  async list(organisationId, typeName, { status = null } = {}) {
    return this.entries.filter((e) => e.organisationId === organisationId
      && e.typeName === typeName && (!status || e.status === status));
  }
  async saveRevision(entryId, values, actorId) {
    const id = `rev-${this.revisions.length + 1}`;
    this.revisions.push({ id, entryId, values, actorId });
    return id;
  }
}
