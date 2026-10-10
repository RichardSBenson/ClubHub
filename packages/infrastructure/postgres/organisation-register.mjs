/** INFRASTRUCTURE — the OrganisationRegister port on Postgres. */

import { PostgresStore } from './store-base.mjs';

export class PostgresOrganisationRegister extends PostgresStore {
  organisationById(id) { return this.one('select * from organisation where id = $1', [id]); }
  async slugTaken(slug) { return !!await this.one('select 1 from organisation where slug = $1', [slug]); }
  async emailHasAccount(email) { return !!await this.one('select person_id from account where email = $1', [email]); }

  /** The club, its profile row (when a city is given) and the audit entry happen together or not at all. */
  addClub({ parent, name, slug, city, addedBy }) {
    return this.atomically(async (tx) => {
      const club = await tx.one(`
        insert into organisation (parent_id, type, name, short_name, slug, path, country_code, timezone, status)
        values ($1,'club',$2,null,$3,($4 || '.' || $5)::ltree,$6,$7,'active') returning *`,
        [parent.id, name, slug, parent.path, slug.replace(/-/g, '_'), parent.country_code, parent.timezone]);
      if (city) await tx.db.query('insert into club_profile (organisation_id, city) values ($1,$2)', [club.id, city]);
      await tx.db.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'club_added','organisation',$3,$4::jsonb)`,
        [addedBy, parent.id, club.id, JSON.stringify({ name: club.name, slug, parent: parent.name })]);
      return club;
    });
  }
}
