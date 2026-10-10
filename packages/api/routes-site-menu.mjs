/**
 * Routes: the website's menu.
 */
import { orgs, navigation, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { destinations, menuFor, MAX_ITEMS } from '../content/navigation.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';
import { organisationFor } from './access.mjs';

export function registerSiteMenuRoutes({ get, post }) {
  // ---- the site menu ---------------------------------------------------------

  get('/o/:slug/menu', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const vocabulary = await orgs.vocabulary(org.id);
    const { stored, authored } = await navigation.forEditing(ctx.me.accountId, org.id);
    return ctx.send(200, V.menuEditor({
      me: ctx.me, org, csrf: ctx.csrf, vocabulary,
      items: menuFor({ stored, authored, vocabulary }),
      destinations: destinations({ authored, vocabulary }),
      max: MAX_ITEMS,
      stored: !!stored,
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
      rebuild: ctx.url.searchParams.get('rebuild'),
    }));
  });

  post('/o/:slug/menu', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const form = await ctx.form();
    const vocabulary = await orgs.vocabulary(org.id);
    const back = `/o/${org.slug}/menu`;

    // The form posts a fixed number of rows; blank ones are not items.
    const items = [];
    for (let i = 0; i < MAX_ITEMS; i++) {
      const href = String(form[`href${i}`] ?? '').trim();
      if (!href) continue;
      items.push({ href, label: String(form[`label${i}`] ?? '').trim() });
    }

    try {
      await navigation.save(ctx.me.accountId, org.id, items, { vocabulary });
      const rebuild = await requestRebuild({ reason: `menu ${org.slug}` });
      return ctx.redirect(`${back}?done=${encodeURIComponent('Menu saved.')}`
        + '&rebuild=' + encodeURIComponent(rebuild.detail));
    } catch (e) {
      if (e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });
}
