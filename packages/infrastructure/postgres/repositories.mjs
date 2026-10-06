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
import { CalendarDay } from '../../core/domain/values.mjs';

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
      select ga.from_rank_order, ga.to_rank_order, ga.awarded_by_type,
             ga.ratified_by_type, ga.min_panel_size, ga.min_panel_rank,
             ga.requires_title_id, t.label as requires_title_label
      from grade_authority ga
      left join title t on t.id = ga.requires_title_id
      where ga.organisation_id = $1
        and $2 between ga.from_rank_order and ga.to_rank_order`,
      [federationId, rankOrder]);
    if (!r) return null;
    return new GradingAuthority({
      fromRankOrder: r.from_rank_order, toRankOrder: r.to_rank_order,
      awardedByType: r.awarded_by_type, ratifiedByType: r.ratified_by_type,
      minPanelSize: r.min_panel_size, minPanelRank: r.min_panel_rank,
      requiresTitleId: r.requires_title_id,
      requiresTitleLabel: r.requires_title_label,
    });
  }
}

/**
 * Which titles each person holds, conferred or awarded.
 *
 * Reads person_title, the view that unions both, so a federation that confers
 * Shihan from a grade and one that awards it by hand answer the same question
 * the same way.
 */
export class PostgresTitles {
  constructor(pool) { this.pool = pool; }

  async heldBy(personIds) {
    const ids = [...new Set(personIds ?? [])].filter(Boolean);
    const held = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return held;

    const { rows } = await this.pool.query(
      `select person_id, title_id from person_title where person_id = any($1)`,
      [ids]);
    for (const row of rows) held.get(row.person_id)?.push(row.title_id);
    return held;
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
      dateOfBirth: CalendarDay.from(r.date_of_birth)?.value ?? null,
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
/**
 * A query that failed because the database is behind the code.
 *
 * Deploying a build that expects a table nobody has created yet is an
 * ordinary thing to do — the code ships on push and the migration is run by
 * hand. What should not be ordinary is finding out through a stack trace in a
 * deploy log at ten to eleven on a Thursday.
 */
export class MigrationNeeded extends Error {
  constructor(migration, cause) {
    super(`This database has not had db/${migration}.sql applied.`);
    this.name = 'MigrationNeeded';
    this.migration = migration;
    this.cause = cause;
  }
}

export class PostgresSiteContent {
  constructor(pool) { this.pool = pool; }

  async federation(slug) {
    const { rows: [r] } = await this.pool.query(
      'select * from organisation where slug=$1', [slug]);
    return r ?? null;
  }

  /**
   * Every image belonging to this federation or anything beneath it, bytes
   * included, for the build to write out as files.
   *
   * The build is the one caller that reads bytes without an actor, which is
   * right: it is not a person, it holds no session, and everything it touches
   * is about to be published anyway.
   */
  async assets(rootSlug) {
    try {
      const { rows } = await this.pool.query(`
        select a.id, a.mime, a.filename, a.alt_text as "altText",
               a.width, a.height, b.bytes
        from asset a
        join asset_blob b on b.asset_id = a.id
        join organisation o on o.id = a.organisation_id
        join organisation root on o.path <@ root.path
        where root.slug = $1
        order by a.created_at`, [rootSlug]);
      return rows;
    } catch (e) {
      // 42P01 is "relation does not exist" — this database has not had
      // db/016 applied. A federation whose images are not migrated yet should
      // get a site without images and a warning naming the migration, not a
      // stack trace that takes the whole deployment down. Anything else is a
      // real fault and is left alone.
      if (e.code === '42P01') throw new MigrationNeeded('016-asset-bytes', e);
      throw e;
    }
  }

  /**
   * Every federation in this database — the top of each tree.
   *
   * The build used to carry a hardcoded list: moknz at the root and two demos
   * beneath it. That meant a federation who bought this and installed it
   * published somebody else's karate organisation at their own address, with
   * a taekwondo and a jiu-jitsu demo under it. One install is one federation,
   * and the only honest source for which one is the database.
   */
  async federations() {
    const { rows } = await this.pool.query(`
      select slug, name, founded,
             coalesce((settings->>'demo')::boolean, false) as demo
      from organisation
      where parent_id is null and status = 'active'
      order by founded nulls last, name`);
    return rows;
  }

  async brand(federationId) {
    const { rows: [r] } = await this.pool.query(
      'select * from brand where organisation_id=$1', [federationId]);
    return r ?? { tokens: {}, fonts: {} };
  }

  /**
   * Instructors this federation has agreed to show, with what the register
   * already knows about them: grade, title, photograph.
   *
   * Published only. The default is unpublished and the absence of a row means
   * nobody has been asked, so an empty list here is the correct answer rather
   * than a missing feature.
   */
  async instructors(rootSlug) {
    const { rows } = await this.pool.query(`
      select p.id as "personId", p.first_name as "firstName",
             p.last_name as "lastName", p.photo_asset_id as "photoAssetId",
             cg.label as grade, cg.is_dan as "isDan",
             ct.label as title, ct.address_as as "addressAs",
             ip.bio, ip.teaches, ip.sort_order as "sortOrder",
             ip.started_year as "startedYear",
             case when ip.show_checks then (
               select coalesce(json_agg(distinct q.label order by q.label), '[]'::json)
               from qualification_award qa join qualification q on q.id = qa.qualification_id
               where qa.person_id = p.id and q.category in ('safeguarding','medical','safety')
                 and (qa.expires_on is null or qa.expires_on >= current_date)) else '[]'::json end as checks,
             o.name as "organisationName", o.slug as "organisationSlug"
      from instructor_profile ip
      join person p on p.id = ip.person_id
      join organisation o on o.id = ip.organisation_id
      join organisation root on o.path <@ root.path
      left join person_current_grade cg on cg.person_id = p.id
      left join person_current_title ct on ct.person_id = p.id
      where root.slug = $1 and ip.published
      order by ip.sort_order, cg.rank_order desc nulls last, p.last_name`,
      [rootSlug]);
    return rows;
  }

  async dojos(rootSlug) {
    const { rows } = await this.pool.query(`
      select o.id, o.name, o.slug, o.country_code, d.*,
             coalesce(json_agg(json_build_object(
               'label', t.label, 'weekday', t.weekday,
               'starts', t.starts::text, 'ends', t.ends::text)
               order by t.sort_order) filter (where t.id is not null), '[]') as sessions
      from organisation root
      join organisation o on o.path <@ root.path and o.type = 'club' and o.status='active'
      left join dojo_profile d on d.organisation_id=o.id
      left join training_session t on t.organisation_id=o.id
      where root.slug=$1
      group by o.id, o.name, o.slug, o.country_code, d.organisation_id
      order by o.name`, [rootSlug]);
    return rows.map((r) => ({ ...r, venueName: r.venue_name,
      addressLine: r.address_line, whoTrains: r.who_trains }));
  }

  /**
   * The pictures each club under this federation has put in its gallery, in
   * order. A database that has not had db/038 yet has none, and the build says nothing.
   */
  async galleryFor(rootSlug) {
    try {
      const { rows } = await this.pool.query(`
        select g.organisation_id, g.asset_id, g.caption, g.position, a.alt_text
        from club_gallery g
        join asset a on a.id = g.asset_id
        join organisation o on o.id = g.organisation_id
        join organisation root on o.path <@ root.path
        where root.slug = $1
        order by g.organisation_id, g.position`, [rootSlug]);
      return rows;
    } catch (e) { if (e.code === '42P01') return []; throw e; }
  }

  async eventsFor(orgSlug) {
    // Three ways onto a calendar: it is this organisation's own; an ancestor
    // published it downward; or a descendant asked to be on it and this
    // organisation agreed. Never a sibling's, and never a descendant's that
    // nobody approved — the federation's name on an event reads as its
    // endorsement, so that decision is the federation's.
    //
    // An event that arrives from a club beneath gets the club's slug on the
    // end of its own, because event slugs are unique per organisation and
    // two organisations will both, sooner or later, run "grading-december".
    const { rows } = await this.pool.query(`
      select e.id, e.title,
             case when o.path <@ target.path and o.id <> target.id
                  then e.slug || '-' || o.slug else e.slug end as slug,
             e.kind, e.summary, e.starts_at, e.ends_at,
             e.venue_name, e.address_line, e.visibility, e.entries_close,
             d.type_key, d.contact_name, d.contact_email, d.contact_phone, d.cost_note, d.info_url, d.description,
             coalesce(d.latitude, e.latitude)::float as latitude, coalesce(d.longitude, e.longitude)::float as longitude,
             o.name as from_org, o.slug as from_slug, (o.id = target.id) as is_own
      from organisation target
      join event e on true
      left join event_detail d on d.event_id = e.id
      join organisation o on o.id = e.organisation_id
      where target.slug = $1 and e.status='published' and e.visibility='public'
        and (
          o.id = target.id
          or (e.publish_down and target.path <@ o.path)
          or (e.publish_up and e.publish_up_state = 'approved'
              and o.path <@ target.path)
        )
      order by e.starts_at`, [orgSlug]);
    return rows;
  }

  /**
   * Scoped to one federation's subtree. Unscoped, a second federation on the
   * same deployment showed the first one's news on its own front page, which
   * is the kind of leak that is only funny until it happens in a demo.
   */
  async articles(federationId = null) {
    // body, hero and tags were missing from this list. The build does
    // `article.body ? renderBlocks(...) : ''`, so every news article on the
    // hosted site has been a headline, a date and nothing else — a page of
    // 1,764 bytes with no content in it. The flat store spreads every column,
    // so a build from files had bodies and only the deployed one did not,
    // which is why it went unnoticed.
    const { rows } = await this.pool.query(`
      select a.slug, a.title, a.summary, a.body, a.tags,
             a.hero_asset_id as "heroAssetId",
             a.published_at, o.name as about_org
      from article a left join organisation o on o.id = a.about_org_id
      where a.status='published'
        and ($1::uuid is null or a.organisation_id = $1 or (
          -- Somebody else's article reaches this site only if they asked and
          -- this federation agreed. A dojo may say what it likes on its own
          -- site; putting it in the federation's voice is the federation's
          -- decision, because its name on a page reads as an endorsement
          -- whether or not it was meant as one.
          a.publish_up and a.publish_up_state = 'approved'
          and a.organisation_id in (
            select d.id from organisation d, organisation root
            where root.id = $1 and d.path <@ root.path)))
      order by a.published_at desc`, [federationId]);
    return rows;
  }

  async pages(federationId = null) {
    const { rows } = await this.pool.query(`
      select slug, title, body, meta_title, meta_description
      from page
      where status='published'
        and ($1::uuid is null or organisation_id in (
          select d.id from organisation d, organisation root
          where root.id = $1 and d.path <@ root.path))`, [federationId]);
    return rows;
  }
}

export class SystemClock {
  today() { return new Date().toISOString().slice(0, 10); }
}

// ---------------------------------------------------------------------------
// what the site generator reads
// ---------------------------------------------------------------------------


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

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

import { Event } from '../../core/domain/calendar.mjs';

/**
 * A row becomes an Event by going through the constructor, which means every
 * rule is checked on the way OUT of the database as well as on the way in.
 *
 * That is deliberate. A row edited by hand in a SQL console, or written by a
 * migration, or imported from a spreadsheet, does not get a pass — if it says
 * entries close after the event starts, reading it fails loudly here rather
 * than producing a page that quietly contradicts itself.
 */
const toEvent = (r) => new Event({
  id: r.id, organisationId: r.organisation_id, kind: r.kind, title: r.title,
  slug: r.slug, summary: r.summary, body: r.body,
  startsAt: r.starts_at, endsAt: r.ends_at, allDay: r.all_day,
  venueName: r.venue_name, addressLine: r.address_line,
  latitude: r.latitude, longitude: r.longitude,
  visibility: r.visibility,
  minRankOrder: r.min_rank_order, maxRankOrder: r.max_rank_order,
  minAge: r.min_age, maxAge: r.max_age,
  publishDown: r.publish_down, publishUp: r.publish_up,
  publishUpState: r.publish_up_state,
  entriesOpen: r.entries_open, entriesClose: r.entries_close,
  capacity: r.capacity, status: r.status,
  guardianUnder: r.guardian_under, consentVersion: r.consent_version,
  consentText: r.consent_text, guestsAllowed: r.guests_allowed,
});

export class PostgresEvents {
  constructor(pool) { this.pool = pool; }

  async byId(id) {
    const { rows: [r] } = await this.pool.query(
      `select * from event where id = $1`, [id]);
    return r ? toEvent(r) : null;
  }

  async bySlug(organisationId, slug) {
    const { rows: [r] } = await this.pool.query(
      `select * from event where organisation_id = $1 and slug = $2`,
      [organisationId, slug]);
    return r ? toEvent(r) : null;
  }

  /**
   * One statement for insert and update, keyed on the entity's own id.
   *
   * `on conflict (id)` rather than `(organisation_id, slug)`: a save must never
   * decide that two events are the same thing because they happen to share a
   * web address. The use case checks for that clash and refuses it by name,
   * which is a message somebody can act on — an upsert would silently
   * overwrite one event with another.
   */
  async save(event) {
    const { rows: [r] } = await this.pool.query(`
      insert into event (id, organisation_id, kind, title, slug, summary, body,
        starts_at, ends_at, all_day, venue_name, address_line,
        latitude, longitude, visibility,
        min_rank_order, max_rank_order, min_age, max_age,
        publish_down, publish_up, publish_up_state,
        entries_open, entries_close, capacity, status,
        guardian_under, consent_version, consent_text, guests_allowed)
      values (coalesce($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7::jsonb,
        $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
        $27, $28, $29, $30)
      on conflict (id) do update set
        kind = excluded.kind, title = excluded.title, slug = excluded.slug,
        summary = excluded.summary, body = excluded.body,
        starts_at = excluded.starts_at, ends_at = excluded.ends_at,
        all_day = excluded.all_day, venue_name = excluded.venue_name,
        address_line = excluded.address_line,
        latitude = excluded.latitude, longitude = excluded.longitude,
        visibility = excluded.visibility,
        min_rank_order = excluded.min_rank_order,
        max_rank_order = excluded.max_rank_order,
        min_age = excluded.min_age, max_age = excluded.max_age,
        publish_down = excluded.publish_down,
        publish_up = excluded.publish_up,
        publish_up_state = excluded.publish_up_state,
        entries_open = excluded.entries_open,
        entries_close = excluded.entries_close,
        capacity = excluded.capacity, status = excluded.status,
        guardian_under = excluded.guardian_under,
        consent_version = excluded.consent_version,
        consent_text = excluded.consent_text,
        guests_allowed = excluded.guests_allowed,
        updated_at = now()
      returning *`,
      [event.id, event.organisationId, event.kind, event.title,
       String(event.slug), event.summary,
       event.body == null ? null : JSON.stringify(event.body),
       event.startsAt, event.endsAt, event.allDay,
       event.venueName, event.addressLine, event.latitude, event.longitude,
       event.visibility, event.minRankOrder, event.maxRankOrder,
       event.minAge, event.maxAge, event.publishDown, event.publishUp,
       event.publishUpState, event.entriesOpen, event.entriesClose,
       event.capacity, event.status,
       event.guardianUnder, event.consentVersion, event.consentText,
       event.guestsAllowed]);
    return toEvent(r);
  }

  async listFor(organisationId, { status = null } = {}) {
    const { rows } = await this.pool.query(`
      select * from event
      where organisation_id = $1
        and ($2::text is null or status = $2)
      order by starts_at desc`, [organisationId, status]);
    return rows.map(toEvent);
  }

  async remove(id) {
    await this.pool.query(`delete from event where id = $1`, [id]);
  }
}
