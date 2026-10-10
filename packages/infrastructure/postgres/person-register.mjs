/**
 * INFRASTRUCTURE — the PersonRegister port on Postgres.
 * Everything here is storage: SQL, sealing of private values, the transaction.
 */

import { seal } from '../crypto/vault.mjs';
import { inTransaction } from './transaction.mjs';

export class PostgresPersonRegister {
  constructor(pool) { this.pool = pool; }

  inTransaction(work) { return inTransaction(this.pool, (client) => work(transactionOn(client))); }

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

    async addAffiliation({ personId, organisationId, role, starts, paidUntil = null }) {
      const { rows: [row] } = await client.query(`
        insert into affiliation (person_id, organisation_id, role, starts, status, paid_until)
        values ($1,$2,$3,coalesce($4::date, current_date),'active',$5) returning *`, [personId, organisationId, role, starts, paidUntil]);
      return row;
    },

    async homeOf(personId) {
      const { rows: [home] } = await client.query(`
        select organisation_id from affiliation where person_id = $1 and ends is null and role = 'member'
        union all
        select organisation_id from affiliation where person_id = $1 and ends is null
        limit 1`, [personId]);
      return home ? { organisationId: home.organisation_id } : null;
    },

    async currentMembership(personId) {
      const { rows: [m] } = await client.query(`
        select id, organisation_id from affiliation where person_id = $1 and ends is null and role = 'member'`, [personId]);
      return m ? { id: m.id, organisationId: m.organisation_id } : null;
    },

    async snapshotOf(personId) {
      const { rows: [was] } = await client.query(`
        select first_name, last_name, preferred_name, date_of_birth, gender, email, phone from person where id = $1`, [personId]);
      return was ?? {};
    },

    async changePerson(personId, changes) {
      const columns = { firstName: 'first_name', lastName: 'last_name', preferredName: 'preferred_name',
        dateOfBirth: 'date_of_birth', gender: 'gender', email: 'email', phone: 'phone' };
      const sets = Object.entries(changes).filter(([k, v]) => columns[k] && v !== undefined);
      if (!sets.length) return;
      const cols = sets.map(([k], i) => `${columns[k]} = $${i + 2}`).join(', ');
      await client.query(
        `update person set ${cols}, updated_at = now() where id = $1`, /* security-ok: column names come from the fixed map above, values are placeholders */
        [personId, ...sets.map(([, v]) => (v === '' ? null : v))]);
    },

    async changeEmergencyContact(personId, { name, phone }) {
      // A phone number that changed two years ago is worse than none, because it is the one that gets rung.
      await client.query(`
        insert into person_private (person_id, emergency_name, emergency_phone) values ($1,$2,$3)
        on conflict (person_id) do update set
          emergency_name = coalesce($2, person_private.emergency_name),
          emergency_phone = coalesce($3, person_private.emergency_phone),
          updated_at = now()`,
        [personId, name === undefined ? null : seal(name || null), phone === undefined ? null : seal(phone || null)]);
    },

    async changeAffiliation(personId, { paidUntil, status }) {
      await client.query(`
        update affiliation set paid_until = coalesce($2::date, paid_until), status = coalesce($3, status)
        where person_id = $1 and ends is null`, [personId, paidUntil || null, status || null]);
    },

    async recordHeldGrade({ personId, gradeId, awardedOn, organisationId, note }) {
      await client.query(`
        insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result, panel, notes)
        values ($1,$2,coalesce($3::date, current_date),$4,'pass','[]',$5)`, [personId, gradeId, awardedOn || null, organisationId, note]);
    },

    async rollOf(organisationId) {
      const { rows } = await client.query(`
        select p.id, p.first_name, p.last_name, p.email, p.date_of_birth
        from affiliation a join person p on p.id = a.person_id
        where a.organisation_id = $1 and a.ends is null`, [organisationId]);
      return rows.map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, dateOfBirth: r.date_of_birth }));
    },

    async endAffiliation(id, on) { await client.query('update affiliation set ends = $2 where id = $1', [id, on]); },

    async audit({ actorId, organisationId, action, entity, entityId, before = null, after }) {
      await client.query(`
        insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
        [actorId, organisationId, action, entity, entityId, before === null ? null : JSON.stringify(before), JSON.stringify(after)]);
    },
  };
}
