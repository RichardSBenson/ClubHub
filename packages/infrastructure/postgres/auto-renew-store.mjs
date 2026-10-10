/** INFRASTRUCTURE — the AutoRenewStore port on Postgres. */

import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';
import { PostgresStore } from './store-base.mjs';

const AGREEMENT = `select g.id, g.organisation_id, g.affiliation_id, g.person_id, g.period, g.method, g.label, g.status, g.failures,
    g.next_attempt_on::text as next_attempt_on, g.last_error, g.agreed_at, o.name as club,
    a.paid_until::text as paid_until, a.fee_exempt,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as person_name
  from payment_agreement g join organisation o on o.id = g.organisation_id
  join affiliation a on a.id = g.affiliation_id join person p on p.id = g.person_id`;

export class PostgresAutoRenewStore extends PostgresStore {
  /** `feeRows(clubId)` is supplied from outside: the price list is read the same way wherever it is needed. */
  constructor(pool, db = pool, { feeRows } = {}) { super(pool, db); this.feeRowsOf = feeRows; }

  atomically(work) { return super.atomically((tx) => { tx.feeRowsOf = this.feeRowsOf; return work(tx); }); }

  feeRows(organisationId) { return this.feeRowsOf(organisationId); }

  personById(id) { return this.one('select id, first_name, last_name, date_of_birth::text as dob from person where id = $1', [id]); }

  async todayAtClub(organisationId) {
    const o = await this.one('select timezone from organisation where id=$1', [organisationId]);
    return (await this.one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [o?.timezone ?? DEFAULT_TIMEZONE])).d;
  }

  renewableMemberships(personId) {
    return this.rows(`select a.id as affiliation_id, a.organisation_id, o.name as club, a.paid_until::text as paid_until, a.fee_exempt
      from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.ends is null and a.role in ('member','instructor','assistant') and o.type = 'club' and a.status in ('active','lapsed') order by o.name`, [personId]);
  }

  liveAgreementsOf(personId) { return this.rows(`${AGREEMENT} where g.person_id = $1 and g.status <> 'cancelled'`, [personId]); }

  membershipForSetup(affiliationId, personId) {
    return this.one(`select a.id, a.organisation_id, a.fee_exempt, o.type from affiliation a join organisation o on o.id = a.organisation_id
      where a.id = $1 and a.person_id = $2 and a.ends is null and a.role in ('member','instructor','assistant')`, [affiliationId, personId]);
  }

  async hasLiveAgreement(affiliationId) { return !!await this.one(`select 1 x from payment_agreement where affiliation_id=$1 and status <> 'cancelled'`, [affiliationId]); }

  async addAgreement({ organisationId, affiliationId, personId, period, method, providerName, providerRef, label, actorId }) {
    return (await this.one(`insert into payment_agreement (organisation_id, affiliation_id, person_id, period, method, provider, provider_ref, label, agreed_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [organisationId, affiliationId, personId, period, method, providerName, providerRef, label, actorId])).id;
  }

  async cancelAgreement({ agreementId, personId, actorId }) {
    return (await this.one(`update payment_agreement set status='cancelled', cancelled_at=now(), cancelled_by=$3, next_attempt_on=null
      where id=$1 and person_id=$2 and status <> 'cancelled' returning organisation_id`, [agreementId, personId, actorId]))?.organisation_id ?? null;
  }

  agreementsOfClub(clubId) {
    return this.rows(`${AGREEMENT} where g.organisation_id = $1 and g.status <> 'cancelled' order by (g.status = 'paused') desc, (g.failures > 0) desc, p.last_name, p.first_name`, [clubId]);
  }

  activeAgreements() { return this.rows(`${AGREEMENT} where g.status = 'active' order by g.agreed_at`); }

  async waitingRenewalPayment(affiliationId) {
    return (await this.one(`select py.id from payment py join payment_line l on l.payment_id = py.id
      where l.renews_affiliation_id = $1 and py.status in ('pending','failed') order by py.created_at desc limit 1`, [affiliationId]))?.id ?? null;
  }

  async createRenewalPayment({ organisationId, personId, cents, currency, affiliationId, months, description }) {
    return this.atomically(async (tx) => {
      const p = await tx.one(`insert into payment (organisation_id, person_id, amount_cents, currency, status) values ($1,$2,$3,$4,'pending') returning id`, [organisationId, personId, cents, currency]);
      await tx.db.query(`insert into payment_line (payment_id, kind, description, amount_cents, renews_affiliation_id, renews_months) values ($1,'club_fee',$2,$3,$4,$5)`,
        [p.id, description, cents, affiliationId, months]);
      return p.id;
    });
  }

  async claimAttempt({ paymentId, method, providerName }) {
    return !!await this.one(`update payment set status='awaiting', method=$2, provider=$3, updated_at=now() where id=$1 and status in ('pending','failed') returning id`, [paymentId, method, providerName]);
  }

  async savedMethodOf(agreementId) { return (await this.one('select provider_ref from payment_agreement where id=$1', [agreementId])).provider_ref; }

  async noteProgress(paymentId, ref, detail) { await this.db.query('update payment set provider_ref=$2, detail=$3, updated_at=now() where id=$1', [paymentId, ref, detail]); }

  async chargeWorked(agreementId) { await this.db.query('update payment_agreement set failures=0, next_attempt_on=null, last_error=null where id=$1', [agreementId]); }

  async chargeFailed({ agreementId, failures, status, nextAttemptOn, error }) {
    await this.db.query('update payment_agreement set failures=$2, status=$3, next_attempt_on=$4, last_error=$5 where id=$1', [agreementId, failures, status, nextAttemptOn, error]);
  }
}
