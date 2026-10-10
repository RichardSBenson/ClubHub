/**
 * Routes: adding and correcting a member.
 */
import { orgs, people } from './data.mjs';
import * as V from './views.mjs';
import { memberFieldsFrom } from './route-helpers.mjs';
import { organisationFor } from './access.mjs';

export function registerMemberRoutes({ get, post }) {
  // ---- adding and correcting a member ---------------------------------------



  get('/o/:slug/members/new', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    return ctx.send(200, V.memberForm({
      me: ctx.me, org, csrf: ctx.csrf, isNew: true,
      vocabulary: await orgs.vocabulary(org.id),
      values: { role: 'member' },
    }));
  });

  post('/o/:slug/members/new', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await ctx.form();

    try {
      const person = await people.enrol(ctx.me.accountId, {
        organisationId: org.id,
        ...memberFieldsFrom(form),
        role: form.role || 'member',
        starts: form.starts?.trim() || null,
      });
      return ctx.redirect(`/p/${person.id}`);
    } catch (e) {
      return ctx.send(e.status ?? 422, V.memberForm({
        me: ctx.me, org, csrf: ctx.csrf, isNew: true, error: e.message,
        vocabulary: await orgs.vocabulary(org.id), values: form,
      }));
    }
  });
}
