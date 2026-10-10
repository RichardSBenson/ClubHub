/**
 * Routes: a club's website pages.
 */
import { lookups, orgs, pages, assets } from './data.mjs';
import * as V from './views.mjs';
import { documentFromText, textFromDocument } from '../content/document-text.mjs';
import { looksEmpty } from '../content/page-form.mjs';
import { renderBlocks, excerpt } from '../content/blocks.mjs';
import * as R from '../site/render.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';
import { slugify } from './route-helpers.mjs';
import { mayPublishAt, organisationFor } from './access.mjs';

export function registerWebsiteRoutes({ get, post }) {
  // ---- the website ----------------------------------------------------------



  get('/o/:slug/pages', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    return ctx.send(200, V.pageList({
      me: ctx.me, org, csrf: ctx.csrf,
      pages: await pages.list(ctx.me.accountId, org.id),
      canPublish: await mayPublishAt(ctx, org.id),
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
      rebuild: ctx.url.searchParams.get('rebuild'),
    }));
  });

  get('/o/:slug/pages/new', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    return ctx.send(200, V.pageEditor({
      me: ctx.me, org, csrf: ctx.csrf,
      images: await assets.list(ctx.me.accountId, org.id),
      values: { body: '' },
      canPublish: await mayPublishAt(ctx, org.id),
    }));
  });

  /**
   * One handler for every button on the editor.
   *
   * Moving a block, removing one, adding one, saving, publishing — all of them
   * post the whole form, because the page has no JavaScript to do it any other
   * way. The structural operations re-render without touching the database;
   * only save, publish and unpublish write.
   */
  async function editorPost(ctx, { org, page = null }) {
    const form = await ctx.form();
    const op = String(form.op ?? 'save');
    const canPublish = await mayPublishAt(ctx, org.id);

    // One box of text, parsed into blocks. What comes back out still goes
    // through the whitelist in pages.save, so the editor is not a way past it.
    const images = await assets.list(ctx.me.accountId, org.id);
    const body = String(form.body ?? '');
    // Pictures are referred to by filename in the box and by id in the
    // document, so the list is needed on the way in as well as out.
    const doc = documentFromText(body, { images });

    const title = String(form.title ?? '').trim();
    const slug = slugify(form.slug || title);

    const render = async (extra = {}) => ctx.send(extra.status ?? 200, V.pageEditor({
      me: ctx.me, org, page, csrf: ctx.csrf, canPublish, images,
      scheduledFor: page ? await pages.scheduledFor(page.id) : null,
      today: new Date().toISOString().slice(0, 10),
      values: { body, title, slug,
                metaDescription: form.metaDescription ?? '' },
      ...extra,
    }));

    if (!title) return render({ status: 422, error: 'The page needs a title.' });
    if (!slug) return render({ status: 422,
      error: 'The page needs a web address. Give it a title with some letters '
        + 'in it, or type one.' });

    // Said before the save rather than after, so a half-written page comes back
    // with everything still in it instead of being refused by the database.
    if (looksEmpty(doc)) {
      return render({ status: 422,
        error: 'There is nothing on this page yet. Add something and type into '
          + 'it before saving.' });
    }

    try {
      const { page: saved, dropped } = await pages.save(ctx.me.accountId, {
        pageId: page?.id ?? null,
        organisationId: page ? null : org.id,
        slug, title, body: doc,
        metaTitle: null,
        metaDescription: form.metaDescription?.trim() || null,
        note: page ? null : 'Created',
      });

      if (op === 'publish' || op === 'unpublish') {
        if (!canPublish) {
          return render({ status: 403, page: saved,
            error: 'Your changes are saved. Putting a page in front of the '
              + 'public needs an owner or administrator.' });
        }
        if (op === 'publish') await pages.publish(ctx.me.accountId, saved.id);
        else await pages.unpublish(ctx.me.accountId, saved.id);

        // Saved first, rebuild asked for second, and the answer is passed on
        // whatever it is. Reporting "published" while the site is unchanged is
        // worse than not publishing at all.
        const rebuild = await requestRebuild({
          reason: `${op} ${org.slug}/${slug}` });

        return ctx.redirect(`/o/${org.slug}/pages?done=`
          + encodeURIComponent(op === 'publish'
            ? `"${saved.title}" is published.` : `"${saved.title}" is off the site.`)
          + '&rebuild=' + encodeURIComponent(rebuild.detail));
      }

      if (op === 'schedule' || op === 'unschedule') {
        if (!canPublish) return render({ status: 403, page: saved,
          error: 'Your changes are saved. Scheduling needs an owner or administrator.' });
        if (op === 'schedule') await pages.schedule(ctx.me.accountId, saved.id, String(form.publishOn ?? ''));
        else await pages.unschedule(ctx.me.accountId, saved.id);
        return ctx.redirect(`/o/${org.slug}/pages/${saved.id}?done=`
          + encodeURIComponent(op === 'schedule' ? `Scheduled for ${String(form.publishOn)}.` : 'No longer scheduled.'));
      }

      if (dropped.length) {
        return render({ page: saved, dropped,
          done: 'Saved as a draft.' });
      }
      return ctx.redirect(`/o/${org.slug}/pages/${saved.id}?done=`
        + encodeURIComponent('Saved as a draft.'));
    } catch (e) {
      return render({ status: e.status ?? 422, error: e.message });
    }
  }

  post('/o/:slug/pages/new', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    return editorPost(ctx, { org });
  });

  get('/o/:slug/pages/:pageId', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const pg = await pages.byId(ctx.me.accountId, ctx.params.pageId);
    const doc = pg.body ?? { blocks: [] };

    const images = await assets.list(ctx.me.accountId, org.id);
    return ctx.send(200, V.pageEditor({
      me: ctx.me, org, page: pg, csrf: ctx.csrf, images,
      scheduledFor: await pages.scheduledFor(pg.id), today: new Date().toISOString().slice(0, 10),
      values: { body: textFromDocument(doc, { images }),
                title: pg.title, slug: pg.slug,
                metaDescription: pg.meta_description ?? '' },
      revisions: await pages.revisions(ctx.me.accountId, pg.id),
      canPublish: await mayPublishAt(ctx, org.id),
      done: ctx.url.searchParams.get('done'),
    }));
  });

  post('/o/:slug/pages/:pageId', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const pg = await pages.byId(ctx.me.accountId, ctx.params.pageId);
    return editorPost(ctx, { org, page: pg });
  });

  post('/o/:slug/pages/:pageId/restore', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const form = await ctx.form();
    const back = `/o/${org.slug}/pages/${ctx.params.pageId}`;
    try {
      await pages.restore(ctx.me.accountId, form.revisionId);
      return ctx.redirect(`${back}?done=`
        + encodeURIComponent('Put back to that version. It is a draft until you '
          + 'publish it again.'));
    } catch (e) {
      return ctx.redirect(`${back}?done=${encodeURIComponent(e.message)}`);
    }
  });

  /**
   * The page as a visitor will see it.
   *
   * Rendered by the SAME function the published site uses, with the same blocks,
   * the same layout, the same live data pulled in. A preview that renders a
   * second way is a preview of something nobody will ever see, and it drifts —
   * the only question is when somebody notices.
   *
   * This is also what makes a static site bearable to edit: the published page
   * takes a minute to rebuild, and nobody waits on it, because this is exact.
   */
  get('/o/:slug/pages/:pageId/preview', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const pg = await pages.byId(ctx.me.accountId, ctx.params.pageId);

    const { repositories } = await import('../infrastructure/factory.mjs');
    const { site } = await repositories();

    // The federation whose site this page belongs to, and its own words for
    // things — a taekwondo club's preview must not say "club".
    const root = await lookups.rootOf(org.id);
    const federation = root ?? org;

    const [brand, clubRows, evs] = await Promise.all([
      site.brand(federation.id),
      site.clubs(federation.slug),
      site.eventsFor(federation.slug),
    ]);

    const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;

    // The preview points at /a/:id, which serves from the database behind a
    // sign-in. The build writes the same images out as files and points at
    // those. Different addresses, same bytes — and the preview has to resolve
    // them at all, or somebody checks a page, sees no image, and assumes the
    // block is broken rather than the preview.
    const previewAssets = Object.fromEntries(
      (await assets.list(ctx.me.accountId, org.id)).map((a) => [a.id, `/a/${a.id}`]));

    const html = renderBlocks(pg.body, { clubs: clubRows, events: evs, assets: previewAssets, enquiryAction: `/enquire/${org.slug}` },
      { origin });

    const body = R.authoredPage({
      page: pg, html, federation,
      origin, base: '',
      fonts: brand?.fonts ?? { display: 'Bitter', body: 'Source Sans 3' },
      nav: [],
      vocabulary: await orgs.vocabulary(org.id),
      description: excerpt(pg.body),
    });

    // The preview is the real page, so it must never be mistaken for the real
    // page by anything that indexes or caches.
    ctx.res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow',
      'cache-control': 'no-store',
      'x-frame-options': 'SAMEORIGIN',
    });
    return ctx.res.end(previewBanner(org, pg) + body);
  });

  /**
   * A strip across the top saying this is a preview.
   *
   * Added after the page rather than inside the renderer, because the renderer
   * must produce exactly what gets published and nothing else. Somebody looking
   * at a draft that is indistinguishable from the live site will eventually
   * tell their club a page is up when it is not.
   */
  const previewBanner = (org, pg) => `
  <div style="position:sticky;top:0;z-index:99;background:#161617;color:#F5F5F5;
    font:14px/1.5 system-ui,sans-serif;padding:10px 18px;display:flex;
    gap:16px;align-items:center;flex-wrap:wrap">
    <strong>Preview</strong>
    <span style="color:#BDBDBF">${pg.status === 'published'
      ? 'This page is live. You are seeing your unsaved draft of it.'
      : 'This page is a draft. Nobody else can see it.'}</span>
    <a href="/o/${org.slug}/pages/${pg.id}"
      style="margin-left:auto;color:#F0CE41">Back to editing</a>
  </div>`;
}
