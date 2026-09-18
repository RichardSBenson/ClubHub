/**
 * HONBU — data access
 *
 * Every function that touches an organisation takes an `actor` and checks
 * permission in SQL, not in the caller. There is no way to query a branch you
 * do not have a grant on, because the check is in the query itself.
 */

import pg from 'pg';

export const pool = new pg.Pool({
  host: process.env.PGHOST ?? '/tmp/pgrun',
  port: +(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.PGDATABASE ?? 'honbu',
});

const q = async (text, params = []) => (await pool.query(text, params)).rows;
const one = async (text, params = []) => (await q(text, params))[0] ?? null;

export class Forbidden extends Error {
  constructor(msg = 'Not permitted') { super(msg); this.status = 403; }
}
export class NotFound extends Error {
  constructor(msg = 'Not found') { super(msg); this.status = 404; }
}
export class Invalid extends Error {
  constructor(msg) { super(msg); this.status = 422; }
}

const MANAGE = ['owner', 'administrator'];
const REGISTER = ['owner', 'administrator', 'registrar'];
const TEACH = ['owner', 'administrator', 'registrar', 'instructor'];

/** Throws unless `actor` holds one of `roles` at or above `orgId`. */
export async function assertRole(actor, orgId, roles = MANAGE) {
  const row = await one('select has_role_at($1,$2,$3) as ok', [actor, orgId, roles]);
  if (!row?.ok) throw new Forbidden();
}

// ---------------------------------------------------------------------------
// organisations
// ---------------------------------------------------------------------------

export const orgs = {
  async bySlug(slug) {
    return one(`select * from organisation where slug = $1`, [slug]);
  },

  /** The whole subtree beneath (and including) an organisation. */
  async subtree(rootId) {
    return q(`
      select o.*, (select count(*) from organisation c where c.parent_id = o.id) as children
      from organisation root
      join organisation o on o.path <@ root.path
      where root.id = $1
      order by o.path`, [rootId]);
  },

  /** Every organisation this account may act on. */
  async visibleTo(actor) {
    return q(`
      select o.* from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      order by o.path`, [actor]);
  },

  /** Public dojo list for the website. No auth — this is the front page. */
  async publicDojos(rootSlug) {
    return q(`
      select o.id, o.name, o.slug, o.country_code,
             d.venue_name, d.city, d.suburb, d.latitude, d.longitude,
             d.phone, d.email, d.first_class_free,
             coalesce(json_agg(json_build_object(
               'label', t.label, 'weekday', t.weekday,
               'starts', t.starts, 'ends', t.ends
             ) order by t.weekday, t.starts)
               filter (where t.id is not null), '[]') as sessions
      from organisation root
      join organisation o on o.path <@ root.path and o.type = 'dojo'
      left join dojo_profile d on d.organisation_id = o.id
      left join training_session t on t.organisation_id = o.id
      where root.slug = $1 and o.status = 'active'
      group by o.id, o.name, o.slug, o.country_code, d.venue_name, d.city,
               d.suburb, d.latitude, d.longitude, d.phone, d.email,
               d.first_class_free
      order by o.name`, [rootSlug]);
  },

  async create(actor, { parentId, type, name, slug, countryCode, timezone }) {
    await assertRole(actor, parentId, MANAGE);
    const parent = await one('select path from organisation where id = $1', [parentId]);
    if (!parent) throw new NotFound('Parent organisation');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
      throw new Invalid('Slug must be lowercase letters, numbers and hyphens');
    const path = `${parent.path}.${slug.replace(/-/g, '_')}`;
    return one(`
      insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
      values ($1,$2,$3,$4,$5,$6,coalesce($7,'Pacific/Auckland'))
      returning *`,
      [parentId, type, name, slug, path, countryCode, timezone]);
  },
};

// ---------------------------------------------------------------------------
// people and affiliation
// ---------------------------------------------------------------------------

export const people = {
  /** Roster for one organisation. Private detail only for registrars and above. */
  async roster(actor, orgId, { includePrivate = false, subtree = false } = {}) {
    await assertRole(actor, orgId, TEACH);
    if (includePrivate) await assertRole(actor, orgId, REGISTER);

    // A national grading draws candidates from every dojo beneath it, not from
    // the federation's own roll — which is empty, because members affiliate to
    // a dojo.
    const scope = subtree
      ? `a.organisation_id in (
           select o.id from organisation root
           join organisation o on o.path <@ root.path where root.id = $1)`
      : `a.organisation_id = $1`;

    return q(`
      select p.id, p.display_number, p.first_name, p.last_name,
             date_part('year', age(p.date_of_birth))::int as age,
             cg.label as grade, cg.rank_order, cg.awarded_on as graded_on,
             a.role, a.status, a.paid_until,
             o.name as dojo, o.slug as dojo_slug
             ${includePrivate ? `, pv.emergency_name, pv.emergency_phone` : ''}
      from affiliation a
      join person p on p.id = a.person_id
      join organisation o on o.id = a.organisation_id
      left join person_current_grade cg on cg.person_id = p.id
      ${includePrivate ? 'left join person_private pv on pv.person_id = p.id' : ''}
      where ${scope} and a.ends is null
      order by cg.rank_order desc nulls last, p.last_name`, [orgId]);
  },

  /** One person, with their whole grading history. Follows them between dojo. */
  async record(actor, personId) {
    // Any current affiliation, not just 'member' — instructors, officials and
    // supporters have records too, and they were invisible until this was fixed.
    const home = await one(`
      select organisation_id from affiliation
      where person_id = $1 and ends is null
      order by case role when 'member' then 0 else 1 end
      limit 1`, [personId]);
    if (!home) throw new NotFound('Person has no current affiliation');
    await assertRole(actor, home.organisation_id, TEACH);

    const person = await one(`
      select p.*, date_part('year', age(p.date_of_birth))::int as age
      from person p where p.id = $1`, [personId]);

    const history = await q(`
      select g.label, g.rank_order, g.is_dan, gr.awarded_on, gr.result,
             gr.certificate_no, o.name as awarded_by, gr.ratified_on
      from grading_record gr
      join grade g on g.id = gr.grade_id
      join organisation o on o.id = gr.awarded_by_org
      where gr.person_id = $1
      order by gr.awarded_on`, [personId]);

    const affiliations = await q(`
      select o.name as organisation, a.role, a.starts, a.ends, a.status
      from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 order by a.starts`, [personId]);

    return { person, history, affiliations };
  },

  /**
   * Move someone to another dojo. Closes the old affiliation, opens a new one.
   * The grading history is untouched — it belongs to the person.
   */
  async transfer(actor, personId, toOrgId, on = new Date()) {
    const current = await one(`
      select id, organisation_id from affiliation
      where person_id = $1 and ends is null and role = 'member'`, [personId]);
    if (!current) throw new NotFound('No current membership');
    await assertRole(actor, current.organisation_id, REGISTER);
    await assertRole(actor, toOrgId, REGISTER);

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('update affiliation set ends = $2 where id = $1',
        [current.id, on]);
      const { rows } = await client.query(`
        insert into affiliation (person_id, organisation_id, role, starts, status)
        values ($1,$2,'member',$3,'active') returning *`,
        [personId, toOrgId, on]);
      await client.query('commit');
      return rows[0];
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }
  },
};

// ---------------------------------------------------------------------------
// rank
// ---------------------------------------------------------------------------

export const rank = {
  async ladder(orgId) {
    return q(`select * from grade where organisation_id = $1 order by rank_order`,
      [orgId]);
  },

  /** Who may award this grade, with what panel, ratified by whom. */
  async authorityFor(orgId, rankOrder) {
    return one(`
      select ga.*, g.label as panel_must_hold
      from grade_authority ga
      left join grade g on g.rank_order = ga.min_panel_rank
                       and g.organisation_id = ga.organisation_id
      where ga.organisation_id = $1
        and $2 between ga.from_rank_order and ga.to_rank_order`,
      [orgId, rankOrder]);
  },

  /**
   * Eligibility, computed. Returns every unmet requirement rather than a bare
   * no, because a dojo operator needs to tell the student what is missing.
   */
  async eligibility(personId, federationId) {
    const row = await one(`
      with cur as (
        select p.id, p.date_of_birth, cg.rank_order, cg.awarded_on, cg.label
        from person p
        left join person_current_grade cg on cg.person_id = p.id
        where p.id = $1
      )
      select cur.label as holds, cur.rank_order,
             g.id as next_grade_id, g.label as next_grade, g.rank_order as next_order,
             g.min_months_at_previous, g.min_age, g.min_sessions,
             coalesce((date_part('year', age(cur.awarded_on))*12
                     + date_part('month', age(cur.awarded_on)))::int, 999) as months_since,
             (select count(*) from attendance a
               where a.person_id = cur.id
                 and a.session_date > coalesce(cur.awarded_on,'1900-01-01')) as sessions_since,
             date_part('year', age(cur.date_of_birth))::int as age_now
      from cur
      join grade g on g.rank_order = coalesce(cur.rank_order, 0) + 1
                  and g.organisation_id = $2`, [personId, federationId]);

    if (!row) return { eligible: false, reason: 'No next grade defined' };

    const unmet = [];
    if (row.months_since < (row.min_months_at_previous ?? 0))
      unmet.push(`${row.min_months_at_previous - row.months_since} more months at grade`);
    if (+row.sessions_since < (row.min_sessions ?? 0))
      unmet.push(`${row.min_sessions - row.sessions_since} more training sessions`);
    if (row.age_now < (row.min_age ?? 0))
      unmet.push(`minimum age ${row.min_age}`);

    return {
      holds: row.holds, next: row.next_grade, nextGradeId: row.next_grade_id,
      months: { has: row.months_since, needs: row.min_months_at_previous },
      sessions: { has: +row.sessions_since, needs: row.min_sessions },
      age: { has: row.age_now, needs: row.min_age },
      eligible: unmet.length === 0,
      unmet,
    };
  },

  /**
   * Record a grading. Refuses if the awarding organisation is not permitted to
   * award that grade, or the panel is too small or too junior.
   */
  async award(actor, { personId, gradeId, awardedByOrg, awardedOn, panel = [],
                       eventId = null, result = 'pass' }) {
    await assertRole(actor, awardedByOrg, REGISTER);

    const grade = await one('select * from grade where id = $1', [gradeId]);
    if (!grade) throw new NotFound('Grade');
    const org = await one('select * from organisation where id = $1', [awardedByOrg]);

    const auth = await this.authorityFor(grade.organisation_id, grade.rank_order);
    if (!auth) throw new Invalid(`No authority rule covers ${grade.label}`);

    if (auth.awarded_by_type !== org.type)
      throw new Invalid(
        `${grade.label} must be awarded by a ${auth.awarded_by_type}, not a ${org.type}`);

    if (panel.length < auth.min_panel_size)
      throw new Invalid(
        `${grade.label} requires a panel of ${auth.min_panel_size}, got ${panel.length}`);

    if (auth.min_panel_rank) {
      const ranks = await q(`
        select cg.rank_order from person_current_grade cg
        where cg.person_id = any($1::uuid[])`, [panel]);
      const tooJunior = ranks.filter((r) => r.rank_order < auth.min_panel_rank);
      if (ranks.length < panel.length || tooJunior.length)
        throw new Invalid(
          `Every examiner must hold ${auth.panel_must_hold} or above`);
    }

    return one(`
      insert into grading_record
        (person_id, grade_id, awarded_on, awarded_by_org, event_id, result, panel)
      values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`,
      [personId, gradeId, awardedOn, awardedByOrg, eventId, result,
       JSON.stringify(panel.map((id) => ({ person_id: id })))]);
  },
};

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

export const events = {
  /**
   * What shows on one organisation's page: its own events, plus anything an
   * ancestor published downward. Never a sibling's.
   */
  async forOrg(orgSlug, { viewerRankOrder = null, isMember = false } = {}) {
    return q(`
      select e.id, e.title, e.slug, e.kind, e.summary, e.starts_at, e.ends_at,
             e.venue_name, e.visibility, e.min_rank_order, e.entries_close,
             o.name as from_org, o.slug as from_slug,
             (o.id = target.id) as is_own
      from organisation target
      join organisation o on target.path <@ o.path
      join event e on e.organisation_id = o.id
      where target.slug = $1
        and e.status = 'published'
        and (e.organisation_id = target.id or e.publish_down)
        and (
          e.visibility = 'public'
          or (e.visibility = 'members' and $2::boolean)
          or (e.visibility = 'own_org' and e.organisation_id = target.id
              and $2::boolean)
          or (e.visibility = 'by_grade' and $3::smallint is not null
              and $3::smallint >= coalesce(e.min_rank_order, 0))
        )
      order by e.starts_at`, [orgSlug, isMember, viewerRankOrder]);
  },

  /** A dojo asks for its event to appear on the parent calendar. */
  async requestPublishUp(actor, eventId) {
    const ev = await one('select * from event where id = $1', [eventId]);
    if (!ev) throw new NotFound('Event');
    await assertRole(actor, ev.organisation_id, MANAGE);
    if (ev.visibility === 'own_org')
      throw new Invalid('A dojo-only event cannot be published upward');
    return one(`
      update event set publish_up = true, publish_up_state = 'requested'
      where id = $1 returning *`, [eventId]);
  },

  /** The parent approves or declines. */
  async decidePublishUp(actor, eventId, approve) {
    const ev = await one(`
      select e.*, o.parent_id from event e
      join organisation o on o.id = e.organisation_id where e.id = $1`, [eventId]);
    if (!ev) throw new NotFound('Event');
    if (!ev.parent_id) throw new Invalid('No parent organisation');
    await assertRole(actor, ev.parent_id, MANAGE);
    return one(`
      update event set publish_up_state = $2, publish_up = $3
      where id = $1 returning *`,
      [eventId, approve ? 'approved' : 'declined', approve]);
  },

  /** Can this person enter? Grade, age and membership all checked. */
  async canEnter(eventId, personId) {
    const row = await one(`
      select e.title, e.visibility, e.min_rank_order, e.max_rank_order,
             e.min_age, e.max_age, e.entries_close,
             cg.rank_order, cg.label as grade,
             date_part('year', age(p.date_of_birth))::int as age,
             exists(select 1 from affiliation a
                    where a.person_id = p.id and a.ends is null
                      and a.status = 'active') as is_member
      from event e
      cross join person p
      left join person_current_grade cg on cg.person_id = p.id
      where e.id = $1 and p.id = $2`, [eventId, personId]);
    if (!row) throw new NotFound('Event or person');

    const blocked = [];
    if (row.entries_close && new Date(row.entries_close) < new Date())
      blocked.push('Entries have closed');
    if (row.visibility !== 'public' && !row.is_member)
      blocked.push('Members only');
    if (row.min_rank_order && (row.rank_order ?? 0) < row.min_rank_order)
      blocked.push(`Requires a higher grade — holds ${row.grade ?? 'none'}`);
    if (row.max_rank_order && (row.rank_order ?? 0) > row.max_rank_order)
      blocked.push('Above the grade limit for this event');
    if (row.min_age && row.age < row.min_age) blocked.push(`Minimum age ${row.min_age}`);
    if (row.max_age && row.age > row.max_age) blocked.push(`Maximum age ${row.max_age}`);

    return { event: row.title, canEnter: blocked.length === 0, blocked };
  },
};

// ---------------------------------------------------------------------------
// money
// ---------------------------------------------------------------------------

export const billing = {
  /**
   * Build the affiliation invoice a parent sends a child organisation.
   * Every line names a person, so both sides can audit it.
   */
  async draftAffiliationInvoice(actor, { fromOrg, toOrg, periodStart, periodEnd,
                                         unitCents, currency = 'NZD' }) {
    await assertRole(actor, fromOrg, MANAGE);

    const members = await q(`
      select p.id, p.display_number, p.first_name, p.last_name
      from affiliation a join person p on p.id = a.person_id
      where a.organisation_id = $1 and a.role = 'member'
        and a.status = 'active' and a.ends is null
      order by p.last_name`, [toOrg]);

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [inv] } = await client.query(`
        insert into invoice (from_org, to_org, period_start, period_end, currency,
                             subtotal_cents, status)
        values ($1,$2,$3,$4,$5,$6,'draft') returning *`,
        [fromOrg, toOrg, periodStart, periodEnd, currency,
         members.length * unitCents]);

      for (const m of members) {
        await client.query(`
          insert into invoice_line (invoice_id, person_id, description, quantity, unit_cents)
          values ($1,$2,$3,1,$4)`,
          [inv.id, m.id,
           `${m.first_name} ${m.last_name} (${m.display_number ?? 'no number'})`,
           unitCents]);
      }
      await client.query('commit');
      return { invoice: inv, lines: members.length };
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }
  },
};

// ---------------------------------------------------------------------------
// authored pages
// ---------------------------------------------------------------------------

import { validate, excerpt, toText } from '../content/blocks.mjs';

export const pages = {
  async published(orgId, slug) {
    return one(`select * from page
      where organisation_id=$1 and slug=$2 and status='published'`, [orgId, slug]);
  },

  async listPublished(orgId) {
    return q(`select slug, title, meta_description, published_at from page
      where organisation_id=$1 and status='published' order by title`, [orgId]);
  },

  /**
   * Save a draft. The document is validated on the way in — anything not in the
   * block whitelist is dropped here, not at render time.
   * Returns what was dropped so the editor can tell the author.
   */
  async save(actor, { pageId, organisationId, slug, title, body,
                      metaTitle, metaDescription, note }) {
    const orgId = organisationId ??
      (await one('select organisation_id from page where id=$1', [pageId]))?.organisation_id;
    if (!orgId) throw new NotFound('Page');
    await assertRole(actor, orgId, ['owner', 'administrator', 'contributor']);

    const { doc, dropped } = validate(body);
    if (!toText(doc).trim()) throw new Invalid('The page has no content');

    const person = await one('select person_id from account where id=$1', [actor]);
    const client = await pool.connect();
    try {
      await client.query('begin');
      let page;
      if (pageId) {
        ({ rows: [page] } = await client.query(`
          update page set title=$2, body=$3, meta_title=$4, meta_description=$5,
                          updated_by=$6, updated_at=now()
          where id=$1 returning *`,
          [pageId, title, doc, metaTitle, metaDescription ?? excerpt(doc),
           person?.person_id]));
      } else {
        ({ rows: [page] } = await client.query(`
          insert into page (organisation_id, slug, title, body, meta_title,
                            meta_description, status, updated_by)
          values ($1,$2,$3,$4,$5,$6,'draft',$7) returning *`,
          [orgId, slug, title, doc, metaTitle, metaDescription ?? excerpt(doc),
           person?.person_id]));
      }

      await client.query(`
        insert into page_revision (page_id, title, body, meta_title,
                                   meta_description, saved_by, note)
        values ($1,$2,$3,$4,$5,$6,$7)`,
        [page.id, page.title, page.body, page.meta_title, page.meta_description,
         person?.person_id, note ?? null]);

      await client.query('commit');
      return { page, dropped };
    } catch (e) { await client.query('rollback'); throw e; }
    finally { client.release(); }
  },

  /** Publishing is a separate permission from writing. */
  async publish(actor, pageId) {
    const page = await one('select * from page where id=$1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, MANAGE);
    return one(`update page set status='published', published_at=now()
      where id=$1 returning *`, [pageId]);
  },

  async revisions(actor, pageId) {
    const page = await one('select organisation_id from page where id=$1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, ['owner','administrator','contributor']);
    return q(`select r.id, r.title, r.saved_at, r.note,
                     p.first_name || ' ' || p.last_name as saved_by
              from page_revision r
              left join person p on p.id = r.saved_by
              where r.page_id=$1 order by r.saved_at desc`, [pageId]);
  },

  async restore(actor, revisionId) {
    const rev = await one(`select r.*, pg.organisation_id
      from page_revision r join page pg on pg.id = r.page_id
      where r.id=$1`, [revisionId]);
    if (!rev) throw new NotFound('Revision');
    await assertRole(actor, rev.organisation_id, MANAGE);
    return one(`update page set title=$2, body=$3, meta_title=$4,
                                meta_description=$5, updated_at=now()
      where id=$1 returning *`,
      [rev.page_id, rev.title, rev.body, rev.meta_title, rev.meta_description]);
  },
};
