/**
 * INFRASTRUCTURE — the little every Postgres store shares: queries on the pool or on one client, and `atomically`.
 * `db` is the pool, or the one client a transaction is running on.
 */

import { inTransaction } from './transaction.mjs';

export class PostgresStore {
  constructor(pool, db = pool) { this.pool = pool; this.db = db; }

  /** Run `work(store)` as one transaction; the store it receives is this same class on the transaction's client. */
  atomically(work) { return inTransaction(this.pool, (client) => work(new this.constructor(this.pool, client))); }

  async rows(sql, params) { return (await this.db.query(sql, params)).rows; }
  async one(sql, params) { return (await this.rows(sql, params))[0] ?? null; }

  async homeOf(personId) {
    return (await this.one(`select organisation_id from affiliation where person_id = $1 and ends is null order by (role = 'member') desc limit 1`, [personId]))?.organisation_id ?? null;
  }

  async homesOf(personId) {
    return (await this.rows('select organisation_id from affiliation where person_id=$1 and ends is null', [personId])).map((r) => r.organisation_id);
  }

  async audit({ actorId, organisationId = null, action, entityId, after = null }) {
    await this.db.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,$3,'person',$4,$5)`,
      [actorId, organisationId, action, entityId, after === null ? null : JSON.stringify(after)]);
  }
}
