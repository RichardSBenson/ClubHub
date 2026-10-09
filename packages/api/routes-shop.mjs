/**
 * Routes: the shop. A member orders gear through their own club; a club (or the federation, for the national range)
 * runs it.
 *
 * Registered from server.mjs, which owns the router. Must be registered before /me/:personId so the member's
 * /me/shop is not read as a person.
 */
import { family, shop, Invalid, NotFound } from './data.mjs';
import * as V from './views.mjs';
import { readProduct, readListing } from '../core/domain/shop.mjs';
import { words } from '../infrastructure/region-context.mjs';

export function registerShopRoutes({ get, post, organisationFor, UUID_RE }) {
  // The member's side. Registered before /me/:personId.
  async function shopScreenFor(ctx, extra = {}) {
    if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
    return ctx.send(extra.status ?? 200, V.shopScreen({ me: ctx.me, csrf: ctx.csrf, ...(await shop.forPerson(ctx.me.accountId, ctx.params.personId)),
      done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...extra }));
  }
  get('/me/shop', async (ctx) => {
    ctx.requireActor();
    const { self } = await family.mine(ctx.me.accountId);
    if (!self) return ctx.send(200, V.shopPublic({ me: ctx.me, csrf: ctx.csrf }));
    return ctx.redirect(`/me/${self.id}/shop`);
  });
  // /shop is a built page (the federation's range, for anybody to look at); ordering starts here, once signed in.
  get('/me/:personId/shop', async (ctx) => { ctx.requireActor(); return shopScreenFor(ctx); });
  post('/me/:personId/shop', async (ctx) => {
    ctx.requireActor();
    if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
    const f = await ctx.form();
    await family.assertMayActFor(ctx.me.accountId, ctx.params.personId);
    const back = (k, t) => ctx.redirect(`/me/${ctx.params.personId}/shop?${k}=${encodeURIComponent(t)}`);
    try {
      if (!UUID_RE.test(String(f.clubId))) throw new Invalid(`Choose a ${words().club.toLowerCase()}.`);
      await shop.place(ctx.me.accountId, ctx.params.personId, f.clubId, f);
      return back('done', `Ordered. Your ${words().club.toLowerCase()} will let you know when it is ready, and you pay them when you collect it.`);
    } catch (e) { if (e instanceof Invalid) return back('error', e.message); throw e; }
  });
  post('/me/:personId/shop/:orderId/cancel', async (ctx) => {
    ctx.requireActor();
    if (!UUID_RE.test(ctx.params.personId) || !UUID_RE.test(ctx.params.orderId)) throw new NotFound('Order');
    await ctx.form();
    try {
      await shop.cancelMine(ctx.me.accountId, ctx.params.personId, ctx.params.orderId);
      return ctx.redirect(`/me/${ctx.params.personId}/shop?done=${encodeURIComponent('Order cancelled.')}`);
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(`/me/${ctx.params.personId}/shop?error=${encodeURIComponent(e.message)}`); throw e; }
  });

  // The club's (or the federation's) side.
  async function shopAdmin(ctx) {
    const org = await organisationFor(ctx);
    return ctx.send(200, V.shopAdminScreen({ me: ctx.me, csrf: ctx.csrf, ...(await shop.forOrg(ctx.me.accountId, org.id)),
      done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error') }));
  }
  get('/o/:slug/shop', shopAdmin);
  async function shopDo(ctx, work, done) {
    const org = await organisationFor(ctx, { toRegister: true });
    const f = await ctx.form();
    const back = (k, t) => ctx.redirect(`/o/${org.slug}/shop?${k}=${encodeURIComponent(t)}`);
    try { await work(org, f); return back('done', done); }
    catch (e) { if (e instanceof Invalid) return back('error', e.message); throw e; }
  }
  // security-ok: shopDo opens with organisationFor(toRegister), and the data layer asserts the role again
  post('/o/:slug/shop/products', (ctx) => shopDo(ctx, async (org, f) => {
    const r = readProduct(f); if (r.problem) throw new Invalid(r.problem);
    await shop.saveProduct(ctx.me.accountId, org.id, null, r.value);
  }, 'Added.'));
  // security-ok: shopDo opens with organisationFor(toRegister), and the data layer asserts the role again
  post('/o/:slug/shop/products/:productId', (ctx) => shopDo(ctx, async (org, f) => {
    if (!UUID_RE.test(ctx.params.productId)) throw new NotFound('Item');
    const r = readProduct(f); if (r.problem) throw new Invalid(r.problem);
    await shop.saveProduct(ctx.me.accountId, org.id, ctx.params.productId, r.value);
  }, 'Saved.'));
  // security-ok: shopDo opens with organisationFor(toRegister), and the data layer asserts the role again
  post('/o/:slug/shop/products/:productId/active', (ctx) => shopDo(ctx, async (org, f) => {
    if (!UUID_RE.test(ctx.params.productId)) throw new NotFound('Item');
    await shop.setActive(ctx.me.accountId, org.id, ctx.params.productId, f.active === 'yes');
  }, 'Saved.'));
  // security-ok: shopDo opens with organisationFor(toRegister), and the data layer asserts the role again
  post('/o/:slug/shop/listing/:productId', (ctx) => shopDo(ctx, async (org, f) => {
    if (!UUID_RE.test(ctx.params.productId)) throw new NotFound('Item');
    const r = readListing(f); if (r.problem) throw new Invalid(r.problem);
    await shop.setListing(ctx.me.accountId, org.id, ctx.params.productId, r.value);
  }, 'Saved.'));
  // security-ok: shopDo opens with organisationFor(toRegister), and the data layer asserts the role again
  post('/o/:slug/shop/orders/:orderId/status', (ctx) => shopDo(ctx, async (org, f) => {
    if (!UUID_RE.test(ctx.params.orderId)) throw new NotFound('Order');
    await shop.setOrderStatus(ctx.me.accountId, org.id, ctx.params.orderId, f.status);
  }, 'Saved.'));
}
