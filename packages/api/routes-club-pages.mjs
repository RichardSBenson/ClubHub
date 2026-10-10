/**
 * Routes: a club's own page on the federation's website.
 */
import { lookups, gallery, orgs, assets, clubPages, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { BadUpload } from './multipart.mjs';
import { fitFor } from '../content/image-slots.mjs';
import { identify, NotAnImage, MAX_BYTES } from '../content/images.mjs';
import { readClubPage, problemsWithClubPage, ClubPageNotReady } from '../core/domain/club-page.mjs';
import * as R from '../site/render.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';
import { esc } from '../core/domain/html.mjs';

export function registerClubPageRoutes({ get, post, mayPublishAt, organisationFor }) {
  // ---- a club's page on the federation's website -----------------------------
  //
  // The club writes what the page says. The federation decides whether it goes
  // up under the federation's name, in the federation's design. Two screens, two
  // sets of permissions: /club-page is the club's, /club-pages is the
  // federation's overview of every club beneath it.

  async function clubPageScreen(ctx, org, extra = {}) {
    const { club, profile, sessions, state, problems } =
      await clubPages.forClub(ctx.me.accountId, org.id);
    return ctx.send(extra.status ?? 200, V.clubPageEditor({
      me: ctx.me, org: club, csrf: ctx.csrf, profile, sessions, state, problems,
      images: await assets.list(ctx.me.accountId, org.id),
      canAsk: await mayPublishAt(ctx, org.id),
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
      rebuild: ctx.url.searchParams.get('rebuild'),
      ...extra,
    }));
  }

  get('/o/:slug/club-page', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    // A federation has no page of this kind; what it has is the list of its clubs.
    if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/club-pages`);
    return clubPageScreen(ctx, org);
  });

  post('/o/:slug/club-page', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const { fields: form, files } = await ctx.upload({
      maxBytes: MAX_BYTES + 256 * 1024 });
    const read = readClubPage(form);

    // A picture chosen here is uploaded here, as the article editor does it:
    // nobody should have to leave a half-filled form to go and find one.
    const hero = files.find((f) => f.field === 'heroFile' && f.bytes.length);
    let heroWarning = null;
    if (hero) {
      try {
        const created = await assets.create(ctx.me.accountId, org.id, {
          bytes: hero.bytes, identified: identify(hero.bytes, { filename: hero.filename }),
          filename: hero.filename, altText: form.heroAlt,
        });
        read.profile.hero_asset_id = created.id;
        heroWarning = fitFor('hero', identify(hero.bytes, { filename: hero.filename }))[0];
      } catch (e) {
        if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid)
          return clubPageScreen(ctx, org, { status: 422, error: e.message,
            values: read });
        throw e;
      }
    }

    const problems = problemsWithClubPage(read);
    if (problems.length)
      return clubPageScreen(ctx, org, { status: 422, values: read,
        error: problems.join(' ') });

    try {
      const after = await clubPages.save(ctx.me.accountId, org.id, read);
      // A live page that was edited has to be rebuilt to show it.
      const rebuild = after.state === 'live'
        ? await requestRebuild({ reason: `club page ${org.slug}` }) : null;
      return ctx.redirect(`/o/${org.slug}/club-page?done=${
        encodeURIComponent('Saved.' + (heroWarning ? ' ' + heroWarning : ''))}${rebuild
        ? '&rebuild=' + encodeURIComponent(rebuild.detail) : ''}`);
    } catch (e) {
      if (e instanceof ClubPageNotReady || e instanceof Invalid)
        return clubPageScreen(ctx, org, { status: 422, values: read, error: e.message });
      throw e;
    }
  });

  post('/o/:slug/club-page/request', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    await ctx.form();
    const back = `/o/${org.slug}/club-page`;
    try {
      await clubPages.request(ctx.me.accountId, org.id);
      return ctx.redirect(`${back}?done=${encodeURIComponent(
        'Asked. The federation will look at your page and answer here.')}`);
    } catch (e) {
      if (e instanceof ClubPageNotReady || e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  post('/o/:slug/club-page/takedown', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    await ctx.form();
    const before = await clubPages.forClub(ctx.me.accountId, org.id);
    await clubPages.takeDown(ctx.me.accountId, org.id);
    const rebuild = before.state === 'live'
      ? await requestRebuild({ reason: `club page down ${org.slug}` }) : null;
    return ctx.redirect(`/o/${org.slug}/club-page?done=${encodeURIComponent(
      before.state === 'live' ? 'Your page is off the website.'
        : 'Request withdrawn.')}${rebuild
      ? '&rebuild=' + encodeURIComponent(rebuild.detail) : ''}`);
  });

  /**
   * The page as the federation's site will show it, in the federation's design.
   * The same renderer the build uses, for the reason the page preview does.
   */
  get('/o/:slug/club-page/preview', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const { club, profile, sessions } = await clubPages.forClub(ctx.me.accountId, org.id);

    const { repositories } = await import('../infrastructure/factory.mjs');
    const { site } = await repositories();
    const federation = await lookups.rootOf(club.id) ?? club;
    const brand = await site.brand(federation.id);
    const vocabulary = await orgs.vocabulary(club.id);

    const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;

    const clubInfo = {
      ...club, ...profile, sessions: sessions.map((t) => ({ ...t,
        starts: t.starts, ends: t.ends })),
      venue_name: profile.venue_name ?? null,
      hero_url: profile.hero_asset_id ? `/a/${profile.hero_asset_id}` : null,
    };
    const html = R.clubPage({
      club: clubInfo, federation, events: await site.eventsFor(club.slug), origin,
      fonts: brand?.fonts ?? { display: 'Bitter', body: 'Source Sans 3' },
      nav: [], base: '', vocabulary,
      gallery: (await gallery.list(ctx.me.accountId, club.id)).map((g) => ({ url: `/a/${g.asset_id}`, alt: g.alt_text, caption: g.caption })),
    });

    ctx.res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow',
      'cache-control': 'no-store',
      'x-frame-options': 'SAMEORIGIN',
    });
    return ctx.res.end(`<div style="position:sticky;top:0;z-index:99;background:#161617;
      color:#F5F5F5;font:14px/1.5 system-ui,sans-serif;padding:10px 18px;display:flex;
      gap:16px;align-items:center;flex-wrap:wrap"><strong>Preview</strong>
      <span style="color:#BDBDBF">How ${esc(federation.name)}'s website will show
      ${esc(club.name)} — ${profile.published
        ? 'this page is live.' : 'nobody else can see this yet.'}</span>
      <a href="/o/${esc(club.slug)}/club-page"
        style="margin-left:auto;color:#F0CE41">Back to editing</a></div>` + html);
  });

  get('/o/:slug/club-pages', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    return ctx.send(200, V.clubPageList({
      me: ctx.me, org, csrf: ctx.csrf,
      clubs: await clubPages.beneath(ctx.me.accountId, org.id),
      vocabulary: await orgs.vocabulary(org.id),
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
      rebuild: ctx.url.searchParams.get('rebuild'),
    }));
  });

  post('/o/:slug/club-pages/:clubId/decide', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const form = await ctx.form();
    const approve = form.answer === 'approve';
    const back = `/o/${org.slug}/club-pages`;
    try {
      const after = await clubPages.decide(ctx.me.accountId, ctx.params.clubId,
        approve, { decidedBy: org.id, note: form.note });
      const rebuild = approve
        ? await requestRebuild({ reason: `club page approved ${after.club.slug}` })
        : null;
      return ctx.redirect(`${back}?done=${encodeURIComponent(approve
        ? `${after.club.name} is on the website.`
        : `${after.club.name}'s request was declined.`)}${rebuild
        ? '&rebuild=' + encodeURIComponent(rebuild.detail) : ''}`);
    } catch (e) {
      if (e instanceof ClubPageNotReady || e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });
}
