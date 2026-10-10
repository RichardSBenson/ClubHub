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
import { dueForReminder, reminderText } from '../../core/domain/membership.mjs';
import { METHODS as AUTO_METHODS, PERIOD_CHOICES, CHARGE_LEAD_DAYS, MAX_FAILURES } from '../../core/domain/autorenew.mjs';
import { readBasket, readNote, mayMoveOrder, ORDER_STATUSES } from '../../core/domain/shop.mjs';
import { SettlePayment, ListPaymentsFor, ListOwed, ViewPayment, PayPayment, CompleteTestPayment, PaymentsReceived, RecordManualPayment, RequestPayment, CancelPaymentRequest, renewMembership } from '../../core/application/payments.mjs';
import { ListFees, SaveFee, RemoveFee, RenewalRoster, RemindMembers, SetReminders, AskToRenew, SetExemption, CarryExemptMemberOn } from '../../core/application/renewals.mjs';
import { PostgresRenewalStore } from '../../infrastructure/postgres/renewal-store.mjs';
import { AutoRenewStanding, StartAutoRenew, CancelAutoRenew, AutoRenewForClub, RunAutoRenewals } from '../../core/application/auto-renew.mjs';
import { PostgresAutoRenewStore } from '../../infrastructure/postgres/auto-renew-store.mjs';
import { PostgresPaymentLedger } from '../../infrastructure/postgres/payment-ledger.mjs';
import { PostgresAuthorisation } from '../../infrastructure/postgres/repositories.mjs';
import { MANAGE, REGISTER } from '../../core/domain/access.mjs';
import { messages, push, webhooks } from './messaging.mjs';
import { family } from './people.mjs';
import { speakingForThisLayer, Invalid, NotFound, assertRole, clubOnly, feeRows, one, q } from './shared.mjs';
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

const renewalDeps = { store: new PostgresRenewalStore(pool, pool, { feeRows }), auth: new PostgresAuthorisation(pool), adultAge: () => region().adultAge, currency: () => region().currency };
const listFees = new ListFees(renewalDeps);
const saveFee = new SaveFee(renewalDeps);
const removeFee = new RemoveFee(renewalDeps);
const renewalRoster = new RenewalRoster(renewalDeps);
const remindMembers = new RemindMembers(renewalDeps);
const setReminders = new SetReminders(renewalDeps);
const askToRenew = new AskToRenew({ ...renewalDeps, recordManual: (x) => recordManualPayment.execute(x) });
const setExemption = new SetExemption(renewalDeps);
const carryExemptMemberOn = new CarryExemptMemberOn({ ...renewalDeps, carryOn: (id, months) => renewMembershipNow(id, months) });

export const fees = {
  /** Anybody who runs renewals may see the prices; setting them is for administrators. */
  list: (actor, orgId) => speakingForThisLayer(() => listFees.execute({ actorId: actor, organisationId: orgId })),
  save: (actor, orgId, input) => speakingForThisLayer(() => saveFee.execute({ actorId: actor, organisationId: orgId, input })),
  remove: (actor, orgId, feeId) => speakingForThisLayer(() => removeFee.execute({ actorId: actor, organisationId: orgId, feeId })),
};

const rosterFor = (orgId) => speakingForThisLayer(() => renewalRoster.forTheDailyJob(orgId));

export const renewals = {
  /** Everybody at the club, and where their fees stand. */
  roster: (actor, orgId) => speakingForThisLayer(() => renewalRoster.execute({ actorId: actor, organisationId: orgId })),

  /** Write to the ticked members about their fees, as the club. */
  remind: (actor, orgId, { affiliationIds, subject, body }, { baseFrom }) => speakingForThisLayer(() => remindMembers.execute({
    actorId: actor, organisationId: orgId, affiliationIds, subject, body,
    prepareMessage: (a, o, input) => messages.prepare(a, o, input, { baseFrom, trusted: true }) })),

  /** Whether this club writes its own reminders automatically. */
  reminderSetting: (orgId) => renewalDeps.store.remindersEnabled(orgId),
  setReminders: (actor, orgId, enabled) => speakingForThisLayer(() => setReminders.execute({ actorId: actor, organisationId: orgId, enabled })),

  /** Ask a set of members to renew, at the club's own price for each. Nothing is charged by asking. */
  ask: (actor, orgId, { affiliationIds, period, received = null }) =>
    speakingForThisLayer(() => askToRenew.execute({ actorId: actor, organisationId: orgId, affiliationIds, period, received })),

  /** The club decides somebody does not pay — and says why. */
  setExemption: (actor, orgId, affiliationId, input) => speakingForThisLayer(() => setExemption.execute({ actorId: actor, organisationId: orgId, affiliationId, input })),

  /** An exempt member's membership carried on a year, with no payment. */
  carryOn: (actor, orgId, affiliationId) => speakingForThisLayer(() => carryExemptMemberOn.execute({ actorId: actor, organisationId: orgId, affiliationId })),
};

const autoRenewDeps = {
  store: new PostgresAutoRenewStore(pool, pool, { feeRows }), auth: new PostgresAuthorisation(pool),
  mustActFor: (actor, personId) => family.assertMayActFor(actor, personId),
  adultAge: () => region().adultAge, currency: () => region().currency, clubWord,
};
const autoRenewStanding = new AutoRenewStanding(autoRenewDeps);
const startAutoRenew = new StartAutoRenew(autoRenewDeps);
const cancelAutoRenew = new CancelAutoRenew(autoRenewDeps);
const autoRenewForClub = new AutoRenewForClub(autoRenewDeps);
const runAutoRenewals = new RunAutoRenewals({ ...autoRenewDeps, settle: (x) => settlePayment.execute(x) });

export const autoRenew = {
  AUTO_METHODS, PERIOD_CHOICES, CHARGE_LEAD_DAYS, MAX_FAILURES,

  /** Where this person stands: each club membership, whether it renews itself, and what it would cost. */
  forPerson: (actor, personId) => speakingForThisLayer(() => autoRenewStanding.execute({ actorId: actor, personId })),
  /** The person (or their parent) agrees to automatic renewal and gives a method. Only a token is kept. */
  start: (actor, personId, affiliationId, input, { provider }) => speakingForThisLayer(() => startAutoRenew.execute({ actorId: actor, personId, affiliationId, input, provider })),
  /** One press. After it, nothing more is charged. */
  cancel: (actor, personId, agreementId) => speakingForThisLayer(() => cancelAutoRenew.execute({ actorId: actor, personId, agreementId })),
  /** A club's view: who renews themselves, who is failing. */
  forClub: (actor, orgId) => speakingForThisLayer(() => autoRenewForClub.execute({ actorId: actor, organisationId: orgId })),

  /** The daily run (see core/application/auto-renew.mjs). */
  run: ({ provider, messenger = null, origin = '', baseFrom = '', budgetMs = 9000 }) => runAutoRenewals.execute({ provider, budgetMs,
    tell: async ({ personId, organisationId, push: note, email }) => {
      await push.toPerson(personId, note);
      if (!messenger) return;
      try {
        const made = await messages.prepare(null, organisationId, { audience: 'selected', kind: 'renewal', personIds: [personId], subject: email.subject, body: email.body, eventId: null, personNumber: null }, { baseFrom, trusted: true });
        await messages.sendBatch(null, organisationId, made.message.id, { messenger, origin, trusted: true, budgetMs: 3000 });
      } catch { /* the failure is recorded either way; a missing address must not stop the run */ }
    } }),
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
