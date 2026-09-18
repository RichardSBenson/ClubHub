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

export class SystemClock {
  today() { return new Date().toISOString().slice(0, 10); }
}
