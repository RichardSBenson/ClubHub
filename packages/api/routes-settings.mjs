/**
 * Routes: country settings (currency, language, age of adulthood) and the grading timetable.
 *
 * Registered from server.mjs, which owns the router and the helpers these need.
 */
import { orgs, rank, Forbidden, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readRegionForm } from '../core/domain/region.mjs';
import { readTimetable } from '../core/domain/next-grading.mjs';
import { readEventTypesForm, problemsWithEventTypes } from '../core/domain/event-types.mjs';

export function registerSettingsRoutes({ get, post, organisationFor, mayPublishAt, requestRebuild }) {
  async function regionPage(ctx, org, extra = {}) {
    const own = await orgs.ownRegion(org.id);
    return ctx.send(extra.status ?? 200, V.regionSettings({ me: ctx.me, csrf: ctx.csrf, org, own, inherited: await orgs.regionOf(org.id),
      done: ctx.url.searchParams.get('done'), ...extra }));
  }
  get('/o/:slug/region', async (ctx) => {
    const org = await organisationFor(ctx);
    if (!await mayPublishAt(ctx, org.id)) throw new Forbidden('Changing country settings needs an owner or administrator.');
    return regionPage(ctx, org);
  });
  post('/o/:slug/region', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    try {
      await orgs.saveRegion(ctx.me.accountId, org.id, readRegionForm(form));
      await requestRebuild({ reason: 'country settings' });
      return ctx.redirect(`/o/${org.slug}/region?done=${encodeURIComponent('Saved.')}`);
    } catch (e) {
      if (e instanceof Invalid) return regionPage(ctx, org, { status: 422, error: e.message, values: readRegionForm(form) });
      throw e;
    }
  });

  /** The gaps between gradings: set once for the federation that owns the ladder. */
  const timetablePage = async (ctx, org, extra = {}) => {
    const owner = await orgs.ladderOwnerOf(org.id);
    if (!owner) throw new Invalid('There is no grading ladder here yet.');
    return ctx.send(extra.status ?? 200, V.gradingTimetable({ me: ctx.me, csrf: ctx.csrf, org, owner, ladder: await rank.ladder(owner.id),
      done: ctx.url.searchParams.get('done'), ...extra }));
  };
  get('/o/:slug/timetable', async (ctx) => {
    const org = await organisationFor(ctx);
    if (!await mayPublishAt(ctx, org.id)) throw new Forbidden('Changing the grading timetable needs an owner or administrator.');
    return timetablePage(ctx, org);
  });
  post('/o/:slug/timetable', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    const owner = await orgs.ladderOwnerOf(org.id);
    if (!owner) throw new Invalid('There is no grading ladder here yet.');
    const { rows, problems } = readTimetable(form, await rank.ladder(owner.id));
    if (problems.length) return timetablePage(ctx, org, { status: 422, error: problems.join(' ') });
    await rank.setTimetable(ctx.me.accountId, owner.id, rows);
    return ctx.redirect(`/o/${org.slug}/timetable?done=${encodeURIComponent('Saved.')}`);
  });

  /** The kinds of event this federation runs, and how each is announced. */
  const typesPage = async (ctx, org, extra = {}) =>
    ctx.send(extra.status ?? 200, V.eventTypesEditor({ me: ctx.me, csrf: ctx.csrf, org, types: extra.types ?? await orgs.eventTypesOf(org.id),
      own: !!(await orgs.hasOwnEventTypes(org.id)), done: ctx.url.searchParams.get('done'), ...extra }));
  get('/o/:slug/event-types', async (ctx) => {
    const org = await organisationFor(ctx);
    if (!await mayPublishAt(ctx, org.id)) throw new Forbidden('Changing the kinds of event needs an owner or administrator.');
    return typesPage(ctx, org);
  });
  post('/o/:slug/event-types', async (ctx) => {
    const org = await organisationFor(ctx);
    const types = readEventTypesForm(await ctx.form());
    const problems = problemsWithEventTypes(types);
    if (problems.length) return typesPage(ctx, org, { status: 422, error: problems.join(' '), types });
    await orgs.saveEventTypes(ctx.me.accountId, org.id, types);
    await requestRebuild({ reason: 'event types' });
    return ctx.redirect(`/o/${org.slug}/event-types?done=${encodeURIComponent('Saved.')}`);
  });
}
