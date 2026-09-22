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

// ---------------------------------------------------------------------------
// content types
// ---------------------------------------------------------------------------

import { ContentType, ContentEntry } from '../../core/domain/content-types.mjs';

const toType = (r) => new ContentType({
  id: r.id, organisationId: r.organisation_id, name: r.name, label: r.label,
  pluralLabel: r.plural_label, routePattern: r.route_pattern,
  titleField: r.title_field, slugField: r.slug_field, icon: r.icon,
  describedAs: r.described_as, schemaType: r.schema_type, fields: r.fields,
});

export class PostgresContentTypes {
  constructor(pool) { this.pool = pool; }

  /**
   * A type defined by a parent organisation is available to everything beneath
   * it — so a national body defines "Instructor" once and every dojo has it.
   * The nearest definition wins, which lets a dojo override.
   */
  async byName(organisationId, name) {
    const { rows: [r] } = await this.pool.query(`
      select ct.* from organisation target
      join organisation owner on target.path <@ owner.path
      join content_type ct on ct.organisation_id = owner.id
      where target.id = $1 and ct.name = $2
      order by nlevel(owner.path) desc limit 1`, [organisationId, name]);
    return r ? toType(r) : null;
  }

  /** Only what this organisation owns — never an inherited definition. */
  async ownedBy(organisationId, name) {
    const { rows: [r] } = await this.pool.query(
      `select * from content_type where organisation_id=$1 and name=$2`,
      [organisationId, name]);
    return r ? toType(r) : null;
  }

  async allFor(organisationId) {
    const { rows } = await this.pool.query(`
      select distinct on (ct.name) ct.* from organisation target
      join organisation owner on target.path <@ owner.path
      join content_type ct on ct.organisation_id = owner.id
      where target.id = $1
      order by ct.name, nlevel(owner.path) desc`, [organisationId]);
    return rows.map(toType);
  }

  async save(type) {
    const fields = JSON.stringify(type.fields);
    const { rows: [r] } = await this.pool.query(`
      insert into content_type (id, organisation_id, name, label, plural_label,
        route_pattern, title_field, slug_field, icon, described_as, schema_type,
        fields)
      values (coalesce($1, uuid_generate_v4()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      on conflict (organisation_id, name) do update set
        label=excluded.label, plural_label=excluded.plural_label,
        route_pattern=excluded.route_pattern, title_field=excluded.title_field,
        slug_field=excluded.slug_field, icon=excluded.icon,
        described_as=excluded.described_as, schema_type=excluded.schema_type,
        fields=excluded.fields, updated_at=now()
      returning *`,
      [type.id, type.organisationId, type.name, type.label, type.pluralLabel,
       type.routePattern, type.titleField, type.slugField, type.icon,
       type.describedAs, type.schemaType, fields]);
    return toType(r);
  }

  async countEntries(typeName, organisationId) {
    const { rows: [r] } = await this.pool.query(`
      select count(*)::int as n from content_entry ce
      join organisation target on target.id = $2
      join organisation o on o.id = ce.organisation_id and o.path <@ target.path
      where ce.type_name = $1`, [typeName, organisationId]);
    return r.n;
  }
}

const toEntry = (r) => new ContentEntry({
  id: r.id, typeName: r.type_name, organisationId: r.organisation_id,
  slug: r.slug, values: r.values, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export class PostgresContentEntries {
  constructor(pool) { this.pool = pool; }

  async byId(id) {
    const { rows: [r] } = await this.pool.query(
      `select * from content_entry where id = $1`, [id]);
    return r ? toEntry(r) : null;
  }

  async bySlug(organisationId, typeName, slug) {
    const { rows: [r] } = await this.pool.query(
      `select * from content_entry
       where organisation_id=$1 and type_name=$2 and slug=$3`,
      [organisationId, typeName, slug]);
    return r ? toEntry(r) : null;
  }

  async save(entry) {
    const { rows: [r] } = await this.pool.query(`
      insert into content_entry (id, type_name, organisation_id, slug, values,
        status)
      values (coalesce($1, uuid_generate_v4()),$2,$3,$4,$5::jsonb,$6)
      on conflict (id) do update set
        slug=excluded.slug, values=excluded.values, status=excluded.status,
        updated_at=now()
      returning *`,
      [entry.id, entry.typeName, entry.organisationId,
       entry.slug?.value ?? null, JSON.stringify(entry.values), entry.status]);
    return toEntry(r);
  }

  async list(organisationId, typeName, { status = null } = {}) {
    const { rows } = await this.pool.query(`
      select * from content_entry
      where organisation_id=$1 and type_name=$2
        and ($3::text is null or status=$3)
      order by updated_at desc`, [organisationId, typeName, status]);
    return rows.map(toEntry);
  }

  async saveRevision(entryId, values, actorId) {
    const { rows: [r] } = await this.pool.query(`
      insert into content_revision (entry_id, values, saved_by)
      values ($1,$2::jsonb,(select id from account where person_id = $3
        union all select $3::uuid limit 1))
      returning id`, [entryId, JSON.stringify(values), actorId]);
    return r.id;
  }
}
