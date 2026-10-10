/**
 * Routes: grading days and who sat them.
 */
import { gradings, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readPanel, readResults } from '../core/domain/grading.mjs';

export function registerGradingEventRoutes({ get, post, UUID_RE, organisationFor }) {
  // ---- grading events ------------------------------------------------------------
  //
  // Clubs enter members; whoever runs the grading records the night; finalising
  // writes the register. The older /grading page is the quick way to record a
  // result with no event behind it.

  async function gradingScreen(ctx, org, extra = {}) {
    if (!UUID_RE.test(ctx.params.eventId)) throw new NotFound('Grading');
    return ctx.send(extra.status ?? 200, V.gradingEventScreen({ me: ctx.me, org, csrf: ctx.csrf,
      ...(await gradings.get(ctx.me.accountId, org.id, ctx.params.eventId)),
      done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...extra }));
  }

  get('/o/:slug/gradings', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    return ctx.send(200, V.gradingEventsScreen({ me: ctx.me, org, csrf: ctx.csrf,
      ...(await gradings.list(ctx.me.accountId, org.id)) }));
  });

  get('/o/:slug/gradings/:eventId', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    return gradingScreen(ctx, org);
  });

  const gradingBack = (org, eventId, kind, text) =>
    `/o/${org.slug}/gradings/${eventId}?${kind}=${encodeURIComponent(text)}`;

  post('/o/:slug/gradings/:eventId/fee', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await ctx.form();
    if (!UUID_RE.test(ctx.params.eventId)) throw new NotFound('Grading');
    try {
      await gradings.setFee(ctx.me.accountId, ctx.params.eventId, form.fee);
      return ctx.redirect(gradingBack(org, ctx.params.eventId, 'done', 'Fee saved.'));
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(gradingBack(org, ctx.params.eventId, 'error', e.message)); throw e; }
  });

  post('/o/:slug/gradings/:eventId/enter', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await ctx.form();
    if (!UUID_RE.test(ctx.params.eventId)) throw new NotFound('Grading');
    const ids = Object.keys(form).filter((k) => k.startsWith('pick_') && form[k] === '1')
      .map((k) => k.slice(5)).filter((id) => UUID_RE.test(id));
    try {
      const out = await gradings.enter(ctx.me.accountId, org.id, ctx.params.eventId, ids);
      return ctx.redirect(gradingBack(org, ctx.params.eventId, 'done', `${out.entered} entered.`));
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(gradingBack(org, ctx.params.eventId, 'error', e.message)); throw e; }
  });

  post('/o/:slug/gradings/:eventId/withdraw/:entryId', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    await ctx.form();
    if (!UUID_RE.test(ctx.params.eventId) || !UUID_RE.test(ctx.params.entryId)) throw new NotFound('Entry');
    try {
      await gradings.withdraw(ctx.me.accountId, org.id, ctx.params.entryId);
      return ctx.redirect(gradingBack(org, ctx.params.eventId, 'done', 'Withdrawn.'));
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(gradingBack(org, ctx.params.eventId, 'error', e.message)); throw e; }
  });

  post('/o/:slug/gradings/:eventId/results', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await ctx.form();
    if (!UUID_RE.test(ctx.params.eventId)) throw new NotFound('Grading');
    const ids = Object.keys(form).filter((k) => k.startsWith('result_')).map((k) => k.slice(7)).filter((id) => UUID_RE.test(id));
    try {
      const out = await gradings.finalise(ctx.me.accountId, ctx.params.eventId,
        { results: readResults(form, ids), panelNumbers: readPanel(form.panel), date: String(form.date ?? '') });
      return ctx.redirect(gradingBack(org, ctx.params.eventId, 'done', `Finalised. ${out.awarded.length} awarded.`));
    } catch (e) {
      if (e instanceof Invalid) return gradingScreen(ctx, org, { status: 422, error: e.message,
        values: { panel: form.panel, date: form.date, results: readResults(form, ids) } });
      throw e;
    }
  });

  get('/p/:id/certificate/:recordId', async (ctx) => {
    ctx.requireActor();
    if (!UUID_RE.test(ctx.params.id) || !UUID_RE.test(ctx.params.recordId)) throw new NotFound('Certificate');
    return ctx.send(200, V.certificate({ cert: await gradings.certificate(ctx.me.accountId, ctx.params.id, ctx.params.recordId) }));
  });
}
