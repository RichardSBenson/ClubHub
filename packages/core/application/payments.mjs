/**
 * USE CASES — payments. A payment has one payee, decided by what it is for. It is made by the person it is for, or by a parent or
 * guardian of a minor. A club sees what it has been paid; it does not see another club's.
 *
 * Settling is the one place money turns into consequences: an entry is paid, a term place is paid, a membership is carried on,
 * and a first payment makes somebody a member. It happens as one unit, so a payment is never marked paid with its consequences
 * half done. What goes out afterwards (a webhook, a referral reward) is best-effort and cannot undo it.
 */

import { payeeFor, problemsWithPaymentRequest, problemsWithPayment, KINDS } from '../domain/payments.mjs';
import { extendedUntil, MANUAL_METHODS, whyNotMethod, mayRecordByHand } from '../domain/membership.mjs';
import { memberNumberPrefix, formatMemberNumber } from '../domain/people.mjs';
import { MANAGE, REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, PAYMENT_LEDGER } from './ports.mjs';

/**
 * Carry a membership on, inside the transaction `tx`. From the later of today and where it already runs to, so paying early loses
 * nothing and paying late is not backdated. Somebody's first payment makes them a member: a number, and the trial and any
 * referral follow. Returns { until, becameMember: personId | null }, or null if there is no such membership.
 */
export async function renewMembership(tx, affiliationId, months) {
  const a = await tx.affiliationForRenewal(affiliationId);
  if (!a) return null;
  const until = extendedUntil(a.paid_until, a.today, months);
  await tx.extendMembership(affiliationId, until);
  if (!['trial', 'lapsed'].includes(a.status)) return { until, becameMember: null };

  const home = await tx.personAndClubOf(affiliationId);
  if (!home) return { until, becameMember: null };
  if (!await tx.numberOf(home.person_id)) {
    const prefix = memberNumberPrefix(await tx.federationShortNameFor(home.organisation_id));
    await tx.setNumber(home.person_id, formatMemberNumber(prefix, (await tx.lastNumberIn(prefix)) + 1));
  }
  await tx.convertTrial(home.person_id, home.organisation_id);
  await tx.promoteReferral(home.person_id);
  return { until, becameMember: home.person_id };
}

class PaymentUseCase {
  /**
   * `mayPayFor(accountId, personId)` says whether somebody may see and pay what a person owes. `announce(organisationId, event,
   * data)` and `afterMemberJoined(personId)` are best-effort and happen after the money is safe.
   */
  constructor({ ledger, auth, mayPayFor, announce = async () => {}, afterMemberJoined = async () => {}, currency = () => 'NZD', clubWord = () => 'club', isTestProvider = () => false }) {
    this.ledger = requirePort(ledger, PAYMENT_LEDGER);
    this.auth = requirePort(auth, AUTHORISATION);
    Object.assign(this, { mayPayFor, announce, afterMemberJoined, currency, clubWord, isTestProvider });
  }

  async mustHaveRole(actorId, organisationId, roles) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, roles)) throw new NotPermitted('Not permitted');
  }

  async readable(actorId, paymentId) {
    const row = await this.ledger.paymentById(paymentId);
    if (!row || !row.person_id) throw new Missing('Payment');
    if (!await this.mayPayFor(actorId, row.person_id)) throw new NotPermitted('Not permitted');
    return row;
  }
}

/** Mark a payment succeeded or failed and do everything that follows. Returns false if it was already settled. */
export class SettlePayment extends PaymentUseCase {
  async execute({ paymentId, ok, detail, actorId = null, ref, manual = null }) {
    const done = await this.ledger.atomically(async (tx) => {
      const row = await tx.settle({ paymentId, ok, detail, ref, manual: manual && { ...manual, actorId } });
      if (!row) return null;
      const renewed = [], joined = [];
      if (ok) for (const l of await tx.markFulfilled(paymentId)) {
        const r = await renewMembership(tx, l.id, l.months);
        renewed.push(r?.until ?? null);
        if (r?.becameMember) joined.push(r.becameMember);
      }
      await tx.audit({ actorId, organisationId: row.organisation_id, entityId: paymentId,
        action: manual ? 'payment_recorded' : ok ? 'payment_made' : 'payment_failed',
        after: { amountCents: row.amount_cents, personId: row.person_id,
          ...(manual ? { method: manual.method, receipt: row.receipt_no } : {}), ...(renewed.length ? { paidUntil: renewed[0] } : {}) } });
      return { row, joined };
    });
    if (!done) return false;
    for (const personId of done.joined) await this.afterMemberJoined(personId).catch(() => {});
    if (ok) await this.announce(done.row.organisation_id, 'payment.succeeded', { payment_id: paymentId, person_id: done.row.person_id, amount_cents: done.row.amount_cents }).catch(() => {});
    return true;
  }
}

export class ListPaymentsFor extends PaymentUseCase {
  async execute({ actorId, personId }) {
    if (!await this.mayPayFor(actorId, personId)) throw new NotPermitted('Not permitted');
    return this.ledger.paymentsFor(personId);
  }
}

/** Everything the signed-in person and their children owe. `peopleOf(accountId)` lists them (themself and dependants). */
export class ListOwed extends PaymentUseCase {
  constructor(deps) { super(deps); this.peopleOf = deps.peopleOf; }
  async execute({ actorId }) {
    const ids = [];
    for (const p of await this.peopleOf(actorId)) if (await this.mayPayFor(actorId, p.id)) ids.push(p.id);
    return ids.length ? this.ledger.owedFor(ids) : [];
  }
}

export class ViewPayment extends PaymentUseCase {
  execute({ actorId, paymentId }) { return this.readable(actorId, paymentId); }
}

/** Pay. The row is claimed first (pending/failed → awaiting), so pressing the button twice reaches the provider once. */
export class PayPayment extends PaymentUseCase {
  constructor(deps) { super(deps); this.settle = deps.settle; }

  async execute({ actorId, paymentId, input, provider }) {
    const row = await this.readable(actorId, paymentId);
    const problems = problemsWithPayment(input);
    if (problems.length) throw new Refused(problems.join(' '));
    if (!await this.ledger.claim({ paymentId, method: input.method, actorId, providerName: provider.name }))
      throw new Refused('This has already been paid, or is being paid.');

    let result;
    try {
      result = await provider.start({ amountCents: row.amount_cents, currency: row.currency, method: input.method, card: input.card, reference: paymentId });
    } catch (e) {
      await this.settle({ paymentId, ok: false, detail: `The payment provider could not be reached: ${e.message}`.slice(0, 250), actorId });
      throw new Refused('The payment could not be started. Nothing was charged — try again.');
    }
    if (result.status === 'succeeded') await this.settle({ paymentId, ok: true, detail: result.detail, actorId, ref: result.ref });
    else if (result.status === 'failed') await this.settle({ paymentId, ok: false, detail: result.detail, actorId, ref: result.ref });
    else await this.ledger.noteProgress(paymentId, result.ref, result.detail);
    return this.readable(actorId, paymentId);
  }
}

/** Test provider only: stands in for the bank telling us the money arrived. */
export class CompleteTestPayment extends PaymentUseCase {
  constructor(deps) { super(deps); this.settle = deps.settle; }
  async execute({ actorId, paymentId, ok, provider }) {
    if (!this.isTestProvider(provider)) throw new NotPermitted('This is only available with test payments.');
    const row = await this.readable(actorId, paymentId);
    if (row.status !== 'awaiting') throw new Refused('Nothing is waiting on this payment.');
    await this.settle({ paymentId, ok, detail: ok ? 'Confirmed by the test bank.' : 'Refused by the test bank.', actorId });
    return this.readable(actorId, paymentId);
  }
}

/** What this organisation has been paid, and what is owed to it. */
export class PaymentsReceived extends PaymentUseCase {
  async execute({ actorId, organisationId, limit = 100 }) {
    await this.mustHaveRole(actorId, organisationId, MANAGE);
    return this.ledger.receivedBy(organisationId, limit);
  }
}

/**
 * The club has been handed the money — cash, or a transfer into its account. Only somebody who looks after the organisation being
 * paid can say so, and it is numbered, attributed and in the history: a cash tin with no record is the thing treasurers lose
 * sleep over.
 */
export class RecordManualPayment extends PaymentUseCase {
  constructor(deps) { super(deps); this.settle = deps.settle; }
  async execute({ actorId, paymentId, method }) {
    if (whyNotMethod(method)) throw new Refused(whyNotMethod(method));
    const pay = await this.ledger.paymentById(paymentId);
    if (!pay) throw new Missing('Payment');
    await this.mustHaveRole(actorId, pay.organisation_id, REGISTER);
    if (!mayRecordByHand(pay.status)) throw new Refused('This has already been dealt with.');
    const r = await this.ledger.nextReceipt(pay.organisation_id);
    const receiptNo = `R-${r.year}-${String(r.number).padStart(4, '0')}`;
    if (!await this.settle({ paymentId, ok: true, detail: `${MANUAL_METHODS[method]} received.`, actorId, manual: { method, receiptNo } }))
      throw new Refused('This has already been dealt with.');
    return this.ledger.paymentById(paymentId);
  }
}

/**
 * A club asks one of its members for money. The payee is worked out from what it is for: a kyu grading or a uniform is the
 * club's, a black belt grading is the federation's.
 */
export class RequestPayment extends PaymentUseCase {
  constructor(deps) { super(deps); this.recordManual = deps.recordManual; }

  async execute({ actorId, organisationId, input }) {
    await this.mustHaveRole(actorId, organisationId, REGISTER);
    const problems = problemsWithPaymentRequest(input);
    if (problems.length) throw new Refused(problems.join(' '));

    const org = await this.ledger.organisationById(organisationId);
    const person = await this.ledger.personByNumber(input.personNumber);
    const home = person && await this.ledger.clubHomeOf(person.id, org.path);
    if (!person || !home) throw new Refused(`There is no member numbered ${input.personNumber} here.`);

    const root = await this.ledger.federationAbove(org.path);
    let payeeId;
    try { payeeId = payeeFor(input.kind, { clubId: home.id, federationId: root?.id }); }
    catch (e) { throw new Refused(e.message); }

    if (input.received) {
      if (whyNotMethod(input.received)) throw new Refused(whyNotMethod(input.received));
      if (!await this.auth.hasRoleAt(actorId, payeeId, REGISTER))
        throw new Refused(`This money belongs to the federation, so a ${this.clubWord()} cannot record it as received. Ask for it instead.`);
    }
    const description = input.description || KINDS[input.kind].label;
    const pay = await this.ledger.atomically(async (tx) => {
      const row = await tx.createRequest({ payeeId, personId: person.id, amountCents: input.amountCents, currency: this.currency(), actorId, kind: input.kind, description });
      await tx.audit({ actorId, organisationId: payeeId, action: 'payment_requested', entityId: row.id,
        after: { kind: input.kind, amountCents: input.amountCents, person: `${person.first_name} ${person.last_name}`, description } });
      return row;
    });
    if (input.received) await this.recordManual({ actorId, paymentId: pay.id, method: input.received });
    return pay;
  }
}

/** Take back a request nobody has paid. */
export class CancelPaymentRequest extends PaymentUseCase {
  async execute({ actorId, organisationId, paymentId }) {
    await this.mustHaveRole(actorId, organisationId, REGISTER);
    if (!await this.ledger.voidUnpaid(organisationId, paymentId)) throw new Missing('Payment');
  }
}
