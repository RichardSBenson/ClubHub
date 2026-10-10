/**
 * Routes: enquiries from a club's public website, and the club's inbox for them.
 */
import { lookups, enquiries, TooMany, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readEnquiry, looksLikeRobot } from '../core/domain/enquiry.mjs';
import { messengerFrom } from '../infrastructure/messaging/messengers.mjs';
import { sendingAddress, ipHash } from './route-helpers.mjs';
import { organisationFor } from './access.mjs';

export function registerEnquiryRoutes({ get, post, UUID_RE }) {

  // ---- website enquiries -----------------------------------------------------------
  //
  // The public door is /enquire/:slug. Anybody may post to it; it is protected
  // by a same-site check, a hidden honeypot box, rate limits and length limits.


  async function enquiryClub(slug) {
    const org = await lookups.activeClub(slug);
    if (!org) throw new NotFound('Organisation');
    return org;
  }

  get('/enquire/:slug/thanks', async (ctx) => {
    const org = await enquiryClub(ctx.params.slug);
    return ctx.send(200, V.enquiryPage({ csrf: ctx.csrf, club: org.name, sent: true }));
  });

  get('/enquire/:slug', async (ctx) => {
    const org = await enquiryClub(ctx.params.slug);
    const kind = ctx.url.searchParams.get('kind') === 'trial' ? 'trial' : 'contact';
    return ctx.send(200, V.enquiryPage({ csrf: ctx.csrf, club: org.name, kind, action: `/enquire/${org.slug}` }));
  });

  post('/enquire/:slug', async (ctx) => {
    const form = await ctx.publicForm();
    const org = await enquiryClub(ctx.params.slug);
    // A robot filled the hidden box. Say thank you and keep nothing.
    if (looksLikeRobot(form)) return ctx.redirect(`/enquire/${org.slug}/thanks`);
    const input = readEnquiry(form);
    try {
      await enquiries.submit({ slug: org.slug, input, ipHash: ipHash(ctx.ip),
        messenger: messengerFrom(), baseFrom: sendingAddress() });
      return ctx.redirect(`/enquire/${org.slug}/thanks`);
    } catch (e) {
      if (e instanceof Invalid || e instanceof TooMany)
        return ctx.send(e.status ?? 422, V.enquiryPage({ csrf: ctx.csrf, club: org.name, kind: input.kind,
          action: `/enquire/${org.slug}`, values: input, error: e.message }));
      throw e;
    }
  });

  async function enquiriesScreen(ctx, org, extra = {}) {
    return ctx.send(extra.status ?? 200, V.enquiriesScreen({ me: ctx.me, org, csrf: ctx.csrf,
      ...(await enquiries.inbox(ctx.me.accountId, org.id)),
      done: ctx.url.searchParams.get('done'), ...extra }));
  }

  get('/o/:slug/enquiries', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    return enquiriesScreen(ctx, org);
  });

  post('/o/:slug/enquiries/:id/handled', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await ctx.form();
    if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Enquiry');
    await enquiries.mark(ctx.me.accountId, org.id, ctx.params.id, form.handled === '1');
    return ctx.redirect(`/o/${org.slug}/enquiries`);
  });

  post('/o/:slug/enquiries/:id/delete', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    await ctx.form();
    if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Enquiry');
    await enquiries.remove(ctx.me.accountId, org.id, ctx.params.id);
    return ctx.redirect(`/o/${org.slug}/enquiries?done=${encodeURIComponent('Deleted.')}`);
  });
}
