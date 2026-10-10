/**
 * Routes: what a club writes to its people. The permission is checked in the data layer, so these only shape input.
 */
import { messages, emailPreferences, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readMessage } from '../core/domain/messaging.mjs';
import { messengerFrom } from '../infrastructure/messaging/messengers.mjs';
import { sendingAddress, originOf } from './request-helpers.mjs';

export function registerMessageRoutes({ get, post, organisationFor }) {
  // ---- messages ----------------------------------------------------------------
  //
  // A club writes to its own people, as the club. Administrators only; the
  // permission is checked in the data layer, so these routes only shape input.

  async function messagesScreen(ctx, org, extra = {}) {
    const baseFrom = sendingAddress();
    const options = await messages.options(ctx.me.accountId, org.id, { baseFrom });
    return ctx.send(extra.status ?? 200, V.messagesScreen({
      me: ctx.me, org, csrf: ctx.csrf, events: options.events, people: options.people, sender: options.sender,
      history: await messages.history(ctx.me.accountId, org.id),
      done: ctx.url.searchParams.get('done'), ...extra,
    }));
  }

  get('/o/:slug/messages', async (ctx) => messagesScreen(ctx, await organisationFor(ctx)));

  post('/o/:slug/messages', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    try {
      const made = await messages.prepare(ctx.me.accountId, org.id, readMessage(form),
        { baseFrom: sendingAddress() });
      // The first batch goes now; the rest wait behind a button, so a club of
      // two hundred is not a request that outlives its function.
      await messages.sendBatch(ctx.me.accountId, org.id, made.message.id,
        { messenger: messengerFrom(), origin: originOf(ctx) });
      return ctx.redirect(`/o/${org.slug}/messages/${made.message.id}`);
    } catch (e) {
      if (e instanceof Invalid)
        return messagesScreen(ctx, org, { status: 422, error: e.message, values: form });
      throw e;
    }
  });

  async function messageScreen(ctx, org, extra = {}) {
    return ctx.send(extra.status ?? 200, V.messageDetail({
      me: ctx.me, org, csrf: ctx.csrf,
      ...(await messages.get(ctx.me.accountId, org.id, ctx.params.messageId)),
      done: ctx.url.searchParams.get('done'), ...extra,
    }));
  }

  get('/o/:slug/messages/:messageId', async (ctx) =>
    messageScreen(ctx, await organisationFor(ctx)));

  post('/o/:slug/messages/:messageId/send', async (ctx) => {
    const org = await organisationFor(ctx);
    await ctx.form();
    await messages.sendBatch(ctx.me.accountId, org.id, ctx.params.messageId,
      { messenger: messengerFrom(), origin: originOf(ctx) });
    return ctx.redirect(`/o/${org.slug}/messages/${ctx.params.messageId}`);
  });

  post('/o/:slug/messages/:messageId/retry', async (ctx) => {
    const org = await organisationFor(ctx);
    await ctx.form();
    await messages.retryFailed(ctx.me.accountId, org.id, ctx.params.messageId);
    return ctx.redirect(`/o/${org.slug}/messages/${ctx.params.messageId}`);
  });

  // The way out. The token in the link is the authority, so no sign-in is asked
  // for. Opening it only shows the setting; changing it takes a button press, so
  // a mail scanner that fetches every link cannot unsubscribe anybody.
  get('/unsubscribe/:token', async (ctx) => {
    const pref = await emailPreferences.byToken(ctx.params.token);
    if (!pref) throw new NotFound('This link');
    return ctx.send(200, V.unsubscribePage({ csrf: ctx.csrf, token: ctx.params.token,
      first: pref.first_name, optedOut: pref.opted_out,
      changed: ctx.url.searchParams.get('done') === '1' }));
  });

  post('/unsubscribe/:token', async (ctx) => {
    const form = await ctx.form();
    if (!await emailPreferences.setOptOut(ctx.params.token, form.optOut === '1'))
      throw new NotFound('This link');
    return ctx.redirect(`/unsubscribe/${ctx.params.token}?done=1`);
  });
}
