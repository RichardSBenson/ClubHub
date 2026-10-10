/**
 * Routes: how the site looks — theme, colours, logo.
 */
import { assets, appearance, Forbidden, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { BUILT_IN } from '../site/builtin-themes.mjs';
import { readTheme, serialise } from '../site/theme.mjs';
import { BadUpload } from './multipart.mjs';
import { fitFor } from '../content/image-slots.mjs';
import { identify, NotAnImage, MAX_BYTES } from '../content/images.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';
import { organisationFor, mayManageAt } from './access.mjs';

export function registerAppearanceRoutes({ get, post, UUID_RE }) {
  // ---- appearance ------------------------------------------------------------
  //
  // The federation's look: a built-in theme, an imported one, or the default.
  // A club has no look of its own, so these are federation screens only.

  const builtInList = () => Object.entries(BUILT_IN)
    .map(([key, t]) => ({ key, ...t }));

  async function appearanceScreen(ctx, org, extra = {}) {
    const stored = await appearance.current(ctx.me.accountId, org.id);
    const q = ctx.url.searchParams;
    return ctx.send(extra.status ?? 200, V.appearanceEditor({
      me: ctx.me, org, csrf: ctx.csrf, builtIn: builtInList(),
      home: await appearance.home(ctx.me.accountId, org.id),
      current: stored ? (readTheme(stored).theme ?? null) : null,
      done: q.get('done'), error: q.get('error'), rebuild: q.get('rebuild'),
      ...extra,
    }));
  }

  get('/o/:slug/appearance', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    if (org.type === 'club') return ctx.redirect(`/o/${org.slug}/club-page`);
    return appearanceScreen(ctx, org);
  });

  post('/o/:slug/appearance', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    if (org.type === 'club') throw new Forbidden('A club uses its federation\'s look.');
    const form = await ctx.form();
    const pasted = String(form.theme_json ?? '');
    const doc = form.builtin ? BUILT_IN[form.builtin] : pasted;
    if (!doc) return appearanceScreen(ctx, org, { status: 422, pasted,
      error: 'Choose a theme or paste a theme file.' });
    const read = readTheme(doc);
    if (!read.ok) return appearanceScreen(ctx, org, { status: 422, pasted,
      problems: read.problems });
    try {
      await appearance.apply(ctx.me.accountId, org.id, read.theme);
    } catch (e) {
      if (e instanceof Invalid)
        return appearanceScreen(ctx, org, { status: 422, pasted, error: e.message });
      throw e;
    }
    const rebuild = await requestRebuild({ reason: `appearance ${org.slug}` });
    return ctx.redirect(`/o/${org.slug}/appearance?done=${
      encodeURIComponent(`Now using "${read.theme.name}".`)}`
      + '&rebuild=' + encodeURIComponent(rebuild.detail));
  });

  /**
   * The crest. One picture, set by the federation, used in the site header and on every
   * event banner. It comes from the federation's own image library, or is added here.
   */
  post('/o/:slug/appearance/logo', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    if (org.type === 'club') throw new Forbidden('A club uses its federation\'s crest.');
    const { fields, files } = await ctx.upload({ maxBytes: MAX_BYTES + 256 * 1024 });
    const back = `/o/${org.slug}/appearance`;
    try {
      if (!await mayManageAt(ctx, org.id)) throw new Forbidden('Only an owner or administrator can set the crest.');
      let assetId = UUID_RE.test(fields.assetId ?? '') ? fields.assetId : null;
      const file = files.find((f) => f.field === 'logoFile' && f.bytes.length);
      if (file) {
        const created = await assets.create(ctx.me.accountId, org.id, {
          bytes: file.bytes, identified: identify(file.bytes, { filename: file.filename }),
          filename: file.filename, altText: `${org.name} crest` });
        assetId = created.id;
      }
      if (fields.remove) assetId = null;
      else if (!assetId) return ctx.redirect(`${back}?error=${encodeURIComponent('Choose a picture or add one.')}`);
      await appearance.setLogo(ctx.me.accountId, org.id, assetId);
      const rebuild = await requestRebuild({ reason: `crest ${org.slug}` });
      return ctx.redirect(`${back}?done=${encodeURIComponent(assetId ? 'Crest set.' : 'Crest removed.')}&rebuild=${encodeURIComponent(rebuild.detail)}`);
    } catch (e) {
      if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  /**
   * The top of the home page: the big picture, the three lines of words, and the picture that
   * shows when the site is shared. Federation screens only; a club uses its federation's.
   * The permission check comes before the upload is read.
   */
  post('/o/:slug/appearance/home', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    if (org.type === 'club') throw new Forbidden('A club uses its federation\'s home page.');
    if (!await mayManageAt(ctx, org.id)) throw new Forbidden('Only an owner or administrator can change the home page.');
    const { fields, files } = await ctx.upload({ maxBytes: MAX_BYTES + 256 * 1024 });
    const back = `/o/${org.slug}/appearance`;
    try {
      const change = {
        heroHeading: fields.heroHeading ?? '', heroText: fields.heroText ?? '', heroButton: fields.heroButton ?? '',
      };
      const add = async (field, alt) => {
        const file = files.find((f) => f.field === field && f.bytes.length);
        if (!file) return undefined;
        const identified = identify(file.bytes, { filename: file.filename });
        const created = await assets.create(ctx.me.accountId, org.id, {
          bytes: file.bytes, identified, filename: file.filename, altText: alt });
        return { id: created.id, identified };
      };
      const warnings = [];
      const hero = await add('heroFile', `${org.name} home page`);
      if (hero) { change.heroAssetId = hero.id; warnings.push(...fitFor('hero', hero.identified)); }
      else if (fields.removeHero) change.heroAssetId = null;
      const share = await add('shareFile', `${org.name} link preview`);
      if (share) { change.shareAssetId = share.id; warnings.push(...fitFor('share', share.identified)); }
      else if (fields.removeShare) change.shareAssetId = null;
      await appearance.setHome(ctx.me.accountId, org.id, change);
      const rebuild = await requestRebuild({ reason: `home page ${org.slug}` });
      return ctx.redirect(`${back}?done=${encodeURIComponent(['Home page saved.', ...warnings].join(' '))}&rebuild=${encodeURIComponent(rebuild.detail)}`);
    } catch (e) {
      if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  post('/o/:slug/appearance/reset', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    if (org.type === 'club') throw new Forbidden('A club uses its federation\'s look.');
    await ctx.form();
    await appearance.reset(ctx.me.accountId, org.id);
    const rebuild = await requestRebuild({ reason: `appearance reset ${org.slug}` });
    return ctx.redirect(`/o/${org.slug}/appearance?done=${
      encodeURIComponent('Back to the default look.')}`
      + '&rebuild=' + encodeURIComponent(rebuild.detail));
  });

  get('/o/:slug/appearance/export', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    if (org.type === 'club') return ctx.redirect(`/o/${org.slug}/club-page`);
    const stored = await appearance.current(ctx.me.accountId, org.id);
    const read = stored ? readTheme(stored) : null;
    if (!read?.ok) return ctx.redirect(`/o/${org.slug}/appearance?error=${
      encodeURIComponent('There is no theme chosen here to download yet.')}`);
    return ctx.download(`${org.slug}-theme.json`, 'application/json', serialise(read.theme));
  });
}
