/**
 * HONBU — brand engine
 *
 * Turns a federation's crest into a usable, accessible set of design tokens.
 *
 * The rule that matters: contrast is COMPUTED, never guessed. A language model
 * will hand you gold text on white and tell you it looks smart. This module
 * checks the ratio and refuses.
 *
 * Proven on the MOKNZ crest: extracted #CE372C, #F0CE41, #BDBDBF, worked out
 * that the gold is 1.54:1 on white (unusable) and 11:1 on near-black, and
 * derived #A82A21 as the readable text version of the brand red.
 */

// ---------------------------------------------------------------------------
// colour maths
// ---------------------------------------------------------------------------

export const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};

export const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n)))
    .toString(16).padStart(2, '0')).join('').toUpperCase();

const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

export const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** WCAG contrast ratio, 1 to 21. */
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

export const rgbToHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
};

export const hslToRgb = ([h, s, l]) => {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
};

const shift = (hex, dl) => {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([h, s, Math.max(0, Math.min(1, l + dl))]));
};

/**
 * Darken (or lighten) a colour until it clears `target` contrast against `on`.
 * Returns the original if it already passes. Gives up at pure black/white.
 */
export const forceContrast = (hex, on = '#FFFFFF', target = 4.5) => {
  if (contrast(hex, on) >= target) return hex;
  const goDarker = luminance(on) > 0.5;
  let out = hex;
  for (let i = 0; i < 100; i++) {
    out = shift(out, goDarker ? -0.01 : 0.01);
    if (contrast(out, on) >= target) return out;
  }
  return goDarker ? '#000000' : '#FFFFFF';
};

const isNeutral = (hex) => rgbToHsl(hexToRgb(hex))[1] < 0.12;
const lightness = (hex) => rgbToHsl(hexToRgb(hex))[2];
const hue = (hex) => rgbToHsl(hexToRgb(hex))[0];

// ---------------------------------------------------------------------------
// palette extraction
// ---------------------------------------------------------------------------

/**
 * Cluster the opaque pixels of a crest into candidate brand colours.
 * `pixels` is a flat RGBA array (Uint8ClampedArray from a canvas, or Buffer).
 */
export function extractPalette(pixels, { maxColours = 6, minShare = 0.02 } = {}) {
  const bucket = new Map();
  let opaque = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue;           // ignore transparency
    opaque++;
    // quantise to 5 bits per channel so near-identical shades merge
    const key = ((pixels[i] >> 3) << 10) | ((pixels[i + 1] >> 3) << 5) | (pixels[i + 2] >> 3);
    const e = bucket.get(key);
    if (e) { e.n++; e.r += pixels[i]; e.g += pixels[i + 1]; e.b += pixels[i + 2]; }
    else bucket.set(key, { n: 1, r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] });
  }

  return [...bucket.values()]
    .filter((e) => e.n / opaque >= minShare)
    .sort((a, b) => b.n - a.n)
    .slice(0, maxColours)
    .map((e) => ({
      hex: rgbToHex([e.r / e.n, e.g / e.n, e.b / e.n]),
      share: +(e.n / opaque).toFixed(4),
    }));
}

// ---------------------------------------------------------------------------
// token derivation
// ---------------------------------------------------------------------------

/**
 * Turn extracted colours into a full, checked token set.
 *
 * Every token carries its contrast ratio and a note about where it may be
 * used, so the renderer can refuse a bad combination instead of shipping it.
 */
export function deriveTokens(palette, opts = {}) {
  const warm = opts.warm ?? false;
  const candidates = palette.filter((c) => !isNeutral(c.hex) && lightness(c.hex) > 0.12
    && lightness(c.hex) < 0.92);

  // Primary: most-used chromatic colour. Accent: next, different hue.
  const primary = candidates[0]?.hex ?? '#1C1C1E';
  const accent = candidates.find((c) =>
    Math.abs(hue(c.hex) - hue(primary)) > 25)?.hex ?? null;

  const neutral = palette.find((c) => isNeutral(c.hex) && lightness(c.hex) > 0.4)?.hex
    ?? '#BDBDBF';

  // Ink and canvas take a hint of the crest's own temperature, so a cool
  // silver crest doesn't sit on a warm cream page.
  const nh = hue(neutral);
  const ink = rgbToHex(hslToRgb([nh, warm ? 0.06 : 0.02, 0.09]));
  const inkSoft = rgbToHex(hslToRgb([nh, warm ? 0.05 : 0.02, 0.15]));
  const canvas = rgbToHex(hslToRgb([nh, warm ? 0.10 : 0.01, 0.96]));
  const canvasAlt = rgbToHex(hslToRgb([nh, warm ? 0.09 : 0.01, 0.89]));

  const onLight = forceContrast(primary, canvas, 4.5);   // readable body links
  const onLightBold = forceContrast(primary, canvas, 7); // small text
  const hover = shift(onLight, -0.08);

  const tok = {
    primary,
    primaryText: onLight,
    primaryTextStrong: onLightBold,
    primaryHover: hover,
    accent,
    neutral,
    ink,
    inkSoft,
    canvas,
    canvasAlt,
    muted: forceContrast(shift(neutral, -0.28), canvas, 4.5),
  };

  // Which tokens are ever used as foreground? Only those can fail readability.
  const FOREGROUND = new Set([
    'primary', 'primaryText', 'primaryTextStrong', 'primaryHover',
    'accent', 'neutral', 'muted', 'ink', 'inkSoft',
  ]);

  // Where may each colour legally appear? Computed, not assumed.
  const rules = {};
  for (const [name, hex] of Object.entries(tok)) {
    if (!hex) continue;
    const fg = FOREGROUND.has(name);
    const onCanvas = contrast(hex, tok.canvas);
    const onInk = contrast(hex, tok.ink);
    rules[name] = {
      hex,
      onCanvas: +onCanvas.toFixed(2),
      onInk: +onInk.toFixed(2),
      textOnCanvas: onCanvas >= 4.5,
      textOnInk: onInk >= 4.5,
      whiteTextOnIt: contrast('#FFFFFF', hex) >= 4.5,
      role: fg ? 'foreground' : 'background',
      darkOnly: fg && onCanvas < 3 && onInk >= 4.5,
      unusableAsText: fg && onCanvas < 4.5 && onInk < 4.5,
    };
  }

  return { tokens: tok, rules, warnings: warnings(tok, rules) };
}

function warnings(tok, rules) {
  const out = [];
  for (const [name, r] of Object.entries(rules)) {
    if (r.darkOnly) {
      out.push(`${name} (${r.hex}) reads at only ${r.onCanvas}:1 on the page ` +
        `background but ${r.onInk}:1 on dark. Use it in dark sections only.`);
    }
    if (r.unusableAsText) {
      out.push(`${name} (${r.hex}) is not readable as text on either background. ` +
        'Graphic use only.');
    }
  }
  if (contrast(tok.primary, '#FFFFFF') < 4.5) {
    out.push(`Brand primary ${tok.primary} is ` +
      `${contrast(tok.primary, '#FFFFFF').toFixed(2)}:1 on white, below 4.5. ` +
      `${tok.primaryTextStrong} has been derived for links and small text.`);
  }
  if (contrast('#FFFFFF', tok.primary) < 4.5) {
    out.push(`White text on ${tok.primary} is only ` +
      `${contrast('#FFFFFF', tok.primary).toFixed(2)}:1. Use ` +
      `${tok.primaryHover} for filled buttons instead.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// type pairing — a curated list, not a generated one
// ---------------------------------------------------------------------------

const PAIRINGS = [
  { id: 'japanese-formal', display: 'Shippori Mincho', body: 'Zen Kaku Gothic New',
    note: 'Japanese mincho and gothic. Renders kanji in the same family as Latin.',
    suits: ['karate','judo','aikido','kendo'] },
  { id: 'japanese-modern', display: 'Zen Antique', body: 'Noto Sans JP',
    note: 'Softer serif with a clean Japanese sans.', suits: ['karate','aikido'] },
  { id: 'institutional', display: 'Bitter', body: 'Source Sans 3',
    note: 'Steady and governmental. Good for a governing body.', suits: ['any'] },
  { id: 'sporting', display: 'Archivo', body: 'Archivo',
    note: 'One family, heavy display weights. Modern sport.', suits: ['any'] },
  { id: 'traditional', display: 'Libre Baskerville', body: 'Inter',
    note: 'Classic serif, neutral body. Safe everywhere.', suits: ['any'] },
];

export function suggestTypePairing(discipline = 'any') {
  const d = discipline.toLowerCase();
  return PAIRINGS.filter((p) => p.suits.includes(d) || p.suits.includes('any'));
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

export function toCssVariables({ tokens }) {
  const lines = Object.entries(tokens)
    .filter(([, v]) => v)
    .map(([k, v]) => `  --${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${v};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/** Everything the onboarding screen needs, in one call. */
export function buildBrand(pixels, { discipline = 'any', warm = false } = {}) {
  const palette = extractPalette(pixels);
  const derived = deriveTokens(palette, { warm });
  return {
    palette,
    ...derived,
    typePairings: suggestTypePairing(discipline),
    css: toCssVariables(derived),
  };
}
