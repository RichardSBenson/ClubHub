/**
 * Routes: first aid, police vetting and the like — who holds what, and what has lapsed.
 */
import { people, qualifications, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readQualification, readAward } from '../core/domain/qualification.mjs';

export function registerQualificationRoutes({ get, post, UUID_RE, organisationFor, mayManageAt }) {
  // ---- qualifications and compliance ----------------------------------------------

  async function complianceScreen(ctx, org, extra = {}) {
    return ctx.send(extra.status ?? 200, V.complianceScreen({ me: ctx.me, org, csrf: ctx.csrf,
      ...(await qualifications.compliance(ctx.me.accountId, org.id)),
      ...(await qualifications.catalogue(ctx.me.accountId, org.id)),
      canDefine: await mayManageAt(ctx, org.id),
      done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...extra }));
  }
  const complianceBack = (org, kind, text) => `/o/${org.slug}/compliance?${kind}=${encodeURIComponent(text)}`;

  get('/o/:slug/compliance', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    return complianceScreen(ctx, org);
  });

  post('/o/:slug/compliance/qualifications', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await ctx.form();
    try {
      if (form.starter) await qualifications.addStarter(ctx.me.accountId, org.id, String(form.starter));
      else await qualifications.define(ctx.me.accountId, org.id, readQualification(form));
      return ctx.redirect(complianceBack(org, 'done', 'Added.'));
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(complianceBack(org, 'error', e.message)); throw e; }
  });

  post('/o/:slug/compliance/qualifications/:id/remove', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    await ctx.form();
    if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Qualification');
    try {
      await qualifications.retire(ctx.me.accountId, org.id, ctx.params.id);
      return ctx.redirect(complianceBack(org, 'done', 'Removed.'));
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(complianceBack(org, 'error', e.message)); throw e; }
  });

  post('/o/:slug/compliance/reminders', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await ctx.form();
    try {
      await qualifications.setReminders(ctx.me.accountId, org.id, form.enabled === '1');
      return ctx.redirect(complianceBack(org, 'done', form.enabled === '1' ? 'Automatic reminders are on.' : 'Automatic reminders are off.'));
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(complianceBack(org, 'error', e.message)); throw e; }
  });

  async function personQualsScreen(ctx, extra = {}) {
    ctx.requireActor();
    if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Person');
    const { person } = await people.record(ctx.me.accountId, ctx.params.id);
    return ctx.send(extra.status ?? 200, V.personQualifications({ me: ctx.me, csrf: ctx.csrf, person,
      ...(await qualifications.forPerson(ctx.me.accountId, ctx.params.id, { staffOnly: true })),
      done: ctx.url.searchParams.get('done'), ...extra }));
  }

  get('/p/:id/qualifications', async (ctx) => personQualsScreen(ctx));

  post('/p/:id/qualifications', async (ctx) => {
    ctx.requireActor();
    if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Person');
    const form = await ctx.form();
    const input = readAward(form);
    try {
      await qualifications.record(ctx.me.accountId, ctx.params.id, input);
      return ctx.redirect(`/p/${ctx.params.id}/qualifications?done=${encodeURIComponent('Recorded.')}`);
    } catch (e) { if (e instanceof Invalid) return personQualsScreen(ctx, { status: 422, error: e.message, values: input }); throw e; }
  });

  post('/p/:id/qualifications/:awardId/remove', async (ctx) => {
    ctx.requireActor();
    await ctx.form();
    if (!UUID_RE.test(ctx.params.id) || !UUID_RE.test(ctx.params.awardId)) throw new NotFound('Record');
    await qualifications.removeAward(ctx.me.accountId, ctx.params.id, ctx.params.awardId);
    return ctx.redirect(`/p/${ctx.params.id}/qualifications?done=${encodeURIComponent('Removed.')}`);
  });
}
