/**
 * INFRASTRUCTURE — Postgres adapters
 *
 * The only place in the system that knows SQL exists. Rows in, domain objects
 * out; domain objects in, rows out. Nothing else.
 *
 * Note what does NOT happen here: no business rule, no eligibility check, no
 * authority logic. Those live in the core. This file could be swapped for
 * SQLite or a file on disk and nothing above it would change.
 */

import { Grade, GradingAuthority, GradingRecord }
  from '../../core/domain/rank.mjs';

export class PostgresLadder {
  constructor(pool) { this.pool = pool; }

  async gradesFor(federationId) {
    const { rows } = await this.pool.query(`
      select id, label, rank_order, is_dan, belt_colour,
             min_months_at_previous, min_age, min_sessions
      from grade where organisation_id = $1 order by rank_order`, [federationId]);
    return rows.map((r) => new Grade({
      id: r.id, label: r.label, rankOrder: r.rank_order, isDan: r.is_dan,
      beltColour: r.belt_colour,
      minMonthsAtPrevious: r.min_months_at_previous,
      minAge: r.min_age, minSessions: r.min_sessions,
    }));
  }

  async authorityFor(federationId, rankOrder) {
    const { rows: [r] } = await this.pool.query(`
      select from_rank_order, to_rank_order, awarded_by_type, ratified_by_type,
             min_panel_size, min_panel_rank
      from grade_authority
      where organisation_id = $1
        and $2 between from_rank_order and to_rank_order`,
      [federationId, rankOrder]);
    if (!r) return null;
    return new GradingAuthority({
      fromRankOrder: r.from_rank_order, toRankOrder: r.to_rank_order,
      awardedByType: r.awarded_by_type, ratifiedByType: r.ratified_by_type,
      minPanelSize: r.min_panel_size, minPanelRank: r.min_panel_rank,
    });
  }
}

export class PostgresRanks {
  constructor(pool) { this.pool = pool; }

  async recordsFor(personId) {
    const { rows } = await this.pool.query(`
      select id, person_id, grade_id, awarded_on, awarded_by_org, result,
             ratified_on, certificate_no
      from grading_record where person_id = $1 order by awarded_on`, [personId]);
    return rows.map(toRecord);
  }

  async save(record) {
    const { rows: [r] } = await this.pool.query(`
      insert into grading_record
        (person_id, grade_id, awarded_on, awarded_by_org, result, panel)
      values ($1,$2,$3,$4,$5,$6::jsonb)
      returning id, person_id, grade_id, awarded_on, awarded_by_org, result,
                ratified_on, certificate_no`,
      [record.personId, record.gradeId, record.awardedOn.value,
       record.awardedByOrgId, record.result, JSON.stringify(record.panel)]);
    return toRecord(r);
  }

  async rankOrdersFor(personIds) {
    const out = new Map(personIds.map((id) => [id, null]));
    if (!personIds.length) return out;
    const { rows } = await this.pool.query(`
      select person_id, rank_order from person_current_grade
      where person_id = any($1::uuid[])`, [personIds]);
    for (const r of rows) out.set(r.person_id, r.rank_order);
    return out;
  }
}

const toRecord = (r) => new GradingRecord({
  id: r.id, personId: r.person_id, gradeId: r.grade_id,
  awardedOn: r.awarded_on, awardedByOrgId: r.awarded_by_org,
  result: r.result, ratifiedOn: r.ratified_on, certificateNo: r.certificate_no,
});

export class PostgresMembers {
  constructor(pool) { this.pool = pool; }

  async byId(personId) {
    const { rows: [r] } = await this.pool.query(`
      select p.id, p.date_of_birth, p.display_number,
             a.organisation_id
      from person p
      left join affiliation a on a.person_id = p.id and a.ends is null
      where p.id = $1 limit 1`, [personId]);
    if (!r) return null;
    return {
      id: r.id,
      dateOfBirth: r.date_of_birth ? r.date_of_birth.toISOString().slice(0, 10) : null,
      displayNumber: r.display_number,
      organisationId: r.organisation_id,
    };
  }

  async sessionsSince(personId, since) {
    const { rows: [r] } = await this.pool.query(`
      select count(*)::int as n from attendance
      where person_id = $1 and session_date > coalesce($2::date, '1900-01-01')`,
      [personId, since]);
    return r.n;
  }
}

export class PostgresOrganisations {
  constructor(pool) { this.pool = pool; }

  async byId(orgId) {
    const { rows: [r] } = await this.pool.query(`
      select o.id, o.type, o.name,
             (select root.id from organisation root
               where o.path <@ root.path and root.parent_id is null
               limit 1) as federation_id
      from organisation o where o.id = $1`, [orgId]);
    if (!r) return null;
    return { id: r.id, type: r.type, name: r.name, federationId: r.federation_id };
  }
}

export class PostgresAuthorisation {
  constructor(pool) { this.pool = pool; }
  async hasRoleAt(actorId, orgId, roles) {
    const { rows: [r] } = await this.pool.query(
      'select has_role_at($1,$2,$3) as ok', [actorId, orgId, roles]);
    return !!r?.ok;
  }
}

/** The same port, backed by SQL. */
export class PostgresSiteContent {
  constructor(pool) { this.pool = pool; }

  async federation(slug) {
    const { rows: [r] } = await this.pool.query(
      'select * from organisation where slug=$1', [slug]);
    return r ?? null;
  }

  async brand(federationId) {
    const { rows: [r] } = await this.pool.query(
      'select * from brand where organisation_id=$1', [federationId]);
    return r ?? { tokens: {}, fonts: {} };
  }

  async dojos(rootSlug) {
    const { rows } = await this.pool.query(`
      select o.id, o.name, o.slug, o.country_code, d.*,
             coalesce(json_agg(json_build_object(
               'label', t.label, 'weekday', t.weekday,
               'starts', t.starts::text, 'ends', t.ends::text)
               order by t.sort_order) filter (where t.id is not null), '[]') as sessions
      from organisation root
      join organisation o on o.path <@ root.path and o.type='dojo' and o.status='active'
      left join dojo_profile d on d.organisation_id=o.id
      left join training_session t on t.organisation_id=o.id
      where root.slug=$1
      group by o.id, o.name, o.slug, o.country_code, d.organisation_id
      order by o.name`, [rootSlug]);
    return rows.map((r) => ({ ...r, venueName: r.venue_name,
      addressLine: r.address_line, whoTrains: r.who_trains }));
  }

  async eventsFor(orgSlug) {
    const { rows } = await this.pool.query(`
      select e.id, e.title, e.slug, e.kind, e.summary, e.starts_at, e.ends_at,
             e.venue_name, e.visibility, e.entries_close,
             o.name as from_org, o.slug as from_slug, (o.id = target.id) as is_own
      from organisation target
      join organisation o on target.path <@ o.path
      join event e on e.organisation_id = o.id
      where target.slug = $1 and e.status='published' and e.visibility='public'
        and (e.organisation_id = target.id or e.publish_down)
      order by e.starts_at`, [orgSlug]);
    return rows;
  }

  async articles() {
    const { rows } = await this.pool.query(`
      select a.slug, a.title, a.summary, a.published_at, o.name as about_org
      from article a left join organisation o on o.id = a.about_org_id
      where a.status='published' order by a.published_at desc`);
    return rows;
  }

  async pages() {
    const { rows } = await this.pool.query(`
      select slug, title, body, meta_title, meta_description
      from page where status='published'`);
    return rows;
  }
}

export class SystemClock {
  today() { return new Date().toISOString().slice(0, 10); }
}

// ---------------------------------------------------------------------------
// what the site generator reads
// ---------------------------------------------------------------------------

export class PostgresSite {
  constructor(pool) { this.pool = pool; }
  #q = async (sql, p = []) => (await this.pool.query(sql, p)).rows;

  async federation(slug) {
    const [r] = await this.#q(
      `select * from organisation where slug=$1 and parent_id is null`, [slug]);
    return r ?? null;
  }

  async brand(organisationId) {
    const [r] = await this.#q(
      `select * from brand where organisation_id=$1`, [organisationId]);
    return r ?? null;
  }

  async dojos(rootSlug) {
    return this.#q(`
      select o.id, o.parent_id as "parentId", o.name, o.slug, o.country_code,
             d.venue_name as "venueName", d.address_line as "addressLine",
             d.suburb, d.city, d.postcode, d.latitude, d.longitude,
             d.directions, d.phone, d.email, d.blurb,
             d.who_trains as "whoTrains",
             d.first_class_free as "firstClassFree", d.published,
             coalesce(json_agg(json_build_object(
               'label', t.label, 'weekday', t.weekday,
               'starts', t.starts::text, 'ends', t.ends::text)
               order by t.sort_order) filter (where t.id is not null), '[]') as sessions
      from organisation root
      join organisation o on o.path <@ root.path and o.type='dojo' and o.status='active'
      left join dojo_profile d on d.organisation_id=o.id
      left join training_session t on t.organisation_id=o.id
      where root.slug=$1
      group by o.id, o.parent_id, o.name, o.slug, o.country_code,
               d.organisation_id
      order by o.name`, [rootSlug]);
  }

  async eventsFor(orgSlug) {
    return this.#q(`
      select e.id, e.title, e.slug, e.kind, e.summary, e.starts_at, e.ends_at,
             e.venue_name, e.visibility, e.entries_close,
             o.name as from_org, o.slug as from_slug,
             (o.id = target.id) as is_own
      from organisation target
      join organisation o on target.path <@ o.path
      join event e on e.organisation_id = o.id
      where target.slug = $1 and e.status='published' and e.visibility='public'
        and (e.organisation_id = target.id or e.publish_down)
      order by e.starts_at`, [orgSlug]);
  }

  async pages() {
    return this.#q(`select slug, title, meta_title, meta_description, body
      from page where status='published'`);
  }

  async articles() {
    return this.#q(`
      select a.slug, a.title, a.summary, a.published_at, o.name as about_org
      from article a left join organisation o on o.id = a.about_org_id
      where a.status='published' order by a.published_at desc`);
  }

  async redirects() {
    return this.#q(`select from_path as "fromPath", to_path as "toPath",
      permanent from redirect`);
  }
}

// ---------------------------------------------------------------------------
// publishing
// ---------------------------------------------------------------------------

import { Publication } from '../../core/domain/publishing.mjs';

const toPublication = (r) => new Publication({
  id: r.id, entryId: r.entry_id, entryKind: r.entry_kind,
  revisionId: r.revision_id, path: r.path, locale: r.locale,
  organisationId: r.organisation_id, status: r.status,
  publishedAt: r.published_at, scheduledFor: r.scheduled_for,
  publishedBy: r.published_by, supersededAt: r.superseded_at,
  withdrawnAt: r.withdrawn_at,
});

export class PostgresPublications {
  constructor(pool) { this.pool = pool; }

  async liveFor(entryId, locale) {
    const { rows: [r] } = await this.pool.query(
      `select * from publication where entry_id=$1 and locale=$2 and status='live'`,
      [entryId, locale]);
    return r ? toPublication(r) : null;
  }

  async atPath(path, locale) {
    const { rows: [r] } = await this.pool.query(
      `select * from publication where path=$1 and locale=$2 and status='live'`,
      [path, locale]);
    return r ? toPublication(r) : null;
  }

  async save(pub) {
    const { rows: [r] } = await this.pool.query(`
      insert into publication (entry_id, entry_kind, revision_id, path, locale,
        organisation_id, status, published_at, scheduled_for, published_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [pub.entryId, pub.entryKind, pub.revisionId, pub.path.value,
       pub.locale.value, pub.organisationId, pub.status,
       pub.publishedAt, pub.scheduledFor?.value ?? null, pub.publishedBy]);
    return toPublication(r);
  }

  /**
   * Supersede the old and publish the new in one transaction. The unique index
   * on (entry_id, locale) where live means doing these in sequence fails — and
   * rightly so.
   */
  async replace(next, previous) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      if (previous) {
        await client.query(`update publication set status=$2, superseded_at=$3
          where id=$1`, [previous.id, previous.status, previous.supersededAt]);
      }
      let row;
      if (next.id) {
        ({ rows: [row] } = await client.query(`
          update publication set status=$2, published_at=$3 where id=$1
          returning *`, [next.id, next.status, next.publishedAt]));
      } else {
        ({ rows: [row] } = await client.query(`
          insert into publication (entry_id, entry_kind, revision_id, path,
            locale, organisation_id, status, published_at, published_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [next.entryId, next.entryKind, next.revisionId, next.path.value,
           next.locale.value, next.organisationId, next.status,
           next.publishedAt, next.publishedBy]));
      }
      await client.query('commit');
      return toPublication(row);
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally { client.release(); }
  }

  /** Status changes only. Content is never edited after publication. */
  async update(pub) {
    const { rows: [r] } = await this.pool.query(`
      update publication set status=$2, published_at=$3, superseded_at=$4,
             withdrawn_at=$5
      where id=$1 returning *`,
      [pub.id, pub.status, pub.publishedAt, pub.supersededAt, pub.withdrawnAt]);
    if (!r) throw new Error(`No publication ${pub.id}`);
    return toPublication(r);
  }

  async due(on) {
    const { rows } = await this.pool.query(
      `select * from publication where status='scheduled' and scheduled_for <= $1
       order by scheduled_for`, [on]);
    return rows.map(toPublication);
  }

  async historyFor(entryId) {
    const { rows } = await this.pool.query(
      `select * from publication where entry_id=$1 order by created_at desc`,
      [entryId]);
    return rows.map(toPublication);
  }
}

export class PostgresEntries {
  constructor(pool) { this.pool = pool; }

  async byId(id) {
    const { rows: [r] } = await this.pool.query(`
      select id, 'page' as kind, organisation_id, slug, title from page where id=$1
      union all
      select id, 'article', organisation_id, slug, title from article where id=$1`,
      [id]);
    return r ? { id: r.id, kind: r.kind, organisationId: r.organisation_id,
                 slug: r.slug, title: r.title } : null;
  }

  async latestRevision(entryId) {
    const { rows: [r] } = await this.pool.query(
      `select id, page_id as entry_id, saved_at from page_revision
       where page_id=$1 order by saved_at desc limit 1`, [entryId]);
    return r ? { id: r.id, entryId: r.entry_id, savedAt: r.saved_at } : null;
  }

  async revision(id) {
    const { rows: [r] } = await this.pool.query(
      `select id, page_id as entry_id, saved_at from page_revision where id=$1`,
      [id]);
    return r ? { id: r.id, entryId: r.entry_id, savedAt: r.saved_at } : null;
  }
}

/**
 * Events are stored, then handled. A subscriber that fails can be retried, and
 * "why did that page change" has an answer months later.
 */
export class PostgresEventBus {
  constructor(pool) { this.pool = pool; }
  emit(event) {
    // Fire and forget: the domain must never fail because a listener did.
    this.pool.query(
      `insert into domain_event (name, payload, occurred_at) values ($1,$2,$3)`,
      [event.name, JSON.stringify(event.payload), event.at])
      .catch((e) => console.error('event not stored:', event.name, e.message));
  }
}
