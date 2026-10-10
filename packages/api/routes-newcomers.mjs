/**
 * Routes: people giving it a go.
 */
import { newcomers, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readNewcomer } from '../core/domain/newcomer.mjs';

export function registerNewcomerRoutes({ get, post, UUID_RE, organisationFor }) {
  // ---- newcomers: people giving it a go ----------------------------------------

  async function newcomersScreen(ctx, org, extra = {}) {
    return ctx.send(extra.status ?? 200, V.newcomersScreen({ me: ctx.me, org, csrf: ctx.csrf,
      ...(await newcomers.list(ctx.me.accountId, org.id)),
      done: ctx.url.searchParams.get('done'), ...extra }));
  }

  get('/o/:slug/newcomers', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/clubs`);
    return newcomersScreen(ctx, org);
  });

  get('/o/:slug/newcomers/new', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/clubs`);
    await newcomers.list(ctx.me.accountId, org.id);   // authority
    return ctx.send(200, V.newcomerForm({ me: ctx.me, org, csrf: ctx.csrf,
      sessionId: ctx.url.searchParams.get('session') ?? '', date: ctx.url.searchParams.get('date') ?? '' }));
  });

  post('/o/:slug/newcomers', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    const input = readNewcomer(form);
    const sessionId = UUID_RE.test(String(form.session ?? '')) ? form.session : null;
    const date = sessionId ? String(form.date ?? '') : null;
    try {
      await newcomers.add(ctx.me.accountId, org.id, input, { sessionId, date });
      return ctx.redirect(sessionId
        ? `/o/${org.slug}/attendance/${sessionId}?date=${encodeURIComponent(date)}&done=${encodeURIComponent('Added, and marked as here.')}`
        : `/o/${org.slug}/newcomers?done=${encodeURIComponent('Added.')}`);
    } catch (e) {
      if (e instanceof Invalid) return ctx.send(422, V.newcomerForm({ me: ctx.me, org, csrf: ctx.csrf,
        values: input, error: e.message, sessionId: sessionId ?? '', date: date ?? '' }));
      throw e;
    }
  });

  post('/o/:slug/newcomers/:id/join', async (ctx) => {
    const org = await organisationFor(ctx);
    await ctx.form();
    if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Newcomer');
    try {
      const { person } = await newcomers.join(ctx.me.accountId, org.id, ctx.params.id);
      return ctx.redirect(`/p/${person.id}`);
    } catch (e) {
      if (e instanceof Invalid) return newcomersScreen(ctx, org, { status: 422, error: e.message });
      throw e;
    }
  });

  post('/o/:slug/newcomers/:id/stop', async (ctx) => {
    const org = await organisationFor(ctx);
    await ctx.form();
    if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Newcomer');
    try {
      await newcomers.notContinuing(ctx.me.accountId, org.id, ctx.params.id);
      return ctx.redirect(`/o/${org.slug}/newcomers?done=${encodeURIComponent('Their details have been removed.')}`);
    } catch (e) {
      if (e instanceof Invalid) return newcomersScreen(ctx, org, { status: 422, error: e.message });
      throw e;
    }
  });
}
