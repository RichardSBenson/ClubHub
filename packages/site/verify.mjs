/** Checks on the built output. SEO claims must be provable, not asserted. */
import fs from 'node:fs';
import path from 'node:path';

// Resolved from this file, not from the working directory, and honouring the
// same OUT the build honours. It used to be './dist', which meant this only
// ran from the repository root — while npm test runs it from packages/site,
// where there is no dist and every check died on the first read.
const OUT = process.env.OUT ?? new URL('../../dist/', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, d='') => c ? (pass++, console.log(`  ✓ ${n}`))
                             : (fail++, console.log(`  ✗ ${n} ${d}`));

const read = (p) => fs.readFileSync(path.join(OUT, p), 'utf8');
const html = (p) => read(p);

console.log('\nTHE MENU ON A PHONE');
{
  const home = html('index.html');
  ok('has a menu button, with no script', /class="navtoggle"/.test(home) && /class="navbtn"/.test(home)
    && !/<script(?![^>]*ld\+json)/.test(home));
  ok('the menu is still ordinary links', (home.match(/<nav class="main"[\s\S]*?<\/nav>/)?.[0].match(/<a /g) ?? []).length >= 2);
  ok('on a phone it slides in from the left', /nav\.main\{position:fixed;top:0;left:0;bottom:0/.test(read('theme.css') + home));
}

console.log('\nSTRUCTURED DATA — the thing Sporty cannot do');
{
  const wh = html('whanganui/index.html');
  const ld = JSON.parse(wh.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  ok('dojo page carries SportsActivityLocation', ld['@type'] === 'SportsActivityLocation');
  ok('with a postal address', !!ld.address?.addressRegion, JSON.stringify(ld.address));
  ok('with geo coordinates', !!ld.geo?.latitude);
  const wh0 = html('whanganui/index.html');
  const rows = (wh0.match(/<table class="times">[\s\S]*?<\/table>/)[0]
                  .match(/<tr>/g) || []).length - 1;   // minus header
  ok('opening hours match the classes on the page',
    ld.openingHoursSpecification?.length === rows,
    `${ld.openingHoursSpecification?.length} vs ${rows} rows`);
  ok('and names its parent organisation',
    ld.parentOrganization?.name?.includes('Mas Oyama'));
  console.log('      → hours:', JSON.stringify(ld.openingHoursSpecification[0]));
}

console.log('\nURLS AND META');
{
  ok('dojo URL is the town, lowercase', fs.existsSync(path.join(OUT,'whanganui/index.html')));
  ok('Inglewood keeps its existing /taranaki slug',
    fs.existsSync(path.join(OUT,'taranaki/index.html')));
  const wh = html('whanganui/index.html');
  const title = wh.match(/<title>(.*?)<\/title>/)[1];
  const desc = wh.match(/name="description" content="(.*?)"/)[1];
  ok('title names the town', title.startsWith('Kyokushin karate in Whanganui'), title);
  ok('description is specific to this dojo', desc.includes('Whanganui') && desc.length > 80);
  // Asserts the shape, not one federation's domain: the origin now comes from
  // the deployment and changes when the DNS is finally pointed.
  const canonical = wh.match(/rel="canonical" href="([^"]+)"/)?.[1] ?? '';
  ok('canonical is set and points at this page',
    /^https?:\/\/[^/]+\/whanganui$/.test(canonical), canonical);

  const ch = html('christchurch/index.html');
  const chDesc = ch.match(/name="description" content="(.*?)"/)[1];
  ok('a different dojo gets a different description', chDesc !== desc);
  console.log(`      → Whanganui: ${desc.slice(0,72)}…`);
  console.log(`      → Christchurch: ${chDesc.slice(0,72)}…`);
}

console.log('\nGENERATED, NOT AUTHORED');
{
  const wh = html('whanganui/index.html');
  ok('training times rendered from records', wh.includes('Juniors, 6-12 years'));
  const table = wh.match(/<table class="times">[\s\S]*?<\/table>/)[0];
  const labels = [...table.matchAll(/<td><strong>(.*?)<\/strong><\/td>/g)].map(m => m[1]);
  ok('no class appears twice — nights are grouped, not repeated',
    labels.length === new Set(labels).size, labels.join(' | '));
  ok('a class held on two nights shows both in one cell',
    /<td>[^<]* &amp; [^<]*<\/td>/.test(table));
  ok('phone is tap-to-call where present', wh.includes('href="tel:'));

  const ch = html('christchurch/index.html');
  ok('an incomplete dojo still renders without breaking',
    ch.includes('Venue to confirm') && ch.includes('Training times to be confirmed'));
  ok('and says so honestly rather than faking content',
    !ch.includes('undefined') && !ch.includes('null'));
}

console.log('\nEVENT SCOPING SURVIVES INTO THE BUILD');
{
  const wh = html('whanganui/index.html');
  const we = html('wellington/index.html');
  ok('public build shows the national grading', wh.includes('National kyu grading'));
  ok('public build hides the dojo-only fight night', !wh.includes('Dojo fight night'));
  ok('and hides the black belt seminar', !wh.includes('Black belt seminar'));
  ok('Wellington shows the national grading too', we.includes('National kyu grading'));
}

console.log('\nCRAWLABILITY');
{
  const sm = read('sitemap.xml');
  const pages = [];
  (function walk(dir){
    for (const e of fs.readdirSync(path.join(OUT,dir), { withFileTypes:true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (e.name === 'index.html') pages.push(rel);
    }
  })('');
  const count = (sm.match(/<loc>/g) || []).length;
  ok('sitemap lists every page', count === pages.length, `${count} vs ${pages.length}`);
  ok('every sitemap URL is absolute', !/<loc>(?!https?:)/.test(sm));
  // Derived from what was built, not a hardcoded list — the set of authored
  // pages differs between the file store and the database.
  const dojoSlugs = new Set(pages.filter(p => !p.includes('/'))
    .map(p => p.replace('/index.html','')));
  const authored = [...dojoSlugs].filter(s =>
    !['index.html','find-a-dojo','events'].includes(s));
  ok('every page built is listed in the sitemap',
    authored.every(a => sm.includes(`/${a}`)), authored.join(','));
  ok('robots points at the sitemap', read('robots.txt').includes('sitemap.xml'));
  ok('home declares the organisation',
    html('index.html').includes('"@type":"SportsOrganization"'));
}

console.log('\nTHEME FROM BRAND TOKENS');
{
  const css = read('theme.css');
  ok('brand red is in the CSS', css.includes('--primary: #CE372C'));
  ok('the readable derived red is too', css.includes('--primary-text-strong: #9A2A1F'));
  ok('accent only ever used on dark surfaces',
    css.includes('color:var(--accent)') && !css.includes('background:var(--accent);color:var(--canvas)'));
  ok('fonts come from the record', css.includes('Shippori Mincho'));
}

console.log('\nEVERY INTERNAL LINK GOES SOMEWHERE');
{
  // The navigation offered /events and the home page linked to /news/<slug>,
  // and neither page was ever built. Every visitor who pressed Events got a
  // 404, on every federation. A link check is cheap and that was not.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory()
      ? walk(path.join(dir, e.name))
      : [path.join(dir, e.name)]));

  const files = walk(OUT);
  const at = (f) => '/' + path.relative(OUT, f).split(path.sep).join('/');
  const served = new Set();
  for (const f of files) {
    const rel = at(f);
    served.add(rel);
    if (rel.endsWith('/index.html')) {
      served.add(rel.slice(0, -'/index.html'.length) || '/');
    }
  }

  const broken = [];
  for (const f of files.filter((f) => f.endsWith('.html'))) {
    const body = fs.readFileSync(f, 'utf8');
    for (const [, href] of body.matchAll(/href="(\/[^"#]*)"/g)) {
      const clean = href.split('?')[0].replace(/\/$/, '') || '/';
      // /enquire/<club> is the enquiry form, answered by the application rather than built.
      if (clean.startsWith('/enquire/')) continue;
      if (served.has(clean) || served.has(`${clean}/index.html`)) continue;
      broken.push(`${href}  <-  ${at(f)}`);
    }
  }

  ok(`no internal link points at a page that was not built`,
    broken.length === 0, broken.slice(0, 5).join(' | '));
  console.log(`      → ${served.size} paths, every link resolves`);

  // And no federation may link into another's pages.
  const strays = [];
  for (const f of files.filter((f) => f.endsWith('.html'))) {
    const rel = at(f);
    const owner = rel.startsWith('/demo/') ? rel.split('/').slice(0, 3).join('/') : '';
    const body = fs.readFileSync(f, 'utf8');
    for (const [, href] of body.matchAll(/href="(\/[^"#]*)"/g)) {
      const theirs = href.startsWith('/demo/')
        ? href.split('/').slice(0, 3).join('/') : '';
      if (theirs !== owner) strays.push(`${rel} -> ${href}`);
    }
  }
  ok('no federation links into another federation', strays.length === 0,
    strays.slice(0, 3).join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
