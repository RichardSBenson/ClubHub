/**
 * Routes: cancelling a payment request.
 */
import { payments, NotFound } from './data.mjs';
import { organisationFor } from './access.mjs';

export function registerPaymentActionRoutes({ post, UUID_RE }) {
  post('/o/:slug/payments/:paymentId/cancel', async (ctx) => {
    const org = await organisationFor(ctx);
    await ctx.form();
    if (!UUID_RE.test(ctx.params.paymentId)) throw new NotFound('Payment');
    await payments.cancel(ctx.me.accountId, org.id, ctx.params.paymentId);
    return ctx.redirect(`/o/${org.slug}/payments?done=${encodeURIComponent('Cancelled.')}`);
  });
}
