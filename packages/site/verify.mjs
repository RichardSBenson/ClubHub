/** Checks on the built output. SEO claims must be provable, not asserted. */
import fs from 'node:fs';
import path from 'node:path';

const OUT = './dist';
let pass = 0, fail = 0;
const ok = (n, c, d='') => c ? (pass++, console.log(`  ✓ ${n}`))
                             : (fail++, console.log(`  ✗ ${n} ${d}`));

const read = (p) => fs.readFileSync(path.join(OUT, p), 'utf8');
const html = (p) => read(p);

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
  ok('canonical is set', wh.includes('rel="canonical" href="https://www.kyokushinkarate.co.nz/whanganui"'));

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
  ok('authored pages are in it', sm.includes('/history') && sm.includes('/about'));
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
