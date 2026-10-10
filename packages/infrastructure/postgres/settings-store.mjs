/** INFRASTRUCTURE — the SettingsStore port on Postgres. Settings live as JSON on the organisation row. */

import { PostgresStore } from './store-base.mjs';

const CLUB = `select *, to_char(founded,'YYYY-MM-DD') as founded_iso from organisation where id=$1 and type='club'`;

export class PostgresSettingsStore extends PostgresStore {
  async settingsOf(organisationId) { return (await this.one('select settings from organisation where id=$1', [organisationId]))?.settings ?? null; }

  async putSetting(organisationId, key, value) {
    await this.db.query(`update organisation set settings = jsonb_set(coalesce(settings,'{}'::jsonb), $3::text[], $2::jsonb, true), updated_at = now() where id = $1`,
      [organisationId, JSON.stringify(value), `{${key}}`]);
  }

  async removeSetting(organisationId, key) { await this.db.query('update organisation set settings = settings - $2::text, updated_at = now() where id = $1', [organisationId, key]); }

  async assetOwner(assetId) { return (await this.one('select organisation_id from asset where id = $1', [assetId]))?.organisation_id ?? null; }

  authoredPages(organisationId) { return this.rows(`select slug, title from page where organisation_id=$1 and status='published' order by title`, [organisationId]); }

  // The date as text: pg hands a DATE back as a JS Date at local midnight, and turning that into a string shifts it a day
  // on a server east of UTC.
  clubRow(organisationId) { return this.one(CLUB, [organisationId]); }

  updateClub(organisationId, input) {
    return this.one(`update organisation set name=$2, short_name=$3, founded=$4::date, timezone=$5, status=$6, updated_at=now()
      where id=$1 returning *, to_char(founded,'YYYY-MM-DD') as founded_iso`,
      [organisationId, input.name, input.shortName, input.founded, input.timezone, input.status]);
  }

  async clubOverview(organisationId, parentId) {
    const administrators = await this.rows(`
      select a.email, p.first_name, p.last_name, g.role
      from grant_role g join account a on a.id = g.account_id left join person p on p.id = a.person_id
      where g.organisation_id = $1 and g.role in ('owner','administrator') order by g.granted_at`, [organisationId]);
    const counts = await this.one(`
      select (select count(*)::int from affiliation where organisation_id=$1 and ends is null and status='active') as members,
             (select count(*)::int from affiliation where organisation_id=$1 and ends is null and status='active' and role in ('instructor','coach')) as instructors,
             (select count(*)::int from event where organisation_id=$1 and status='published' and starts_at > now()) as upcoming`, [organisationId]);
    const page = await this.one('select published, page_requested_at from club_profile where organisation_id=$1', [organisationId]);
    const parent = await this.one('select name, slug from organisation where id=$1', [parentId]);
    return { administrators, counts, page, parent };
  }

  async audit({ actorId, organisationId, action, before = null, after = null }) {
    await this.db.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after) values ($1,$2,$3,'organisation',$2,$4,$5)`,
      [actorId, organisationId, action, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)]);
  }
}
