/**
 * HONBU — THE MENU
 *
 * What a federation puts in its site's menu. Data, like everything else a
 * federation decides, and not a list in a build script.
 *
 * Two things this gets right that the build script did not.
 *
 * It knows which destinations exist. A menu item pointing at a page nobody
 * has written is a link to a 404, and the build used to drop those silently —
 * a line in a build log is not telling somebody. The item added to the
 * hardcoded list this morning was dropped from every federation's menu that
 * way, by me, and nothing said so anywhere a person would look.
 *
 * And it holds the five-item limit that data/settings.json has asked for in a
 * comment since it was written: "Adding a sixth means removing one — this is
 * the rule that stops the menu becoming forty links in five years." A rule
 * that lives in a comment is a suggestion.
 */

/** Five. The comment in settings.json was right. */
export const MAX_ITEMS = 5;

/**
 * Destinations the site generates for every federation, with the label each
 * one takes by default.
 *
 * `club` means the label follows the federation's own word, so a taekwondo
 * body gets "Find a dojang" rather than somebody else's noun.
 */
export const BUILT_IN = [
  { href: '/', label: 'Home', always: true },
  { href: '/find-a-dojo', label: null, club: true },
  { href: '/events', label: 'Events' },
  { href: '/news', label: 'News' },
  { href: '/instructors', label: 'Instructors' },
];

const trim = (s) => String(s ?? '').trim();

/** The label a built-in destination takes when nobody has typed one. */
export function defaultLabel(href, vocabulary = {}) {
  const found = BUILT_IN.find((b) => b.href === href);
  if (!found) return null;
  if (!found.club) return found.label;
  const word = vocabulary.clubPlural ?? vocabulary.club ?? 'Clubs';
  return `Find a ${String(word).toLowerCase().replace(/s$/, '')}`;
}

/**
 * Everywhere this federation's site will actually have a page.
 *
 * `authored` is the published pages; the rest are generated. The instructors
 * page is always written, even when empty, so it is always a valid
 * destination — a menu that appears and disappears as people are published
 * would be worse than one that sometimes leads somewhere quiet.
 */
export function destinations({ authored = [], vocabulary = {} } = {}) {
  return [
    ...BUILT_IN.map((b) => ({
      href: b.href,
      label: defaultLabel(b.href, vocabulary),
      kind: 'generated',
    })),
    ...authored.map((p) => ({
      href: `/${p.slug}`,
      label: p.title,
      kind: 'written',
    })),
  ];
}

/**
 * Read a stored menu into a shape the editor and the build can both use.
 *
 * Tolerant on the way in because this comes out of a settings column somebody
 * may have edited by hand, and a menu with one malformed row should lose that
 * row rather than the whole menu.
 */
export function navigationFrom(stored, { vocabulary = {} } = {}) {
  const raw = Array.isArray(stored) ? stored
    : Array.isArray(stored?.items) ? stored.items
    : [];

  const seen = new Set();
  const items = [];
  for (const row of raw) {
    const href = trim(row?.href);
    if (!href.startsWith('/')) continue;
    if (seen.has(href)) continue;          // a menu with the same link twice
    seen.add(href);
    items.push({
      href,
      label: trim(row?.label) || defaultLabel(href, vocabulary) || href,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

/**
 * What is wrong with this menu, as sentences somebody can act on.
 *
 * Returns problems rather than throwing, because the editor shows all of them
 * at once and refusing on the first is how a person fixes four things in four
 * round trips.
 */
export function problemsWithNavigation(items = [], existing = []) {
  const problems = [];
  const hrefs = new Set(existing.map((d) => d.href));

  if (items.length > MAX_ITEMS)
    problems.push(`A menu may have at most ${MAX_ITEMS} items. `
      + 'Adding a sixth means removing one — that is the rule that stops a '
      + 'menu becoming forty links in five years.');

  const seen = new Set();
  for (const item of items) {
    const href = trim(item.href);
    if (!href) { problems.push('One of the items has no destination.'); continue; }
    if (!href.startsWith('/'))
      problems.push(`"${href}" is not a page on this site. Menu items link `
        + 'within the site; a link out belongs in the page itself.');
    else if (!hrefs.has(href))
      problems.push(`"${trim(item.label) || href}" points at ${href}, which `
        + 'this federation has no page for. Write that page first, or remove '
        + 'the item — otherwise it is a link to nothing.');
    if (seen.has(href)) problems.push(`${href} is in the menu twice.`);
    seen.add(href);

    // A blank label is not a problem when the destination can name itself —
    // the editor says "leave blank for the page's own name", and a rule that
    // then refuses it makes the screen a liar. It is only a problem when
    // there is nothing to fall back to.
    if (!trim(item.label)) {
      const known = existing.find((d) => d.href === href);
      if (!known?.label)
        problems.push(`The item for ${href} has no label, and the page has no `
          + 'name to borrow. Type one.');
    }
  }

  return problems;
}

/**
 * The menu the site should build with.
 *
 * Falls back, in order, to: what the federation stored, what the deployment's
 * settings file says, and finally the generated destinations that are always
 * there. The last of those is what a federation sees on the day it installs,
 * before anybody has opened the menu editor.
 */
export function menuFor({ stored, fileItems = [], authored = [],
                          vocabulary = {} } = {}) {
  const existing = destinations({ authored, vocabulary });
  const valid = (items) => items.filter((i) =>
    existing.some((d) => d.href === i.href));

  const fromStore = valid(navigationFrom(stored, { vocabulary }));
  if (fromStore.length) return fromStore;

  const fromFile = valid(navigationFrom(fileItems, { vocabulary }));
  if (fromFile.length) return fromFile;

  return existing
    .filter((d) => d.kind === 'generated' && d.href !== '/')
    .slice(0, MAX_ITEMS);
}
