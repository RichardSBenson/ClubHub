/**
 * The showcase layout, and the rule that a theme only ever CHOOSES a layout by name.
 *
 * Pure: no database, no server. It renders pages straight from the functions the build calls.
 */
import { readTheme, exportTheme, lookOf, LAYOUTS } from './theme.mjs';
import { BUILT_IN } from './builtin-themes.mjs';
import { safeHref, safeImage } from './showcase.mjs';
import * as R from './render.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`));

const TOKENS = { primary: '#CE372C', primaryText: '#B02A20', primaryTextStrong: '#8A2118', primaryHover: '#8A2118',
  accent: '#F0CE41', ink: '#1C1C1E', inkSoft: '#2A2A2C', canvas: '#F4F4F5', canvasAlt: '#E4E4E6', neutral: '#BDBDBF', muted: '#6E6E70' };
const FONTS = { display: 'Shippori Mincho', body: 'Zen Kaku Gothic New' };

const fed = (more = {}) => ({ id: 'f', name: 'Mas Oyama Karate New Zealand', country_code: 'NZ', discipline: 'Karate',
  artName: 'Kyokushin karate', layoutName: 'showcase', logoUrl: '/media/crest.png',
  stripe: ['#F4F4F5', '#D9761F', 'nonsense', '#1C1C1E'], wordmark: { main: 'Mas Oyama Karate', sub: 'NEW ZEALAND' },
  footerLinks: [{ href: '/find-a-dojo', label: 'Dojo' }], ...more });

const dojo = (slug, name, more = {}) => ({ slug, name, published: true, first_class_free: null, sessions: [], city: name, ...more });
const DOJOS = [dojo('whanganui', 'Whanganui', { first_class_free: true }), dojo('hawera', 'Hawera'), dojo('nagoya', 'Nagoya')];
const page = { origin: 'https://example.org', fonts: FONTS, nav: [{ href: '/events', label: 'Events' }], base: '', vocabulary: { club: 'Dojo', clubPlural: 'Dojo' } };

console.log('\nA THEME CHOOSES A LAYOUT BY NAME, AND NOTHING ELSE');
{
  ok('the layouts are classic and showcase', LAYOUTS.join() === 'classic,showcase');
  const old = { ...BUILT_IN.ink }; delete old.layout;
  const r = readTheme(old);
  ok('a theme written before layouts existed still reads, as classic', r.ok && r.theme.layout === 'classic');
  const r2 = readTheme(BUILT_IN.showcase);
  ok('the showcase theme is valid, readable, and says so', r2.ok && r2.theme.layout === 'showcase');
  ok('and it passes the readability checks', r2.problems.length === 0);
  const bad = readTheme({ ...BUILT_IN.showcase, layout: 'evil' });
  ok('an unknown layout is refused, naming the choices', !bad.ok && bad.problems.some((p) => /classic, showcase/.test(p)));
  const css = readTheme({ ...BUILT_IN.showcase, css: 'body{display:none}' });
  ok('there is still no CSS field', !css.ok && css.problems.some((p) => /css/.test(p)));
  const html = readTheme({ ...BUILT_IN.showcase, layout: '<script>alert(1)</script>' });
  ok('a layout name cannot carry markup', !html.ok);
  ok('the look carries the layout to the build', lookOf(r2.theme).layout === 'showcase');
  const out = exportTheme({ ...r2.theme, homeSections: r2.theme.homePage.sections, dojoSections: r2.theme.dojoPage.sections });
  ok('a download keeps the layout', out.layout === 'showcase');
  ok('a downloaded theme reads back the same', JSON.stringify(readTheme(out).theme) === JSON.stringify(r2.theme));
}

console.log('\nLINKS AND PICTURES ARE CHECKED BEFORE THEY ARE DRAWN');
{
  ok('a path on this site is a link', safeHref('/about') === '/about');
  ok('an https address is a link', safeHref('https://example.org/x') === 'https://example.org/x');
  ok('javascript: is not', safeHref('javascript:alert(1)') === null);
  ok('data: is not', safeHref('data:text/html,<b>x</b>') === null);
  ok('a protocol-relative address is not', safeHref('//evil.example/x') === null);
  ok('plain http is not', safeHref('http://example.org') === null);
  ok('a quote cannot escape the attribute', safeHref('/a"onmouseover="x') === null);
  ok('a file under /media is a picture', safeImage('/media/seiza.jpg') === '/media/seiza.jpg');
  ok('nothing else is', safeImage('https://evil.example/x.jpg') === null && safeImage('/media/../secret.jpg') === null && safeImage('/other/x.jpg') === null);
}

console.log('\nTHE STYLESHEET');
{
  const classic = R.themeCss(TOKENS, FONTS);
  const show = R.themeCss(TOKENS, FONTS, 'showcase');
  ok('classic is the classic stylesheet, as before', classic.includes('header.site{') && !classic.includes('.masthead'));
  ok('showcase draws the masthead and the belt stripe', show.includes('.masthead') && show.includes('.belt'));
  ok('it keeps the shared components: event banners, instructor cards, the lightbox', show.includes('.evbanner') && show.includes('.icard') && show.includes('.lb{'));
  ok('it does not drag the classic shell along', !show.includes('header.site{'));
  ok('the theme colours reach it', show.includes('--primary: #CE372C'));
  ok('its colours are the theme\'s, not a fixed red', /--red:var\(--primary\)/.test(show));
}

console.log('\nTHE HOME PAGE');
{
  const copy = {
    heroHeading: 'Everyone starts as a white belt.', heroText: 'Since 1965.',
    stats: [{ value: '1965', label: 'First dojo' }, { value: '{clubs}', label: 'Dojo' }, { value: 'Free', label: 'First class, everywhere', when: 'allFree' }],
    firstNight: { heading: 'First night', items: [{ title: 'Wear anything', text: 'Shorts are fine.', image: '/media/seiza.jpg', alt: 'x' },
      { title: '<img src=x onerror=alert(1)>', text: 'ok', image: 'https://evil.example/x.jpg' }],
      link: { label: 'Kids', href: '/karate-for-kids' } },
    quotes: { heading: 'Words', items: [] },
    regions: [{ name: 'North Island', slugs: ['whanganui', 'hawera'] }, { name: 'Japan', slugs: ['nagoya'] }],
    lineage: { heading: 'Lineage', paragraphs: ['p'], button: { label: 'History', href: '/about' }, image: '/media/h.jpg', alt: 'h' },
    spotlight: { heading: 'Spotlight', paragraphs: ['s'], button: { label: 'Go', href: 'javascript:alert(1)' } },
    memberBand: { heading: 'Already training?', button: { label: 'Login', href: '/signin' } },
  };
  const html = R.homePage({ ...page, federation: fed({ knownPaths: new Set(['/', '/about', '/signin']) }), dojos: DOJOS, events: [], articles: [],
    homeCopy: copy, sections: ['hero', 'proof', 'firstNight', 'quotes', 'dojoGrid', 'lineage', 'spotlight', 'memberBand'] });

  ok('the masthead carries the crest and the wordmark', html.includes('class="masthead"') && html.includes('Mas Oyama Karate') && html.includes('NEW ZEALAND'));
  ok('the belt stripe draws the valid colours and ignores the invalid one', (html.match(/<i style="background:#/g) ?? []).length === 6 && !html.includes('nonsense'));
  ok('the find-your-dojo box lists every dojo', html.includes('data-finder') && (html.match(/<option value="\/[a-z]/g) ?? []).length === 3);
  ok('and loads its small script from this site', html.includes('src="/vendor/finder.js"'));
  ok('the proof strip counts the dojo itself', html.includes('<b>3</b>'));
  ok('"free at every dojo" is NOT claimed when only one dojo has said so', !html.includes('First class, everywhere'));
  ok('a picture on another site is not drawn', !html.includes('evil.example'));
  ok('hostile words are escaped', !html.includes('<img src=x') && html.includes('&lt;img src=x'));
  ok('a link to a page that does not exist is dropped', !html.includes('/karate-for-kids'));
  ok('a link to one that does exist is kept', html.includes('href="/about"') && html.includes('href="/signin"'));
  ok('javascript: never becomes a link', !html.includes('javascript:'));
  ok('with no real quotes there is no quotes section, not three empty ones', !html.includes('class="says"') && !html.includes('Words'));
  ok('the dojo are grouped by the federation\'s regions', html.includes('North Island') && html.includes('>Japan<'));
  ok('a dojo with no stated free class says "See times", not a promise', html.includes('<strong>Hawera</strong><span>See times</span>') && html.includes('<strong>Whanganui</strong><span>Book a free class</span>'));

  const allFree = R.homePage({ ...page, federation: fed(), dojos: DOJOS.map((d) => ({ ...d, first_class_free: true })), events: [], articles: [],
    homeCopy: copy, sections: ['proof'] });
  ok('when every dojo says so, the claim appears', allFree.includes('First class, everywhere'));

  const none = R.homePage({ ...page, federation: fed(), dojos: DOJOS, events: [], articles: [], homeCopy: {}, sections: ['hero', 'proof', 'firstNight', 'pathway', 'lineage', 'spotlight', 'memberBand'] });
  ok('a federation that has written nothing gets a hero and no invented sections',
    none.includes('class="hero tall') && !none.includes('class="proof"') && !none.includes('class="path"') && !none.includes('class="national"'));

  const classic = R.homePage({ ...page, federation: fed({ layoutName: 'classic' }), dojos: DOJOS, events: [], articles: [], homeCopy: copy, sections: ['hero', 'proof', 'dojoGrid'] });
  ok('classic still draws the classic header and skips what it does not know', classic.includes('<header class="site">') && !classic.includes('class="proof"'));
}

console.log('\nA DOJO\'S PAGE');
{
  const d = { ...dojo('whanganui', 'Whanganui', { first_class_free: true, venue_name: 'Hall', address_line: '1 Road', phone: '+64 6 000 0000', email: 'a@b.nz' }),
    sessions: [{ label: 'Juniors', weekday: 2, starts: '17:30', ends: '18:30' }] };
  const html = R.dojoPage({ ...page, dojo: d, federation: fed({ dojoCopy: { firstNight: { heading: 'Your first night', items: [{ title: 'Turn up early', text: 'Say hello.' }] },
    federationBand: { heading: 'Part of us', text: '{clubs} dojo.', button: { label: 'Events', href: '/events' } } }, clubCount: 17, knownPaths: new Set(['/events']) }),
    events: [], gallery: [], instructors: [], startAnyWeekText: 'Start any week.',
    sections: ['hero', 'facts', 'startAnyWeek', 'times', 'about', 'instructors', 'firstNight', 'events', 'gallery', 'findUs', 'enquire', 'federationBand'] });
  ok('it has a breadcrumb back to find a dojo', html.includes('class="crumb"') && html.includes('href="/find-a-dojo"'));
  ok('the facts name where, when and who to ask, with a call button', html.includes('WHERE') && html.includes('WHEN') && html.includes('WHO TO ASK') && html.includes('href="tel:+6460000000"'));
  ok('the enquiry form posts to this dojo, and has the hidden box robots fill in',
    html.includes('action="/enquire/whanganui"') && html.includes('name="website"') && html.includes('name="kind" value="trial"'));
  ok('the federation band uses the live count', html.includes('17 dojo.'));
  ok('with nobody published there is no "who teaches here" placeholder', !html.includes('Who teaches here'));
  ok('the page title uses the federation\'s name for the art', html.includes('<title>Kyokushin karate in Whanganui'));
  const evil = R.dojoPage({ ...page, dojo: { ...d, name: '<script>alert(1)</script>' }, federation: fed(), events: [], gallery: [], instructors: [] });
  ok('a hostile dojo name cannot become markup', !evil.includes('<script>alert(1)') && evil.includes('&lt;script&gt;'));
}

console.log('\nTHE OTHER PAGES WEAR THE SAME CHROME');
{
  const f = fed();
  const find = R.findADojoPage({ ...page, dojos: DOJOS, federation: { ...f, homeCopy: { regions: [{ name: 'North Island', slugs: ['whanganui'] }] } } });
  ok('find a dojo is grouped by region and has the masthead', find.includes('North Island') && find.includes('class="masthead"'));
  const ev = R.eventsPage({ ...page, events: [], federation: { ...f, eventsIntro: 'Nationals and camps.' } });
  ok('events carries the federation\'s introduction', ev.includes('Nationals and camps.'));
  const au = R.authoredPage({ ...page, page: { slug: 'about', title: 'About us' }, html: '<p>Hello</p>', federation: f });
  ok('a written page has the crumb and a page heading', au.includes('class="crumb"') && au.includes('<h1 class="page">About us</h1>'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
