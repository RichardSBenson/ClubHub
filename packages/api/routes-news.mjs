/**
 * Routes: news articles, and publishing them up the tree.
 */
import { assets, news, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { BadUpload } from './multipart.mjs';
import { documentFromText, textFromDocument } from '../content/document-text.mjs';
import { identify, NotAnImage, MAX_BYTES } from '../content/images.mjs';
import { looksEmpty } from '../content/page-form.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';

export function registerNewsRoutes({ get, post, mayPublishAt, slugify, organisationFor }) {
  // ---- news ------------------------------------------------------------------

  get('/o/:slug/news', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const canDecide = await mayPublishAt(ctx, org.id);
    return ctx.send(200, V.newsList({
      me: ctx.me, org, csrf: ctx.csrf,
      articles: await news.list(ctx.me.accountId, org.id),
      // Only shown to somebody who can actually decide, and only containing
      // what sits beneath them.
      waiting: canDecide ? await news.awaitingDecision(ctx.me.accountId, org.id) : [],
      canPublish: canDecide,
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
      rebuild: ctx.url.searchParams.get('rebuild'),
    }));
  });

  get('/o/:slug/news/new', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    return ctx.send(200, V.articleEditor({
      me: ctx.me, org, csrf: ctx.csrf,
      values: { body: '' },
      images: await assets.list(ctx.me.accountId, org.id),
      canPublish: await mayPublishAt(ctx, org.id),
    }));
  });

  post('/o/:slug/news/new', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    return articlePost(ctx, { org });
  });

  get('/o/:slug/news/:articleId', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const a = await news.byId(ctx.me.accountId, ctx.params.articleId);
    const doc = a.body ?? { blocks: [] };
    const images = await assets.list(ctx.me.accountId, org.id);
    return ctx.send(200, V.articleEditor({
      me: ctx.me, org, article: a, csrf: ctx.csrf, images,
      scheduledFor: await news.scheduledFor(a.id), today: new Date().toISOString().slice(0, 10),
      values: { body: textFromDocument(doc, { images }),
                title: a.title, slug: a.slug,
                summary: a.summary ?? '', heroAssetId: a.hero_asset_id ?? '',
                tags: (a.tags ?? []).join(', ') },
      canPublish: await mayPublishAt(ctx, org.id),
      done: ctx.url.searchParams.get('done'),
    }));
  });

  post('/o/:slug/news/:articleId', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const a = await news.byId(ctx.me.accountId, ctx.params.articleId);
    return articlePost(ctx, { org, article: a });
  });

  post('/o/:slug/news/:articleId/ask', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    await ctx.form();
    const back = `/o/${org.slug}/news`;
    try {
      const a = await news.requestPublishUp(ctx.me.accountId, ctx.params.articleId);
      return ctx.redirect(`${back}?done=` + encodeURIComponent(
        `Asked for "${a.title}" to appear on the federation's site.`));
    } catch (e) {
      if (e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  /**
   * The federation's answer.
   *
   * Posted at the deciding organisation, not at the article's own, because the
   * right to decide belongs to whoever's site it would appear on.
   */
  post('/o/:slug/news/:articleId/decide', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const form = await ctx.form();
    const approve = form.answer === 'approve';
    const back = `/o/${org.slug}/news`;
    try {
      const a = await news.decidePublishUp(ctx.me.accountId, ctx.params.articleId,
        approve, { decidedBy: org.id });
      const rebuild = approve
        ? await requestRebuild({ reason: `approve ${a.slug}` })
        : { detail: 'Nothing to rebuild — it was not on the site.' };
      return ctx.redirect(`${back}?done=` + encodeURIComponent(approve
        ? `"${a.title}" now appears on this site.`
        : `"${a.title}" was declined. It stays on their own site.`)
        + '&rebuild=' + encodeURIComponent(rebuild.detail));
    } catch (e) {
      if (e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  /** Shared by both article posts, the way editorPost is shared by pages. */
  async function articlePost(ctx, { org, article = null }) {
    // Multipart, because a picture can be chosen here rather than on another
    // screen. Leaving a half-written article to go and upload one, then coming
    // back to a blank form, is how somebody loses what they wrote.
    const { fields: form, files } = await ctx.upload({
      maxBytes: MAX_BYTES + 256 * 1024 });
    const op = String(form.op ?? 'save');
    const canPublish = await mayPublishAt(ctx, org.id);

    let images = await assets.list(ctx.me.accountId, org.id);
    const body = String(form.body ?? '');

    const title = String(form.title ?? '').trim();
    const slug = slugify(form.slug || title);
    const summary = String(form.summary ?? '').trim();
    let heroAssetId = String(form.heroAssetId ?? '').trim() || null;
    const tags = String(form.tags ?? '').split(',');

    // A picture attached here is uploaded as part of saving and becomes the
    // one at the top. It also joins the organisation's images, so it can be
    // used again — a hero picture is not a different kind of thing.
    const hero = files.find((f) => f.field === 'heroFile' && f.bytes.length);
    if (hero) {
      try {
        const identified = identify(hero.bytes, { filename: hero.filename });
        const created = await assets.create(ctx.me.accountId, org.id, {
          bytes: hero.bytes, identified, filename: hero.filename,
          altText: form.heroAlt,
        });
        heroAssetId = created.id;
        images = await assets.list(ctx.me.accountId, org.id);
      } catch (e) {
        if (e instanceof NotAnImage || e instanceof BadUpload
            || e instanceof Invalid) {
          return ctx.send(422, V.articleEditor({
            me: ctx.me, org, article, csrf: ctx.csrf, canPublish, images,
            values: { body, title, slug, summary, heroAssetId: heroAssetId ?? '',
                      heroAlt: form.heroAlt ?? '', tags: form.tags ?? '' },
            error: e.message,
          }));
        }
        throw e;
      }
    }

    const doc = documentFromText(body, { images });

    const render = async (extra = {}) => ctx.send(extra.status ?? 200,
      V.articleEditor({
        me: ctx.me, org, article, csrf: ctx.csrf, canPublish, images,
        scheduledFor: article ? await news.scheduledFor(article.id) : null,
        today: new Date().toISOString().slice(0, 10),
        values: { body, title, slug, summary,
                  heroAssetId: heroAssetId ?? '', heroAlt: form.heroAlt ?? '',
                  tags: form.tags ?? '' },
        ...extra,
      }));

    if (!title) return render({ status: 422, error: 'The article needs a headline.' });
    if (!slug) return render({ status: 422,
      error: 'The article needs a web address. Give it a headline with some '
        + 'letters in it, or type one.' });
    if (looksEmpty(doc)) return render({ status: 422,
      error: 'There is nothing in this article yet. Add something and type into '
        + 'it before saving.' });

    try {
      const { article: saved, dropped } = await news.save(ctx.me.accountId, {
        articleId: article?.id ?? null,
        organisationId: article ? null : org.id,
        slug, title, summary: summary || null, body: doc,
        heroAssetId, tags,
      });

      if (op === 'publish' || op === 'unpublish') {
        if (!canPublish) return render({ status: 403, article: saved,
          error: 'Your changes are saved. Putting news in front of the public '
            + 'needs an owner or administrator.' });
        if (op === 'publish') await news.publish(ctx.me.accountId, saved.id);
        else await news.unpublish(ctx.me.accountId, saved.id);

        const rebuild = await requestRebuild({ reason: `${op} ${org.slug}/${slug}` });
        return ctx.redirect(`/o/${org.slug}/news?done=`
          + encodeURIComponent(op === 'publish'
            ? `"${saved.title}" is published.` : `"${saved.title}" is off the site.`)
          + '&rebuild=' + encodeURIComponent(rebuild.detail));
      }

      if (op === 'schedule' || op === 'unschedule') {
        if (!canPublish) return render({ status: 403, article: saved,
          error: 'Your changes are saved. Scheduling needs an owner or administrator.' });
        if (op === 'schedule') await news.schedule(ctx.me.accountId, saved.id, String(form.publishOn ?? ''));
        else await news.unschedule(ctx.me.accountId, saved.id);
        return ctx.redirect(`/o/${org.slug}/news/${saved.id}?done=`
          + encodeURIComponent(op === 'schedule' ? `Scheduled for ${String(form.publishOn)}.` : 'No longer scheduled.'));
      }

      if (dropped.length) return render({ article: saved, dropped,
        done: 'Saved as a draft.' });
      return ctx.redirect(`/o/${org.slug}/news/${saved.id}?done=`
        + encodeURIComponent('Saved as a draft.'));
    } catch (e) {
      return render({ status: e.status ?? 422, error: e.message });
    }
  }
}
