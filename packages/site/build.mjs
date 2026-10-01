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
import { menuFor } from '../content/navigation.mjs';
import { loadSettings, SettingsError } from './settings.mjs';
import * as R from './render.mjs';

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
  const tokens = { ...(brand?.tokens ?? {}), ...(atRoot ? rootSettings.tokens : {}) };
  const fonts = { ...(brand?.fonts ?? {}), ...(atRoot ? rootSettings.fonts : {}) };


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

  const shared = { federation, fonts, nav, base, vocabulary, origin: ORIGIN };

  await write('theme.css', R.themeCss(tokens, fonts));

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
  }

  for (const dojo of dojos) {
    const dojoEvents = await site.eventsFor(dojo.slug);
    await write(`${dojo.slug}/index.html`,
      R.dojoPage({ dojo, events: dojoEvents, ...shared }));
  }

  await write('find-a-dojo/index.html', R.findADojoPage({ dojos, ...shared }));

  // Only those the organisation has published. An empty page is the right
  // answer when nobody has been asked yet, so it is still written — a missing
  // page and an empty one say different things to somebody following a link.
  const teachers = site.instructors ? await site.instructors(target.slug) : [];
  await write('instructors/index.html',
    R.instructorsPage({ instructors: teachers, assets, ...shared }));

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
