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
import { renderBlocks, excerpt } from '../content/blocks.mjs';
import { extensionFor } from '../content/images.mjs';
import { loadSettings, SettingsError } from './settings.mjs';
import * as R from './render.mjs';

// Relative to the repository, not the working directory — so it lands in the
// same place whether run locally, from a script, or by Vercel at the repo root.
const OUT = process.env.OUT ?? new URL('../../dist/', import.meta.url).pathname;
const FED = process.env.FEDERATION ?? 'moknz';

const NAV = [
  { href: '/find-a-dojo', label: 'Find a club' },
  { href: '/events', label: 'Events' },
  { href: '/about', label: 'About us' },
];

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
const SITES = process.env.FEDERATION
  ? [{ slug: process.env.FEDERATION, base: '' }]
  : [
      { slug: 'moknz', base: '' },
      { slug: 'demo-tkd', base: '/demo/tkd' },
      { slug: 'demo-bjj', base: '/demo/bjj' },
    ];

const repos = await repositories();
const site = repos.site;

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

  const orgSettings = federation.settings ?? {};
  const atRoot = target.base === '';
  const settings = atRoot ? rootSettings : null;

  const vocabulary = strip(orgSettings.vocabulary ?? {});
  if (atRoot) Object.assign(vocabulary, strip(rootSettings.vocabulary ?? {}));

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
  const tokens = { ...(brand?.tokens ?? {}), ...(atRoot ? rootSettings.tokens : {}) };
  const fonts = { ...(brand?.fonts ?? {}), ...(atRoot ? rootSettings.fonts : {}) };

  // The plural, because "Find a academy" is the kind of detail that makes a
  // demo feel machine-made.
  const navFor = (v) => (atRoot && rootSettings.navigation.length
    ? rootSettings.navigation
    : NAV.map((n) => (n.href === '/find-a-dojo'
        ? { ...n, label: v.clubPlural ?? v.club ?? 'Clubs' }
        : n)));

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

  const dojos = (await site.dojos(target.slug)).map((d) => ({
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
  }));

  const evs = await site.eventsFor(target.slug);
  const articles = await site.articles(federation.id);
  const authored = await site.pages(federation.id);

  // What this federation will actually have a page for. Decided before
  // anything is rendered, because the menu is rendered into every page and a
  // menu item pointing at a page that was never built sends a visitor to a
  // 404 from the one link they are most likely to press.
  const willExist = new Set([
    '/', '/find-a-dojo', '/events', '/news',
    ...authored.map((pg) => `/${pg.slug}`),
  ]);
  const nav = navFor(vocabulary).filter((n) => {
    if (willExist.has(n.href)) return true;
    console.log(`     nav: dropped ${n.href} — this federation has no such page`);
    return false;
  });

  const shared = { federation, fonts, nav, base, vocabulary, origin: ORIGIN };

  await write('theme.css', R.themeCss(tokens, fonts));

  for (const dojo of dojos) {
    const dojoEvents = await site.eventsFor(dojo.slug);
    await write(`${dojo.slug}/index.html`,
      R.dojoPage({ dojo, events: dojoEvents, ...shared }));
  }

  await write('find-a-dojo/index.html', R.findADojoPage({ dojos, ...shared }));

  for (const ev of evs) {
    await write(`events/${ev.slug}/index.html`, R.eventPage({ ev, ...shared }));
  }
  await write('events/index.html', R.eventsPage({ events: evs, ...shared }));

  for (const pg of authored) {
    const html = renderBlocks(pg.body, { dojos, events: evs, assets },
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
      ? renderBlocks(article.body, { dojos, events: evs, assets },
                     { origin: ORIGIN + base })
      : '';
    await write(`news/${article.slug}/index.html`,
      R.articlePage({ article, html: body, ...shared }));
  }

  await write('index.html', R.homePage({
    dojos, events: evs, articles,
    homeCopy: atRoot ? (rootSettings.homePage ?? {}) : strip(orgSettings.homePage ?? {}),
    ...shared,
  }));

  console.log(`  ${(base || '/').padEnd(11)} ${federation.name}`
    + ` — ${dojos.length} ${clubsWord.toLowerCase()}, ${evs.length} event(s),`
    + ` ${articles.length} article(s)`);
  allWritten.push(...written);
}

// ---- crawlability ---------------------------------------------------------
const urls = allWritten.filter((f) => f.endsWith('.html'))
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
