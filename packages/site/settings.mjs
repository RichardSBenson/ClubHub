/**
 * Site settings — loaded, completed and CHECKED.
 *
 * The point of this file: someone editing data/settings.json on a phone cannot
 * ship a site with unreadable text. Every colour pair that will actually appear
 * together is measured, and a bad one fails the build with the numbers.
 *
 * Better a failed build than a page nobody can read on a phone in daylight.
 */

import fs from 'node:fs';
import path from 'node:path';
import { contrast, forceContrast, deriveTokens, extractPalette }
  from '../brand/index.mjs';

export class SettingsError extends Error {
  constructor(problems) {
    super('settings.json has problems:\n\n  ' + problems.join('\n  ') + '\n');
    this.name = 'SettingsError';
    this.problems = problems;
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

const HOME_SECTIONS = ['hero','dojoGrid','photoBand','events','news','pathway','lineage'];
const DOJO_SECTIONS = ['hero','facts','startAnyWeek','times','about','events','findUs'];

const DEFAULTS = {
  colours: { primary:'#CE372C', accent:'#F0CE41', ink:'#161617',
             canvas:'#F5F5F5', neutral:'#BDBDBF' },
  fonts: { display:'Georgia', body:'system-ui' },
  homePage: { sections:['hero','dojoGrid','events','news'] },
  dojoPage: { sections: DOJO_SECTIONS },
  navigation: { items: [] },
};

/** Strips the _readme and _comment keys so they never reach a template. */
const clean = (o) => {
  if (Array.isArray(o)) return o.map(clean);
  if (o && typeof o === 'object')
    return Object.fromEntries(Object.entries(o)
      .filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, clean(v)]));
  return o;
};

export function loadSettings(dir) {
  const file = path.join(dir, 'settings.json');
  if (!fs.existsSync(file)) return complete(DEFAULTS);

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new SettingsError([
      `it is not valid JSON — ${e.message}`,
      'a missing comma or a trailing one is the usual cause',
    ]);
  }
  return complete(clean(raw));
}

function complete(s) {
  const problems = [];
  const c = { ...DEFAULTS.colours, ...(s.colours ?? {}) };

  for (const [name, value] of Object.entries(c)) {
    if (!HEX.test(value))
      problems.push(`colours.${name} is "${value}" — needs to be a hex colour ` +
        `like #CE372C`);
  }
  if (problems.length) throw new SettingsError(problems);

  // Derive the rest from the five the person chose, the same way the crest
  // engine does, so a hand-picked palette behaves like a generated one.
  const derived = deriveTokens([
    { hex: c.primary, share: 0.4 },
    { hex: c.accent, share: 0.2 },
    { hex: c.neutral, share: 0.4 },
  ]);

  const tokens = {
    ...derived.tokens,
    primary: c.primary, accent: c.accent, ink: c.ink,
    canvas: c.canvas, neutral: c.neutral,
    primaryText: s.colours?.primaryText ?? forceContrast(c.primary, c.canvas, 4.5),
    primaryTextStrong: s.colours?.primaryTextStrong
      ?? forceContrast(c.primary, c.canvas, 7),
    primaryHover: s.colours?.primaryHover ?? forceContrast(c.primary, c.canvas, 7),
    inkSoft: s.colours?.inkSoft ?? derived.tokens.inkSoft,
    canvasAlt: s.colours?.canvasAlt ?? derived.tokens.canvasAlt,
    muted: s.colours?.muted ?? forceContrast(c.neutral, c.canvas, 4.5),
  };

  const notes = [];
  checkReadability(tokens, problems, notes);
  checkSections(s, problems);
  checkNavigation(s, problems);
  if (problems.length) throw new SettingsError(problems);

  return {
    organisation: s.organisation ?? {},
    tokens,
    fonts: { ...DEFAULTS.fonts, ...(s.fonts ?? {}) },
    homePage: { ...DEFAULTS.homePage, ...(s.homePage ?? {}) },
    dojoPage: { ...DEFAULTS.dojoPage, ...(s.dojoPage ?? {}) },
    navigation: s.navigation?.items ?? [],
    seo: s.seo ?? {},
    // One note per colour. The derived engine reports the same constraints in
    // different words, and three lines saying one thing is noise.
    notes: dedupe([...notes, ...derived.warnings]),
  };
}

/**
 * Only the pairs that ACTUALLY appear together. Checking every combination
 * produces noise nobody reads; checking the real ones produces failures people
 * act on.
 */
/**
 * Problems fail the build. Notes are printed and ignored — the difference is
 * whether a visitor would be unable to read something, or whether the author
 * simply needs to know a constraint.
 */
function checkReadability(t, problems, notes) {
  const pairs = [
    ['body text', t.ink, t.canvas, 4.5],
    ['quiet text', t.muted, t.canvas, 4.5],
    ['links', t.primaryText, t.canvas, 4.5],
    ['text on dark sections', t.canvas, t.ink, 4.5],
    ['quiet text on dark', t.neutral, t.ink, 4.5],
    ['button text', '#FFFFFF', t.primary, 4.5],
    ['dates and highlights', t.accent, t.ink, 4.5],
  ];

  for (const [what, fg, bg, need] of pairs) {
    const ratio = contrast(fg, bg);
    if (ratio < need) {
      problems.push(
        `${what}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${need}:1 — ` +
        `unreadable on a phone in daylight`);
    }
  }

  // Not a failure: a pale accent on a light page is normal and the site only
  // ever uses it on dark. Worth saying once so nobody sets it as a text colour.
  if (contrast(t.accent, t.canvas) < 3) {
    notes.push(
      `accent ${t.accent} reads at ${contrast(t.accent, t.canvas).toFixed(2)}:1 ` +
      `on the page background, so it is used on dark sections only`);
  }
}

function checkSections(s, problems) {
  for (const name of s.homePage?.sections ?? []) {
    if (!HOME_SECTIONS.includes(name))
      problems.push(`homePage.sections has "${name}" — choose from: ` +
        HOME_SECTIONS.join(', '));
  }
  for (const name of s.dojoPage?.sections ?? []) {
    if (!DOJO_SECTIONS.includes(name))
      problems.push(`dojoPage.sections has "${name}" — choose from: ` +
        DOJO_SECTIONS.join(', '));
  }
  if ((s.dojoPage?.sections ?? []).length
      && !s.dojoPage.sections.includes('facts'))
    problems.push('dojoPage.sections is missing "facts" — where, when and who ' +
      'to ask is the reason a visitor is on that page');
}

function checkNavigation(s, problems) {
  const items = s.navigation?.items ?? [];
  if (items.length > 5)
    problems.push(`navigation has ${items.length} items — five is the limit. ` +
      'A sixth means removing one.');
  for (const i of items) {
    if (!i.href?.startsWith('/'))
      problems.push(`navigation link "${i.label}" must start with /`);
    if (!i.label) problems.push('a navigation item has no label');
  }
}

/** Used by onboarding: crest in, a settings.json a person can then edit. */
export function settingsFromCrest(pixels, { name, tagline } = {}) {
  const palette = extractPalette(pixels);
  const { tokens } = deriveTokens(palette);
  return {
    organisation: { name, tagline },
    colours: {
      primary: tokens.primary, accent: tokens.accent ?? tokens.neutral,
      ink: tokens.ink, canvas: tokens.canvas, neutral: tokens.neutral,
    },
    fonts: DEFAULTS.fonts,
    homePage: DEFAULTS.homePage,
    dojoPage: DEFAULTS.dojoPage,
  };
}

/** Keeps the first note mentioning each colour name. */
function dedupe(notes) {
  const seen = new Set();
  return notes.filter((n) => {
    const key = n.split(/[\s(]/)[0].toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { HOME_SECTIONS, DOJO_SECTIONS };
