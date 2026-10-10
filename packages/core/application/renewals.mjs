/**
 * USE CASES — what a club charges and who has paid: the price list, the roll with where each member's fees stand, reminders,
 * asking people to renew, exemptions, and carrying an exempt member on.
 *
 * Asking is not charging: it makes a request the member can pay, at the club's own price for their age and the period.
 */

import { standing, feeFor, problemsWithFee, problemsWithExemption, PERIODS, whyNotMethod } from '../domain/membership.mjs';
import { centsFrom } from '../domain/payments.mjs';
import { MANAGE, REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, RENEWAL_STORE } from './ports.mjs';

class RenewalUseCase {
  /** `adultAge()` and `currency()` come from the request's region. */
  constructor({ store, auth, adultAge = () => 18, currency = () => 'NZD' }) {
    this.store = requirePort(store, RENEWAL_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
    Object.assign(this, { adultAge, currency });
  }

  async mustHaveRole(actorId, organisationId, roles) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, roles)) throw new NotPermitted('Not permitted');
  }

  async club(organisationId) {
    const org = await this.store.clubById(organisationId);
    if (!org) throw new Missing('Organisation');
    if (org.type !== 'club') throw new Refused('Fees are set by each club.');
    return org;
  }

  async rosterOf(club) {
    const rows = await this.store.rosterRows(club.id, club.timezone);
    const today = await this.store.todayAt(club);
    return { today, rows: rows.map((r) => ({ ...r, standing: r.status === 'trial' ? 'trial' : standing({ paidUntil: r.paid_until, exempt: r.fee_exempt }, today) })) };
  }
}

/** Anybody who runs renewals may see the prices; setting them is for administrators. */
export class ListFees extends RenewalUseCase {
  async execute({ actorId, organisationId }) {
    await this.mustHaveRole(actorId, organisationId, REGISTER);
    await this.club(organisationId);
    return this.store.feeRows(organisationId);
  }
}

export class SaveFee extends RenewalUseCase {
  async execute({ actorId, organisationId, input }) {
    await this.mustHaveRole(actorId, organisationId, MANAGE);
    const org = await this.club(organisationId);
    const problems = problemsWithFee(input, centsFrom);
    if (problems.length) throw new Refused(problems.join(' '));
    const from = input.effectiveFrom || await this.store.todayAt(org);
    const cents = centsFrom(input.amountText);
    return this.store.atomically(async (tx) => {
      // A new price for the same people and period replaces the old one from its start date; the old one stops the day before,
      // so there is never an ambiguity about which applies.
      await tx.endFeesBefore({ clubId: organisationId, appliesTo: input.appliesTo, period: input.period, from });
      const row = await tx.addFee({ clubId: organisationId, label: input.label, cents, period: input.period, appliesTo: input.appliesTo, from, currency: this.currency() });
      await tx.audit({ actorId, organisationId, action: 'fee_set', entity: 'fee_schedule', entityId: row.id,
        after: { label: input.label, amountCents: cents, period: input.period, appliesTo: input.appliesTo } });
      return row;
    });
  }
}

export class RemoveFee extends RenewalUseCase {
  async execute({ actorId, organisationId, feeId }) {
    await this.mustHaveRole(actorId, organisationId, MANAGE);
    await this.store.atomically(async (tx) => {
      const row = await tx.removeFee(organisationId, feeId);
      if (!row) throw new Missing('Price');
      await tx.audit({ actorId, organisationId, action: 'fee_removed', entity: 'fee_schedule', entityId: null, after: { label: row.label, amountCents: row.amount_cents } });
    });
  }
}

/** Everybody at the club, and where their fees stand. */
export class RenewalRoster extends RenewalUseCase {
  async execute({ actorId, organisationId }) {
    await this.mustHaveRole(actorId, organisationId, REGISTER);
    return this.rosterOf(await this.club(organisationId));
  }

  /** The same roll for the daily job, which acts for nobody. */
  async forTheDailyJob(organisationId) { return this.rosterOf(await this.club(organisationId)); }
}

/** Write to the ticked members about their fees, as the club. `prepareMessage(actorId, organisationId, input)` is the messaging system. */
export class RemindMembers extends RenewalUseCase {
  async execute({ actorId, organisationId, affiliationIds, subject, body, prepareMessage }) {
    await this.mustHaveRole(actorId, organisationId, REGISTER);
    const { rows } = await this.rosterOf(await this.club(organisationId));
    const people = rows.filter((r) => affiliationIds.includes(r.affiliation_id) && !r.fee_exempt).map((r) => r.person_id);
    if (!people.length) throw new Refused('Tick the people to remind. Anybody who is not charged is left out.');
    return prepareMessage(actorId, organisationId, {
      audience: 'selected', kind: 'renewal', personIds: people,
      subject: String(subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 150), body: String(body ?? '').trim().slice(0, 10_000), eventId: null, personNumber: null });
  }
}

export class SetReminders extends RenewalUseCase {
  async execute({ actorId, organisationId, enabled }) {
    await this.mustHaveRole(actorId, organisationId, MANAGE);
    await this.club(organisationId);
    await this.store.atomically(async (tx) => {
      await tx.setReminders(organisationId, !!enabled);
      await tx.audit({ actorId, organisationId, action: 'reminders_setting', entity: 'organisation', entityId: organisationId, after: { enabled: !!enabled } });
    });
  }
}

/**
 * Ask a set of members to renew, at the club's own price for each. Nothing is charged by asking. Returns who was asked and who
 * was not, and why. `recordManual({ actorId, paymentId, method })` records money already handed over.
 */
export class AskToRenew extends RenewalUseCase {
  constructor(deps) { super(deps); this.recordManual = deps.recordManual; }

  async execute({ actorId, organisationId, affiliationIds, period, received = null }) {
    await this.mustHaveRole(actorId, organisationId, REGISTER);
    const club = await this.club(organisationId);
    if (!PERIODS[period]?.months) throw new Refused('Choose how long to renew for.');
    if (!affiliationIds?.length) throw new Refused('Tick the people to ask.');
    if (received && whyNotMethod(received)) throw new Refused(whyNotMethod(received));

    const { today, rows } = await this.rosterOf(club);
    const schedule = await this.store.feeRows(organisationId);
    const adultAge = this.adultAge();
    let asked = 0; const skipped = [];
    for (const r of rows.filter((x) => affiliationIds.includes(x.affiliation_id))) {
      if (r.fee_exempt) { skipped.push({ name: r.name, reason: 'not charged' }); continue; }
      if (r.asked) { skipped.push({ name: r.name, reason: 'already asked' }); continue; }
      const fee = feeFor(schedule, { adultAge, ageYears: r.age, period, today });
      if (!fee) { skipped.push({ name: r.name, reason: `no ${r.age != null && r.age < adultAge ? 'junior' : 'adult'} price for “${PERIODS[period].label.toLowerCase()}”` }); continue; }
      const paymentId = await this.store.atomically(async (tx) => {
        const id = await tx.requestRenewal({ clubId: organisationId, personId: r.person_id, cents: fee.amount_cents, currency: fee.currency ?? this.currency(),
          actorId, affiliationId: r.affiliation_id, months: PERIODS[period].months, description: `${fee.label} — membership ${PERIODS[period].label.toLowerCase()}` });
        await tx.audit({ actorId, organisationId, action: 'payment_requested', entity: 'payment', entityId: id,
          after: { kind: 'club_fee', amountCents: fee.amount_cents, person: r.name, description: `${fee.label} renewal` } });
        return id;
      });
      asked++;
      if (received) await this.recordManual({ actorId, paymentId, method: received });
    }
    return { asked, skipped };
  }
}

/** The club decides somebody does not pay — and says why. */
export class SetExemption extends RenewalUseCase {
  async execute({ actorId, organisationId, affiliationId, input }) {
    await this.mustHaveRole(actorId, organisationId, MANAGE);
    await this.club(organisationId);
    const problems = problemsWithExemption(input);
    if (problems.length) throw new Refused(problems.join(' '));
    await this.store.atomically(async (tx) => {
      const personId = await tx.setExemption({ clubId: organisationId, affiliationId, exempt: input.exempt, reason: input.exempt ? input.reason : null });
      if (!personId) throw new Missing('Member');
      // Anything already asked of them is withdrawn: they were never to be asked.
      if (input.exempt) await tx.voidAskedFor(affiliationId);
      await tx.audit({ actorId, organisationId, action: 'fee_exemption', entity: 'person', entityId: personId,
        after: { exempt: input.exempt, reason: input.reason || null, person: await tx.personName(personId) } });
    });
  }
}

/** An exempt member's membership carried on a year, with no payment. `carryOn(affiliationId, months)` returns the new date. */
export class CarryExemptMemberOn extends RenewalUseCase {
  constructor(deps) { super(deps); this.carryOn = deps.carryOn; }
  async execute({ actorId, organisationId, affiliationId }) {
    await this.mustHaveRole(actorId, organisationId, REGISTER);
    await this.club(organisationId);
    const a = await this.store.affiliationOf(organisationId, affiliationId);
    if (!a) throw new Missing('Member');
    if (!a.fee_exempt) throw new Refused('Only somebody who is not charged can be renewed without paying.');
    const until = await this.carryOn(affiliationId, 12);
    await this.store.audit({ actorId, organisationId, action: 'membership_carried_on', entity: 'person', entityId: a.person_id, after: { paidUntil: until } });
    return until;
  }
}
