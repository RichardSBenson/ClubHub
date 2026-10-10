/**
 * USE CASES — school terms: the calendar, the mid-term joining rule, what a child could enrol in and at what price,
 * enrolling, and withdrawing.
 *
 * Term enrolment is separate from membership: a child may have an active membership while their class enrolment is attached
 * to a particular term. Withdrawing before the term starts cancels an unpaid bill; a paid one is left for the club to refund.
 */

import { feeFor } from '../domain/membership.mjs';
import { ageOn } from '../domain/people.mjs';
import { builtInFor, builtInYears, yearToOffer, offersDue, termState, mayEnrol, termPrice, readMidTerm, problemsWithMidTerm, problemsWithTerm, midTermOf } from '../domain/terms.mjs';
import { MANAGE } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, TERM_STORE, TERM_OFFER_STORE } from './ports.mjs';

class TermUseCase {
  /**
   * `howMayActFor(accountId, personId)` → 'self' | 'guardian' | null. `adultAge()` and `currency()` come from the
   * request's region.
   */
  constructor({ store, auth, howMayActFor, adultAge, currency }) {
    this.store = requirePort(store, TERM_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
    this.howMayActFor = howMayActFor;
    this.adultAge = adultAge;
    this.currency = currency;
  }

  async mustManage(actorId, organisationId) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, MANAGE)) throw new NotPermitted('Not permitted');
  }

  async mustActFor(actorId, personId) {
    const how = await this.howMayActFor(actorId, personId);
    if (!how) throw new NotPermitted('Not permitted');
    return how;
  }
}

/** Load the country's own calendar for a year. `system` is the daily run, acting for nobody. */
export class LoadBuiltInTerms extends TermUseCase {
  async execute({ actorId, organisationId, year, system = false }) {
    if (!system) await this.mustManage(actorId, organisationId);
    const country = await this.store.countryOf(organisationId);
    const calendar = builtInFor(country, year);
    if (!calendar) throw new Refused(`There is no built-in calendar for ${country ?? 'this country'} in ${year}. Add the terms yourself.`);
    if (await this.store.hasTermsIn(organisationId, year)) throw new Refused(`${year} already has terms here.`);
    return this.store.atomically(async (store) => {
      for (const t of calendar.terms) await store.addTerm({ organisationId, year, number: t.number, name: t.name, starts: t.starts, ends: t.ends, source: 'built-in' });
      await store.audit({ actorId: system ? null : actorId, organisationId, action: 'terms_loaded', entity: 'organisation', entityId: organisationId,
        after: { year, country, source: calendar.source } });
      return calendar.terms.length;
    });
  }
}

export class SaveTerm extends TermUseCase {
  async execute({ actorId, organisationId, input }) {
    await this.mustManage(actorId, organisationId);
    const t = { id: input.id || null, name: String(input.name ?? '').trim().slice(0, 40), starts: String(input.starts ?? '').trim(), ends: String(input.ends ?? '').trim() };
    const year = Number(t.starts.slice(0, 4));
    const problems = problemsWithTerm(t, await this.store.termsOf(organisationId));
    if (problems.length) throw new Refused(problems.join(' '));
    await this.store.atomically(async (store) => {
      if (t.id) {
        if (!await store.updateTerm({ id: t.id, organisationId, name: t.name, starts: t.starts, ends: t.ends, year })) throw new Missing('Term');
      } else {
        await store.addTerm({ organisationId, year, number: await store.nextTermNumber(organisationId, year), name: t.name, starts: t.starts, ends: t.ends });
      }
      await store.audit({ actorId, organisationId, action: 'term_saved', entity: 'organisation', entityId: organisationId, after: t });
    });
  }
}

export class RemoveTerm extends TermUseCase {
  async execute({ actorId, organisationId, termId }) {
    await this.mustManage(actorId, organisationId);
    if (await this.store.enrolledCount(termId)) throw new Refused('Children are enrolled in that term. Withdraw them first.');
    if (!await this.store.removeTerm(organisationId, termId)) throw new Missing('Term');
  }
}

export class SetMidTermRule extends TermUseCase {
  async execute({ actorId, organisationId, form }) {
    await this.mustManage(actorId, organisationId);
    const org = await this.store.organisationById(organisationId);
    if (!org) throw new Missing('Organisation');
    if (org.type !== 'club') throw new Refused('Fees are set by each club.');
    const rule = readMidTerm(form);
    const problems = problemsWithMidTerm(rule);
    if (problems.length) throw new Refused(problems.join(' '));
    await this.store.setMidTermRule(org.id, rule);
  }
}

/** The terms a child could be enrolled in now, and what each costs them. */
export class OfferedTerms extends TermUseCase {
  async execute({ actorId, personId }) {
    const how = await this.mustActFor(actorId, personId);
    const person = await this.store.personById(personId);
    const home = await this.store.memberClubOf(personId);
    if (!home) return { how, person, club: null, items: [] };
    const today = await this.store.todayAt(home);
    const age = ageOn(person.date_of_birth, today);
    if (age == null || age >= this.adultAge()) return { how, person, club: null, items: [] };

    const year = Number(today.slice(0, 4));
    const weekdays = await this.store.trainingWeekdays(home.id, age);
    const fee = feeFor(await this.store.feeSchedule(home.id), { adultAge: this.adultAge(), ageYears: age, period: 'term', today });
    const rule = midTermOf(home);
    const items = [];
    for (const y of [year, year + 1]) {
      for (const t of (await this.store.effectiveTerms(home.id, y)).terms) {
        if (t.ends < today) continue;
        const enrolment = await this.store.enrolmentOf(t.id, personId);
        const price = fee ? termPrice({ fullCents: fee.amount_cents, term: t, today, rule, weekdays }) : { cents: 0, kind: 'free', note: 'No term fee set' };
        items.push({ term: t, state: termState(t, today), enrolment, price,
          mayEnrol: mayEnrol(t, today) && !!price && (!enrolment || enrolment.status === 'withdrawn') });
      }
    }
    return { how, person, club: home.name, items, fee, rule };
  }
}

export class EnrolInTerm extends TermUseCase {
  constructor(deps) { super(deps); this.offered = new OfferedTerms(deps); }

  async execute({ actorId, personId, termId }) {
    const info = await this.offered.execute({ actorId, personId });
    const item = info.items.find((i) => i.term.id === termId);
    if (!item) throw new Missing('Term');
    if (!item.mayEnrol) throw new Refused(item.enrolment?.status === 'enrolled' ? 'Already enrolled.'
      : item.price ? 'Enrolment is not open for that term yet.' : 'The club does not take enrolments part-way through this term.');

    const home = await this.store.memberClubOf(personId);
    const today = await this.store.todayAt(home);
    const cents = item.price.cents;
    return this.store.atomically(async (store) => {
      const enrolment = await store.enrol({ termId, personId, clubId: home.id, cents, note: item.price.note, today, by: actorId });
      let paymentId = null;
      if (cents > 0) {
        paymentId = await store.requestPayment({ clubId: home.id, personId, cents, currency: info.fee?.currency ?? this.currency(), by: actorId, enrolmentId: enrolment.id,
          description: `${item.term.name} ${item.term.year} classes — ${info.person.first_name}${item.price.kind === 'full' ? '' : ` (${item.price.note})`}` });
      }
      await store.audit({ actorId, organisationId: home.id, action: 'term_enrolled', entity: 'term_enrolment', entityId: enrolment.id,
        after: { term: item.term.name, year: item.term.year, cents } });
      return { paymentId };
    });
  }
}

/** Withdraw before the term starts. An unpaid bill is cancelled; a paid one is left for the club to refund. */
export class WithdrawFromTerm extends TermUseCase {
  async execute({ actorId, personId, termId }) {
    await this.mustActFor(actorId, personId);
    const e = await this.store.enrolmentToWithdraw(termId, personId);
    if (!e) throw new Missing('Enrolment');
    if (await this.store.todayAt(e) >= e.starts) throw new Refused('The term has started. Please ask the club.');
    return this.store.atomically(async (store) => {
      await store.voidUnpaidFor(e.id);
      await store.markWithdrawn(e.id);
      await store.audit({ actorId, organisationId: e.organisation_id, action: 'term_withdrawn', entity: 'term_enrolment', entityId: e.id, after: { paid: e.paid } });
      return { paid: e.paid };
    });
  }
}

/**
 * The daily job: load each country's next calendar where it is known, and offer the next term to the families of children
 * who were enrolled in the last one. It acts for nobody. A message that cannot be sent never undoes the offer.
 *
 * `loadBuiltIn(organisationId, year)` loads one calendar. Each run is handed `mailClub(club, to, subject, text)`, which returns whether it was sent.
 */
export class RunDailyTermWork {
  constructor({ store, loadBuiltIn }) {
    this.store = requirePort(store, TERM_OFFER_STORE);
    this.loadBuiltIn = loadBuiltIn;
  }

  async execute({ origin, mailClub }) {
    const report = { loaded: [], offered: 0 };
    for (const r of await this.store.federationsForCalendars()) {
      if (r.settings?.terms?.auto === false) continue;
      const today = await this.store.todayAt(r);
      const year = yearToOffer(await this.store.loadedYears(r.id), today);
      if (year && builtInYears(r.country_code).includes(year)) {
        try { await this.loadBuiltIn(r.id, year); report.loaded.push(`${r.name} ${year}`); } catch { /* already there */ }
      }
    }
    for (const club of await this.store.activeClubs()) {
      const today = await this.store.todayAt(club);
      const y = Number(today.slice(0, 4));
      const all = [...(await this.store.effectiveTerms(club.id, y)).terms, ...(await this.store.effectiveTerms(club.id, y + 1)).terms];
      const due = offersDue(all, today);
      if (!due || await this.store.offerMade(due.next.id, club.id)) continue;
      const byAddress = new Map();
      for (const k of await this.store.familiesToOffer({ previousTermId: due.prev.id, nextTermId: due.next.id, clubId: club.id }))
        for (const addr of (k.guardians.length ? k.guardians : [k.email]).filter(Boolean)) byAddress.set(addr, [...(byAddress.get(addr) ?? []), k.firstName]);
      await this.store.recordOffer(due.next.id, club.id);
      for (const [to, names] of byAddress) {
        const sent = await mailClub(club, to, `${due.next.name} enrolment is open at ${club.name}`,
          `Hello,\n\nEnrolment for ${due.next.name} (${due.next.starts} to ${due.next.ends}) is open for ${names.join(' and ')}.\nEnrol online: ${origin}/me/terms\n\nSee you in class.`);
        if (sent) report.offered++;
      }
    }
    return report;
  }
}
