/**
 * Routes: what a club has been paid, and asking for more.
 */
import { payments, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readPaymentRequest } from '../core/domain/payments.mjs';
import { isTestProvider } from '../infrastructure/payments/providers.mjs';

export function registerClubPaymentRoutes({ get, post, UUID_RE, providerNow, organisationFor }) {
  // ---- what a club has been paid, and asking for more ---------------------------

  async function paymentsScreen(ctx, org, extra = {}) {
    return ctx.send(extra.status ?? 200, V.paymentsScreen({
      me: ctx.me, org, csrf: ctx.csrf, test: isTestProvider(providerNow()),
      ...(await payments.receivedBy(ctx.me.accountId, org.id)),
      done: ctx.url.searchParams.get('done'), ...extra }));
  }

  get('/o/:slug/payments', async (ctx) => paymentsScreen(ctx, await organisationFor(ctx)));

  post('/o/:slug/payments', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    const input = readPaymentRequest(form);
    try {
      await payments.request(ctx.me.accountId, org.id, input);
      return ctx.redirect(`/o/${org.slug}/payments?done=${encodeURIComponent('Asked. They will see it under Payments.')}`);
    } catch (e) {
      if (e instanceof Invalid)
        return paymentsScreen(ctx, org, { status: 422, error: e.message, values: { ...form, amountText: input.amountText } });
      throw e;
    }
  });

  post('/o/:slug/payments/:paymentId/received', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    if (!UUID_RE.test(ctx.params.paymentId)) throw new NotFound('Payment');
    try {
      const pay = await payments.recordManual(ctx.me.accountId, ctx.params.paymentId, form.method);
      return ctx.redirect(`/o/${org.slug}/payments?done=${encodeURIComponent(`Recorded. Receipt ${pay.receipt_no}.`)}`);
    } catch (e) {
      if (e instanceof Invalid) return paymentsScreen(ctx, org, { status: 422, error: e.message });
      throw e;
    }
  });
}
