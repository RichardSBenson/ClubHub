/**
 * Static build.
 *
 * Reads through the site-content port, so it has no idea whether the data came
 * from JSON files or Postgres. With no DATABASE_URL set it runs from files and
 * needs nothing provisioned — which is how it deploys before a database exists.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { repositories, STORE } from '../infrastructure/factory.mjs';
import { renderBlocks, excerpt } from '../content/blocks.mjs';
import * as R from './render.mjs';

const ORIGIN = process.env.ORIGIN ?? 'https://www.kyokushinkarate.co.nz';
// Relative to the repository, not the working directory — so it lands in the
// same place whether run locally, from a script, or by Vercel at the repo root.
const OUT = process.env.OUT ?? new URL('../../dist/', import.meta.url).pathname;
const FED = process.env.FEDERATION ?? 'moknz';

const NAV = [
  { href: '/find-a-dojo', label: 'Find a dojo' },
  { href: '/events', label: 'Events' },
  { href: '/about', label: 'About us' },
];

const repos = await repositories();
const site = repos.site;

const federation = await site.federation(FED);
if (!federation) {
  console.error(`No federation with slug "${FED}" in the ${STORE} store.`);
  process.exit(1);
}

const brand = await site.brand(federation.id);
const tokens = brand?.tokens ?? {};
const fonts = brand?.fonts ?? {};

const write = async (rel, html) => {
  const file = path.join(OUT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, html);
  return rel;
};

await fs.rm(OUT, { recursive: true, force: true });
const written = [];

written.push(await write('theme.css', R.themeCss(tokens, fonts)));

// ---- dojo pages -----------------------------------------------------------
const dojos = (await site.dojos(FED)).map((d) => ({
  ...d,
  venue_name: d.venue_name ?? d.venueName ?? null,
  address_line: d.address_line ?? d.addressLine ?? null,
  who_trains: d.who_trains ?? d.whoTrains ?? null,
  first_class_free: d.first_class_free ?? d.firstClassFree ?? true,
  sessions: d.sessions ?? [],
}));

for (const dojo of dojos) {
  const evs = await site.eventsFor(dojo.slug);
  written.push(await write(`${dojo.slug}/index.html`,
    R.dojoPage({ dojo, federation, events: evs, origin: ORIGIN, fonts, nav: NAV })));
}

written.push(await write('find-a-dojo/index.html',
  R.findADojoPage({ dojos, federation, origin: ORIGIN, fonts, nav: NAV })));

// ---- events ---------------------------------------------------------------
const evs = await site.eventsFor(FED);
for (const ev of evs) {
  written.push(await write(`events/${ev.slug}/index.html`,
    R.eventPage({ ev, federation, origin: ORIGIN, fonts, nav: NAV })));
}

// ---- authored pages -------------------------------------------------------
const authored = await site.pages();
for (const pg of authored) {
  const html = renderBlocks(pg.body, { dojos, events: evs });
  written.push(await write(`${pg.slug}/index.html`, R.layout({
    title: pg.meta_title ?? `${pg.title} — ${federation.name}`,
    description: pg.meta_description ?? excerpt(pg.body),
    canonical: `${ORIGIN}/${pg.slug}`,
    federation, fonts, nav: NAV,
    body: `<section><div class="wrap narrow">
      <h1 style="font-family:var(--display);font-size:clamp(30px,5vw,46px);margin:0 0 20px">${pg.title}</h1>
      ${html}
    </div></section>`,
  })));
}

// ---- home -----------------------------------------------------------------
const articles = await site.articles();
written.push(await write('index.html',
  R.homePage({ federation, dojos, events: evs, articles, origin: ORIGIN, fonts, nav: NAV })));

// ---- crawlability ---------------------------------------------------------
const urls = written.filter((f) => f.endsWith('.html'))
  .map((f) => ORIGIN + '/' + f.replace(/index\.html$/, '').replace(/\/$/, ''));
written.push(await write('sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u || ORIGIN}</loc></url>`).join('\n') +
  `\n</urlset>`));
written.push(await write('robots.txt',
  `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`));

console.log(`${written.length} files → ${OUT}  (store: ${STORE})`);
console.log(`  ${dojos.length} dojo pages, ${evs.length} events, ` +
  `${articles.length} news, ${authored.length} authored`);

if (repos.store === 'postgres') {
  const { pool } = await import('../api/data.mjs');
  await pool.end();
}
