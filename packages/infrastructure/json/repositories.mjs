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
import { OrgType } from '../../core/domain/values.mjs';
import { Event } from '../../core/domain/calendar.mjs';

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

/**
 * Titles from the exported files: those awarded outright, plus those the
 * federation confers from a grade. Both, because the Postgres view does both
 * and the two stores have to answer alike.
 */
export class JsonTitles {
  constructor(data) { this.data = data; }

  async heldBy(personIds) {
    const ids = [...new Set(personIds ?? [])].filter(Boolean);
    const held = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return held;

    const titles = this.data.read('titles');
    const wanted = new Set(ids);

    for (const award of this.data.read('title-awards')) {
      if (wanted.has(award.personId)) held.get(award.personId).push(award.titleId);
    }

    // Conferred: read the person's rank the same way JsonRanks does, so a
    // grade that earns a title here earns it there too.
    const gradeRank = new Map(
      this.data.read('grades').map((g) => [g.id, g.rankOrder]));
    const rankOf = new Map();
    for (const record of this.data.read('gradings')) {
      if (!wanted.has(record.personId)) continue;
      if (record.result && !['pass', 'provisional'].includes(record.result)) continue;
      const order = gradeRank.get(record.gradeId);
      if (order == null) continue;
      rankOf.set(record.personId, Math.max(rankOf.get(record.personId) ?? 0, order));
    }

    for (const [personId, order] of rankOf) {
      for (const t of titles) {
        if (!t.conferredByRank) continue;
        if (order < (t.minGradeOrder ?? 0)) continue;
        if (t.maxGradeOrder != null && order > t.maxGradeOrder) continue;
        if (!held.get(personId).includes(t.id)) held.get(personId).push(t.id);
      }
    }

    return held;
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

/**
 * The calendar, read from files.
 *
 * Reading works; writing does not, and says so rather than appearing to
 * succeed. A read-only deployment that accepts an event and loses it is worse
 * than one that refuses it, because nobody finds out until the day of.
 */
export class JsonEvents {
  constructor(data) { this.data = data; }

  #all() {
    return this.data.read('events').map((e) => new Event(e));
  }

  async byId(id) { return this.#all().find((e) => e.id === id) ?? null; }

  async bySlug(organisationId, slug) {
    return this.#all().find((e) => e.organisationId === organisationId
      && String(e.slug) === String(slug)) ?? null;
  }

  async listFor(organisationId, { status = null } = {}) {
    return this.#all()
      .filter((e) => e.organisationId === organisationId
        && (status == null || e.status === status))
      .sort((a, b) => b.startsAt - a.startsAt);
  }

  async save() { throw new ReadOnlyStore('save an event'); }
  async remove() { throw new ReadOnlyStore('delete an event'); }
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
      .filter((o) => OrgType.isLeaf(o.type) && descendsFrom(o, root, orgs))
      .map((o) => ({
        ...o, ...(profiles.get(o.id) ?? {}),
        // No profile means the club has told nobody anything, which is not
        // the same as having asked to be on the website.
        published: profiles.get(o.id)?.published === true,
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

  async federations() {
    return this.data.read('organisations')
      .filter((o) => !o.parentId)
      .map((o) => ({ slug: o.slug, name: o.name, founded: o.founded ?? null,
                     demo: !!o.settings?.demo }));
  }

  async brand(federationId) {
    return this.data.read('brand')
      .find((b) => b.organisationId === federationId) ?? { tokens: {}, fonts: {} };
  }

  /**
   * Images, for the build to write out.
   *
   * The flat store keeps bytes as base64 in the record, because the point of
   * this store is that a federation's whole register is a folder of files
   * somebody can read, copy and commit. A sidecar directory of binaries
   * alongside it would break that and gain nothing at this size.
   *
   * Empty is the normal answer here: the files store exists for the demo and
   * for a federation that has not set up a database, and neither uploads.
   */
  async assets(rootSlug) {
    const root = await this.federation(rootSlug);
    if (!root) return [];
    const under = new Set(this.orgs.publicDojos
      ? (await this.orgs.publicDojos(rootSlug)).map((d) => d.id)
      : []);
    under.add(root.id);
    return this.data.read('assets')
      .filter((a) => under.has(a.organisationId))
      .map((a) => ({ ...a, bytes: Buffer.from(a.base64 ?? '', 'base64') }));
  }

  async dojos(rootSlug) { return this.orgs.publicDojos(rootSlug); }

  /** The files store has no galleries; a federation that wants them runs a database. */
  async galleryFor() { return []; }

  /** The files store has no shop; a federation that sells gear runs a database. */
  async shopRange() { return []; }

  async eventsFor(orgSlug) {
    const orgs = this.data.read('organisations');
    const target = orgs.find((o) => o.slug === orgSlug);
    if (!target) return [];
    return this.data.read('events')
      .filter((e) => {
        const from = orgs.find((o) => o.id === e.organisationId);
        if (!from) return false;
        if (from.id === target.id) return true;
        if (e.publishDown && descendsFrom(target, from, orgs)) return true;
        // A club's event reaches its federation only if the federation said yes.
        return e.publishUp === true && e.publishUpState === 'approved'
          && descendsFrom(from, target, orgs);
      })
      .map((e) => {
        const from = orgs.find((o) => o.id === e.organisationId);
        return { ...e, starts_at: e.startsAt, ends_at: e.endsAt,
                 venue_name: e.venueName, address_line: e.addressLine, entries_close: e.entriesClose,
                 ...(e.detail ?? {}),
                 from_org: from.name, from_slug: from.slug,
                 is_own: from.id === target.id,
                 slug: from.id !== target.id && descendsFrom(from, target, orgs)
                   ? `${e.slug}-${from.slug}` : e.slug };
      })
      .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  }

  /** Scoped to one federation, so a second one's news never shows here. */
  async articles(federationId = null) {
    return this.data.read('articles')
      .filter((a) => !federationId || a.organisationId === federationId)
      .map((a) => ({ ...a, published_at: a.publishedAt, about_org: a.aboutOrg }));
  }

  async pages(federationId = null) {
    return this.data.read('pages')
      .filter((p) => !federationId || p.organisationId === federationId)
      .map((p) => ({ ...p, meta_title: p.metaTitle,
                     meta_description: p.metaDescription }));
  }
}

export class SystemClock {
  today() { return new Date().toISOString().slice(0, 10); }
}
