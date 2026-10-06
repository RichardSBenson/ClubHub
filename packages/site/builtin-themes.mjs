/**
 * The themes that ship with Honbu.
 *
 * Held as code rather than read from files at runtime because the admin runs
 * as a serverless function, and a file nothing imports is not reliably
 * included in one. The .json copies in themes/ are written from these by
 * tools/export-themes.mjs and checked against them by a test, so they are what
 * somebody downloads, shares or edits — never what the site reads.
 *
 * Every one passes readTheme(), including the readability checks. A built-in
 * theme that fails them would be the product shipping an unreadable website.
 */

const HOME = ['hero', 'dojoGrid', 'events', 'news'];
const DOJO = ['hero', 'facts', 'startAnyWeek', 'times', 'about', 'instructors', 'gallery', 'events', 'findUs'];

export const BUILT_IN = Object.freeze({
  // The look MOKNZ launched with, as a theme: the crest's red and gold on
  // near-black, with Japanese-rooted type. Another federation may use it, but
  // it is not a neutral choice and is not the default.
  'kyokushin-classic': {
    format: 'honbu-theme', version: 1,
    name: 'Kyokushin Classic',
    description: 'Red and gold on near-black, with type that carries kanji. '
      + 'The look the Mas Oyama federation launched with.',
    author: 'Honbu',
    colours: { primary: '#CE372C', accent: '#F0CE41', ink: '#161617',
               canvas: '#F5F5F5', neutral: '#BDBDBF' },
    fonts: { display: 'Shippori Mincho', body: 'Zen Kaku Gothic New' },
    homePage: { sections: HOME }, dojoPage: { sections: DOJO },
  },

  // The default. Quiet and monochrome, so a federation that has not chosen
  // anything looks like nobody's in particular.
  ink: {
    format: 'honbu-theme', version: 1,
    name: 'Ink',
    description: 'Black and white with one warm highlight. Calm, lets the '
      + 'photographs and the words do the work.',
    author: 'Honbu',
    colours: { primary: '#15171A', accent: '#F2C94C', ink: '#15171A',
               canvas: '#FFFFFF', neutral: '#9AA5AC' },
    fonts: { display: 'Source Serif 4', body: 'Inter' },
    homePage: { sections: HOME }, dojoPage: { sections: DOJO },
  },

  slate: {
    format: 'honbu-theme', version: 1,
    name: 'Slate',
    description: 'Cool blue-grey with a clear blue for actions. Modern and '
      + 'sporting without being loud.',
    author: 'Honbu',
    colours: { primary: '#2543B8', accent: '#7DD3FC', ink: '#0F172A',
               canvas: '#F8FAFC', neutral: '#94A3B8' },
    fonts: { display: 'Archivo', body: 'Inter' },
    homePage: { sections: HOME }, dojoPage: { sections: DOJO },
  },
});

/** The one a federation gets until it chooses another. */
export const DEFAULT_THEME = 'ink';
