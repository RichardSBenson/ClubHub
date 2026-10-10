/** INFRASTRUCTURE — the SelfServiceReads port on Postgres. Plain reads, no transaction: these run on most pages. */

const PERSON = `p.id, p.display_number, p.first_name, p.last_name, p.preferred_name,
  p.date_of_birth::text as date_of_birth, p.gender, p.email, p.phone`;

export class PostgresSelfServiceReads {
  constructor(pool) { this.pool = pool; }

  async selfOf(accountId) {
    const { rows: [self] } = await this.pool.query(
      `select ${PERSON} from account a join person p on p.id = a.person_id where a.id = $1`, [accountId]);
    return self ?? null;
  }

  async dependantsOf(guardianPersonId, adultAge) {
    const { rows } = await this.pool.query(`
      select ${PERSON}, gl.relationship
      from guardian_link gl join person p on p.id = gl.child_id
      where gl.guardian_id = $1 and gl.ended_on is null
        and p.date_of_birth is not null
        and p.date_of_birth > current_date - make_interval(years => $2)
      order by p.first_name`, [guardianPersonId, adultAge]);
    return rows;
  }

  async personIdOf(accountId) {
    const { rows: [r] } = await this.pool.query('select person_id from account where id=$1', [accountId]);
    return r?.person_id ?? null;
  }

  async feePayersOf(childId) {
    const { rows } = await this.pool.query(
      'select guardian_id, pays_fees from guardian_link where child_id=$1 and ended_on is null', [childId]);
    return { anySet: rows.some((r) => r.pays_fees), guardianIds: rows.filter((r) => r.pays_fees).map((r) => r.guardian_id) };
  }
}
