/**
 * Routes: the images and files a club has uploaded.
 */
import { gallery, MAX_GALLERY, assets, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { BadUpload } from './multipart.mjs';
import { fitFor } from '../content/image-slots.mjs';
import { identify, NotAnImage, ACCEPTED, MAX_BYTES } from '../content/images.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';

export function registerMediaRoutes({ SECURITY_HEADERS, get, post, UUID_RE, organisationFor }) {
  // ---- media ------------------------------------------------------------------

  /** A club's photo gallery. Pictures come from its own library, or are added here. */
  async function galleryScreen(ctx, org, extra = {}) {
    if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/club-pages`);
    const q = ctx.url.searchParams;
    const year = /^\d{4}$/.test(q.get('year') ?? '') ? Number(q.get('year')) : null;
    const eventId = UUID_RE.test(q.get('event') ?? '') ? q.get('event') : null;
    return ctx.send(extra.status ?? 200, V.galleryScreen({
      me: ctx.me, org, csrf: ctx.csrf, max: MAX_GALLERY,
      items: await gallery.list(ctx.me.accountId, org.id, { year, eventId }),
      total: (await gallery.years(ctx.me.accountId, org.id)).reduce((n, y) => n + y.n, 0),
      years: await gallery.years(ctx.me.accountId, org.id),
      events: await gallery.events(ctx.me.accountId, org.id),
      filter: { year, eventId },
      library: await assets.list(ctx.me.accountId, org.id),
      done: q.get('done'), error: q.get('error'), rebuild: q.get('rebuild'), ...extra,
    }));
  }

  get('/o/:slug/gallery', async (ctx) => galleryScreen(ctx, await organisationFor(ctx, { toWrite: true })));

  /** The little script sends one picture per request and asks for JSON; everything else gets a redirect. */
  const wantsJson = (ctx) => String(ctx.req.headers.accept ?? '').includes('application/json');
  function jsonReply(ctx, status, body) {
    ctx.res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
    ctx.res.end(JSON.stringify(body));
  }

  post('/o/:slug/gallery', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    // Several pictures can arrive in one go. Each is judged on its own, so one that is not a
    // picture does not throw away the rest.
    const { fields, files } = await ctx.upload({ maxBytes: 14 * 1024 * 1024, maxFiles: 20 });
    const back = `/o/${org.slug}/gallery`;
    const json = wantsJson(ctx);
    try {
      const where = { year: fields.year, eventId: UUID_RE.test(fields.eventId ?? '') ? fields.eventId : null };
      const picked = files.filter((f) => f.field === 'file' && f.bytes.length);
      const tooBig = picked.find((f) => f.bytes.length > MAX_BYTES);
      if (tooBig) throw new Invalid(`${tooBig.filename} is over ${Math.round(MAX_BYTES / 1048576)} MB.`);
      const added = [], skipped = [], warnings = [];
      for (const file of picked) {
        try {
          const identified = identify(file.bytes, { filename: file.filename });
          const created = await assets.create(ctx.me.accountId, org.id, {
            bytes: file.bytes, identified, filename: file.filename, altText: fields.alt_text || fields.caption || null });
          await gallery.add(ctx.me.accountId, org.id, created.id, picked.length === 1 ? fields.caption : null, where);
          added.push(file.filename);
          const w = fitFor('gallery', identified)[0];
          if (w && picked.length === 1) warnings.push(w);
        } catch (e) {
          if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid) skipped.push(`${file.filename}: ${e.message}`);
          else throw e;
        }
      }
      // Or one already in the library.
      let assetId = UUID_RE.test(fields.assetId ?? '') ? fields.assetId : null;
      if (assetId && !picked.length) { await gallery.add(ctx.me.accountId, org.id, assetId, fields.caption, where); added.push('1 from the library'); }
      if (!added.length && !skipped.length) throw new Invalid('Choose one or more pictures to add.');
      const message = (added.length ? `Added ${added.length} ${added.length === 1 ? 'picture' : 'pictures'}.` : 'Nothing was added.')
        + (skipped.length ? ` Not added — ${skipped.join('; ')}` : '') + (warnings.length ? ` ${warnings[0]}` : '');
      if (json) return jsonReply(ctx, added.length ? 200 : 422, { ok: added.length > 0, added: added.length, message });
      const rebuild = await requestRebuild({ reason: `gallery ${org.slug}` });
      const key = added.length ? 'done' : 'error';
      return ctx.redirect(`${back}?${key}=${encodeURIComponent(message)}&rebuild=${encodeURIComponent(rebuild.detail)}`);
    } catch (e) {
      if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid) {
        if (json) return jsonReply(ctx, 422, { ok: false, message: e.message });
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      }
      throw e;
    }
  });

  /** Rebuild the site once the last picture of a batch is in. Called by the script when it has finished. */
  post('/o/:slug/gallery/done', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    await ctx.form();
    const rebuild = await requestRebuild({ reason: `gallery ${org.slug}` });
    return ctx.redirect(`/o/${org.slug}/gallery?done=${encodeURIComponent('Pictures added.')}&rebuild=${encodeURIComponent(rebuild.detail)}`);
  });

  /** Tick some pictures, then file them under a year and event, or remove them. */
  post('/o/:slug/gallery/bulk', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const form = await ctx.form();
    const back = `/o/${org.slug}/gallery`;
    try {
      const ids = Object.keys(form).filter((k) => k.startsWith('pick_') && form[k] === 'on')
        .map((k) => k.slice(5)).filter((id) => UUID_RE.test(id));
      let message;
      if (form.action === 'remove') {
        await gallery.removeMany(ctx.me.accountId, org.id, ids);
        message = `Removed ${ids.length}.`;
      } else {
        const change = {};
        if (String(form.year ?? '').trim() !== '') change.year = form.year;
        if (form.eventId === 'none') change.eventId = null;
        else if (UUID_RE.test(form.eventId ?? '')) change.eventId = form.eventId;
        await gallery.file(ctx.me.accountId, org.id, ids, change);
        message = `Filed ${ids.length}.`;
      }
      const rebuild = await requestRebuild({ reason: `gallery ${org.slug}` });
      return ctx.redirect(`${back}?done=${encodeURIComponent(message)}&rebuild=${encodeURIComponent(rebuild.detail)}`);
    } catch (e) {
      if (e instanceof Invalid) return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  for (const action of ['remove', 'move', 'caption', 'details']) {
    post(`/o/:slug/gallery/:galleryId/${action}`, async (ctx) => {
      const org = await organisationFor(ctx, { toWrite: true });
      const form = await ctx.form();
      if (!UUID_RE.test(ctx.params.galleryId)) throw new NotFound('Picture');
      try {
        if (action === 'remove') await gallery.remove(ctx.me.accountId, org.id, ctx.params.galleryId);
        if (action === 'move') await gallery.move(ctx.me.accountId, org.id, ctx.params.galleryId, form.direction === 'up' ? -1 : 1);
        if (action === 'caption') await gallery.caption(ctx.me.accountId, org.id, ctx.params.galleryId, form.caption);
        if (action === 'details') {
          await gallery.caption(ctx.me.accountId, org.id, ctx.params.galleryId, form.caption);
          await gallery.file(ctx.me.accountId, org.id, [ctx.params.galleryId], {
            year: String(form.year ?? '').trim() === '' ? undefined : form.year,
            eventId: form.eventId === 'none' ? null : UUID_RE.test(form.eventId ?? '') ? form.eventId : undefined });
        }
      } catch (e) {
        if (e instanceof Invalid) return ctx.redirect(`/o/${org.slug}/gallery?error=${encodeURIComponent(e.message)}`);
        throw e;
      }
      const rebuild = await requestRebuild({ reason: `gallery ${org.slug}` });
      return ctx.redirect(`/o/${org.slug}/gallery?done=${encodeURIComponent('Saved.')}&rebuild=${encodeURIComponent(rebuild.detail)}`);
    });
  }

  get('/o/:slug/media', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    return ctx.send(200, V.mediaLibrary({
      me: ctx.me, org, csrf: ctx.csrf,
      assets: await assets.list(ctx.me.accountId, org.id),
      accepted: ACCEPTED, maxBytes: MAX_BYTES,
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
    }));
  });

  post('/o/:slug/media', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const back = `/o/${org.slug}/media`;

    try {
      // Room for the image plus the form around it. The image's own limit is
      // the one that produces a sensible message; this one only stops a body
      // large enough to be a problem before anything has looked at it.
      const { fields, files } = await ctx.upload({ maxBytes: MAX_BYTES + 256 * 1024 });
      const file = files.find((f) => f.field === 'file');

      if (!file || !file.bytes.length)
        return ctx.redirect(`${back}?error=${encodeURIComponent('Choose a file first.')}`);

      // From the bytes. What the browser called it is not consulted.
      const identified = identify(file.bytes, { filename: file.filename });

      await assets.create(ctx.me.accountId, org.id, {
        bytes: file.bytes, identified, filename: file.filename,
        altText: fields.alt_text, credit: fields.credit,
        consentRef: fields.consent_ref,
      });

      // Small is allowed, but say so: every slot needs at least 800 pixels across.
      const small = fitFor('gallery', identified)[0];
      return ctx.redirect(`${back}?done=${encodeURIComponent(`${file.filename} uploaded.${small ? ' ' + small : ''}`)}`);
    } catch (e) {
      // A refused upload goes back to the screen with the reason, rather than an
      // error page — the person is mid-task and the fix is usually obvious.
      if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  post('/o/:slug/media/:assetId/describe', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const form = await ctx.form();
    await assets.describe(ctx.me.accountId, ctx.params.assetId, {
      altText: form.alt_text, credit: form.credit, consentRef: form.consent_ref,
    });
    return ctx.redirect(`/o/${org.slug}/media?done=${encodeURIComponent('Saved')}`);
  });

  post('/o/:slug/media/:assetId/delete', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    await ctx.form();
    const back = `/o/${org.slug}/media`;
    try {
      const { filename } = await assets.remove(ctx.me.accountId, ctx.params.assetId);
      return ctx.redirect(`${back}?done=${encodeURIComponent(`${filename} deleted`)}`);
    } catch (e) {
      if (e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  /**
   * Serve an image to the admin.
   *
   * The public site does not come through here — it is built at deploy, with
   * these written out as files. This exists so the media library and the page
   * preview can show what they are talking about.
   *
   * The permission check lives in assets.forViewing, which is the only way to
   * reach an asset's bytes at all.
   */
  get('/a/:assetId', async (ctx) => {
    ctx.requireActor();
    // Fetching and authorising are one call, so there is no version of this
    // route that reads the bytes without having checked.
    const { asset, bytes } = await assets.forViewing(ctx.me.accountId,
                                                     ctx.params.assetId);

    return ctx.sendBytes(200, bytes, {
      type: asset.mime,
      filename: asset.filename,
      // Private, because this is behind a sign-in. The public site's copies are
      // static files and get cached properly by whatever serves them.
      cacheControl: 'private, max-age=300',
    });
  });
}
