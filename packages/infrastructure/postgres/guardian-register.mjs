/** INFRASTRUCTURE — the GuardianRegister port on Postgres. Storage only: SQL and the transaction. */

import { inTransaction } from './transaction.mjs';

const PERSON = `p.id, p.display_number, p.first_name, p.last_name, p.preferred_name,
  p.date_of_birth::text as date_of_birth, p.gender, p.email, p.phone`;

export class PostgresGuardianRegister {
  constructor(pool) { this.pool = pool; }

  inTransaction(work) { return inTransaction(this.pool, (client) => work(transactionOn(client))); }
}

function transactionOn(client) {
  const one = async (sql, params) => (await client.query(sql, params)).rows[0] ?? null;
  return {
    personById: (id) => one(`select ${PERSON} from person p where p.id=$1`, [id]),

    async homesOf(personId) {
      const { rows } = await client.query('select organisation_id from affiliation where person_id=$1 and ends is null', [personId]);
      return rows.map((r) => r.organisation_id);
    },

    linkById: (id) => one(`
      select gl.*, g.first_name as g_first, g.last_name as g_last, c.first_name as c_first, c.last_name as c_last
      from guardian_link gl
      join person g on g.id = gl.guardian_id join person c on c.id = gl.child_id
      where gl.id=$1 and gl.ended_on is null`, [id]),

    addLink: ({ guardianId, childId, relationship, createdBy }) => one(`
      insert into guardian_link (guardian_id, child_id, relationship, created_by) values ($1,$2,$3,$4)
      on conflict (guardian_id, child_id) where ended_on is null do nothing returning *`,
      [guardianId, childId, relationship, createdBy]),

    async chooseContact(link, { main, copy, fees }) {
      if (main) await client.query('update guardian_link set is_main_contact=false where child_id=$1 and ended_on is null', [link.child_id]);
      if (fees) await client.query('update guardian_link set pays_fees=false where child_id=$1 and ended_on is null', [link.child_id]);
      await client.query('update guardian_link set is_main_contact=$2, also_copy=$3, pays_fees=$4 where id=$1', [link.id, main, copy, fees]);
    },

    async endLink(id) { await client.query('update guardian_link set ended_on = current_date where id=$1', [id]); },

    async guardiansOf(childId) {
      const { rows } = await client.query(`
        select gl.id, gl.relationship, gl.is_main_contact, gl.also_copy, gl.pays_fees, g.id as person_id, g.first_name, g.last_name,
               g.email, exists(select 1 from account a where a.person_id = g.id) as can_sign_in
        from guardian_link gl join person g on g.id = gl.guardian_id
        where gl.child_id=$1 and gl.ended_on is null order by gl.created_at`, [childId]);
      return rows;
    },

    async audit({ actorId, organisationId, action, entity, entityId, after }) {
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
        values ($1,$2,$3,$4,$5,$6)`, [actorId, organisationId, action, entity, entityId, JSON.stringify(after)]);
    },
  };
}
