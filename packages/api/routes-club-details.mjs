/**
 * Routes: a club's own details — venue, hours, contact.
 */
import { clubProfile, Forbidden, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readClubProfile } from '../core/domain/club-profile.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';
import { organisationFor } from './access.mjs';

export function registerClubDetailRoutes({ get, post }) {
  // ---- a club's own details --------------------------------------------------
  //
  // What the club is as an organisation. Address, phone and training times are
  // its PAGE (/club-page) and live there once.

  async function profileScreen(ctx, org, extra = {}) {
    return ctx.send(extra.status ?? 200, V.clubProfileScreen({
      me: ctx.me, org, csrf: ctx.csrf,
      ...(await clubProfile.get(ctx.me.accountId, org.id)),
      done: ctx.url.searchParams.get('done'),
      rebuild: ctx.url.searchParams.get('rebuild'),
      ...extra,
    }));
  }

  get('/o/:slug/profile', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/clubs`);
    return profileScreen(ctx, org);
  });

  post('/o/:slug/profile', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type !== 'club') throw new Forbidden('Only a club has these details.');
    const form = await ctx.form();
    const input = readClubProfile(form);
    try {
      const { siteChanged } = await clubProfile.save(ctx.me.accountId, org.id, input);
      const rebuild = siteChanged
        ? await requestRebuild({ reason: `club ${org.slug}` })
        : { detail: 'Nothing on the website changed.' };
      return ctx.redirect(`/o/${org.slug}/profile?done=${
        encodeURIComponent('Saved.')}&rebuild=${encodeURIComponent(rebuild.detail)}`);
    } catch (e) {
      if (e instanceof Invalid)
        return profileScreen(ctx, org, { status: 422, error: e.message, values: form });
      throw e;
    }
  });
}
