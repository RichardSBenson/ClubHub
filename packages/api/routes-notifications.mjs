/**
 * Routes: notifications on this device.
 */
import { myself, payments, push, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readSelfEdit } from '../core/domain/family.mjs';
import { readPayment } from '../core/domain/payments.mjs';

export function registerNotificationRoutes({ get, post, UUID_RE, providerNow, payView }) {
  // ---- notifications on this device
  get('/me/notifications', async (ctx) => {
    ctx.requireActor();
    return ctx.send(200, V.notificationsScreen({ me: ctx.me, csrf: ctx.csrf, ...(await push.status(ctx.me.accountId)),
      done: ctx.url.searchParams.get('done') }));
  });
  post('/push/subscribe', async (ctx) => {
    ctx.requireActor();
    const f = await ctx.form();
    try {
      await push.subscribe(ctx.me.accountId, { endpoint: f.endpoint, p256dh: f.p256dh, auth: f.auth }, ctx.req.headers['user-agent']);
      return ctx.send(200, 'ok');
    } catch (e) { if (e instanceof Invalid) return ctx.send(422, e.message); throw e; }
  });
  post('/push/unsubscribe', async (ctx) => {
    ctx.requireActor();
    const f = await ctx.form();
    await push.unsubscribe(ctx.me.accountId, f.endpoint);
    return ctx.send(200, 'ok');
  });
  post('/me/notifications/:deviceId/remove', async (ctx) => {
    ctx.requireActor();
    if (!UUID_RE.test(ctx.params.deviceId)) throw new NotFound('Device');
    await ctx.form();
    await push.removeDevice(ctx.me.accountId, ctx.params.deviceId);
    return ctx.redirect(`/me/notifications?done=${encodeURIComponent('Removed.')}`);
  });

  get('/me/payments/:paymentId', async (ctx) => { ctx.requireActor(); return payView(ctx); });

  post('/me/payments/:paymentId', async (ctx) => {
    ctx.requireActor();
    const form = await ctx.form();
    if (!UUID_RE.test(ctx.params.paymentId)) throw new NotFound('Payment');
    try {
      await payments.pay(ctx.me.accountId, ctx.params.paymentId, readPayment(form),
        { provider: providerNow() });
    } catch (e) {
      if (e instanceof Invalid) return payView(ctx, { status: 422, error: e.message });
      throw e;
    }
    return ctx.redirect(`/me/payments/${ctx.params.paymentId}`);
  });

  post('/me/payments/:paymentId/complete', async (ctx) => {
    ctx.requireActor();
    const form = await ctx.form();
    if (!UUID_RE.test(ctx.params.paymentId)) throw new NotFound('Payment');
    await payments.completeTest(ctx.me.accountId, ctx.params.paymentId, form.ok === '1',
      { provider: providerNow() });
    return ctx.redirect(`/me/payments/${ctx.params.paymentId}`);
  });

  get('/me/:personId', async (ctx) => {
    ctx.requireActor();
    const record = await myself.get(ctx.me.accountId, ctx.params.personId);
    return ctx.send(200, V.myPerson({ me: ctx.me, csrf: ctx.csrf, ...record,
      done: ctx.url.searchParams.get('done') }));
  });

  post('/me/:personId', async (ctx) => {
    ctx.requireActor();
    const form = await ctx.form();
    try {
      await myself.update(ctx.me.accountId, ctx.params.personId, readSelfEdit(form));
      return ctx.redirect(`/me/${ctx.params.personId}?done=${encodeURIComponent('Saved.')}`);
    } catch (e) {
      if (e instanceof Invalid) {
        const record = await myself.get(ctx.me.accountId, ctx.params.personId);
        return ctx.send(422, V.myPerson({ me: ctx.me, csrf: ctx.csrf, ...record,
          values: form, error: e.message }));
      }
      throw e;
    }
  });
}
