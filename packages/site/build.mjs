/**
 * Static build.
 *
 * Reads through the site-content port, so it has no idea whether the data came
 * from JSON files or Postgres. With no DATABASE_URL set it runs from files and
 * needs nothing provisioned — which is how it deploys before a database exists.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { repositories, currentStore } from '../infrastructure/factory.mjs';
import { renderBlocks, excerpt, paragraphs } from '../content/blocks.mjs';
import { extensionFor } from '../content/images.mjs';
import { menuFor } from '../content/navigation.mjs';
import { loadSettings, SettingsError } from './settings.mjs';
import { readTheme, lookOf, LAYOUTS } from './theme.mjs';
import * as R from './render.mjs';
import * as PWA from './pwa.mjs';
import { enterRegion } from '../infrastructure/region-context.mjs';
import { eventToIcs } from '../core/domain/calendar-file.mjs';

// Relative to the repository, not the working directory — so it lands in the
// same place whether run locally, from a script, or by Vercel at the repo root.
const OUT = process.env.OUT ?? new URL('../../dist/', import.meta.url).pathname;
const FED = process.env.FEDERATION ?? 'moknz';

/**
 * Which federations this deployment publishes, and where each one lives.
 *
 * The first is the site at the root. The rest are demonstrations, each under
 * its own path, so a prospective federation can be shown the same platform
 * speaking its own language rather than told that it would.
 *
 * FEDERATION=<slug> builds just one, which is what a single-federation
 * deployment does.
 */
const repos = await repositories();
const site = repos.site;

/**
 * Which federations this deployment publishes, and where each one lives.
 *
 * Read from the database. This used to be a list in this file — moknz at the
 * root, a taekwondo demo and a jiu-jitsu demo beneath it — which meant a
 * federation that bought this and installed it published somebody else's
 * karate organisation at their own address, with two demos under it. "I have
 * just purchased this and I do not want to see anything" is the right
 * expectation and the list made it impossible.
 *
 * One install is one federation. That one is published at the root. A
 * federation marked demo:true goes under /demo/<name>, because the demos are
 * a sales tool for this deployment rather than anybody's real site. More than
 * one real federation in a single database is not the intended shape, so it
 * is published rather than refused — losing somebody's site to a rule is
 * worse than an unusual arrangement — but it is said out loud.
 */
async function sitesToPublish() {
  if (process.env.FEDERATION)
    return [{ slug: process.env.FEDERATION, base: '' }];

  const all = site.federations ? await site.federations() : [];
  if (!all.length) return [];

  const real = all.filter((f) => !f.demo);
  const demos = all.filter((f) => f.demo);

  const root = real[0] ?? demos[0];
  const sites = [{ slug: root.slug, base: '' }];

  for (const f of real.slice(1)) {
    console.log(`  note: ${f.name} is a second federation in this database.`);
    console.log(`        Publishing it at /f/${f.slug}. One install is meant`);
    console.log('        to be one federation; set FEDERATION to choose which.');
    sites.push({ slug: f.slug, base: `/f/${f.slug}` });
  }

  for (const f of demos)
    sites.push({ slug: f.slug, base: `/demo/${f.slug.replace(/^demo-/, '')}` });

  return sites;
}

const SITES = await sitesToPublish();

/**
 * Nothing set up yet.
 *
 * A federation who has just installed this has an empty database, and the
 * build used to die writing a sitemap into a directory it never created. A
 * first deploy failing with ENOENT is a poor welcome, and "the output
 * directory is missing" is what Vercel would have said.
 *
 * So it publishes one page saying what to do, the way a fresh WordPress says
 * run the installer, and exits successfully. There is a working deployment
 * at the end of it with nothing in it, which is the correct state.
 */
if (!SITES.length) {
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'index.html'),
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Honbu — not set up yet</title>
<style>
  body{font:16px/1.6 system-ui,sans-serif;background:#111113;color:#F2F2F7;
       margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}
  main{max-width:34rem}
  h1{font-size:28px;margin:0 0 16px}
  code{background:#1C1C1E;padding:2px 6px;border-radius:4px}
  p{color:#BDBDBF}
</style></head><body><main>
  <h1>Nothing here yet</h1>
  <p>This install has no federation in it. That is what a new one looks
     like — it does not come with somebody else's organisation in it.</p>
  <p>Set yours up by running:</p>
  <p><code>npm run found -- --name "Your Federation" --art Karate
     --country NZ --email you@example.org</code></p>
  <p>Then deploy again, and this page is replaced by your site.</p>
</main></body></html>\n`);
  await fs.writeFile(path.join(OUT, 'robots.txt'),
    'User-agent: *\nDisallow: /\n');

  console.log('\nNo federation in this database yet.');
  console.log('Wrote a placeholder page. Run `npm run found` to set one up,');
  console.log('then deploy again.\n');
  process.exit(0);
}

const DATA = process.env.HONBU_DATA
  ?? new URL('../../data/', import.meta.url).pathname;

// settings.json describes the federation at the root. A federation published
// under a path carries its own words and colours in its organisation record,
// because there is only one settings file and there are several federations.
let rootSettings;
try {
  rootSettings = loadSettings(DATA);
} catch (e) {
  if (e instanceof SettingsError) { console.error('\n' + e.message); process.exit(1); }
  throw e;
}
for (const n of rootSettings.notes ?? []) console.log(`  note: ${n}`);

/**
 * Whether the settings file is about the federation it is being applied to.
 *
 * data/settings.json is the deployment's one hand-edited file, and on a
 * single-federation install it is that federation's own — name, tagline,
 * colours, the word they use for a club. That was fine while this repository
 * had exactly one customer.
 *
 * It is not fine shipped. A federation who installs this gets a settings file
 * describing Mas Oyama Karate New Zealand, and their brand new aikido site
 * says "Find a dojo" in somebody else's colours. The test for a fresh install
 * caught exactly that.
 *
 * So the file is used only when it is about the federation at the root. If it
 * names a different one, it is ignored and said so — loudly, because an
 * ignored settings file is otherwise a mystery, and because the fix is for
 * them to edit it or delete it rather than to wonder.
 */
function settingsAreAbout(federation) {
  const named = rootSettings.organisation?.name;
  if (!named) return true;              // nobody said; assume it is theirs
  const same = (a, b) => String(a ?? '').trim().toLowerCase()
                       === String(b ?? '').trim().toLowerCase();
  return same(named, federation.name)
      || same(rootSettings.organisation?.shortName, federation.short_name);
}

/**
 * Where this deployment actually answers.
 *
 * settings.json names www.kyokushinkarate.co.nz, which is where the site is
 * GOING to live. Until the DNS points here that address serves something else,
 * and every page was telling search engines that the real version of itself
 * was over there — on a site we do not control the content of. Worse once
 * there are three federations on one deployment, because a taekwondo
 * federation's canonical URL should not be a karate domain at all.
 *
 * So: the deployment's own hostname wins. Vercel sets
 * VERCEL_PROJECT_PRODUCTION_URL to the production domain, which becomes the
 * custom domain the moment one is attached — so this corrects itself when the
 * DNS is finally pointed, with nothing to remember.
 */
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const ORIGIN = process.env.ORIGIN
  ?? (vercelHost ? `https://${vercelHost}` : null)
  ?? rootSettings.seo?.origin
  ?? 'http://localhost';

const strip = (o = {}) => Object.fromEntries(
  Object.entries(o).filter(([k, v]) => !k.startsWith('_') && v != null));

await fs.rm(OUT, { recursive: true, force: true });

const allWritten = [];

for (const target of SITES) {
  const federation = await site.federation(target.slug);
  if (!federation) {
    if (target.base === '') {
      console.error(`No federation with slug "${target.slug}" in the ${currentStore()} store.`);
      process.exit(1);
    }
    // A demo that is not seeded is not a reason to fail the build. The site
    // that matters is the one at the root.
    console.log(`  skipped ${target.slug}: not in the ${currentStore()} store`);
    continue;
  }
  // This federation's currency, language and age of adulthood apply to everything built for it.
  enterRegion(federation.settings?.region ?? {});

  const orgSettings = federation.settings ?? {};
  const atRoot = target.base === '';

  // The settings file only counts if it is this federation's.
  if (atRoot && !settingsAreAbout(federation)) {
    console.log(`  note: data/settings.json describes `
      + `"${rootSettings.organisation?.name}", not "${federation.name}".`);
    console.log('        Ignoring it. Edit it for your federation, or delete');
    console.log('        it — everything in it has a sensible default.');
    rootSettings = loadSettings('/nonexistent');   // defaults only
  }

  const settings = atRoot ? rootSettings : null;

  // The file supplies defaults; what the federation itself has stored wins.
  // The other way round, a settings file that fell back to generic defaults
  // overwrote a Muay Thai federation's "Gym" with "Club".
  const vocabulary = {
    ...(atRoot ? strip(rootSettings.vocabulary ?? {}) : {}),
    ...strip(orgSettings.vocabulary ?? {}),
  };

  // The art, for schema.org and for the page copy. From settings at the root,
  // from the federation's own record for everyone else.
  const discipline = atRoot
    ? rootSettings.organisation?.discipline
    : orgSettings.discipline;
  if (discipline) federation.discipline = discipline;

  // What the pages CALL the art, which is not always what schema.org should
  // be told the sport is: MOKNZ's pages say "Kyokushin karate", schema.org
  // wants "Karate". Falls back to the discipline when a federation does not
  // distinguish them.
  const artName = atRoot ? rootSettings.organisation?.artName : orgSettings.artName;
  if (artName) federation.artName = artName;

  const clubsWord = vocabulary.clubPlural ?? vocabulary.club ?? 'Clubs';
  const brand = await site.brand(federation.id);
  // How it looks, in order of authority: what the federation chose in its own
  // admin (a stored theme), then the settings file for an install that has
  // never opened the admin, then the defaults. The same order navigation uses,
  // for the same reason — the screen a person can reach should beat a file
  // they would have to edit in GitHub on a phone.
  let look = null;
  if (orgSettings.theme) {
    const read = readTheme(orgSettings.theme);
    if (read.ok) look = lookOf(read.theme);
    else {
      // A stored theme that no longer validates (a later version tightened a
      // rule) costs the federation its theme, loudly, and not its website.
      console.warn(`\n  ⚠ ${federation.name}'s stored theme is not valid, so it was `
        + `ignored:\n      ${read.problems.join('\n      ')}\n`);
    }
  }
  const tokens = look ? look.tokens
    : { ...(brand?.tokens ?? {}), ...(atRoot ? rootSettings.tokens : {}) };
  const fonts = look ? look.fonts
    : { ...(brand?.fonts ?? {}), ...(atRoot ? rootSettings.fonts : {}) };

  const fromFile = (key) => atRoot ? rootSettings[key] : orgSettings[key];
  // The same order as everything else: the theme the federation chose, then the settings file, then classic.
  const fileLayout = atRoot ? rootSettings.layout : null;
  const layoutName = look?.layout ?? (LAYOUTS.includes(fileLayout) ? fileLayout : 'classic');
  const homeSections = look?.homeSections ?? fromFile('homePage')?.sections;
  const dojoSections = look?.dojoSections ?? fromFile('dojoPage')?.sections;
  // Words, not look: these stay the federation's own whatever theme is chosen.
  const dojoCopy = strip(fromFile('dojoPage') ?? {});


  const base = target.base;
  const at = (p) => `${base}${p}`;

  const written = [];
  const write = async (rel, html) => {
    const file = path.join(OUT, base.replace(/^\//, ''), rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, html);
    written.push(base.replace(/^\//, '') ? `${base.slice(1)}/${rel}` : rel);
    return rel;
  };

  /**
   * Images, written out as real files.
   *
   * This is the half of the image block that was missing. blocks.mjs looks up
   * data.assets[assetId] and returns an empty string when it misses, so every
   * image block on every page has rendered as nothing since it was written —
   * silently, because an empty string is a perfectly good return value.
   *
   * Written at build rather than served at runtime: the public site is static,
   * so an image is a file next to the page that references it, cached by
   * whatever serves the site, and needs no function invocation and no database
   * connection to look at.
   *
   * The extension comes from the mime that images.mjs read out of the bytes,
   * never from the uploaded filename.
   *
   * Written under /images/, not /a/. /a/ is rewritten to the serverless
   * function so the admin can serve an image from the database, and whether
   * Vercel checks the filesystem before applying a rewrite is not something to
   * find out in production. Two prefixes, no overlap, no question.
   */
  let assetRows = [];
  try {
    assetRows = site.assets ? await site.assets(target.slug) : [];
  } catch (e) {
    // A database that is behind the code should cost a federation its images,
    // loudly, not its whole website silently — or worse, its whole deployment
    // with a stack trace. This exact case took production down: the build
    // shipped on push, db/016 had not been run, and the deploy failed on a
    // missing table with no indication of which one or why.
    if (e.name !== 'MigrationNeeded') throw e;
    console.warn(`\n  ⚠ ${e.message}`);
    console.warn('    Images will be missing from this site until it is run.');
    console.warn('    Everything else builds normally.\n');
  }
  const assets = {};
  for (const a of assetRows) {
    if (!a.bytes?.length) continue;
    const name = `${a.id}.${extensionFor(a.mime)}`;
    const file = path.join(OUT, base.replace(/^\//, ''), 'images', name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, a.bytes);
    written.push(base.replace(/^\//, '')
      ? `${base.slice(1)}/images/${name}` : `images/${name}`);
    assets[a.id] = `${base}/images/${name}`;
  }
  if (assetRows.length) console.log(`  ${assetRows.length} image(s)`);

  // Every club in the tree, and then the ones that have a page.
  //
  // A club is on the website because it asked and the federation said yes,
  // not because it exists. This used to publish every active club, so one
  // that had told the federation nothing went live with the placeholder text
  // from the template in its description. `published` has been in the schema
  // since the first migration and nothing read it.
  const everyClub = (await site.dojos(target.slug)).map((d) => ({
    ...d,
    venue_name: d.venue_name ?? d.venueName ?? null,
    address_line: d.address_line ?? d.addressLine ?? null,
    who_trains: d.who_trains ?? d.whoTrains ?? null,
    // Not defaulted to true. A dojo with no profile row has told us nothing
    // about its first class, and inventing "free" here is how fourteen dojos
    // that have never filled anything in ended up with the national site
    // promising the public something on their behalf.
    first_class_free: d.first_class_free ?? d.firstClassFree ?? null,
    accepts_beginners: d.accepts_beginners ?? d.acceptsBeginners ?? null,
    sessions: d.sessions ?? [],
    hero_url: assets[d.hero_asset_id ?? d.heroAssetId] ?? null,
  }));
  const dojos = everyClub.filter((d) => d.published === true);
  const unlisted = everyClub.length - dojos.length;

  const galleryRows = new Map();
  for (const g of (site.galleryFor ? await site.galleryFor(target.slug) : []))
    galleryRows.set(g.organisation_id, [...(galleryRows.get(g.organisation_id) ?? []), g]);
  const evs = await site.eventsFor(target.slug);
  const articles = await site.articles(federation.id);
  const authored = await site.pages(federation.id);

  // What this federation will actually have a page for. Decided before
  // anything is rendered, because the menu is rendered into every page and a
  // menu item pointing at a page that was never built sends a visitor to a
  // 404 from the one link they are most likely to press.
  // The menu is the federation's, stored on its own record. The settings file
  // is the fallback for a single-federation install that has never opened the
  // editor, and the generated pages are the fallback for a fresh one.
  //
  // menuFor drops anything pointing at a page this federation has not got,
  // which is a backstop and not the protection: the editor refuses to save
  // such an item, by name, with what to do about it. The build used to be the
  // only thing that noticed, and it said so in a log nobody reads — which is
  // how an item added to the hardcoded list this morning was dropped from
  // every federation's menu without anybody being told.
  const nav = menuFor({
    stored: orgSettings.navigation,
    fileItems: atRoot ? rootSettings.navigation : [],
    authored,
    vocabulary,
  });

  // The crest: one image the federation chose, used in the header and on every event banner.
  // The organisation's own words about itself: from the settings file at the root, from its record elsewhere.
  const orgWords = atRoot ? (rootSettings.organisation ?? {}) : orgSettings;
  // A crest kept as a file under data/media is the fallback for an install that has not uploaded one.
  const mediaCrest = /^\/media\/[A-Za-z0-9._-]+$/.test(orgWords.logo ?? '') ? `${base}${orgWords.logo}` : null;
  const logoUrl = assets[federation.settings?.logoAssetId] ?? mediaCrest;
  const shareUrl = assets[orgSettings.homePage?.shareAssetId] ?? null;

  // What the chosen layout needs beyond the theme: the federation's words, which are never in a theme.
  const homeCopy = { ...(atRoot ? strip(rootSettings.homePage ?? {}) : {}), ...strip(orgSettings.homePage ?? {}) };
  const footerLinks = [
    { href: '/find-a-dojo', label: clubsWord },
    { href: '/events', label: 'Events' },
    ...(articles.length ? [{ href: '/news', label: 'News' }] : []),
    ...authored.map((p) => ({ href: `/${p.slug}`, label: p.title })),
  ];
  const shared = {
    federation: {
      ...federation, logoUrl, shareUrl,
      layoutName,
      stripe: orgWords.stripe, wordmark: orgWords.wordmark, footerLine: orgWords.footerLine,
      eventsIntro: orgWords.eventsIntro ?? null,
      footerLinks, homeCopy, dojoCopy, clubCount: dojos.length,
      // Every path this site will have a page for, so a layout never draws a button that leads to a 404.
      knownPaths: new Set(['/', '/find-a-dojo', '/events', '/news', '/instructors', '/signin', '/shop',
        ...authored.map((p) => `/${p.slug}`)]),
    },
    fonts, nav, base, vocabulary, origin: ORIGIN,
  };

  // "Add to calendar": one small file beside each event page that is not cancelled.
  const writeCalendar = async (ev, dir, at) => {
    if (ev.status === 'cancelled') return;
    const ics = eventToIcs(ev, { url: `${ORIGIN}${base}${at}`, host: new URL(ORIGIN).hostname });
    if (ics) await write(`${dir}/event.ics`, ics);
  };

  await write('theme.css', R.themeCss(tokens, fonts, layoutName));

  // The admin's editor, copied into the static output so it is served from
  // this origin. The admin's Content-Security-Policy is default-src 'self',
  // and a CDN would have meant relaxing that on the screen where the most
  // sensitive editing happens. Written once, at the root, not per federation.
  if (atRoot) {
    const vendor = new URL('../../vendor/easymde/', import.meta.url).pathname;
    for (const file of ['easymde.min.js', 'easymde.min.css']) {
      const to = path.join(OUT, 'vendor', file);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(path.join(vendor, file), to);
      written.push(`vendor/${file}`);
    }
    // The admin's gallery uploader: a small script served from this site, never inline.
    const own = new URL('../../vendor/honbu/gallery-upload.js', import.meta.url).pathname;
    await fs.copyFile(own, path.join(OUT, 'vendor', 'gallery-upload.js'));
    written.push('vendor/gallery-upload.js');
    // The photo viewer on public gallery pages.
    await fs.copyFile(new URL('../../vendor/honbu/lightbox.js', import.meta.url).pathname, path.join(OUT, 'vendor', 'lightbox.js'));
    written.push('vendor/lightbox.js');
    await fs.copyFile(new URL('../../vendor/honbu/select-all.js', import.meta.url).pathname, path.join(OUT, 'vendor', 'select-all.js'));
    written.push('vendor/select-all.js');
    await fs.copyFile(new URL('../../vendor/honbu/photo-pick.js', import.meta.url).pathname, path.join(OUT, 'vendor', 'photo-pick.js'));
    written.push('vendor/photo-pick.js');
    await fs.copyFile(new URL('../../vendor/honbu/finder.js', import.meta.url).pathname, path.join(OUT, 'vendor', 'finder.js'));
    written.push('vendor/finder.js');

    // The federation's own pictures, kept as plain files under data/media and published as they are.
    // Flat files first: nothing here needs a database, and a photograph is not a record.
    const mediaDir = path.join(DATA, 'media');
    try {
      for (const f of await fs.readdir(mediaDir)) {
        if (!/^[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i.test(f)) continue;
        await fs.mkdir(path.join(OUT, 'media'), { recursive: true });
        await fs.copyFile(path.join(mediaDir, f), path.join(OUT, 'media', f));
        written.push(`media/${f}`);
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }

    // The installable app: manifest, icons, offline page, service worker, and the two small scripts that use them.
    for (const f of ['pwa.js', 'push.js', 'day-of-week.js']) {
      await fs.copyFile(new URL(`../../vendor/honbu/${f}`, import.meta.url).pathname, path.join(OUT, 'vendor', f));
      written.push(`vendor/${f}`);
    }
    await fs.copyFile(new URL('../../vendor/honbu/sw.js', import.meta.url).pathname, path.join(OUT, 'sw.js'));
    await write('manifest.webmanifest', JSON.stringify(PWA.manifest({ name: federation.name, shortName: orgWords.shortName ?? rootSettings.organisation?.shortName ?? null, background: tokens.ink ?? '#161617' }), null, 2));
    await write('offline.html', PWA.offlinePage(federation.name));
    await fs.mkdir(path.join(OUT, 'icons'), { recursive: true });
    // The federation's own crest when there is one this build can read; otherwise the plain H on the app colour.
    let crest = null;
    if (/^\/media\/[A-Za-z0-9._-]+\.png$/i.test(orgWords.logo ?? ''))
      crest = await fs.readFile(new URL(`../../data${orgWords.logo}`, import.meta.url)).catch(() => null);
    for (const [file, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-192.png', 192, true], ['icon-maskable-512.png', 512, true]]) {
      const drawn = crest ? PWA.crestIconPng(crest, size, { colour: tokens.ink ?? '#161617', maskable }) : null;
      await fs.writeFile(path.join(OUT, 'icons', file), drawn ?? PWA.iconPng(size, { maskable }));
    }
    written.push('sw.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png');
  }

  // Only those the organisation has published. An empty page is the right
  // answer when nobody has been asked yet, so it is still written — a missing
  // page and an empty one say different things to somebody following a link.
  const teachers = (site.instructors ? await site.instructors(target.slug) : [])
    .map((x) => ({ ...x, photoUrl: assets[x.photoAssetId] ?? null, paragraphs: paragraphs(x.bio) }));

  // A dojo's pictures, newest year first, as the pages want them.
  const galleryFor = (dojo) => (galleryRows.get(dojo.id) ?? []).map((g) => ({
    url: assets[g.asset_id], alt: g.alt_text, caption: g.caption, year: g.year ?? null,
    eventId: g.event_id ?? null, eventTitle: g.event_title ?? null, eventSlug: g.event_slug ?? null })).filter((g) => g.url);

  for (const dojo of dojos) {
    const dojoEvents = await site.eventsFor(dojo.slug);
    if (galleryFor(dojo).length)
      await write(`${dojo.slug}/gallery/index.html`, R.galleryPage({ dojo, items: galleryFor(dojo), ...shared }));
    // A dojo's own events get their page under the dojo, so a local event needs nobody's
    // permission to be on the website. Ones that reached the federation's calendar are there too.
    for (const ev of dojoEvents.filter((e) => e.is_own))
    {
      const at = `/${dojo.slug}/events/${ev.slug}`;
      await write(`${dojo.slug}/events/${ev.slug}/index.html`, R.eventPage({ ev, ...shared, path: at }));
      await writeCalendar(ev, `${dojo.slug}/events/${ev.slug}`, at);
    }
    await write(`${dojo.slug}/index.html`,
      R.dojoPage({ dojo, events: dojoEvents, ...shared, instructors: teachers.filter((x) => x.organisationSlug === dojo.slug),
        gallery: galleryFor(dojo).slice(0, 8), galleryTotal: galleryFor(dojo).length,
        sections: dojoSections, startAnyWeekText: dojoCopy.startAnyWeekText ?? null,
        showFirstClassFree: dojoCopy.showFirstClassFree !== false }));
  }

  await write('shop/index.html', R.shopPage({ products: site.shopRange ? await site.shopRange(target.slug) : [], ...shared }));

  await write('find-a-dojo/index.html', R.findADojoPage({ dojos, ...shared }));

  await write('instructors/index.html',
    R.instructorsPage({ instructors: teachers, assets, ...shared }));

  for (const ev of evs) {
    await write(`events/${ev.slug}/index.html`, R.eventPage({ ev, ...shared }));
    await writeCalendar(ev, `events/${ev.slug}`, `/events/${ev.slug}`);
  }
  await write('events/index.html', R.eventsPage({ events: evs, ...shared }));

  for (const pg of authored) {
    const html = renderBlocks(pg.body, { dojos, events: evs, assets, enquiryAction: `/enquire/${target.slug}` },
      { origin: ORIGIN + base });
    await write(`${pg.slug}/index.html`, R.authoredPage({
      // Only computed when the page has no description of its own, as it was
      // before: reading every page's first paragraph to throw it away is work
      // for nothing, and it is work done on data from outside.
      page: pg, html, description: pg.meta_description ?? excerpt(pg.body),
      ...shared,
    }));
  }

  await write('news/index.html', R.newsPage({ articles, ...shared }));
  for (const article of articles) {
    const body = article.body
      ? renderBlocks(article.body, { dojos, events: evs, assets, enquiryAction: `/enquire/${target.slug}` },
                     { origin: ORIGIN + base })
      : '';
    await write(`news/${article.slug}/index.html`,
      R.articlePage({ article, html: body, ...shared }));
  }

  await write('index.html', R.homePage({
    dojos, events: evs, articles,
    // The file supplies defaults at the root; what the federation stored wins.
    homeCopy,
    sections: homeSections,
    heroUrl: assets[orgSettings.homePage?.heroAssetId]
      ?? (atRoot ? assets[rootSettings.homePage?.heroAssetId] : null) ?? null,
    ...shared,
  }));

  console.log(`  ${(base || '/').padEnd(11)} ${federation.name}`
    + ` — ${dojos.length} ${clubsWord.toLowerCase()}`
    + (unlisted ? ` (+${unlisted} without a page)` : '')
    + `, ${evs.length} event(s),`
    + ` ${articles.length} article(s)`);
  allWritten.push(...written);
}

// ---- crawlability ---------------------------------------------------------
const urls = allWritten.filter((f) => f.endsWith('.html') && f !== 'offline.html')
  .map((f) => ORIGIN + '/' + f.replace(/index\.html$/, '').replace(/\/$/, ''));
allWritten.push(await (async () => {
  const file = path.join(OUT, 'sitemap.xml');
  await fs.writeFile(file,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u || ORIGIN}</loc></url>`).join('\n') +
    `\n</urlset>`);
  return 'sitemap.xml';
})());
await fs.writeFile(path.join(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
allWritten.push('robots.txt');

console.log(`${allWritten.length} files → ${OUT}  (store: ${currentStore()})`);
