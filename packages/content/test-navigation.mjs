import { navigationFrom, problemsWithNavigation, menuFor, destinations,
         defaultLabel, MAX_ITEMS } from './navigation.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const KARATE = { club: 'Dojo', clubPlural: 'Dojo' };
const TKD = { club: 'Dojang', clubPlural: 'Dojangs' };
const PAGES = [{ slug: 'about', title: 'About us' },
               { slug: 'membership', title: 'Membership' }];

console.log('\nTHE LABEL FOLLOWS THE FEDERATION\'S OWN WORD');
{
  ok('karate', defaultLabel('/find-a-club', KARATE) === 'Find a dojo',
    defaultLabel('/find-a-club', KARATE));
  ok('taekwondo', defaultLabel('/find-a-club', TKD) === 'Find a dojang',
    defaultLabel('/find-a-club', TKD));
  ok('and a federation that has said nothing gets a neutral word',
    defaultLabel('/find-a-club', {}) === 'Find a club');
  ok('other destinations have fixed labels',
    defaultLabel('/events', TKD) === 'Events');
  ok('and something not built in has none',
    defaultLabel('/anything', {}) === null);
}

console.log('\nWHAT THE SITE ACTUALLY HAS A PAGE FOR');
{
  const d = destinations({ authored: PAGES, vocabulary: KARATE });
  ok('the generated pages are there',
    ['/', '/find-a-club', '/events', '/news', '/instructors']
      .every((h) => d.some((x) => x.href === h)));
  ok('and the written ones', d.some((x) => x.href === '/about'));
  ok('a written page keeps its own title',
    d.find((x) => x.href === '/about')?.label === 'About us');
  ok('and they are marked as written rather than generated',
    d.find((x) => x.href === '/about')?.kind === 'written');
}

console.log('\nREADING A STORED MENU');
{
  const items = navigationFrom({ items: [
    { href: '/find-a-club' },
    { href: '/about', label: 'Who we are' },
  ]}, { vocabulary: KARATE });
  ok('two items', items.length === 2);
  ok('a missing label falls back to the default',
    items[0].label === 'Find a dojo');
  ok('a typed label wins', items[1].label === 'Who we are');

  ok('a bare array works too',
    navigationFrom([{ href: '/events' }]).length === 1);
  ok('nothing stored is an empty menu, not a crash',
    navigationFrom(null).length === 0 && navigationFrom(undefined).length === 0);

  // Hand-edited settings files contain anything.
  const messy = navigationFrom({ items: [
    { href: '/events' }, null, { href: '' }, { href: 'events' },
    { href: '/events', label: 'Again' }, { label: 'No destination' },
  ]});
  ok('one malformed row loses that row, not the menu', messy.length === 1,
    JSON.stringify(messy));
  ok('and the same link twice is kept once', messy[0].href === '/events');

  const many = navigationFrom({ items: Array.from({ length: 9 },
    (_, i) => ({ href: `/p${i}`, label: `P${i}` })) });
  ok(`never more than ${MAX_ITEMS}`, many.length === MAX_ITEMS);
}

console.log('\nPROBLEMS ARE REPORTED ALL AT ONCE, NOT ONE PER ATTEMPT');
{
  const existing = destinations({ authored: PAGES, vocabulary: KARATE });

  ok('a good menu has no problems',
    problemsWithNavigation([{ href: '/events', label: 'Events' }], existing)
      .length === 0);

  // The bug this file exists for: an item pointing nowhere used to vanish in
  // a build log.
  const dangling = problemsWithNavigation(
    [{ href: '/classes', label: 'Classes' }], existing);
  ok('an item pointing at a page nobody wrote is reported', dangling.length === 1);
  ok('by name, with the destination',
    dangling[0].includes('Classes') && dangling[0].includes('/classes'));
  ok('and says what to do about it',
    dangling[0].includes('Write that page first'));

  const several = problemsWithNavigation([
    { href: '/events', label: '' },
    { href: '/events', label: 'Events' },
    { href: 'https://example.com', label: 'Elsewhere' },
    { href: '/nope', label: 'Nope' },
  ], existing);
  ok('three problems come back together', several.length >= 3, several.join(' | '));
  ok('an external link is explained rather than silently dropped',
    several.some((p) => p.includes('link out belongs in the page')));
  ok('a duplicate is named', several.some((p) => p.includes('twice')));

  // The editor says "leave blank for the page's own name". A rule that then
  // refuses a blank label would make that screen a liar.
  ok('a blank label is not a problem when the page can name itself',
    problemsWithNavigation([{ href: '/events', label: '' }], existing)
      .length === 0);
  ok('nor for a written page, which has a title',
    problemsWithNavigation([{ href: '/about', label: '' }], existing)
      .length === 0);
  ok('but it is when there is nothing to borrow',
    problemsWithNavigation([{ href: '/x', label: '' }],
      [{ href: '/x', label: '' }]).some((p) => p.includes('no name to borrow')));

  const six = problemsWithNavigation(
    Array.from({ length: 6 }, () => ({ href: '/events', label: 'E' })), existing);
  ok('a sixth item is refused with the reason',
    six.some((p) => p.includes('at most 5')));
}

console.log('\nWHAT THE BUILD ENDS UP WITH');
{
  const stored = { items: [{ href: '/about', label: 'Who we are' }] };
  const file = [{ href: '/events' }, { href: '/find-a-club' }];

  ok('what the federation stored wins',
    menuFor({ stored, fileItems: file, authored: PAGES, vocabulary: KARATE })
      .map((i) => i.href).join() === '/about');

  ok('the settings file is the fallback',
    menuFor({ stored: null, fileItems: file, authored: PAGES })
      .map((i) => i.href).join() === '/events,/find-a-club');

  const fresh = menuFor({ authored: [], vocabulary: TKD });
  ok('a fresh install gets a working menu without anybody editing anything',
    fresh.length > 0);
  ok('in the federation\'s own words',
    fresh.some((i) => i.label === 'Find a dojang'), JSON.stringify(fresh));
  ok('and never links to the home page from the menu',
    !fresh.some((i) => i.href === '/'));

  // Stored items that point nowhere are dropped here too — but by then the
  // editor has already refused to save them.
  ok('a stored item pointing nowhere does not reach the site',
    menuFor({ stored: { items: [{ href: '/gone', label: 'Gone' },
                                { href: '/events', label: 'Events' }] },
              authored: PAGES }).map((i) => i.href).join() === '/events');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
