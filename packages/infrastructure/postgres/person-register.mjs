/**
 * INFRASTRUCTURE — the PersonRegister port on Postgres.
 * Everything here is storage: SQL, sealing of private values, the transaction.
 */

import { seal } from '../crypto/vault.mjs';

export class PostgresPersonRegister {
  constructor(pool) { this.pool = pool; }

  async inTransaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(transactionOn(client));
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }
  }
}

function transactionOn(client) {
  return {
    async lockEnrolment() { await client.query(`select pg_advisory_xact_lock(hashtext('enrol-person'))`); },

    async peopleNamed(first, last) {
      const { rows } = await client.query(`select display_number, first_name, last_name, date_of_birth::text as date_of_birth, email
        from person where lower(first_name) = lower($1) and lower(last_name) = lower($2) order by id`, [first, last]);
      return rows;
    },

    async federationShortNameFor(organisationId) {
      const { rows: [fed] } = await client.query(`
        select coalesce(f.short_name, f.slug) as prefix
        from organisation target
        join organisation f on target.path <@ f.path and f.parent_id is null
        where target.id = $1`, [organisationId]);
      return fed?.prefix ?? null;
    },

    async lastNumberIn(prefix) {
      const { rows: [seq] } = await client.query(`
        select coalesce(max(substring(display_number from '[0-9]+$')::int), 0) as last
        from person where display_number like $1`, [`${prefix}-%`]);
      return seq.last;
    },

    async addPerson(p) {
      const { rows: [person] } = await client.query(`
        insert into person (display_number, first_name, last_name, preferred_name, date_of_birth, gender, email, phone)
        values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [p.number, p.firstName, p.lastName, p.preferredName, p.dateOfBirth, p.gender, p.email, p.phone]);
      return person;
    },

    async addEmergencyContact(personId, name, phone) {
      await client.query(`
        insert into person_private (person_id, emergency_name, emergency_phone) values ($1,$2,$3)
        on conflict (person_id) do update set emergency_name = excluded.emergency_name, emergency_phone = excluded.emergency_phone`,
        [personId, seal(name), seal(phone)]);
    },

    async addAffiliation({ personId, organisationId, role, starts, paidUntil }) {
      await client.query(`
        insert into affiliation (person_id, organisation_id, role, starts, status, paid_until)
        values ($1,$2,$3,coalesce($4::date, current_date),'active',$5)`, [personId, organisationId, role, starts, paidUntil]);
    },

    async audit({ actorId, organisationId, action, entity, entityId, after }) {
      await client.query(`
        insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
        values ($1,$2,$3,$4,$5,$6::jsonb)`, [actorId, organisationId, action, entity, entityId, JSON.stringify(after)]);
    },
  };
}
