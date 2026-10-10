/**
 * Routes: the club's own prices, who is due, and who is not charged.
 */
import { messages, fees, renewals, autoRenew, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readFee, readExemption, reminderText } from '../core/domain/membership.mjs';
import { messengerFrom } from '../infrastructure/messaging/messengers.mjs';
import { sendingAddress, originOf } from './route-helpers.mjs';
import { organisationFor, mayManageAt } from './access.mjs';

export function registerRenewalRoutes({ get, post, UUID_RE }) {
  // ---- renewals: the club's own prices, who is due, who is not charged -----------

  async function renewalsScreen(ctx, org, extra = {}) {
    const actor = ctx.me.accountId;
    const { today, rows } = await renewals.roster(actor, org.id);
    const canSetPrices = await mayManageAt(ctx, org.id);
    return ctx.send(extra.status ?? 200, V.renewalsScreen({
      me: ctx.me, org, csrf: ctx.csrf, today, rows, prices: await fees.list(actor, org.id),
      auto: await autoRenew.forClub(actor, org.id),
      canSetPrices, canExempt: canSetPrices, reminderText: reminderText('due'),
      autoReminders: await renewals.reminderSetting(org.id),
      done: ctx.url.searchParams.get('done'), ...extra }));
  }

  get('/o/:slug/renewals', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/clubs`);
    return renewalsScreen(ctx, org);
  });

  post('/o/:slug/renewals', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    const ids = Object.keys(form).filter((k) => k.startsWith('pick_') && form[k] === '1')
      .map((k) => k.slice(5)).filter((id) => UUID_RE.test(id));
    if (form.action === 'remind') {
      try {
        const made = await renewals.remind(ctx.me.accountId, org.id,
          { affiliationIds: ids, subject: form.subject, body: form.body }, { baseFrom: sendingAddress() });
        await messages.sendBatch(ctx.me.accountId, org.id, made.message.id,
          { messenger: messengerFrom(), origin: originOf(ctx), trusted: true });
        return ctx.redirect(`/o/${org.slug}/messages/${made.message.id}`);
      } catch (e) {
        if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message });
        throw e;
      }
    }
    try {
      const out = await renewals.ask(ctx.me.accountId, org.id,
        { affiliationIds: ids, period: form.period, received: form.received });
      const notes = out.skipped.map((s) => `${s.name}: ${s.reason}`);
      return renewalsScreen(ctx, org, { done: `${out.asked} renewal${out.asked === 1 ? '' : 's'} ${
        form.received ? 'recorded' : 'asked for'}.`, notes });
    } catch (e) {
      if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message });
      throw e;
    }
  });

  post('/o/:slug/renewals/reminders', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    await renewals.setReminders(ctx.me.accountId, org.id, form.enabled === '1');
    return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent(
      form.enabled === '1' ? 'Automatic reminders are on.' : 'Automatic reminders are off.')}`);
  });

  post('/o/:slug/renewals/fees', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    const input = readFee(form);
    try {
      await fees.save(ctx.me.accountId, org.id, input);
      return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent('Price saved.')}`);
    } catch (e) {
      if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message, values: input });
      throw e;
    }
  });

  post('/o/:slug/renewals/fees/:feeId/remove', async (ctx) => {
    const org = await organisationFor(ctx);
    await ctx.form();
    if (!UUID_RE.test(ctx.params.feeId)) throw new NotFound('Price');
    await fees.remove(ctx.me.accountId, org.id, ctx.params.feeId);
    return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent('Price removed.')}`);
  });

  post('/o/:slug/renewals/:affiliationId/exempt', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    if (!UUID_RE.test(ctx.params.affiliationId)) throw new NotFound('Member');
    try {
      await renewals.setExemption(ctx.me.accountId, org.id, ctx.params.affiliationId, readExemption(form));
      return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent('Saved.')}`);
    } catch (e) {
      if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message });
      throw e;
    }
  });

  post('/o/:slug/renewals/:affiliationId/carry-on', async (ctx) => {
    const org = await organisationFor(ctx);
    await ctx.form();
    if (!UUID_RE.test(ctx.params.affiliationId)) throw new NotFound('Member');
    try {
      const until = await renewals.carryOn(ctx.me.accountId, org.id, ctx.params.affiliationId);
      return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent(`Carried on to ${until}.`)}`);
    } catch (e) {
      if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message });
      throw e;
    }
  });
}
