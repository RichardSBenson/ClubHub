/**
 * Static build. Queries the register, writes a site. No CMS in between.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool, orgs, events as eventsApi } from '../api/data.mjs';
import { renderBlocks, excerpt } from '../content/blocks.mjs';
import * as R from './render.mjs';

const ORIGIN = process.env.ORIGIN ?? 'https://www.kyokushinkarate.co.nz';
const OUT = process.env.OUT ?? './dist';
const FED = process.env.FEDERATION ?? 'moknz';

const NAV = [
  { href: '/find-a-dojo', label: 'Find a dojo' },
  { href: '/events', label: 'Events' },
  { href: '/about', label: 'About us' },
];

const write = async (rel, html) => {
  const file = path.join(OUT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, html);
  return rel;
};

const q = async (sql, p = []) => (await pool.query(sql, p)).rows;

const federation = await orgs.bySlug(FED);
const brand = (await q('select * from brand where organisation_id=$1', [federation.id]))[0];
const tokens = brand?.tokens ?? {};
const fonts = brand?.fonts ?? {};

await fs.rm(OUT, { recursive: true, force: true });
const written = [];

written.push(await write('theme.css', R.themeCss(tokens, fonts)));

// ---- dojo pages, generated from records -----------------------------------
const dojos = await q(`
  select o.id, o.name, o.slug, o.country_code, d.*,
         coalesce(json_agg(json_build_object(
           'label', t.label, 'weekday', t.weekday,
           'starts', t.starts::text, 'ends', t.ends::text)
           order by t.sort_order) filter (where t.id is not null), '[]') as sessions
  from organisation root
  join organisation o on o.path <@ root.path and o.type='dojo' and o.status='active'
  left join dojo_profile d on d.organisation_id=o.id
  left join training_session t on t.organisation_id=o.id
  where root.slug=$1
  group by o.id, o.name, o.slug, o.country_code, d.organisation_id
  order by o.name`, [FED]);

for (const dojo of dojos) {
  const evs = await eventsApi.forOrg(dojo.slug, { isMember: false });
  written.push(await write(`${dojo.slug}/index.html`,
    R.dojoPage({ dojo, federation, events: evs, origin: ORIGIN, fonts, nav: NAV })));
}

written.push(await write('find-a-dojo/index.html',
  R.findADojoPage({ dojos, federation, origin: ORIGIN, fonts, nav: NAV })));

// ---- events ---------------------------------------------------------------
const evs = await eventsApi.forOrg(FED, { isMember: false });
for (const ev of evs) {
  written.push(await write(`events/${ev.slug}/index.html`,
    R.eventPage({ ev, federation, origin: ORIGIN, fonts, nav: NAV })));
}

// ---- news -----------------------------------------------------------------
const articles = await q(`
  select a.slug, a.title, a.summary, a.published_at, o.name as about_org
  from article a
  left join organisation o on o.id = a.about_org_id
  where a.organisation_id=$1 and a.status='published'
  order by a.published_at desc`, [federation.id]);

// ---- authored pages -------------------------------------------------------
const authored = await q(`
  select slug, title, body, meta_title, meta_description
  from page where organisation_id=$1 and status='published'`, [federation.id]);

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
written.push(await write('index.html',
  R.homePage({ federation, dojos, events: evs, articles, origin: ORIGIN, fonts, nav: NAV })));

// ---- sitemap and robots ---------------------------------------------------
const urls = written.filter((f) => f.endsWith('.html'))
  .map((f) => ORIGIN + '/' + f.replace(/index\.html$/, '').replace(/\/$/, ''));
written.push(await write('sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u || ORIGIN}</loc></url>`).join('\n') +
  `\n</urlset>`));
written.push(await write('robots.txt',
  `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`));

console.log(`${written.length} files → ${OUT}`);
console.log(`  ${dojos.length} dojo pages, ${evs.length} events, ` +
  `${articles.length} news, ${authored.length} authored`);
await pool.end();
