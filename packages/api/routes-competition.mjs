/**
 * Routes: the competition itself — disciplines and divisions.
 */
import { competition, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { gradesFor } from './access.mjs';
import { eventFor } from './event-context.mjs';

export function registerCompetitionRoutes({ get, post }) {
  // ---- competition ----------------------------------------------------------




  get('/o/:slug/events/:eventSlug/setup', async (ctx) => {
    const { org, event } = await eventFor(ctx, { toSchedule: true });
    const setup = await competition.setupFor(event.id);
    return ctx.send(200, V.eventSetup({
      me: ctx.me, org, event, csrf: ctx.csrf,
      disciplines: setup.disciplines, byDiscipline: setup.byDiscipline,
      prices: setup.prices, grades: await gradesFor(org),
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
    }));
  });

  post('/o/:slug/events/:eventSlug/setup/discipline', async (ctx) => {
    const { org, event } = await eventFor(ctx, { toSchedule: true });
    const form = await ctx.form();
    const back = `/o/${org.slug}/events/${event.slug}/setup`;
    try {
      const d = await competition.addDiscipline(ctx.me.accountId, event.id, {
        name: form.name, summary: form.summary?.trim() || null,
        sortOrder: +(form.sortOrder ?? 0) || 0 });
      return ctx.redirect(`${back}?done=${encodeURIComponent(`${d.name} added.`)}`);
    } catch (e) {
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    }
  });

  post('/o/:slug/events/:eventSlug/setup/division', async (ctx) => {
    const { org, event } = await eventFor(ctx, { toSchedule: true });
    const form = await ctx.form();
    const back = `/o/${org.slug}/events/${event.slug}/setup`;
    try {
      const d = await competition.addDivision(ctx.me.accountId, form.disciplineId, {
        label: form.label, summary: form.summary?.trim() || null,
        minRankOrder: form.minRankOrder, maxRankOrder: form.maxRankOrder,
        minAge: form.minAge, maxAge: form.maxAge,
        minWeightKg: form.minWeightKg, maxWeightKg: form.maxWeightKg,
        gender: form.gender?.trim() || null,
        sortOrder: +(form.sortOrder ?? 0) || 0 });
      return ctx.redirect(`${back}?done=${encodeURIComponent(`${d.label} added.`)}`);
    } catch (e) {
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    }
  });

  post('/o/:slug/events/:eventSlug/setup/price', async (ctx) => {
    const { org, event } = await eventFor(ctx, { toSchedule: true });
    const form = await ctx.form();
    const back = `/o/${org.slug}/events/${event.slug}/setup`;
    try {
      // Typed in dollars because that is what the form says; stored in cents
      // because money in a float is how a total comes out a penny wrong.
      const amountCents = Math.round(Number(form.amount) * 100);
      if (!Number.isFinite(amountCents) || amountCents < 0)
        throw new Invalid('That is not a price');
      await competition.setPrice(ctx.me.accountId, event.id, {
        forCount: +form.forCount, amountCents, membersOnly: !!form.membersOnly });
      return ctx.redirect(`${back}?done=${encodeURIComponent('Price set.')}`);
    } catch (e) {
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    }
  });
}
