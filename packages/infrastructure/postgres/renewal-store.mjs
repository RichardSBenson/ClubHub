/** INFRASTRUCTURE — the RenewalStore port on Postgres. */

import { PostgresStore } from './store-base.mjs';

export class PostgresRenewalStore extends PostgresStore {
  /** `feeRows(clubId)` is supplied from outside: the price list is read the same way wherever it is needed. */
  constructor(pool, db = pool, { feeRows } = {}) { super(pool, db); this.feeRowsOf = feeRows; }

  atomically(work) { return super.atomically((tx) => { tx.feeRowsOf = this.feeRowsOf; return work(tx); }); }

  clubById(id) { return this.one('select * from organisation where id=$1', [id]); }

  async todayAt(organisation) { return (await this.one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [organisation.timezone])).d; }

  feeRows(clubId) { return this.feeRowsOf(clubId); }

  async endFeesBefore({ clubId, appliesTo, period, from }) {
    await this.db.query(`update fee_schedule set effective_to = ($4::date - 1)
      where organisation_id=$1 and applies_to=$2 and period=$3 and effective_from < $4::date and (effective_to is null or effective_to >= $4::date)`,
      [clubId, appliesTo, period, from]);
  }

  addFee({ clubId, label, cents, period, appliesTo, from, currency }) {
    return this.one(`insert into fee_schedule (organisation_id, label, amount_cents, period, applies_to, effective_from, currency)
      values ($1,$2,$3,$4,$5,$6::date,$7) returning id`, [clubId, label, cents, period, appliesTo, from, currency]);
  }

  removeFee(clubId, feeId) { return this.one('delete from fee_schedule where id=$1 and organisation_id=$2 returning label, amount_cents', [feeId, clubId]); }

  rosterRows(clubId, timezone) {
    return this.rows(`
      select a.id as affiliation_id, a.role, a.status, a.fee_exempt, a.fee_exempt_reason,
             a.paid_until::text as paid_until, p.id as person_id, p.display_number,
             nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
             case when p.date_of_birth is null then null
                  else date_part('year', age((now() at time zone $2)::date, p.date_of_birth))::int end as age,
             exists (select 1 from payment_line l join payment py on py.id = l.payment_id
                      where l.renews_affiliation_id = a.id and py.status in ('pending','awaiting','failed')) as asked,
             exists (select 1 from payment_agreement g where g.affiliation_id = a.id and g.status = 'active') as auto_renew,
             (select max(mr.sent_at)::date::text from message_recipient mr join message m on m.id = mr.message_id
               where m.kind = 'renewal' and mr.status = 'sent' and (mr.person_id = p.id or mr.about_id = p.id)) as last_reminded
      from affiliation a join person p on p.id = a.person_id
      where a.organisation_id = $1 and a.ends is null
        and a.role in ('member','instructor','assistant') and a.status in ('active','lapsed','pending','trial')
      order by p.last_name, p.first_name`, [clubId, timezone]);
  }

  async remindersEnabled(clubId) {
    return (await this.one(`select coalesce((settings->'reminders'->>'enabled')::boolean, false) as on from organisation where id=$1`, [clubId])).on;
  }

  async setReminders(clubId, enabled) {
    await this.db.query(`update organisation set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('reminders',
      coalesce(settings->'reminders','{}'::jsonb) || jsonb_build_object('enabled', $2::boolean)), updated_at = now() where id = $1`, [clubId, enabled]);
  }

  async requestRenewal({ clubId, personId, cents, currency, actorId, affiliationId, months, description }) {
    const pay = await this.one(`insert into payment (organisation_id, person_id, amount_cents, currency, status, requested_by) values ($1,$2,$3,$4,'pending',$5) returning id`,
      [clubId, personId, cents, currency, actorId]);
    await this.db.query(`insert into payment_line (payment_id, kind, description, amount_cents, renews_affiliation_id, renews_months) values ($1,'club_fee',$2,$3,$4,$5)`,
      [pay.id, description, cents, affiliationId, months]);
    return pay.id;
  }

  async setExemption({ clubId, affiliationId, exempt, reason }) {
    return (await this.one('update affiliation set fee_exempt=$3, fee_exempt_reason=$4 where id=$1 and organisation_id=$2 and ends is null returning person_id',
      [affiliationId, clubId, exempt, reason]))?.person_id ?? null;
  }

  async voidAskedFor(affiliationId) {
    await this.db.query(`update payment set status='void', updated_at=now() where status in ('pending','failed') and id in (select payment_id from payment_line where renews_affiliation_id = $1)`, [affiliationId]);
  }

  async personName(personId) { return (await this.one(`select nullif(trim(concat_ws(' ', first_name, last_name)), '') as name from person where id=$1`, [personId]))?.name ?? null; }

  affiliationOf(clubId, affiliationId) { return this.one('select a.id, a.person_id, a.fee_exempt from affiliation a where a.id=$1 and a.organisation_id=$2 and a.ends is null', [affiliationId, clubId]); }

  async audit({ actorId, organisationId, action, entity, entityId, after = null }) {
    await this.db.query('insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,$3,$4,$5,$6)',
      [actorId, organisationId, action, entity, entityId, after === null ? null : JSON.stringify(after)]);
  }
}
