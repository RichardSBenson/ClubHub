/** INFRASTRUCTURE — the TermStore port on Postgres. */

import { PostgresStore } from './store-base.mjs';

const TERM = `st.id, st.organisation_id, st.year, st.number, st.name, to_char(st.starts,'YYYY-MM-DD') as starts, to_char(st.ends,'YYYY-MM-DD') as ends, st.source`;

export class PostgresTermStore extends PostgresStore {
  /** `feeScheduleFor(clubId)` is supplied from outside: the fee rules live with billing. */
  constructor(pool, db = pool, { feeScheduleFor } = {}) { super(pool, db); this.feeScheduleFor = feeScheduleFor; }

  atomically(work) {
    return super.atomically((tx) => { tx.feeScheduleFor = this.feeScheduleFor; return work(tx); });
  }

  organisationById(id) { return this.one('select * from organisation where id=$1', [id]); }

  async countryOf(organisationId) {
    return (await this.one(`select o.country_code from organisation me join organisation o on me.path <@ o.path
      where me.id = $1 and o.country_code is not null order by nlevel(o.path) desc limit 1`, [organisationId]))?.country_code ?? null;
  }

  async todayAt(organisation) {
    return (await this.one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [organisation.timezone])).d;
  }

  termsOf(organisationId) {
    return this.rows(`select id, to_char(starts,'YYYY-MM-DD') as starts, to_char(ends,'YYYY-MM-DD') as ends from school_term where organisation_id = $1`, [organisationId]);
  }

  async hasTermsIn(organisationId, year) { return !!await this.one('select 1 as x from school_term where organisation_id = $1 and year = $2', [organisationId, year]); }

  async addTerm({ organisationId, year, number, name, starts, ends, source = null }) {
    await this.db.query(`insert into school_term (organisation_id, year, number, name, starts, ends, source) values ($1,$2,$3,$4,$5,$6,coalesce($7,'manual'))`,
      [organisationId, year, number, name, starts, ends, source]);
  }

  async nextTermNumber(organisationId, year) {
    return (await this.one('select coalesce(max(number),0)+1 as n from school_term where organisation_id=$1 and year=$2', [organisationId, year])).n;
  }

  updateTerm({ id, organisationId, name, starts, ends, year }) {
    return this.one(`update school_term set name=$3, starts=$4, ends=$5, year=$6, source='manual' where id=$1 and organisation_id=$2 returning id`,
      [id, organisationId, name, starts, ends, year]);
  }

  async enrolledCount(termId) { return (await this.one(`select count(*)::int as n from term_enrolment where term_id = $1 and status = 'enrolled'`, [termId])).n; }
  removeTerm(organisationId, termId) { return this.one('delete from school_term where id = $1 and organisation_id = $2 returning id', [termId, organisationId]); }

  async setMidTermRule(organisationId, rule) {
    await this.db.query(`update organisation set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('terms',
      coalesce(settings->'terms','{}'::jsonb) || jsonb_build_object('midTerm', $2::jsonb)), updated_at = now() where id = $1`, [organisationId, JSON.stringify(rule)]);
  }

  async effectiveTerms(organisationId, year) {
    const rows = await this.rows(`select ${TERM}, o.name as owner, nlevel(o.path) as depth /* security-ok: TERM is a fixed column list defined at module level */
      from school_term st join organisation o on o.id = st.organisation_id
      join organisation me on me.id = $1 and me.path <@ o.path
      where st.year = $2 order by nlevel(o.path) desc, st.number`, [organisationId, year]);
    if (!rows.length) return { terms: [], owner: null };
    const top = rows[0].organisation_id;
    const terms = rows.filter((r) => r.organisation_id === top);
    return { terms, owner: { id: top, name: terms[0].owner }, inherited: top !== organisationId };
  }

  memberClubOf(personId) {
    return this.one(`select o.* from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.role = 'member' and a.status in ('active') and a.ends is null limit 1`, [personId]);
  }

  personById(id) {
    return this.one(`select p.id, p.display_number, p.first_name, p.last_name, p.preferred_name, p.date_of_birth::text as date_of_birth, p.gender, p.email, p.phone from person p where p.id = $1`, [id]);
  }

  async trainingWeekdays(clubId, age) {
    const sessions = await this.rows('select weekday, min_age, max_age from training_session where organisation_id = $1', [clubId]);
    return [...new Set(sessions.filter((s) => (s.min_age == null || age >= s.min_age) && (s.max_age == null || age <= s.max_age)).map((s) => s.weekday))];
  }

  feeSchedule(clubId) { return this.feeScheduleFor(clubId); }

  enrolmentOf(termId, personId) { return this.one('select id, status, paid, fee_cents, price_note from term_enrolment where term_id = $1 and person_id = $2', [termId, personId]); }

  enrol({ termId, personId, clubId, cents, note, today, by }) {
    return this.one(`insert into term_enrolment (term_id, person_id, organisation_id, status, fee_cents, price_note, paid, enrolled_on, enrolled_by)
      values ($1,$2,$3,'enrolled',$4,$5,$6,$7::date,$8)
      on conflict (term_id, person_id) do update set status='enrolled', fee_cents=$4, price_note=$5, paid=$6, enrolled_on=$7::date, enrolled_by=$8 returning id`,
      [termId, personId, clubId, cents, note, cents === 0, today, by]);
  }

  async requestPayment({ clubId, personId, cents, currency, by, description, enrolmentId }) {
    const pay = await this.one(`insert into payment (organisation_id, person_id, amount_cents, currency, status, requested_by) values ($1,$2,$3,$4,'pending',$5) returning id`,
      [clubId, personId, cents, currency, by]);
    await this.db.query(`insert into payment_line (payment_id, kind, description, amount_cents, term_enrolment_id) values ($1,'club_fee',$2,$3,$4)`, [pay.id, description, cents, enrolmentId]);
    return pay.id;
  }

  enrolmentToWithdraw(termId, personId) {
    return this.one(`select e.id, e.paid, e.organisation_id, to_char(st.starts,'YYYY-MM-DD') as starts, o.timezone from term_enrolment e
      join school_term st on st.id = e.term_id join organisation o on o.id = e.organisation_id
      where e.term_id = $1 and e.person_id = $2 and e.status = 'enrolled'`, [termId, personId]);
  }

  async voidUnpaidFor(enrolmentId) {
    await this.db.query(`update payment set status='void', updated_at=now() where status in ('pending','failed') and id in (select payment_id from payment_line where term_enrolment_id = $1)`, [enrolmentId]);
  }

  async markWithdrawn(enrolmentId) { await this.db.query(`update term_enrolment set status='withdrawn' where id=$1`, [enrolmentId]); }

  async audit({ actorId, organisationId, action, entity, entityId, after }) {
    await this.db.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,$3,$4,$5,$6)`,
      [actorId, organisationId, action, entity, entityId, JSON.stringify(after)]);
  }

  // --- the daily run -------------------------------------------------------

  federationsForCalendars() {
    return this.rows(`select id, name, country_code, settings, timezone from organisation where parent_id is null and status = 'active' and country_code is not null`);
  }

  async loadedYears(organisationId) { return (await this.rows('select distinct year from school_term where organisation_id = $1', [organisationId])).map((x) => x.year); }

  activeClubs() { return this.rows(`select * from organisation where type = 'club' and status = 'active'`); }


  async offerMade(termId, clubId) { return !!await this.one('select 1 as x from term_offer where term_id = $1 and organisation_id = $2', [termId, clubId]); }

  async familiesToOffer({ previousTermId, nextTermId, clubId }) {
    const kids = await this.rows(`select p.first_name, p.email::text as email,
        coalesce((select json_agg(g.email::text) from guardian_link gl join person g on g.id = gl.guardian_id where gl.child_id = p.id and gl.ended_on is null and g.email is not null and (gl.is_main_contact or gl.also_copy or not exists (select 1 from guardian_link m where m.child_id = p.id and m.ended_on is null and m.is_main_contact))), '[]'::json) as guardians
      from term_enrolment e join person p on p.id = e.person_id
      where e.term_id = $1 and e.organisation_id = $2 and e.status = 'enrolled'
        and not exists (select 1 from term_enrolment n where n.term_id = $3 and n.person_id = p.id)
        and exists (select 1 from affiliation a where a.person_id = p.id and a.organisation_id = $2 and a.status = 'active' and a.ends is null)`,
      [previousTermId, clubId, nextTermId]);
    return kids.map((k) => ({ firstName: k.first_name, email: k.email, guardians: k.guardians }));
  }

  async recordOffer(termId, clubId) { await this.db.query('insert into term_offer (term_id, organisation_id) values ($1,$2) on conflict do nothing', [termId, clubId]); }
}
