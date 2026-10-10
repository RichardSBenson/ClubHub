/**
 * Routes: the forms a club builds, and who has signed them.
 */
import { forms, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { toCsv, fileName } from '../core/domain/csv.mjs';
import { words } from '../infrastructure/region-context.mjs';

export function registerFormRoutes({ get, post, UUID_RE, organisationFor, mayManageAt }) {
  // ---- forms and consent: the builder and who has signed -----------------------------
  const formsBack = (org, id, kind, text) => `/o/${org.slug}/forms${id ? `/${id}` : ''}?${kind}=${encodeURIComponent(text)}`;
  async function formFor(ctx, org, { edit = false } = {}) {
    if (!UUID_RE.test(ctx.params.formId)) throw new NotFound('Form');
    return forms.get(ctx.me.accountId, org.id, ctx.params.formId, { edit });
  }
  get('/o/:slug/forms', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    return ctx.send(200, V.formList({ me: ctx.me, csrf: ctx.csrf, org, ...(await forms.list(ctx.me.accountId, org.id)),
      starters: forms.STARTERS, canManage: await mayManageAt(ctx, org.id),
      done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error') }));
  });
  post('/o/:slug/forms', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const f = await ctx.form();
    try {
      const id = await forms.create(ctx.me.accountId, org.id, { starter: f.starter || null, title: f.title });
      return ctx.redirect(formsBack(org, id, 'done', 'Created. Check the wording, then publish it.'));
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(formsBack(org, null, 'error', e.message)); throw e; }
  });
  get('/o/:slug/forms/:formId', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await formFor(ctx, org);
    return ctx.send(200, V.formEditor({ me: ctx.me, csrf: ctx.csrf, org, form, canManage: await mayManageAt(ctx, org.id),
      done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error') }));
  });
  const formAction = (path, run, ok) => post(`/o/:slug/forms/:formId${path}`, async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    if (!UUID_RE.test(ctx.params.formId)) throw new NotFound('Form');
    const f = await ctx.form();
    try { await run(ctx, org, f); return ctx.redirect(formsBack(org, ctx.params.formId, 'done', ok)); }
    catch (e) { if (e instanceof Invalid) return ctx.redirect(formsBack(org, ctx.params.formId, 'error', e.message)); throw e; }
  });
  const A = (ctx) => ctx.me.accountId;
  formAction('', (ctx, org, f) => forms.save(A(ctx), org.id, ctx.params.formId, f), 'Saved.');
  formAction('/fields', (ctx, org, f) => forms.addField(A(ctx), org.id, ctx.params.formId, f), 'Question added.');
  formAction('/fields/:fieldId', (ctx, org, f) => forms.updateField(A(ctx), org.id, ctx.params.formId, ctx.params.fieldId, f), 'Question saved.');
  formAction('/fields/:fieldId/remove', (ctx, org) => forms.removeField(A(ctx), org.id, ctx.params.formId, ctx.params.fieldId), 'Question removed.');
  formAction('/fields/:fieldId/move', (ctx, org, f) => forms.moveField(A(ctx), org.id, ctx.params.formId, ctx.params.fieldId, f.dir === 'up' ? -1 : 1), 'Moved.');
  formAction('/status', (ctx, org, f) => forms.setStatus(A(ctx), org.id, ctx.params.formId, ['published', 'draft', 'archived'].includes(f.status) ? f.status : 'draft'), 'Updated.');
  formAction('/ask-again', (ctx, org) => forms.askAgain(A(ctx), org.id, ctx.params.formId), 'Everyone will be asked to sign again.');
  get('/o/:slug/forms/:formId/status', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    if (!UUID_RE.test(ctx.params.formId)) throw new NotFound('Form');
    return ctx.send(200, V.formStatus({ me: ctx.me, csrf: ctx.csrf, org, ...(await forms.report(ctx.me.accountId, org.id, ctx.params.formId)),
      filter: ctx.url.searchParams.get('filter') ?? 'all' }));
  });
  get('/o/:slug/forms/:formId/status.csv', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    if (!UUID_RE.test(ctx.params.formId)) throw new NotFound('Form');
    const r = await forms.report(ctx.me.accountId, org.id, ctx.params.formId);
    const W = { current: 'Signed', missing: 'Not signed', expired: 'Run out' };
    return ctx.download(fileName(org.slug, `form-${r.form.title}`, new Date().toISOString().slice(0, 10)), 'text/csv',
      toCsv([{ key: 'number', label: 'Number' }, { key: 'first', label: 'First name' }, { key: 'last', label: 'Last name' }, { key: 'club', label: words().club },
        { key: 'standing', label: 'Status' }, { key: 'signed', label: 'Signed by' }, { key: 'until', label: 'Until' }],
        r.rows.map((p) => ({ number: p.display_number, first: p.first_name, last: p.last_name, club: p.club, standing: W[p.standing],
          signed: p.response?.signed_name ?? '', until: p.response?.expires_on ?? '' }))));
  });
  get('/o/:slug/forms/:formId/people/:personId', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    if (!UUID_RE.test(ctx.params.formId) || !UUID_RE.test(ctx.params.personId)) throw new NotFound('Form');
    const r = await forms.answers(ctx.me.accountId, org.id, ctx.params.formId, ctx.params.personId);
    return ctx.send(200, V.formAnswers({ me: ctx.me, csrf: ctx.csrf, org, ...r }));
  });
}
