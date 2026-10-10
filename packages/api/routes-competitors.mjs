/**
 * Routes: entering a club's own competitors in an event.
 */
import { people, competition } from './data.mjs';
import * as V from './views.mjs';
import { Competitor, placeEntry, priceFor, consentNeeded, problemsWithConsent } from '../core/domain/competition.mjs';
import { ageOn } from '../core/domain/people.mjs';
import { region } from '../infrastructure/region-context.mjs';
import { dayOf, engineSetupFor, entryContextFor } from './event-context.mjs';

export function registerCompetitorRoutes({ get, post }) {
  // ---- entering a club's own competitors -------------------------------------



  get('/o/:slug/events/:eventSlug/enter', async (ctx) => {
    const { org, host, event } = await entryContextFor(ctx);
    const setup = await competition.setupFor(event.id);
    const eventDate = dayOf(event, host.timezone);

    const roster = (await people.roster(ctx.me.accountId, org.id, {
      subtree: org.type !== 'club' }))
      .filter((p) => p.status === 'active')
      .map((p) => ({ ...p, ageOnDay: ageOn(p.date_of_birth, eventDate) }));

    return ctx.send(200, V.enterCompetitors({
      me: ctx.me, org, host, event, csrf: ctx.csrf,
      disciplines: setup.disciplines, roster, eventDate,
      consent: { version: event.consentVersion ?? null,
                 text: event.consentText ?? null,
                 guardianUnder: event.guardianUnder ?? null },
    }));
  });

  post('/o/:slug/events/:eventSlug/enter', async (ctx) => {
    const { org, host, event } = await entryContextFor(ctx);
    const form = await ctx.form();
    const setup = await engineSetupFor(event.id);
    const eventDate = dayOf(event, host.timezone);

    const roster = await people.roster(ctx.me.accountId, org.id, {
      subtree: org.type !== 'club' });
    const byId = new Map(roster.map((p) => [p.id, p]));

    // Which boxes were ticked, per person. A person with none ticked is simply
    // not competing, which is the normal case for most of a roll.
    const wanted = new Map();
    for (const key of Object.keys(form)) {
      const m = key.match(/^enter_([0-9a-f-]{36})_([0-9a-f-]{36})$/);
      if (m && byId.has(m[1])) {
        if (!wanted.has(m[1])) wanted.set(m[1], []);
        wanted.get(m[1]).push(m[2]);
      }
    }

    const backToForm = (error) => ctx.send(422, V.enterCompetitors({
      me: ctx.me, org, host, event, csrf: ctx.csrf,
      disciplines: setup.disciplines, eventDate, error, values: form,
      roster: roster.map((p) => ({ ...p, ageOnDay: ageOn(p.date_of_birth, eventDate) })),
      consent: { version: event.consentVersion ?? null,
                 text: event.consentText ?? null,
                 guardianUnder: event.guardianUnder ?? null },
    }));

    if (!wanted.size) return backToForm('Nobody has been ticked to enter.');

    const consentProblems = event.consentVersion
      ? problemsWithConsent({ accepted: !!form.accepted,
          acceptedName: form.acceptedName, version: event.consentVersion }, {})
      : [];
    if (consentProblems.length) return backToForm(consentProblems.join('; '));

    // Worked out, not written. Nothing is saved until somebody has read it.
    const rows = [];
    for (const [personId, disciplineIds] of wanted) {
      const p = byId.get(personId);
      const weightKg = form[`weight_${personId}`]?.trim() || null;
      const heightCm = form[`height_${personId}`]?.trim() || null;

      const competitor = new Competitor({
        personId, name: `${p.first_name} ${p.last_name}`,
        dateOfBirth: p.date_of_birth, gender: p.gender ?? p.person_gender,
        rankOrder: p.rank_order, weightKg, heightCm, clubName: org.name,
        isMember: true,
      });

      const placed = placeEntry({ disciplines: setup.disciplines,
        divisionsByDiscipline: setup.engineDivisions }, competitor,
        { eventDate, wanted: disciplineIds });

      const price = priceFor(disciplineIds.length, setup.enginePrices,
        { isMember: true });

      rows.push({ personId, name: competitor.name, weightKg, heightCm,
        ready: placed.ready, placements: placed.placements,
        amountCents: price.amountCents,
        needsGuardian: consentNeeded(competitor,
          { eventDate, guardianUnder: event.guardianUnder ?? null }).guardian });
    }

    const ready = rows.filter((r) => r.ready);
    const total = ready.reduce((n, r) => n + (r.amountCents ?? 0), 0);

    if (form.confirm !== 'yes') {
      // Everything needed to repeat this decision, so the confirm step is the
      // same calculation rather than a stored one.
      const text = Object.fromEntries(Object.entries(form)
        .filter(([k]) => k !== '_csrf' && k !== 'confirm'));
      return ctx.send(200, V.entryPreview({
        me: ctx.me, org, event, csrf: ctx.csrf, rows, text, total,
        currency: setup.prices[0]?.currency ?? region().currency }));
    }

    if (!ready.length) return backToForm('Nobody is ready to enter yet.');

    let entered = 0;
    const failures = [];
    for (const r of ready) {
      try {
        await competition.enterCompetitor(ctx.me.accountId, event.id, {
          personId: r.personId, enteredForOrg: org.id,
          weightKg: r.weightKg, heightCm: r.heightCm, clubName: org.name,
          amountCents: r.amountCents,
          currency: setup.prices[0]?.currency ?? region().currency,
          placements: r.placements.map((p) => ({
            disciplineId: p.discipline.id, divisionId: p.division?.id ?? null,
            placedBy: 'calculated',
            options: p.division?.options ?? {} })),
          consent: event.consentVersion ? {
            version: event.consentVersion, acceptedName: form.acceptedName,
            ip: ctx.ip,
            guardian: r.needsGuardian
              ? { name: form.acceptedName, relationship: 'entered by club',
                  contact: ctx.me.email }
              : null,
          } : null,
        });
        entered += 1;
      } catch (e) {
        // One competitor already entered must not lose the other nineteen.
        failures.push(`${r.name}: ${e.message}`);
      }
    }

    const done = `${entered} entered`
      + (failures.length ? `. Not entered — ${failures.join('; ')}` : '.');
    return ctx.redirect(`/o/${org.slug}/events/${event.slug}/entries?`
      + (failures.length ? 'error=' : 'done=') + encodeURIComponent(done));
  });
}
