/**
 * Routes: finding people and things.
 */
import { orgs, search } from './data.mjs';
import * as V from './views.mjs';

export function registerSearchRoutes({ get }) {
  // ---- search ----------------------------------------------------------------

  /**
   * Finding things.
   *
   * Not scoped to an organisation in the path, because the question "where is
   * Aroha" is asked by somebody who does not know which club she is at. The
   * scoping is in the query — every branch starts from visible_orgs — so this
   * returns exactly what this account may already see and nothing else.
   */
  get('/search', async (ctx) => {
    ctx.requireActor();
    const raw = ctx.url.searchParams.get('q') ?? '';
    const { query, results } = await search.everything(ctx.me.accountId, raw);
    // One person and nothing else matches: that is who was meant, so open them rather than listing one row.
    if (results.length === 1 && results[0].kind === 'person' && ctx.url.searchParams.get('list') !== '1')
      return ctx.redirect(`/p/${results[0].id}`);
    return ctx.send(200, V.searchResults({
      me: ctx.me, csrf: ctx.csrf, query, results,
      vocabulary: await orgs.vocabulary(ctx.me.home?.id ?? null),
    }));
  });
}
