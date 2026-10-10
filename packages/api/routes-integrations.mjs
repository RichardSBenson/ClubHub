/**
 * Routes: API tokens and webhooks.
 */
import { apiTokens, webhooks, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readScopes, readEvents } from '../core/domain/integrations.mjs';
import { originOf } from './route-helpers.mjs';
import { organisationFor } from './access.mjs';

export function registerIntegrationRoutes({ get, post, UUID_RE }) {
  // ---- integrations: tokens and webhooks (owner or administrator)
  async function integrationsScreen(ctx, org, extra = {}) {
    return ctx.send(extra.status ?? 200, V.integrationsScreen({ me: ctx.me, csrf: ctx.csrf, org,
      tokens: await apiTokens.list(ctx.me.accountId, org.id), ...(await webhooks.list(ctx.me.accountId, org.id)),
      scopes: apiTokens.SCOPES, events: webhooks.EVENTS, origin: originOf(ctx),
      done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...extra }));
  }
  const integrationsBack = (org, k, t) => `/o/${org.slug}/integrations?${k}=${encodeURIComponent(t)}`;
  get('/o/:slug/integrations', async (ctx) => integrationsScreen(ctx, await organisationFor(ctx)));
  post('/o/:slug/integrations/tokens', async (ctx) => {
    const org = await organisationFor(ctx);
    const f = await ctx.form();
    try {
      const made = await apiTokens.create(ctx.me.accountId, org.id, { name: f.name, scopes: readScopes(f) });
      return integrationsScreen(ctx, org, { newToken: made.token });
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(integrationsBack(org, 'error', e.message)); throw e; }
  });
  post('/o/:slug/integrations/tokens/:tokenId/revoke', async (ctx) => {
    const org = await organisationFor(ctx);
    if (!UUID_RE.test(ctx.params.tokenId)) throw new NotFound('Token');
    await ctx.form();
    await apiTokens.revoke(ctx.me.accountId, org.id, ctx.params.tokenId);
    return ctx.redirect(integrationsBack(org, 'done', 'Token revoked. It stops working at once.'));
  });
  post('/o/:slug/integrations/webhooks', async (ctx) => {
    const org = await organisationFor(ctx);
    const f = await ctx.form();
    try {
      const made = await webhooks.create(ctx.me.accountId, org.id, { url: f.url, events: readEvents(f) });
      return integrationsScreen(ctx, org, { newSecret: made.secret });
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(integrationsBack(org, 'error', e.message)); throw e; }
  });
  const hookAction = (path, run, text) => post(`/o/:slug/integrations/webhooks/:hookId${path}`, async (ctx) => {
    const org = await organisationFor(ctx);
    if (!UUID_RE.test(ctx.params.hookId)) throw new NotFound('Webhook');
    const f = await ctx.form();
    const out = await run(ctx, org, f);
    return ctx.redirect(integrationsBack(org, 'done', typeof text === 'function' ? text(out) : text));
  });
  hookAction('/test', (ctx, org) => webhooks.sendTest(ctx.me.accountId, org.id, ctx.params.hookId),
    (r) => r?.status === 'delivered' ? 'The test message was delivered.' : `The test message was not delivered: ${r?.last_error ?? 'no answer'}`);
  hookAction('/on', (ctx, org) => webhooks.setActive(ctx.me.accountId, org.id, ctx.params.hookId, true), 'Switched on.');
  hookAction('/off', (ctx, org) => webhooks.setActive(ctx.me.accountId, org.id, ctx.params.hookId, false), 'Switched off.');
  hookAction('/remove', (ctx, org) => webhooks.remove(ctx.me.accountId, org.id, ctx.params.hookId), 'Removed.');
}
