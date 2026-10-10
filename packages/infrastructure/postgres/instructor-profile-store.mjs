/** INFRASTRUCTURE — the InstructorProfileStore port on Postgres. */

import { PostgresStore } from './store-base.mjs';
import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';

const CATALOGUE = `from organisation me join organisation a on me.path <@ a.path
  join qualification q on q.organisation_id = a.id where me.id = $1`;

export class PostgresInstructorProfileStore extends PostgresStore {
  personForReadiness(personId) { return this.one(`select date_of_birth::text as dob, nullif(about, '') as about from person where id=$1`, [personId]); }
  async settingsOf(organisationId) { return (await this.one('select settings from organisation where id=$1', [organisationId]))?.settings ?? {}; }

  async todayAt(organisationId) {
    const o = await this.one('select timezone from organisation where id=$1', [organisationId]);
    return (await this.one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [o?.timezone ?? DEFAULT_TIMEZONE])).d;
  }

  instructorQualifications(clubId) { return this.rows(`select q.id, q.label ${CATALOGUE} and 'instruct' = any(q.required_for) order by q.label`, [clubId]); }

  awardsOf(personId) {
    return this.rows(`
      select qa.id, qa.person_id, qa.qualification_id, to_char(qa.awarded_on,'YYYY-MM-DD') as awarded_on,
             to_char(qa.expires_on,'YYYY-MM-DD') as expires_on, qa.issued_by_other, qa.reference,
             q.label, q.code, q.category, q.required_for
      from qualification_award qa join qualification q on q.id = qa.qualification_id where qa.person_id = $1`, [personId]);
  }

  instructorRows(personIds) {
    return this.rows(`
      select a.person_id, a.organisation_id as club_id, coalesce(ip.published, false) as published
      from affiliation a
      left join instructor_profile ip on ip.person_id = a.person_id and ip.organisation_id = a.organisation_id
      where a.person_id = any($1::uuid[]) and a.role = 'instructor' and a.ends is null and a.status = 'active'`, [personIds]);
  }

  async membersWithin(scopeOrgId, personIds) {
    const rows = await this.rows(`
      select distinct on (a.person_id) a.person_id, a.organisation_id
      from affiliation a join organisation o on o.id = a.organisation_id
      join organisation scope on scope.id = $1 and o.path <@ scope.path
      where a.role = 'member' and a.ends is null and a.status = 'active' and a.person_id = any($2::uuid[])
      order by a.person_id, a.starts desc`, [scopeOrgId, personIds]);
    return new Map(rows.map((r) => [r.person_id, r.organisation_id]));
  }

  async nameOf(personId) { return (await this.one(`select first_name || ' ' || last_name as name from person where id=$1`, [personId]))?.name ?? null; }

  profileOf(clubId, personId) {
    return this.one(`select bio, teaches, sort_order, started_year, show_checks, published from instructor_profile where organisation_id=$1 and person_id=$2`, [clubId, personId]);
  }

  personForProfile(personId, clubId) {
    return this.one(`
      select p.id, p.date_of_birth,
             exists (select 1 from affiliation a where a.person_id = p.id and a.organisation_id = $2
                       and a.ends is null and a.role = 'instructor' and a.status = 'active') as is_instructor
      from person p where p.id = $1`, [personId, clubId]);
  }

  saveProfile({ clubId, personId, bio, teaches, published, publishedBy, sortOrder, year, showChecks }) {
    return this.one(`
      insert into instructor_profile (organisation_id, person_id, bio, teaches, published, published_by, published_at, sort_order, started_year, show_checks)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (organisation_id, person_id) do update set
        bio = excluded.bio, started_year = excluded.started_year, show_checks = excluded.show_checks, teaches = excluded.teaches,
        published = excluded.published,
        -- Only stamped when it becomes published, so the record keeps who first agreed rather than whoever last edited a typo.
        published_by = case when excluded.published and not instructor_profile.published then excluded.published_by else instructor_profile.published_by end,
        published_at = case when excluded.published and not instructor_profile.published then excluded.published_at else instructor_profile.published_at end,
        sort_order = excluded.sort_order
      returning *`,
      [clubId, personId, bio, teaches, published, publishedBy, published ? new Date() : null, sortOrder, year, showChecks]);
  }

  removeProfile(clubId, personId) { return this.one('delete from instructor_profile where organisation_id=$1 and person_id=$2 returning *', [clubId, personId]); }

  siteStatus(personId) {
    return this.one(`select o.slug, o.name, coalesce(ip.published, false) as published
      from affiliation a join organisation o on o.id = a.organisation_id
      left join instructor_profile ip on ip.person_id = a.person_id and ip.organisation_id = a.organisation_id
      where a.person_id = $1 and a.role = 'instructor' and a.ends is null and a.status = 'active'
      order by o.path limit 1`, [personId]);
  }

  profilesFor(clubId) {
    return this.rows(`
      select p.id as person_id, p.first_name, p.last_name, p.date_of_birth, p.photo_asset_id, cg.label as grade, cg.is_dan,
             ct.label as title, ct.address_as, ip.id as profile_id, ip.bio, ip.teaches, ip.published,
             ip.published_at, ip.sort_order, ip.started_year, ip.show_checks
      from affiliation a
      join person p on p.id = a.person_id
      left join person_current_grade cg on cg.person_id = p.id
      left join person_current_title ct on ct.person_id = p.id
      left join instructor_profile ip on ip.person_id = p.id and ip.organisation_id = $1
      where a.organisation_id = $1 and a.ends is null and a.role = 'instructor' and a.status = 'active'
      order by ip.sort_order nulls last, cg.rank_order desc nulls last, p.last_name`, [clubId]);
  }

  async audit({ actorId, organisationId, action, entity, entityId, before = null, after = null }) {
    await this.db.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
      [actorId, organisationId, action, entity, entityId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)]);
  }
}
