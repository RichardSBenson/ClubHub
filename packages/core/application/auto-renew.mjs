/**
 * USE CASES — automatic renewal. A person (or their parent) agrees to have a saved method charged as their membership runs out.
 * Only the provider's token is kept. One press stops it, and after that nothing more is charged.
 *
 * The daily run asks for the club's price, charges the saved method, and lets the ordinary payment path extend the membership.
 * It is safe to run twice: the payment is claimed before the provider is asked, and a second run finds the membership already
 * extended or an attempt already waiting. A failure is recorded, retried on a schedule, and finally pauses the agreement.
 */

import { feeFor, PERIODS } from '../domain/membership.mjs';
import { ageOn } from '../domain/people.mjs';
import { chargeDue, afterFailure, problemsWithSetup, cardLabel, PERIOD_CHOICES } from '../domain/autorenew.mjs';
import { REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, AUTO_RENEW_STORE } from './ports.mjs';

class AutoRenewUseCase {
  /** `mustActFor(accountId, personId)` throws unless they may; `adultAge()`, `currency()` and `clubWord()` come from the request's region. */
  constructor({ store, auth, mustActFor, adultAge = () => 18, currency = () => 'NZD', clubWord = () => 'club' }) {
    this.store = requirePort(store, AUTO_RENEW_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
    Object.assign(this, { mustActFor, adultAge, currency, clubWord });
  }

  priceFor(schedule, person, period, today) {
    return feeFor(schedule, { adultAge: this.adultAge(), ageYears: ageOn(person?.dob, today), period, today });
  }
}

/** Where this person stands: each club membership, whether it renews itself, and what it would cost. */
export class AutoRenewStanding extends AutoRenewUseCase {
  async execute({ actorId, personId }) {
    await this.mustActFor(actorId, personId);
    const memberships = await this.store.renewableMemberships(personId);
    const live = await this.store.liveAgreementsOf(personId);
    const person = await this.store.personById(personId);
    const out = [];
    for (const m of memberships) {
      const today = await this.store.todayAtClub(m.organisation_id);
      const schedule = await this.store.feeRows(m.organisation_id);
      const prices = Object.fromEntries(PERIOD_CHOICES.map((pd) => [pd, this.priceFor(schedule, person, pd, today)]).filter(([, f]) => f));
      out.push({ ...m, agreement: live.find((g) => g.affiliation_id === m.affiliation_id) ?? null, prices });
    }
    return { person, memberships: out };
  }
}

/** The person agrees to automatic renewal and gives a method. Only a token is kept. */
export class StartAutoRenew extends AutoRenewUseCase {
  async execute({ actorId, personId, affiliationId, input, provider }) {
    await this.mustActFor(actorId, personId);
    const problems = problemsWithSetup({ method: input.method, period: input.period, agreed: input.agreed });
    if (problems.length) throw new Refused(problems.join(' '));
    const a = await this.store.membershipForSetup(affiliationId, personId);
    if (!a || a.type !== 'club') throw new Missing('Membership');
    if (a.fee_exempt) throw new Refused('You are not charged here, so there is nothing to renew.');
    const today = await this.store.todayAtClub(a.organisation_id);
    if (!this.priceFor(await this.store.feeRows(a.organisation_id), await this.store.personById(personId), input.period, today))
      throw new Refused(`The ${this.clubWord()} has not set a price for that yet. Choose another, or ask the ${this.clubWord()}.`);
    if (await this.store.hasLiveAgreement(affiliationId)) throw new Refused('Automatic renewal is already set up. Stop it first to change it.');

    let saved;
    try { saved = await provider.saveMethod({ method: input.method, card: input.card }); }
    catch { throw new Refused('We could not reach the payment provider. Nothing was saved — try again.'); }
    if (saved.status !== 'saved') throw new Refused(saved.detail || 'That payment method was not accepted.');

    return this.store.atomically(async (tx) => {
      const id = await tx.addAgreement({ organisationId: a.organisation_id, affiliationId, personId, period: input.period, method: input.method,
        providerName: provider.name, providerRef: saved.ref, label: input.method === 'card' ? cardLabel(input.card) : 'Bank direct debit', actorId });
      await tx.audit({ actorId, organisationId: a.organisation_id, action: 'auto_renew_start', entityId: personId, after: { period: input.period, method: input.method } });
      return id;
    });
  }
}

/** One press. After it, nothing more is charged. */
export class CancelAutoRenew extends AutoRenewUseCase {
  async execute({ actorId, personId, agreementId }) {
    await this.mustActFor(actorId, personId);
    await this.store.atomically(async (tx) => {
      const organisationId = await tx.cancelAgreement({ agreementId, personId, actorId });
      if (!organisationId) throw new Missing('Automatic renewal');
      await tx.audit({ actorId, organisationId, action: 'auto_renew_stop', entityId: personId, after: {} });
    });
  }
}

/** A club's view: who renews themselves, who is failing. */
export class AutoRenewForClub extends AutoRenewUseCase {
  async execute({ actorId, organisationId }) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, REGISTER)) throw new NotPermitted('Not permitted');
    return this.store.agreementsOfClub(organisationId);
  }
}

/**
 * The daily run. `settle({ paymentId, ok, detail, ref })` is the ordinary payment path. Each run is handed `tell({ personId, organisationId,
 * push, email })`, which is best-effort and cannot stop the run. `now()` is the clock the time budget is measured on.
 */
export class RunAutoRenewals extends AutoRenewUseCase {
  constructor(deps) { super(deps); Object.assign(this, { settle: deps.settle, now: deps.now ?? (() => Date.now()) }); }

  async execute({ provider, tell, budgetMs = 9000 }) {
    const started = this.now();
    const report = { charged: 0, failed: 0, paused: 0, skipped: 0 };
    for (const g of await this.store.activeAgreements()) {
      if (this.now() - started > budgetMs) break;
      const today = await this.store.todayAtClub(g.organisation_id);
      if (!chargeDue({ status: g.status, nextAttemptOn: g.next_attempt_on, paidUntil: g.paid_until, exempt: g.fee_exempt }, today)) { report.skipped++; continue; }
      const fee = this.priceFor(await this.store.feeRows(g.organisation_id), await this.store.personById(g.person_id), g.period, today);
      if (!fee) { report.skipped++; continue; }

      // Reuse an attempt already waiting rather than asking twice.
      const paymentId = await this.store.waitingRenewalPayment(g.affiliation_id) ?? await this.store.createRenewalPayment({
        organisationId: g.organisation_id, personId: g.person_id, cents: fee.amount_cents, currency: fee.currency ?? this.currency(),
        affiliationId: g.affiliation_id, months: PERIODS[g.period].months, description: `${fee.label} — automatic renewal ${PERIODS[g.period].label.toLowerCase()}` });
      if (!await this.store.claimAttempt({ paymentId, method: g.method === 'card' ? 'card' : 'direct_debit', providerName: provider.name })) { report.skipped++; continue; }

      let result;
      try { result = await provider.charge({ ref: await this.store.savedMethodOf(g.id), amountCents: fee.amount_cents, currency: fee.currency ?? this.currency(), reference: paymentId }); }
      catch { result = { status: 'failed', detail: 'The payment provider could not be reached.' }; }

      if (result.status === 'succeeded') {
        await this.settle({ paymentId, ok: true, detail: result.detail, ref: result.ref });
        await this.store.chargeWorked(g.id);
        report.charged++;
      } else if (result.status === 'awaiting') {
        await this.store.noteProgress(paymentId, result.ref, result.detail);
        report.charged++;
      } else {
        await this.settle({ paymentId, ok: false, detail: result.detail ?? 'Declined.', ref: result.ref });
        const next = afterFailure(g.failures, today);
        await this.store.chargeFailed({ agreementId: g.id, failures: next.failures, status: next.status, nextAttemptOn: next.nextAttemptOn, error: String(result.detail ?? 'Declined.').slice(0, 250) });
        report.failed++;
        const paused = next.status === 'paused';
        if (paused) report.paused++;
        await tell({ personId: g.person_id, organisationId: g.organisation_id,
          push: { title: paused ? 'Automatic renewal has stopped' : 'Your membership payment did not go through', body: `${g.club}: ${g.person_name}`, url: `/me/${g.person_id}/auto-renew` },
          email: paused
            ? { subject: 'Automatic renewal has stopped', body: `We could not take your membership payment for ${g.person_name} at ${g.club} after several tries, so automatic renewal is paused. Please sign in, go to My payments, and pay or set up automatic renewal again.` }
            : { subject: 'Your membership payment did not go through', body: `We tried to renew ${g.person_name}'s membership at ${g.club} and the payment did not go through (${result.detail ?? 'declined'}). We will try again on ${next.nextAttemptOn}. You can also pay now from My payments.` } }).catch(() => {});
      }
    }
    return report;
  }
}
