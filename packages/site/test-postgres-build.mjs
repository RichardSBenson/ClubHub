/**
 * The site build, against the database it actually deploys against.
 *
 * Every other check on the build runs it from the JSON files, because that is
 * what a laptop has. The hosted deployment builds from Postgres, and the two
 * are not the same: a page written by a seed or a migration never went through
 * the block validator, so it arrives in whatever shape it was written in.
 *
 * A single page holding its paragraph text as a bare string — legal, accepted
 * by the validator, present in the seed — killed the entire build with
 * "(p.text ?? []).map is not a function". No page name, no slug, just a stack
 * trace, and a green test suite right up until the deploy failed.
 *
 * So this runs the real build against a real database, with the awkward shapes
 * deliberately in it.
 */

import '../api/reset.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../api/data.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const OUT = '/tmp/honbu-pg-build';
const org = (await pool.query(
  `select id from organisation where slug = 'moknz'`)).rows[0];

// ---------------------------------------------------------------------------
// the shapes that arrive from outside the editor
// ---------------------------------------------------------------------------

const AWKWARD = [
  ['bare-string',
   'Text as a plain string, which cleanRich accepts and the readers did not',
   { blocks: [{ type: 'paragraph', text: 'Founded in 1965 in Whanganui.' }] }],

  ['array-of-strings',
   'Runs as plain strings rather than objects',
   { blocks: [{ type: 'paragraph', text: ['One sentence. ', 'And another.'] }] }],

  ['no-paragraph',
   'A page with nothing excerpt can read',
   { blocks: [{ type: 'heading', text: 'Just a heading', level: 2 },
              { type: 'divider' }] }],

  ['no-spaces',
   'One very long word, so there is nowhere to break the excerpt',
   { blocks: [{ type: 'paragraph', text: 'x'.repeat(400) }] }],

  ['mixed-list',
   'A list whose items are strings rather than arrays of runs',
   { blocks: [{ type: 'paragraph', text: 'Times below.' },
              { type: 'list', items: ['Tuesday', 'Thursday'] }] }],
];

for (const [slug, title, body] of AWKWARD) {
  await pool.query(`
    insert into page (organisation_id, slug, title, body, status, published_at)
    values ($1,$2,$3,$4::jsonb,'published',now())
    on conflict (organisation_id, slug) do update
      set body = excluded.body, status = 'published'`,
    [org.id, slug, title, JSON.stringify(body)]);
}

console.log('\nTHE BUILD RUNS AGAINST POSTGRES AT ALL');
{
  let output = '';
  let threw = null;
  try {
    output = execSync('node packages/site/build.mjs', {
      cwd: new URL('../../', import.meta.url).pathname,
      env: { ...process.env, HONBU_STORE: 'postgres', OUT },
      stdio: 'pipe',
    }).toString();
  } catch (e) {
    threw = e;
  }

  ok('it does not die on real content', !threw,
    threw ? String(threw.stderr ?? threw.message).slice(0, 400) : '');
  ok('and says which store it used', output.includes('store: postgres'), output.slice(-120));
}

console.log('\nEVERY AWKWARD PAGE WAS BUILT');
{
  for (const [slug, title] of AWKWARD) {
    const file = path.join(OUT, slug, 'index.html');
    const there = fs.existsSync(file);
    ok(`${slug} — ${title.toLowerCase()}`, there, 'not built');
    if (!there) continue;
    const html = fs.readFileSync(file, 'utf8');
    ok(`  its title is on the page`, html.includes(title), 'title missing');
    ok(`  and it is a whole page`, html.includes('<!DOCTYPE html>'));
  }
}

console.log('\nTHE WORDS SURVIVE WHATEVER SHAPE THEY WERE IN');
{
  const read = (slug) => fs.readFileSync(path.join(OUT, slug, 'index.html'), 'utf8');

  ok('a bare string renders as text',
    read('bare-string').includes('Founded in 1965 in Whanganui.'));
  ok('an array of plain strings joins up',
    read('array-of-strings').includes('One sentence. And another.'));
  ok('a list of plain strings renders its items',
    read('mixed-list').includes('Tuesday') && read('mixed-list').includes('Thursday'));
}

console.log('\nTHE DESCRIPTION SEARCH ENGINES GET');
{
  const meta = (slug) => (fs.readFileSync(path.join(OUT, slug, 'index.html'), 'utf8')
    .match(/<meta name="description" content="([^"]*)"/) ?? [])[1];

  ok('comes from the first paragraph when the page has none of its own',
    meta('bare-string')?.startsWith('Founded in 1965'), meta('bare-string'));
  ok('is empty rather than broken when there is no paragraph',
    meta('no-paragraph') === '', JSON.stringify(meta('no-paragraph')));

  const long = meta('no-spaces');
  ok('a word with nowhere to break is cut at the limit, not mangled',
    long.length > 100 && long.length <= 160 && long.endsWith('…'),
    `${long.length} chars, ends "${long.slice(-4)}"`);
  ok('and it does not lose its last character to a -1 slice',
    !long.startsWith('…'), long.slice(0, 8));
}

console.log('\nAND THE REST OF THE SITE IS STILL THERE');
{
  for (const p of ['index.html', 'find-a-club/index.html', 'events/index.html',
                   'news/index.html', 'sitemap.xml', 'robots.txt', 'theme.css']) {
    ok(p, fs.existsSync(path.join(OUT, p)), 'missing');
  }
  const sitemap = fs.readFileSync(path.join(OUT, 'sitemap.xml'), 'utf8');
  ok('the new pages are in the sitemap',
    AWKWARD.every(([slug]) => sitemap.includes(`/${slug}`)),
    AWKWARD.filter(([s]) => !sitemap.includes(`/${s}`)).map(([s]) => s).join(','));
}

console.log('\nIMAGES ARE WRITTEN OUT, AND THE BLOCK POINTS AT THEM');
{
  // The failure this exists to catch is silence: blocks.mjs looks up
  // data.assets[assetId], misses, and returns an empty string. The page still
  // builds, the suite still passes, and the image is simply not there.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
    + 'IQAAAABJRU5ErkJggg==', 'base64');
  const { rows: [asset] } = await pool.query(`
    insert into asset (organisation_id, kind, filename, mime, width, height,
                       bytes, alt_text)
    values ($1,'image','crest.png','image/png',1,1,$2,'The MOKNZ crest')
    returning id`, [org.id, png.length]);
  await pool.query(`insert into asset_blob (asset_id, bytes) values ($1,$2)`,
    [asset.id, png]);
  await pool.query(`
    insert into page (organisation_id, slug, title, body, status, published_at)
    values ($1,'with-an-image','With an image',$2,'published',now())`,
    [org.id, JSON.stringify({ blocks: [
      { type: 'image', assetId: asset.id, alt: 'The MOKNZ crest',
        caption: 'Since 1965' }] })]);

  execSync(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..'), stdio: 'pipe' });

  const file = path.join(OUT, 'images', `${asset.id}.png`);
  ok('the image is written into the build', fs.existsSync(file));
  ok('byte for byte', fs.existsSync(file)
    && fs.readFileSync(file).equals(png));

  const html = fs.readFileSync(
    path.join(OUT, 'with-an-image', 'index.html'), 'utf8');
  ok('the page has an img tag at all, not an empty figure',
    html.includes('<img src="/images/'), 'the block rendered as nothing');
  ok('pointing at the file that was written',
    html.includes(`/images/${asset.id}.png`));
  ok('with the description on it',
    html.includes('alt="The MOKNZ crest"'));
  ok('and the caption',
    html.includes('Since 1965'));

  // /a/ is rewritten to the serverless function, so a built image must not
  // land there or the two would be fighting over the same path in production.
  ok('and nothing was written under /a/',
    !fs.existsSync(path.join(OUT, 'a')));
}

console.log('\nNEWS ARTICLES HAVE BODIES');
{
  // They did not. The site query selected slug, title, summary and date but
  // not body, and the build renders '' when body is undefined — so every news
  // page on the hosted site was a headline and a date. The flat store spreads
  // every column, so only the deployed build was affected.
  const { rows: [a] } = await pool.query(
    `select slug from article where status='published' limit 1`);
  const html = fs.readFileSync(
    path.join(OUT, 'news', a.slug, 'index.html'), 'utf8');
  ok('the article page has its paragraph, not an empty section',
    /<section>\s*<div class="wrap narrow">\s*<p>/.test(html),
    'the body rendered as nothing');
  ok('and the section is not empty',
    !/<div class="wrap narrow"><\/div>/.test(html));
}

console.log('\nTHE SITE PROMISES ONLY WHAT THE DOJOS SAID');
{
  // It used to print "Every one takes beginners, and your first class is free"
  // over every federation's list, hardcoded. Three of MOKNZ's seventeen clubs
  // have a profile row at all, so that was a promise made to the public on
  // behalf of fourteen businesses nobody had asked.
  // Every club is on the site for this test, because a club only is when it
  // has asked and been approved. Each says nothing about beginners or a free
  // first class — which is what "false" means in a column that cannot be null.
  await pool.query(`
    insert into club_profile (organisation_id, published, accepts_beginners,
                              first_class_free)
    select o.id, true, false, false from organisation o where o.type='club'
    on conflict (organisation_id) do update
      set published = true, accepts_beginners = false, first_class_free = false`);
  execSync(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..'), stdio: 'pipe' });

  const find = fs.readFileSync(
    path.join(OUT, 'find-a-club', 'index.html'), 'utf8');
  ok('no blanket promise while most dojos have said nothing',
    !/Every one takes beginners/.test(find)
    && !/your first class is free/i.test(find),
    find.match(/<p style="font-size:19px[^<]*/)?.[0]);
  ok('it still says how many there are', /17 dojo/.test(find));

  // And when every club really has said so, the claim comes back.
  await pool.query(`
    insert into club_profile (organisation_id, accepts_beginners, first_class_free)
    select o.id, true, true from organisation o where o.type='club'
    on conflict (organisation_id) do update
      set accepts_beginners = true, first_class_free = true`);
  execSync(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..'), stdio: 'pipe' });
  const now = fs.readFileSync(
    path.join(OUT, 'find-a-club', 'index.html'), 'utf8');
  ok('once all of them have said so, it says so',
    /Every one takes beginners, and your first class is free/.test(now),
    now.match(/<p style="font-size:19px[^<]*/)?.[0]);

  // One club that does not take beginners is enough to withdraw the claim.
  await pool.query(`
    update club_profile set accepts_beginners = false
    where organisation_id = (select id from organisation
                             where type='club' order by name limit 1)`);
  execSync(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..'), stdio: 'pipe' });
  const one = fs.readFileSync(
    path.join(OUT, 'find-a-club', 'index.html'), 'utf8');
  ok('one dissenter withdraws the claim about beginners',
    !/Every one takes beginners/.test(one));
  ok('but the free first class still stands',
    /Your first class is free/.test(one),
    one.match(/<p style="font-size:19px[^<]*/)?.[0]);
}

fs.rmSync(OUT, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
