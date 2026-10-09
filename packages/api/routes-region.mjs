/**
 * Routes: country settings (currency, language, age of adulthood).
 *
 * Registered from server.mjs, which owns the router and the helpers these need.
 */
import { orgs, Forbidden, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readRegionForm } from '../core/domain/region.mjs';

export function registerRegionRoutes({ get, post, organisationFor, mayPublishAt, requestRebuild }) {
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
}
