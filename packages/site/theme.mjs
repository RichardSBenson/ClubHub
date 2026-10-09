/**
 * HONBU — THEMES
 *
 * A theme is how a federation's website looks: five colours, two fonts, which
 * of Honbu's built-in layouts to use, and which sections appear on the home
 * page and on a club's page, in what order. Nothing else. That is the whole of
 * the format, and it is deliberately small.
 *
 * It is DATA, never code. There is no CSS field, no HTML field, no script and
 * no address a theme can point a browser at. The layout is a NAME from a list
 * Honbu ships; choosing "showcase" cannot make a page do anything showcase does
 * not already do for everybody. A theme file is something a
 * federation downloads from a stranger, so the only safe design is one where
 * the worst a hostile file can do is look ugly — and the readability checks
 * below mean it cannot even do that, because an unreadable palette is refused
 * rather than published.
 *
 * What a theme does not carry: words. Headlines, hero copy, a federation's
 * name — those are the federation's own and stay where they are. Importing a
 * theme must never put somebody else's sentences on your website.
 *
 * Pure: no file, database or request in here.
 */
import { tokensFor, readability, HOME_SECTIONS, CLUB_SECTIONS } from './settings.mjs';

export const THEME_FORMAT = 'honbu-theme';
export const THEME_VERSION = 1;

/** A theme is a few hundred bytes. Anything near this is not a theme. */
export const MAX_BYTES = 20 * 1024;

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * A font family as Google spells it. Strict because the name goes into a
 * stylesheet and a font request: letters, digits and spaces, and nothing a
 * stylesheet or a URL would treat as syntax.
 */
const FONT = /^[A-Za-z0-9][A-Za-z0-9 ]{1,38}$/;

const COLOUR_NAMES = ['primary', 'accent', 'ink', 'canvas', 'neutral'];

/**
 * The page layouts Honbu ships. A theme CHOOSES one by name; it cannot supply one. The markup and the
 * stylesheet of a layout are part of Honbu, reviewed with Honbu, which is the only reason a theme file
 * from a stranger can still be safe to open.
 *
 *   classic   the plain layout every federation gets until it chooses another
 *   showcase  the Mas Oyama prototype: belt stripe, crest masthead, "find your nearest club" hero,
 *             proof strip, pathway, club grouped by region, event cards
 */
export const LAYOUTS = Object.freeze(['classic', 'showcase']);
export const DEFAULT_LAYOUT = 'classic';

const ALLOWED = {
  top: ['format', 'version', 'name', 'description', 'author', 'layout',
        'colours', 'fonts', 'homePage', 'clubPage'],
  colours: COLOUR_NAMES,
  fonts: ['display', 'body'],
  homePage: ['sections'],
  clubPage: ['sections'],
};

const trim = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Read a theme from text or an object.
 *
 * Never throws. Returns every problem at once, as sentences, because a person
 * fixing a file should not have to submit it five times to find five mistakes.
 */
import { modernise } from './legacy.mjs';

export function readTheme(input) {
  const problems = [];

  let doc = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    if (Buffer.byteLength(text) > MAX_BYTES)
      return refuse(`That file is ${Math.round(Buffer.byteLength(text) / 1024)} KB. `
        + `A theme is a few hundred bytes — this is not one.`);
    try { doc = JSON.parse(text); }
    catch (e) {
      return refuse(`That is not a theme file — it is not valid JSON (${e.message}).`);
    }
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    return refuse('That is not a theme file.');
  doc = modernise(doc);

  if (doc.format !== THEME_FORMAT)
    return refuse(`That is not a Honbu theme. It should say "format": "${THEME_FORMAT}".`);
  if (doc.version !== THEME_VERSION)
    return refuse(`That theme is version ${JSON.stringify(doc.version)}; this `
      + `Honbu reads version ${THEME_VERSION}.`);

  // Anything unrecognised is refused, not ignored. Silently dropping a field
  // means a file that looked like it carried CSS "imported fine" and did
  // nothing, and the next version that understands the field would suddenly
  // start honouring a file nobody had looked at since.
  for (const [where, allowed] of Object.entries(ALLOWED)) {
    const obj = where === 'top' ? doc : doc[where];
    if (obj == null || typeof obj !== 'object') continue;
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key))
        problems.push(`"${where === 'top' ? '' : where + '.'}${key}" is not something `
          + `a theme can carry. Themes are colours, fonts, a layout name and the order of `
          + `sections — nothing else.`);
    }
  }

  const name = trim(doc.name, 60);
  if (name.length < 2) problems.push('The theme needs a name.');

  // Absent means classic, so every theme written before layouts existed still reads.
  const layout = doc.layout == null ? DEFAULT_LAYOUT : doc.layout;
  if (!LAYOUTS.includes(layout))
    problems.push(`layout is ${JSON.stringify(layout)} — choose from: ${LAYOUTS.join(', ')}.`);

  const colours = {};
  for (const c of COLOUR_NAMES) {
    const v = doc.colours?.[c];
    if (!HEX.test(String(v ?? '')))
      problems.push(`colours.${c} is ${v == null ? 'missing' : JSON.stringify(v)} — `
        + `it needs a six-digit hex colour like #CE372C.`);
    else colours[c] = v.toUpperCase();
  }

  const fonts = {};
  for (const f of ['display', 'body']) {
    const v = doc.fonts?.[f];
    if (!FONT.test(String(v ?? '')))
      problems.push(`fonts.${f} is ${v == null ? 'missing' : JSON.stringify(v)} — `
        + `it needs a font family name as Google Fonts spells it, like "Inter".`);
    else fonts[f] = v.trim().replace(/\s+/g, ' ');
  }

  const homeSections = sectionsOf(doc.homePage?.sections, HOME_SECTIONS,
    'homePage', problems);
  const clubSections = sectionsOf(doc.clubPage?.sections, CLUB_SECTIONS,
    'clubPage', problems);
  if (clubSections && !clubSections.includes('facts'))
    problems.push('clubPage.sections is missing "facts" — where, when and who to '
      + 'ask is the reason anybody is on that page.');

  const notes = [];
  if (!problems.length) {
    const { tokens } = tokensFor(colours);
    const check = readability(tokens);
    problems.push(...check.problems.map((p) => `Colours: ${p}`));
    notes.push(...check.notes);
  }

  if (problems.length) return { ok: false, theme: null, problems, notes };

  return {
    ok: true, problems: [], notes,
    theme: {
      format: THEME_FORMAT, version: THEME_VERSION, name,
      description: trim(doc.description, 300),
      author: trim(doc.author, 80),
      layout,
      colours, fonts,
      homePage: { sections: homeSections },
      clubPage: { sections: clubSections },
    },
  };
}

function refuse(message) {
  return { ok: false, theme: null, problems: [message], notes: [] };
}

function sectionsOf(list, allowed, where, problems) {
  if (!Array.isArray(list) || !list.length) {
    problems.push(`${where}.sections needs at least one section, from: ${allowed.join(', ')}.`);
    return null;
  }
  const out = [];
  for (const s of list) {
    if (!allowed.includes(s)) {
      problems.push(`${where}.sections has "${s}" — choose from: ${allowed.join(', ')}.`);
    } else if (out.includes(s)) {
      problems.push(`${where}.sections lists "${s}" twice.`);
    } else out.push(s);
  }
  return out;
}

/**
 * What the build needs from a theme: the full set of colour tokens, the
 * fonts, and the section order. Same derivation the settings file uses.
 */
export function lookOf(theme) {
  const { tokens, warnings } = tokensFor(theme.colours);
  return {
    name: theme.name,
    layout: theme.layout ?? DEFAULT_LAYOUT,
    tokens, fonts: { ...theme.fonts },
    homeSections: [...theme.homePage.sections],
    clubSections: [...theme.clubPage.sections],
    notes: warnings,
  };
}

/**
 * A theme document from a federation's current look, for download.
 *
 * Field order is fixed so exporting twice gives the same bytes, and a theme
 * kept in version control shows only what somebody actually changed.
 */
export function exportTheme({ name, description = '', author = '', layout = DEFAULT_LAYOUT, colours, fonts,
                              homeSections, clubSections }) {
  return {
    format: THEME_FORMAT, version: THEME_VERSION,
    name, description, author, layout,
    colours: Object.fromEntries(COLOUR_NAMES.map((c) => [c, String(colours[c]).toUpperCase()])),
    fonts: { display: fonts.display, body: fonts.body },
    homePage: { sections: [...homeSections] },
    clubPage: { sections: [...clubSections] },
  };
}

export const serialise = (theme) => JSON.stringify(theme, null, 2) + '\n';
