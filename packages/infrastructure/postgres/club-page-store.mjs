/** INFRASTRUCTURE — the ClubPageStore port on Postgres. */

import { PostgresStore } from './store-base.mjs';

export class PostgresClubPageStore extends PostgresStore {
  clubOf(id) { return this.one('select id, name, slug, type, parent_id from organisation where id = $1', [id]); }

  sessionsOf(clubId) {
    return this.rows(`select id, label, weekday, to_char(starts, 'HH24:MI') as starts, to_char(ends, 'HH24:MI') as ends, min_age, max_age
      from training_session where organisation_id = $1 order by sort_order, weekday, starts`, [clubId]);
  }

  profileOf(clubId) { return this.one('select * from club_profile where organisation_id = $1', [clubId]); }
  async ownsAsset(assetId, clubId) { return !!await this.one('select 1 from asset where id = $1 and organisation_id = $2', [assetId, clubId]); }

  async saveProfile(clubId, p) {
    await this.db.query(`
      insert into club_profile (organisation_id, venue_name, address_line, suburb, city, postcode, directions, phone, email, blurb, who_trains,
        first_class_free, accepts_beginners, hero_asset_id, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
      on conflict (organisation_id) do update set
        venue_name = excluded.venue_name, address_line = excluded.address_line, suburb = excluded.suburb, city = excluded.city,
        postcode = excluded.postcode, directions = excluded.directions, phone = excluded.phone, email = excluded.email, blurb = excluded.blurb,
        who_trains = excluded.who_trains, first_class_free = excluded.first_class_free, accepts_beginners = excluded.accepts_beginners,
        hero_asset_id = excluded.hero_asset_id, updated_at = now()`,
      [clubId, p.venue_name, p.address_line, p.suburb, p.city, p.postcode, p.directions, p.phone, p.email, p.blurb, p.who_trains,
       p.first_class_free, p.accepts_beginners, p.hero_asset_id]);
  }

  async sessionIdsOf(clubId) { return (await this.rows('select id::text from training_session where organisation_id = $1', [clubId])).map((r) => r.id); }
  async removeSession(clubId, id) { await this.db.query('delete from training_session where id = $1 and organisation_id = $2', [id, clubId]); }

  async updateSession(clubId, s, order) {
    await this.db.query(`update training_session set label=$3, weekday=$4, starts=$5, ends=$6, min_age=$7, max_age=$8, sort_order=$9
      where id = $1 and organisation_id = $2`, [s.id, clubId, s.label, s.weekday, s.starts, s.ends, s.minAge, s.maxAge, order]);
  }

  async addSession(clubId, s, order) {
    await this.db.query(`insert into training_session (organisation_id, label, weekday, starts, ends, min_age, max_age, sort_order)
      values ($1,$2,$3,$4,$5,$6,$7,$8)`, [clubId, s.label, s.weekday, s.starts, s.ends, s.minAge, s.maxAge, order]);
  }

  async requestPage(clubId) { await this.db.query('update club_profile set page_requested_at = now(), page_note = null where organisation_id = $1', [clubId]); }
  async takeDown(clubId) { await this.db.query('update club_profile set published = false, page_requested_at = null where organisation_id = $1', [clubId]); }

  async publish(clubId, publishedBy) {
    await this.db.query(`update club_profile set published = true, page_requested_at = null, page_note = null, published_by = $2, published_at = now()
      where organisation_id = $1`, [clubId, publishedBy]);
  }

  async decline(clubId, note) { await this.db.query('update club_profile set published = false, page_requested_at = null, page_note = $2 where organisation_id = $1', [clubId, note]); }

  async sitsBeneath(deciderId, clubId) {
    return !!await this.one(`select 1 from organisation mine, organisation theirs
      where mine.id = $1 and theirs.id = $2 and theirs.path <@ mine.path and theirs.id <> mine.id`, [deciderId, clubId]);
  }

  pagesBeneath(organisationId) {
    return this.rows(`
      select o.id, o.name, o.slug, d.venue_name, d.city, d.phone, d.email, d.blurb, d.who_trains,
             coalesce(d.published, false) as published, d.page_requested_at, d.page_note, d.published_at,
             (select count(*) from training_session t where t.organisation_id = o.id)::int as sessions
      from organisation root
      join organisation o on o.path <@ root.path and o.id <> root.id and o.type = 'club' and o.status = 'active'
      left join club_profile d on d.organisation_id = o.id
      where root.id = $1
      order by (d.page_requested_at is not null and not coalesce(d.published, false)) desc, o.name`, [organisationId]);
  }

  /** `clubId` is whose page the entry is about; `organisationId` whose history it appears in (history reads downward). */
  async audit({ actorId, organisationId, action, clubId, before, after }) {
    const club = await this.one('select name from organisation where id = $1', [clubId]);
    await this.db.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after) values ($1,$2,$3,'club_page',$4,$5,$6)`,
      [actorId, organisationId, action, clubId, JSON.stringify(before ?? {}), JSON.stringify({ ...(after ?? {}), club: club?.name ?? null })]);
  }
}
