/** INFRASTRUCTURE — the PaymentLedger port on Postgres. */

import { PostgresStore } from './store-base.mjs';

const PAYMENT_SELECT = `
  select py.id, py.organisation_id, py.person_id, py.amount_cents, py.currency, py.status,
         py.method, py.detail, py.provider, py.provider_ref, py.created_at, py.settled_at, py.receipt_no, py.taken_by,
         po.name as payee_name,
         nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as person_name,
         p.display_number,
         (select coalesce(json_agg(json_build_object('kind', l.kind, 'description', l.description,
                          'amount_cents', l.amount_cents) order by l.id), '[]'::json)
            from payment_line l where l.payment_id = py.id) as lines
  from payment py
  join organisation po on po.id = py.organisation_id
  left join person p on p.id = py.person_id`;

export class PostgresPaymentLedger extends PostgresStore {
  paymentsFor(personId) {
    return this.rows(`${PAYMENT_SELECT} where py.person_id = $1 and py.status <> 'void'
      order by (py.status in ('pending','failed','awaiting')) desc, py.created_at desc`, [personId]);
  }

  owedFor(personIds) {
    return this.rows(`${PAYMENT_SELECT} where py.person_id = any($1::uuid[]) and py.status in ('pending','failed','awaiting') order by py.created_at`, [personIds]);
  }

  paymentById(id) { return this.one(`${PAYMENT_SELECT} where py.id = $1`, [id]); }

  async receivedBy(organisationId, limit) {
    const rows = await this.rows(`${PAYMENT_SELECT} where py.organisation_id = $1 and py.status <> 'void' order by py.created_at desc limit $2`, [organisationId, limit]);
    const totals = await this.rows(`
      select l.kind, py.status, count(*)::int as n, sum(l.amount_cents)::int as cents
      from payment py join payment_line l on l.payment_id = py.id
      where py.organisation_id = $1 and py.status in ('succeeded','pending','awaiting')
      group by l.kind, py.status`, [organisationId]);
    const methods = await this.rows(`select py.method, sum(py.amount_cents)::int as cents
      from payment py where py.organisation_id = $1 and py.status = 'succeeded' and py.method is not null
      group by py.method order by cents desc`, [organisationId]);
    return { rows, totals, methods };
  }

  async claim({ paymentId, method, actorId, providerName }) {
    return !!await this.one(`update payment set status='awaiting', method=$2, paid_by=$3, provider=$4, updated_at=now()
      where id=$1 and status in ('pending','failed') returning id`, [paymentId, method, actorId, providerName]);
  }

  async noteProgress(paymentId, ref, detail) { await this.db.query('update payment set provider_ref=$2, detail=$3, updated_at=now() where id=$1', [paymentId, ref, detail]); }

  settle({ paymentId, ok, detail, ref, manual }) {
    return this.one(`
      update payment set status = $2, detail = $3, updated_at = now(),
             settled_at = case when $2 = 'succeeded' then now() else settled_at end,
             provider_ref = coalesce($4, provider_ref),
             method = coalesce($5, method), taken_by = coalesce($6, taken_by),
             receipt_no = coalesce($7, receipt_no), provider = coalesce($8, provider)
       where id = $1 and status in ('awaiting','pending','failed')
       returning organisation_id, person_id, amount_cents, receipt_no`,
      [paymentId, ok ? 'succeeded' : 'failed', detail, ref ?? null, manual?.method ?? null, manual ? manual.actorId : null, manual?.receiptNo ?? null, manual ? 'manual' : null]);
  }

  async markFulfilled(paymentId) {
    await this.db.query('update event_entry set paid = true, updated_at = now() where id in (select event_entry_id from payment_line where payment_id = $1)', [paymentId]);
    await this.db.query('update term_enrolment set paid = true where id in (select term_enrolment_id from payment_line where payment_id = $1 and term_enrolment_id is not null)', [paymentId]);
    return this.rows('select renews_affiliation_id as id, renews_months as months from payment_line where payment_id = $1 and renews_affiliation_id is not null', [paymentId]);
  }

  affiliationForRenewal(id) {
    return this.one(`select a.id, a.paid_until::text as paid_until, a.status, to_char((now() at time zone o.timezone)::date, 'YYYY-MM-DD') as today
      from affiliation a join organisation o on o.id = a.organisation_id where a.id = $1`, [id]);
  }

  async extendMembership(id, until) {
    await this.db.query(`update affiliation set paid_until = $2::date, status = case when status in ('lapsed','trial') then 'active' else status end where id = $1`, [id, until]);
  }

  personAndClubOf(affiliationId) { return this.one('select person_id, organisation_id from affiliation where id = $1', [affiliationId]); }

  async numberOf(personId) { return (await this.one('select display_number from person where id = $1 for update', [personId]))?.display_number ?? null; }
  async setNumber(personId, number) { await this.db.query('update person set display_number = $2 where id = $1', [personId, number]); }

  async federationShortNameFor(organisationId) {
    return (await this.one(`select coalesce(f.short_name, f.slug) as prefix from organisation target
      join organisation f on target.path <@ f.path and f.parent_id is null where target.id = $1`, [organisationId]))?.prefix ?? null;
  }

  async lastNumberIn(prefix) {
    return (await this.one(`select coalesce(max(substring(display_number from '[0-9]+$')::int), 0) as last from person where display_number like $1`, [`${prefix}-%`])).last;
  }

  async convertTrial(personId, organisationId) {
    await this.db.query(`update member_trial set status = 'converted', converted_at = now() where person_id = $1 and organisation_id = $2 and status <> 'converted'`, [personId, organisationId]);
  }

  async promoteReferral(personId) { await this.db.query(`update referral set status = 'member', converted_at = now() where referred_id = $1 and status = 'trial'`, [personId]); }

  async referralAwaitingReward(personId) { return (await this.one(`select id from referral where referred_id = $1 and status = 'member'`, [personId]))?.id ?? null; }

  async nextReceipt(organisationId) {
    const r = await this.one(`
      insert into receipt_counter (organisation_id, year, last_number) values ($1, extract(year from now())::int, 1)
      on conflict (organisation_id, year) do update set last_number = receipt_counter.last_number + 1
      returning year, last_number`, [organisationId]);
    return { year: r.year, number: r.last_number };
  }

  async voidUnpaid(organisationId, paymentId) {
    return !!await this.one(`update payment set status='void', updated_at=now() where id=$1 and organisation_id=$2 and status in ('pending','failed') returning id`, [paymentId, organisationId]);
  }

  organisationById(id) { return this.one('select * from organisation where id=$1', [id]); }
  personByNumber(number) { return this.one('select id, first_name, last_name from person where upper(display_number) = upper($1)', [number]); }

  clubHomeOf(personId, path) {
    return this.one(`select o.id from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.ends is null and a.status = 'active' and o.type = 'club' and o.path <@ $2::ltree order by a.starts limit 1`, [personId, path]);
  }

  federationAbove(path) { return this.one('select id from organisation where parent_id is null and $1::ltree <@ path', [path]); }

  async createRequest({ payeeId, personId, amountCents, currency, actorId, kind, description }) {
    const pay = await this.one(`insert into payment (organisation_id, person_id, amount_cents, currency, status, requested_by) values ($1,$2,$3,$5,'pending',$4) returning *`,
      [payeeId, personId, amountCents, actorId, currency]);
    await this.db.query('insert into payment_line (payment_id, kind, description, amount_cents) values ($1,$2,$3,$4)', [pay.id, kind, description, amountCents]);
    return pay;
  }

  async audit({ actorId, organisationId, action, entityId, after = null }) {
    await this.db.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after) values ($1,$2,$3,'payment',$4,null,$5)`,
      [actorId, organisationId, action, entityId, after === null ? null : JSON.stringify(after)]);
  }
}
