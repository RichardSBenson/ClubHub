/**
 * INFRASTRUCTURE — JSON file adapters
 *
 * The same ports, backed by files in the repository instead of a database.
 *
 * Why this exists:
 *
 *  - **It deploys with nothing to provision.** Push to GitHub, Vercel builds,
 *    the site is up. No database, no connection string, no waiting.
 *  - **Content is editable from a phone.** JSON files in the repo, edited
 *    through GitHub's web interface — which is exactly how this gets deployed
 *    anyway.
 *  - **It is versioned.** Every content change is a commit with an author and a
 *    message. That is a better audit trail than most CMSs manage.
 *
 * The honest limit: a serverless filesystem is read-only. These adapters serve
 * reads perfectly and refuse writes loudly. The moment gradings need recording
 * from the admin app, Postgres has to arrive — and by then it is one line in
 * the factory, because the core never knew the difference.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Grade, GradingAuthority, GradingRecord }
  from '../../core/domain/rank.mjs';

export class ReadOnlyStore extends Error {
  constructor(what) {
    super(`Cannot ${what}: this deployment is running from files, which are ` +
      `read-only. Connect a database to record changes.`);
    this.name = 'ReadOnlyStore';
    this.status = 503;
  }
}

/**
 * Loads once per process and keeps it. On a serverless host each instance reads
 * the files on its first request and never again, which is the right trade for
 * data that only changes on deploy.
 */
export class JsonData {
  #dir;
  #cache = new Map();

  constructor(dir) { this.#dir = dir; }

  read(name) {
    if (this.#cache.has(name)) return this.#cache.get(name);
    const file = path.join(this.#dir, `${name}.json`);
    const data = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : [];
    this.#cache.set(name, data);
    return data;
  }

  /** For tests and the build; never called in a request. */
  reload() { this.#cache.clear(); return this; }
}

// ---------------------------------------------------------------------------

export class JsonLadder {
  constructor(data) { this.data = data; }

  async gradesFor(federationId) {
    return this.data.read('grades')
      .filter((g) => !federationId || g.organisationId === federationId)
      .map((g) => new Grade(g))
      .sort((a, b) => a.rankOrder.value - b.rankOrder.value);
  }

  async authorityFor(federationId, rankOrder) {
    const row = this.data.read('grade-authorities').find((a) =>
      (!federationId || a.organisationId === federationId)
      && rankOrder >= a.fromRankOrder && rankOrder <= a.toRankOrder);
    return row ? new GradingAuthority(row) : null;
  }
}

export class JsonRanks {
  constructor(data) { this.data = data; }

  async recordsFor(personId) {
    return this.data.read('gradings')
      .filter((r) => r.personId === personId)
      .map((r) => new GradingRecord(r));
  }

  async save() { throw new ReadOnlyStore('record a grading'); }

  async rankOrdersFor(personIds) {
    const grades = new Map(this.data.read('grades').map((g) => [g.id, g.rankOrder]));
    const out = new Map(personIds.map((id) => [id, null]));
    for (const r of this.data.read('gradings')) {
      if (!out.has(r.personId)) continue;
      if (r.result && r.result !== 'pass' && r.result !== 'provisional') continue;
      const order = grades.get(r.gradeId) ?? null;
      const best = out.get(r.personId);
      if (order != null && (best == null || order > best)) out.set(r.personId, order);
    }
    return out;
  }
}

export class JsonMembers {
  constructor(data) { this.data = data; }

  async byId(personId) {
    const p = this.data.read('people').find((x) => x.id === personId);
    return p ? { id: p.id, dateOfBirth: p.dateOfBirth ?? null,
                 displayNumber: p.displayNumber ?? null,
                 organisationId: p.organisationId ?? null } : null;
  }

  async sessionsSince(personId, since) {
    return this.data.read('attendance')
      .filter((a) => a.personId === personId
        && (!since || a.sessionDate > since)).length;
  }
}

export class JsonOrganisations {
  constructor(data) { this.data = data; }

  async byId(orgId) {
    const orgs = this.data.read('organisations');
    const o = orgs.find((x) => x.id === orgId);
    if (!o) return null;
    // The federation is the root of this branch.
    let root = o;
    while (root.parentId) {
      const parent = orgs.find((x) => x.id === root.parentId);
      if (!parent) break;
      root = parent;
    }
    return { id: o.id, type: o.type, name: o.name, federationId: root.id };
  }

  /** Everything the public site needs, with no database. */
  async publicDojos(rootSlug) {
    const orgs = this.data.read('organisations');
    const profiles = new Map(
      this.data.read('dojo-profiles').map((d) => [d.organisationId, d]));
    const sessions = this.data.read('training-sessions');
    const root = orgs.find((o) => o.slug === rootSlug);
    if (!root) return [];

    return orgs
      .filter((o) => o.type === 'dojo' && descendsFrom(o, root, orgs))
      .map((o) => ({
        ...o, ...(profiles.get(o.id) ?? {}),
        sessions: sessions.filter((s) => s.organisationId === o.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

const descendsFrom = (node, root, all) => {
  let cur = node;
  while (cur) {
    if (cur.id === root.id) return true;
    cur = all.find((x) => x.id === cur.parentId);
  }
  return false;
};

/**
 * Roles from a file. Useful for a single-administrator deployment and for the
 * read-only public build; a real multi-user install needs the database.
 */
export class JsonAuthorisation {
  constructor(data) { this.data = data; }

  async hasRoleAt(accountId, orgId, roles) {
    const orgs = this.data.read('organisations');
    const target = orgs.find((o) => o.id === orgId);
    if (!target) return false;
    return this.data.read('grants').some((g) => {
      if (g.accountId !== accountId || !roles.includes(g.role)) return false;
      const granted = orgs.find((o) => o.id === g.organisationId);
      return granted && descendsFrom(target, granted, orgs);
    });
  }
}

/**
 * Everything the public site renders. One port, so the site build has no idea
 * whether it is reading files or a database.
 */
export class JsonSiteContent {
  constructor(data) { this.data = data; this.orgs = new JsonOrganisations(data); }

  async federation(slug) {
    return this.data.read('organisations').find((o) => o.slug === slug) ?? null;
  }

  async brand(federationId) {
    return this.data.read('brand')
      .find((b) => b.organisationId === federationId) ?? { tokens: {}, fonts: {} };
  }

  async dojos(rootSlug) { return this.orgs.publicDojos(rootSlug); }

  async eventsFor(orgSlug) {
    const orgs = this.data.read('organisations');
    const target = orgs.find((o) => o.slug === orgSlug);
    if (!target) return [];
    return this.data.read('events')
      .filter((e) => {
        const from = orgs.find((o) => o.id === e.organisationId);
        if (!from) return false;
        if (from.id === target.id) return true;
        return e.publishDown && descendsFrom(target, from, orgs);
      })
      .map((e) => {
        const from = orgs.find((o) => o.id === e.organisationId);
        return { ...e, starts_at: e.startsAt, ends_at: e.endsAt,
                 venue_name: e.venueName, entries_close: e.entriesClose,
                 from_org: from.name, from_slug: from.slug,
                 is_own: from.id === target.id };
      })
      .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  }

  async articles() {
    return this.data.read('articles').map((a) => ({
      ...a, published_at: a.publishedAt, about_org: a.aboutOrg }));
  }

  async pages() {
    return this.data.read('pages').map((p) => ({
      ...p, meta_title: p.metaTitle, meta_description: p.metaDescription }));
  }
}

export class SystemClock {
  today() { return new Date().toISOString().slice(0, 10); }
}

// ---------------------------------------------------------------------------
// what the site generator reads
// ---------------------------------------------------------------------------

export class JsonSite {
  constructor(data) {
    this.data = data;
    this.orgs = new JsonOrganisations(data);
  }

  async federation(slug) {
    return this.data.read('organisations')
      .find((o) => o.slug === slug && !o.parentId) ?? null;
  }

  async brand(organisationId) {
    return this.data.read('brand')
      .find((b) => b.organisationId === organisationId) ?? null;
  }

  async dojos(rootSlug) { return this.orgs.publicDojos(rootSlug); }

  /**
   * Public events for one organisation: its own, plus anything an ancestor
   * published downward. The scoping rules hold in the flat store too — they are
   * not a database feature.
   */
  async eventsFor(orgSlug) {
    const orgs = this.data.read('organisations');
    const target = orgs.find((o) => o.slug === orgSlug);
    if (!target) return [];

    const ancestors = new Set();
    for (let cur = target; cur; cur = orgs.find((o) => o.id === cur.parentId))
      ancestors.add(cur.id);

    return this.data.read('events')
      .filter((e) => e.visibility === 'public'
        && (e.organisationId === target.id
            || (e.publishDown && ancestors.has(e.organisationId))))
      .map((e) => {
        const from = orgs.find((o) => o.id === e.organisationId);
        return { ...e, starts_at: e.startsAt, ends_at: e.endsAt,
                 venue_name: e.venueName, entries_close: e.entriesClose,
                 from_org: from?.name, from_slug: from?.slug,
                 is_own: e.organisationId === target.id };
      })
      .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  }

  async pages() {
    return this.data.read('pages').map((p) => ({
      ...p, meta_title: p.metaTitle, meta_description: p.metaDescription }));
  }

  async articles() {
    return this.data.read('articles').map((a) => ({
      ...a, published_at: a.publishedAt, about_org: a.aboutOrg }));
  }

  async redirects() { return this.data.read('redirects'); }
}
