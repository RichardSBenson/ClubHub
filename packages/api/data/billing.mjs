/**
 * HONBU — data access: billing
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { region, words } from '../../infrastructure/region-context.mjs';
const clubWord = () => words().club.toLowerCase();
import { isTestProvider } from '../../infrastructure/payments/providers.mjs';
import { dueForReminder, reminderText, PERIODS, standing, feeFor, problemsWithFee, problemsWithExemption, whyNotMethod } from '../../core/domain/membership.mjs';
import { centsFrom } from '../../core/domain/payments.mjs';
import { chargeDue, afterFailure, problemsWithSetup, cardLabel, METHODS as AUTO_METHODS, PERIOD_CHOICES, CHARGE_LEAD_DAYS, MAX_FAILURES } from '../../core/domain/autorenew.mjs';
import { readBasket, readNote, mayMoveOrder, ORDER_STATUSES } from '../../core/domain/shop.mjs';
import { SettlePayment, ListPaymentsFor, ListOwed, ViewPayment, PayPayment, CompleteTestPayment, PaymentsReceived, RecordManualPayment, RequestPayment, CancelPaymentRequest, renewMembership } from '../../core/application/payments.mjs';
import { PostgresPaymentLedger } from '../../infrastructure/postgres/payment-ledger.mjs';
import { PostgresAuthorisation } from '../../infrastructure/postgres/repositories.mjs';
import { MANAGE, REGISTER } from '../../core/domain/access.mjs';
import { messages, push, webhooks } from './messaging.mjs';
import { family } from './people.mjs';
import { speakingForThisLayer, Invalid, NotFound, assertRole, clubOnly, feeRows, one, q, qualToday } from './shared.mjs';
import { referrals } from './visitors.mjs';

export const billing = {
  /**
   * Build the affiliation invoice a parent sends a child organisation.
   * Every line names a person, so both sides can audit it.
   */
  async draftAffiliationInvoice(actor, { fromOrg, toOrg, periodStart, periodEnd,
                                         unitCents, currency = region().currency }) {
    await assertRole(actor, fromOrg, MANAGE);

    const members = await q(`
      select p.id, p.display_number, p.first_name, p.last_name
      from affiliation a join person p on p.id = a.person_id
      where a.organisation_id = $1 and a.role = 'member'
        and a.status = 'active' and a.ends is null
      order by p.last_name`, [toOrg]);

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [inv] } = await client.query(`
        insert into invoice (from_org, to_org, period_start, period_end, currency,
                             subtotal_cents, status)
        values ($1,$2,$3,$4,$5,$6,'draft') returning *`,
        [fromOrg, toOrg, periodStart, periodEnd, currency,
         members.length * unitCents]);

      for (const m of members) {
        await client.query(`
          insert into invoice_line (invoice_id, person_id, description, quantity, unit_cents)
          values ($1,$2,$3,1,$4)`,
          [inv.id, m.id,
           `${m.first_name} ${m.last_name} (${m.display_number ?? 'no number'})`,
           unitCents]);
      }
      await client.query('commit');
      return { invoice: inv, lines: members.length };
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }
  },
};

// ---------------------------------------------------------------------------
// payments
//
// A payment has one payee, decided by what it is for (core/domain/payments).
// It is made by the person it is for, or by a parent or guardian of a minor.
// A club sees what it has been paid; it does not see another club's.
// ---------------------------------------------------------------------------

const ledger = new PostgresPaymentLedger(pool);
const paymentDeps = {
  ledger, auth: new PostgresAuthorisation(pool),
  mayPayFor: (actor, personId) => family.mayPayFor(actor, personId),
  peopleOf: async (actor) => { const { self, dependants } = await family.mine(actor); return [self, ...dependants].filter(Boolean); },
  announce: (orgId, event, data) => webhooks.emitNow(orgId, event, data),
  afterMemberJoined: async (personId) => { const id = await ledger.referralAwaitingReward(personId); if (id) await referrals.qualify(id); },
  currency: () => region().currency, clubWord, isTestProvider,
};
const settlePayment = new SettlePayment(paymentDeps);
const settle = (paymentId, ok, detail, { actor = null, ref = undefined, manual = null } = {}) =>
  settlePayment.execute({ paymentId, ok, detail, actorId: actor, ref, manual });
const settling = { ...paymentDeps, settle: (x) => settlePayment.execute(x) };
const recordManualPayment = new RecordManualPayment(settling);
const viewPayment = new ViewPayment(paymentDeps);
const listPaymentsFor = new ListPaymentsFor(paymentDeps);
const listOwed = new ListOwed(paymentDeps);
const payPayment = new PayPayment(settling);
const completeTestPayment = new CompleteTestPayment(settling);
const paymentsReceived = new PaymentsReceived(paymentDeps);
const requestPayment = new RequestPayment({ ...paymentDeps, recordManual: (x) => recordManualPayment.execute(x) });
const cancelPaymentRequest = new CancelPaymentRequest(paymentDeps);

/** Carry a membership on without a payment (see renewals.carryOn). */
const renewMembershipNow = async (affiliationId, months) => {
  const r = await ledger.atomically((tx) => renewMembership(tx, affiliationId, months));
  if (r?.becameMember) await paymentDeps.afterMemberJoined(r.becameMember).catch(() => {});
  return r?.until ?? null;
};

export const payments = {
  /** What one person owes and has paid. Authority is theirs or their guardian's. */
  forPerson: (actor, personId) => speakingForThisLayer(() => listPaymentsFor.execute({ actorId: actor, personId })),
  /** Everything the signed-in person and their children owe, for the home screen. */
  owedBy: (actor) => speakingForThisLayer(() => listOwed.execute({ actorId: actor })),
  get: (actor, paymentId) => speakingForThisLayer(() => viewPayment.execute({ actorId: actor, paymentId })),
  pay: (actor, paymentId, input, { provider }) => speakingForThisLayer(() => payPayment.execute({ actorId: actor, paymentId, input, provider })),
  /** Test provider only: stands in for the bank telling us the money arrived. */
  completeTest: (actor, paymentId, ok, { provider }) => speakingForThisLayer(() => completeTestPayment.execute({ actorId: actor, paymentId, ok, provider })),
  /** What this organisation has been paid, and what is owed to it. */
  receivedBy: (actor, orgId, { limit = 100 } = {}) => speakingForThisLayer(() => paymentsReceived.execute({ actorId: actor, organisationId: orgId, limit })),
  request: (actor, orgId, input) => speakingForThisLayer(() => requestPayment.execute({ actorId: actor, organisationId: orgId, input })),
  recordManual: (actor, paymentId, method) => speakingForThisLayer(() => recordManualPayment.execute({ actorId: actor, paymentId, method })),
  cancel: (actor, orgId, paymentId) => speakingForThisLayer(() => cancelPaymentRequest.execute({ actorId: actor, organisationId: orgId, paymentId })),
};

export const fees = {
  /** Anybody who runs renewals may see the prices; setting them is for administrators. */
  async list(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    await clubOnly(orgId);
    return feeRows(orgId);
  },

  async save(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    const org = await clubOnly(orgId);
    const problems = problemsWithFee(input, centsFrom);
    if (problems.length) throw new Invalid(problems.join(' '));
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [org.timezone])).d;
    const from = input.effectiveFrom || today;
    // A new price for the same people and period replaces the old one from its
    // start date; the old one stops the day before, so there is never an
    // ambiguity about which applies.
    await pool.query(`update fee_schedule set effective_to = ($4::date - 1)
      where organisation_id=$1 and applies_to=$2 and period=$3
        and effective_from < $4::date and (effective_to is null or effective_to >= $4::date)`,
      [orgId, input.appliesTo, input.period, from]);
    const row = await one(`insert into fee_schedule (organisation_id, label, amount_cents, period,
        applies_to, effective_from, currency) values ($1,$2,$3,$4,$5,$6::date,$7) returning id`,
      [orgId, input.label, centsFrom(input.amountText), input.period, input.appliesTo, from, region().currency]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'fee_set','fee_schedule',$3,$4)`, [actor, orgId, row.id,
      JSON.stringify({ label: input.label, amountCents: centsFrom(input.amountText), period: input.period,
        appliesTo: input.appliesTo })]);
    return row;
  },

  async remove(actor, orgId, feeId) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one(`delete from fee_schedule where id=$1 and organisation_id=$2
      returning label, amount_cents`, [feeId, orgId]);
    if (!row) throw new NotFound('Price');
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, after)
      values ($1,$2,'fee_removed','fee_schedule',$3)`, [actor, orgId,
      JSON.stringify({ label: row.label, amountCents: row.amount_cents })]);
  },
};

async function rosterFor(orgId) {
  const org = await clubOnly(orgId);
    const rows = await q(`
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
      order by p.last_name, p.first_name`, [orgId, org.timezone]);
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [org.timezone])).d;
    return { today, rows: rows.map((r) => ({ ...r, standing: r.status === 'trial' ? 'trial' : standing({ paidUntil: r.paid_until, exempt: r.fee_exempt }, today) })) };
}

export const renewals = {
  /** Everybody at the club, and where their fees stand. */
  async roster(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    return rosterFor(orgId);
  },

  /** Write to the ticked members about their fees, as the club. */
  async remind(actor, orgId, { affiliationIds, subject, body }, { baseFrom }) {
    await assertRole(actor, orgId, REGISTER);
    const { rows } = await rosterFor(orgId);
    const people = rows.filter((r) => affiliationIds.includes(r.affiliation_id) && !r.fee_exempt)
      .map((r) => r.person_id);
    if (!people.length) throw new Invalid('Tick the people to remind. Anybody who is not charged is left out.');
    return messages.prepare(actor, orgId, { audience: 'selected', kind: 'renewal', personIds: people,
      subject: String(subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 150),
      body: String(body ?? '').trim().slice(0, 10_000), eventId: null, personNumber: null },
      { baseFrom, trusted: true });
  },

  /** Whether this club writes its own reminders automatically. */
  async reminderSetting(orgId) {
    return (await one(`select coalesce((settings->'reminders'->>'enabled')::boolean, false) as on
      from organisation where id=$1`, [orgId])).on;
  },

  async setReminders(actor, orgId, enabled) {
    await assertRole(actor, orgId, MANAGE);
    await clubOnly(orgId);
    await pool.query(`update organisation set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('reminders',
      coalesce(settings->'reminders','{}'::jsonb) || jsonb_build_object('enabled', $2::boolean)), updated_at = now() where id = $1`, [orgId, !!enabled]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'reminders_setting','organisation',$2,$3)`, [actor, orgId, JSON.stringify({ enabled: !!enabled })]);
  },

  /**
   * Ask a set of members to renew, at the club's own price for each. Nothing is
   * charged by asking. Returns who was asked and who was not, and why.
   */
  async ask(actor, orgId, { affiliationIds, period, received = null }) {
    await assertRole(actor, orgId, REGISTER);
    await clubOnly(orgId);
    if (!PERIODS[period] || !PERIODS[period].months) throw new Invalid('Choose how long to renew for.');
    if (!affiliationIds?.length) throw new Invalid('Tick the people to ask.');
    if (received && whyNotMethod(received)) throw new Invalid(whyNotMethod(received));

    const { today, rows } = await renewals.roster(actor, orgId);
    const schedule = await feeRows(orgId);
    const chosen = rows.filter((r) => affiliationIds.includes(r.affiliation_id));
    let asked = 0; const skipped = [];
    for (const r of chosen) {
      if (r.fee_exempt) { skipped.push({ name: r.name, reason: 'not charged' }); continue; }
      if (r.asked) { skipped.push({ name: r.name, reason: 'already asked' }); continue; }
      const fee = feeFor(schedule, { adultAge: region().adultAge, ageYears: r.age, period, today });
      if (!fee) { skipped.push({ name: r.name, reason: `no ${r.age != null && r.age < region().adultAge ? 'junior' : 'adult'} price for “${PERIODS[period].label.toLowerCase()}”` }); continue; }
      const client = await pool.connect();
      try {
        await client.query('begin');
        const { rows: [pay] } = await client.query(`insert into payment (organisation_id, person_id,
            amount_cents, currency, status, requested_by) values ($1,$2,$3,$4,'pending',$5) returning id`,
          [orgId, r.person_id, fee.amount_cents, fee.currency ?? region().currency, actor]);
        await client.query(`insert into payment_line (payment_id, kind, description, amount_cents,
            renews_affiliation_id, renews_months) values ($1,'club_fee',$2,$3,$4,$5)`,
          [pay.id, `${fee.label} — membership ${PERIODS[period].label.toLowerCase()}`, fee.amount_cents,
           r.affiliation_id, PERIODS[period].months]);
        await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
          values ($1,$2,'payment_requested','payment',$3,$4)`, [actor, orgId, pay.id,
          JSON.stringify({ kind: 'club_fee', amountCents: fee.amount_cents, person: r.name,
            description: `${fee.label} renewal` })]);
        await client.query('commit'); asked++;
        if (received) await payments.recordManual(actor, pay.id, received);
      } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    }
    return { asked, skipped };
  },

  /** The club decides somebody does not pay — and says why. */
  async setExemption(actor, orgId, affiliationId, input) {
    await assertRole(actor, orgId, MANAGE);
    await clubOnly(orgId);
    const problems = problemsWithExemption(input);
    if (problems.length) throw new Invalid(problems.join(' '));
    const row = await one(`update affiliation set fee_exempt=$3, fee_exempt_reason=$4
      where id=$1 and organisation_id=$2 and ends is null returning person_id`,
      [affiliationId, orgId, input.exempt, input.exempt ? input.reason : null]);
    if (!row) throw new NotFound('Member');
    // Anything already asked of them is withdrawn: they were never to be asked.
    if (input.exempt) await pool.query(`update payment set status='void', updated_at=now()
      where status in ('pending','failed') and id in
        (select payment_id from payment_line where renews_affiliation_id = $1)`, [affiliationId]);
    const who = await one(`select nullif(trim(concat_ws(' ', first_name, last_name)), '') as name
      from person where id=$1`, [row.person_id]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'fee_exemption','person',$3,$4)`, [actor, orgId, row.person_id,
      JSON.stringify({ exempt: input.exempt, reason: input.reason || null, person: who?.name })]);
  },

  /** An exempt member's membership carried on a year, with no payment. */
  async carryOn(actor, orgId, affiliationId) {
    await assertRole(actor, orgId, REGISTER);
    await clubOnly(orgId);
    const a = await one(`select a.id, a.person_id, a.fee_exempt from affiliation a
      where a.id=$1 and a.organisation_id=$2 and a.ends is null`, [affiliationId, orgId]);
    if (!a) throw new NotFound('Member');
    if (!a.fee_exempt) throw new Invalid('Only somebody who is not charged can be renewed without paying.');
    const until = await renewMembershipNow(affiliationId, 12);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'membership_carried_on','person',$3,$4)`, [actor, orgId, a.person_id,
      JSON.stringify({ paidUntil: until })]);
    return until;
  },
};

const AGREEMENT_SELECT = `select g.id, g.organisation_id, g.affiliation_id, g.person_id, g.period, g.method, g.label, g.status, g.failures,
    g.next_attempt_on::text as next_attempt_on, g.last_error, g.agreed_at, o.name as club,
    a.paid_until::text as paid_until, a.fee_exempt,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as person_name
  from payment_agreement g join organisation o on o.id = g.organisation_id
  join affiliation a on a.id = g.affiliation_id join person p on p.id = g.person_id`;

export const autoRenew = {
  AUTO_METHODS, PERIOD_CHOICES, CHARGE_LEAD_DAYS, MAX_FAILURES,

  /** Where this person stands: each club membership, whether it renews itself, and what it would cost. */
  async forPerson(actor, personId) {
    await family.assertMayActFor(actor, personId);
    const mem = await q(`select a.id as affiliation_id, a.organisation_id, o.name as club, a.paid_until::text as paid_until, a.fee_exempt
      from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.ends is null and a.role in ('member','instructor','assistant') and o.type = 'club'
        and a.status in ('active','lapsed') order by o.name`, [personId]);
    const live = await q(`${AGREEMENT_SELECT} where g.person_id = $1 and g.status <> 'cancelled'`, [personId]);
    const person = await one(`select id, first_name, last_name, date_of_birth::text as dob from person where id = $1`, [personId]);
    const out = [];
    for (const m of mem) {
      const today = await qualToday(m.organisation_id);
      const age = person.dob ? Math.floor((Date.parse(today) - Date.parse(person.dob)) / 31_557_600_000) : null;
      const schedule = await feeRows(m.organisation_id);
      const prices = Object.fromEntries(PERIOD_CHOICES.map((pd) => [pd, feeFor(schedule, { adultAge: region().adultAge, ageYears: age, period: pd, today })]).filter(([, f]) => f));
      out.push({ ...m, agreement: live.find((g) => g.affiliation_id === m.affiliation_id) ?? null, prices });
    }
    return { person, memberships: out };
  },

  /** The person (or their parent) agrees to automatic renewal and gives a method. Only a token is kept. */
  async start(actor, personId, affiliationId, input, { provider }) {
    await family.assertMayActFor(actor, personId);
    const problems = problemsWithSetup({ method: input.method, period: input.period, agreed: input.agreed });
    if (problems.length) throw new Invalid(problems.join(' '));
    const a = await one(`select a.id, a.organisation_id, a.fee_exempt, o.type from affiliation a join organisation o on o.id = a.organisation_id
      where a.id = $1 and a.person_id = $2 and a.ends is null and a.role in ('member','instructor','assistant')`, [affiliationId, personId]);
    if (!a || a.type !== 'club') throw new NotFound('Membership');
    if (a.fee_exempt) throw new Invalid('You are not charged here, so there is nothing to renew.');
    const today = await qualToday(a.organisation_id);
    const person = await one('select date_of_birth::text as dob from person where id=$1', [personId]);
    const age = person.dob ? Math.floor((Date.parse(today) - Date.parse(person.dob)) / 31_557_600_000) : null;
    if (!feeFor(await feeRows(a.organisation_id), { adultAge: region().adultAge, ageYears: age, period: input.period, today }))
      throw new Invalid(`The ${clubWord()} has not set a price for that yet. Choose another, or ask the ${clubWord()}.`);
    if (await one(`select 1 x from payment_agreement where affiliation_id=$1 and status <> 'cancelled'`, [affiliationId]))
      throw new Invalid('Automatic renewal is already set up. Stop it first to change it.');
    let saved;
    try { saved = await provider.saveMethod({ method: input.method, card: input.card }); }
    catch { throw new Invalid('We could not reach the payment provider. Nothing was saved — try again.'); }
    if (saved.status !== 'saved') throw new Invalid(saved.detail || 'That payment method was not accepted.');
    const row = await one(`insert into payment_agreement (organisation_id, affiliation_id, person_id, period, method, provider, provider_ref, label, agreed_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [a.organisation_id, affiliationId, personId, input.period, input.method, provider.name, saved.ref,
       input.method === 'card' ? cardLabel(input.card) : 'Bank direct debit', actor]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'auto_renew_start','person',$3,$4)`,
      [actor, a.organisation_id, personId, JSON.stringify({ period: input.period, method: input.method })]);
    return row.id;
  },

  /** One press. After it, nothing more is charged. */
  async cancel(actor, personId, agreementId) {
    await family.assertMayActFor(actor, personId);
    const g = await one(`update payment_agreement set status='cancelled', cancelled_at=now(), cancelled_by=$3, next_attempt_on=null
      where id=$1 and person_id=$2 and status <> 'cancelled' returning organisation_id`, [agreementId, personId, actor]);
    if (!g) throw new NotFound('Automatic renewal');
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'auto_renew_stop','person',$3,'{}')`,
      [actor, g.organisation_id, personId]);
  },

  /** A club's view: who renews themselves, who is failing. */
  async forClub(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    await clubOnly(orgId);
    return q(`${AGREEMENT_SELECT} where g.organisation_id = $1 and g.status <> 'cancelled'
      order by (g.status = 'paused') desc, (g.failures > 0) desc, p.last_name, p.first_name`, [orgId]);
  },

  /**
   * The daily run. For each agreement whose membership is about to run out: ask for the club's price, charge the saved
   * method, and let the ordinary payment path extend the membership. Safe to run twice: the payment is claimed before
   * the provider is asked, and a second run finds the membership already extended or an attempt already waiting.
   */
  async run({ provider, messenger = null, origin = '', baseFrom = '', budgetMs = 9000 }) {
    const started = Date.now();
    const rows = await q(`${AGREEMENT_SELECT} where g.status = 'active' order by g.agreed_at`);
    const report = { charged: 0, failed: 0, paused: 0, skipped: 0 };
    for (const g of rows) {
      if (Date.now() - started > budgetMs) break;
      const today = await qualToday(g.organisation_id);
      if (!chargeDue({ status: g.status, nextAttemptOn: g.next_attempt_on, paidUntil: g.paid_until, exempt: g.fee_exempt }, today)) { report.skipped++; continue; }
      const person = await one('select date_of_birth::text as dob from person where id=$1', [g.person_id]);
      const age = person.dob ? Math.floor((Date.parse(today) - Date.parse(person.dob)) / 31_557_600_000) : null;
      const fee = feeFor(await feeRows(g.organisation_id), { adultAge: region().adultAge, ageYears: age, period: g.period, today });
      if (!fee) { report.skipped++; continue; }
      // Reuse an attempt already waiting rather than asking twice.
      let pay = await one(`select py.id from payment py join payment_line l on l.payment_id = py.id
        where l.renews_affiliation_id = $1 and py.status in ('pending','failed') order by py.created_at desc limit 1`, [g.affiliation_id]);
      if (!pay) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const { rows: [p] } = await client.query(`insert into payment (organisation_id, person_id, amount_cents, currency, status)
            values ($1,$2,$3,$4,'pending') returning id`, [g.organisation_id, g.person_id, fee.amount_cents, fee.currency ?? region().currency]);
          await client.query(`insert into payment_line (payment_id, kind, description, amount_cents, renews_affiliation_id, renews_months)
            values ($1,'club_fee',$2,$3,$4,$5)`, [p.id, `${fee.label} — automatic renewal ${PERIODS[g.period].label.toLowerCase()}`, fee.amount_cents, g.affiliation_id, PERIODS[g.period].months]);
          await client.query('commit'); pay = p;
        } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
      }
      const claimed = await one(`update payment set status='awaiting', method=$2, provider=$3, updated_at=now()
        where id=$1 and status in ('pending','failed') returning id`, [pay.id, g.method === 'card' ? 'card' : 'direct_debit', provider.name]);
      if (!claimed) { report.skipped++; continue; }
      let result;
      try { result = await provider.charge({ ref: (await one('select provider_ref from payment_agreement where id=$1', [g.id])).provider_ref,
        amountCents: fee.amount_cents, currency: fee.currency ?? region().currency, reference: pay.id }); }
      catch (e) { result = { status: 'failed', detail: 'The payment provider could not be reached.' }; }
      if (result.status === 'succeeded') {
        await settle(pay.id, true, result.detail, { ref: result.ref });
        await pool.query(`update payment_agreement set failures=0, next_attempt_on=null, last_error=null where id=$1`, [g.id]);
        report.charged++;
      } else if (result.status === 'awaiting') {
        await pool.query(`update payment set provider_ref=$2, detail=$3, updated_at=now() where id=$1`, [pay.id, result.ref, result.detail]);
        report.charged++;
      } else {
        await settle(pay.id, false, result.detail ?? 'Declined.', { ref: result.ref });
        const next = afterFailure(g.failures, today);
        await pool.query(`update payment_agreement set failures=$2, status=$3, next_attempt_on=$4, last_error=$5 where id=$1`,
          [g.id, next.failures, next.status, next.nextAttemptOn, String(result.detail ?? 'Declined.').slice(0, 250)]);
        report.failed++;
        if (next.status === 'paused') report.paused++;
        await push.toPerson(g.person_id, { title: next.status === 'paused' ? 'Automatic renewal has stopped' : 'Your membership payment did not go through',
          body: `${g.club}: ${g.person_name}`, url: `/me/${g.person_id}/auto-renew` });
        if (messenger) {
          const text = next.status === 'paused'
            ? { subject: 'Automatic renewal has stopped', body: `We could not take your membership payment for ${g.person_name} at ${g.club} after several tries, so automatic renewal is paused. Please sign in, go to My payments, and pay or set up automatic renewal again.` }
            : { subject: 'Your membership payment did not go through', body: `We tried to renew ${g.person_name}'s membership at ${g.club} and the payment did not go through (${result.detail ?? 'declined'}). We will try again on ${next.nextAttemptOn}. You can also pay now from My payments.` };
          try {
            const made = await messages.prepare(null, g.organisation_id, { audience: 'selected', kind: 'renewal', personIds: [g.person_id],
              subject: text.subject, body: text.body, eventId: null, personNumber: null }, { baseFrom, trusted: true });
            await messages.sendBatch(null, g.organisation_id, made.message.id, { messenger, origin, trusted: true, budgetMs: 3000 });
          } catch { /* the failure is recorded either way; a missing address must not stop the run */ }
        }
      }
    }
    return report;
  },
};

/**
 * The daily run: for every club that has switched automatic reminders on, write
 * to members whose fees are about to run out or have recently. Meant to be
 * called by a scheduler; it is safe to run twice, because nobody is written to
 * again within REMIND_EVERY_DAYS and a half-sent message is resumed, not remade.
 *
 * There is no signed-in person here. Each message is the club's, from the
 * club's sender, and records that nobody in particular sent it.
 */
export const reminders = {
  async run({ messenger, origin, baseFrom, budgetMs = 9000 }) {
    const started = Date.now();
    const clubs = await q(`select id, name, slug from organisation
      where type = 'club' and status = 'active' and (settings->'reminders'->>'enabled')::boolean is true
      order by name`);
    const report = [];

    for (const club of clubs) {
      const line = { club: club.slug, written: 0, skipped: null };
      try {
        // First, finish anything an earlier run left unsent.
        const open = await q(`select distinct m.id from message m join message_recipient r on r.message_id = m.id
          where m.organisation_id = $1 and m.kind = 'renewal' and m.sent_by is null
            and r.status in ('queued','sending')`, [club.id]);
        for (const m of open) {
          if (Date.now() - started > budgetMs) break;
          await messages.sendBatch(null, club.id, m.id, { messenger, origin, trusted: true,
            budgetMs: Math.max(1000, budgetMs - (Date.now() - started)) });
        }

        const { today, rows } = await rosterFor(club.id);
        const groups = dueForReminder(rows, today);
        for (const [which, list] of [['due', groups.due], ['overdue', groups.overdue]]) {
          if (!list.length || Date.now() - started > budgetMs) continue;
          const text = reminderText(which);
          const made = await messages.prepare(null, club.id, { audience: 'selected', kind: 'renewal',
            personIds: list.slice(0, 200).map((r) => r.person_id), subject: text.subject, body: text.body,
            eventId: null, personNumber: null }, { baseFrom, trusted: true });
          line.written += made.recipients;
          await messages.sendBatch(null, club.id, made.message.id, { messenger, origin, trusted: true,
            budgetMs: Math.max(1000, budgetMs - (Date.now() - started)) });
        }
      } catch (e) {
        // One club's missing contact address must not stop the others.
        line.skipped = String(e.message ?? e).slice(0, 200);
      }
      report.push(line);
    }
    return report;
  },
};

/** The next number in the federation's own sequence. Inside the caller's transaction. */
/**
 * The range a club offers: its own products, plus those of every organisation above it (the national range),
 * less what the club has hidden, at the club's own price where it set one. This is the ONLY query that decides what
 * a member sees, so a tee shirt owned by one club can never reach another club's members.
 */
const RANGE = `
  select p.id, p.organisation_id, p.category, p.name, p.description, p.sizes, p.currency,
         p.price_cents as national_price_cents, coalesce(l.price_cents, p.price_cents) as price_cents,
         (p.organisation_id = club.id) as own
    from organisation club
    join organisation owner on club.path <@ owner.path
    join product p on p.organisation_id = owner.id
    left join product_listing l on l.product_id = p.id and l.organisation_id = club.id
   where club.id = $1 and p.active and not coalesce(l.hidden, false)
   order by (p.organisation_id = club.id), p.category, p.sort_order, p.name`;

const ORDERS = `
  select o.id, o.status, o.note, o.total_cents, o.currency, o.created_at, o.person_id,
         p.first_name, p.last_name,
         coalesce((select json_agg(json_build_object('name', l.name, 'size', l.size, 'quantity', l.quantity, 'unit_cents', l.unit_cents) order by l.name)
                     from shop_order_line l where l.order_id = o.id), '[]'::json) as lines
    from shop_order o join person p on p.id = o.person_id`;

const mayShopFor = (personId, clubId) => one(
  `select 1 x from affiliation where person_id=$1 and organisation_id=$2 and ends is null
     and role in ('member','instructor','assistant') and status in ('active','trial')`, [personId, clubId]);

export const shop = {
  ORDER_STATUSES,

  /** The member's side: for each club they belong to, what they may order and what they have ordered. */
  async forPerson(actor, personId) {
    await family.assertMayActFor(actor, personId);
    const person = await one('select id, first_name, last_name from person where id=$1', [personId]);
    if (!person) throw new NotFound('Person');
    // distinct: somebody who is both a member and an instructor at a club is one club, not two
    const clubs = await q(`select distinct o.id, o.name from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id=$1 and a.ends is null and a.role in ('member','instructor','assistant') and a.status in ('active','trial') and o.type='club' order by o.name`, [personId]);
    const out = [];
    for (const club of clubs) {
      out.push({ club, range: await q(RANGE, [club.id]),
        orders: await q(`${ORDERS} where o.person_id=$1 and o.organisation_id=$2 order by o.created_at desc limit 20`, [personId, club.id]) });
    }
    return { person, clubs: out };
  },

  /** Place an order. Prices, sizes and what is on offer are all decided here, from the club's range, never from the form. */
  async place(actor, personId, clubId, form) {
    await family.assertMayActFor(actor, personId);
    if (!await mayShopFor(personId, clubId)) throw new NotFound(words().club);
    const range = await q(RANGE, [clubId]);
    const basket = readBasket(form ?? {}, range);
    if (basket.problem) throw new Invalid(basket.problem);
    const currency = range[0]?.currency ?? region().currency;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const o = (await client.query(
        `insert into shop_order (organisation_id, person_id, ordered_by, note, total_cents, currency) values ($1,$2,$3,$4,$5,$6) returning id`,
        [clubId, personId, actor, readNote(form?.note), basket.total_cents, currency])).rows[0];
      for (const l of basket.value)
        await client.query(`insert into shop_order_line (order_id, product_id, name, size, quantity, unit_cents) values ($1,$2,$3,$4,$5,$6)`,
          [o.id, l.product_id, l.name, l.size, l.quantity, l.unit_cents]);
      await client.query('commit');
      return { id: o.id, total_cents: basket.total_cents };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },

  /** A member can take back an order the club has not yet touched. */
  async cancelMine(actor, personId, orderId) {
    await family.assertMayActFor(actor, personId);
    const r = await one(`update shop_order set status='cancelled', updated_at=now() where id=$1 and person_id=$2 and status='placed' returning id`, [orderId, personId]);
    if (!r) throw new Invalid(`That order can no longer be cancelled here. Please ask the ${clubWord()}.`);
  },

  /** The club's (or the federation's) side. A club: orders, its own products, and the national range to hide or reprice. */
  async forOrg(actor, orgId) {
    const org = await one('select * from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    const isClub = org.type === 'club';
    await assertRole(actor, orgId, isClub ? REGISTER : MANAGE);
    const own = await q(`select id, category, name, description, sizes, price_cents, currency, active from product where organisation_id=$1 order by active desc, category, sort_order, name`, [orgId]);
    if (!isClub) return { org, isClub, own, national: [], orders: [] };
    const national = await q(`select p.id, p.category, p.name, p.sizes, p.price_cents, p.currency, p.organisation_id,
        coalesce(l.hidden, false) as hidden, l.price_cents as own_price_cents
      from organisation club join organisation owner on club.path <@ owner.path and owner.id <> club.id
      join product p on p.organisation_id = owner.id and p.active
      left join product_listing l on l.product_id = p.id and l.organisation_id = club.id
      where club.id=$1 order by p.category, p.sort_order, p.name`, [orgId]);
    const orders = await q(`${ORDERS} where o.organisation_id=$1 order by (o.status in ('placed','paid','ready')) desc, o.created_at desc limit 200`, [orgId]);
    return { org, isClub, own, national, orders };
  },

  async saveProduct(actor, orgId, productId, v) {
    const org = await one('select type from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    await assertRole(actor, orgId, org.type === 'club' ? REGISTER : MANAGE);
    if (productId) {
      const r = await one(`update product set name=$3, category=$4, description=$5, sizes=$6, price_cents=$7, updated_at=now()
        where id=$1 and organisation_id=$2 returning id`, [productId, orgId, v.name, v.category, v.description, v.sizes, v.price_cents]);
      if (!r) throw new NotFound('Item');
      return r.id;
    }
    return (await one(`insert into product (organisation_id, name, category, description, sizes, price_cents, currency) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [orgId, v.name, v.category, v.description, v.sizes, v.price_cents, region().currency])).id;
  },

  async setActive(actor, orgId, productId, active) {
    const org = await one('select type from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    await assertRole(actor, orgId, org.type === 'club' ? REGISTER : MANAGE);
    const r = await one(`update product set active=$3, updated_at=now() where id=$1 and organisation_id=$2 returning id`, [productId, orgId, !!active]);
    if (!r) throw new NotFound('Item');
  },

  /** A club's say over a national item: hide it, or set its own price. Only for items owned above it. */
  async setListing(actor, clubId, productId, v) {
    await clubOnly(clubId);
    await assertRole(actor, clubId, REGISTER);
    const p = await one(`select p.id from product p join organisation owner on owner.id = p.organisation_id
      join organisation club on club.path <@ owner.path and club.id <> owner.id where p.id=$1 and club.id=$2`, [productId, clubId]);
    if (!p) throw new NotFound('Item');
    await pool.query(`insert into product_listing (product_id, organisation_id, hidden, price_cents) values ($1,$2,$3,$4)
      on conflict (product_id, organisation_id) do update set hidden=excluded.hidden, price_cents=excluded.price_cents`,
      [productId, clubId, !!v.hidden, v.price_cents]);
  },

  async setOrderStatus(actor, clubId, orderId, status) {
    await clubOnly(clubId);
    await assertRole(actor, clubId, REGISTER);
    const o = await one('select id, status from shop_order where id=$1 and organisation_id=$2', [orderId, clubId]);
    if (!o) throw new NotFound('Order');
    if (!Object.hasOwn(ORDER_STATUSES, status) || !mayMoveOrder(o.status, status)) throw new Invalid('That order cannot be moved there.');
    await pool.query(`update shop_order set status=$2, updated_at=now() where id=$1`, [orderId, status]);
  },
};
