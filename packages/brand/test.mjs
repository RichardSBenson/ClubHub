/**
 * Brand extraction, with assertions.
 *
 * This file used to read `./fixture-moknz.json`, which was never committed — so
 * `npm test` has been dying on its first line and nothing after it ever ran.
 * It also only printed its results: no comparisons, no exit code, so even with
 * the fixture present it could not have failed.
 *
 * It now builds its own input. A crest is a handful of flat colours in known
 * proportions, which is exactly what the extractor takes, so a synthetic one
 * tests the real code path and — unlike a binary fixture — says in the source
 * what it is testing.
 */

import { buildBrand, extractPalette, deriveTokens, contrast, hexToRgb,
         forceContrast, toCssVariables } from './index.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

/**
 * An RGBA byte array made of flat colour regions.
 * `parts` is [hex, howManyPixels] — the proportions are what the extractor
 * keys off, so they are the only thing that has to be realistic.
 */
function crest(parts) {
  const total = parts.reduce((n, [, count]) => n + count, 0);
  const px = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [hex, count] of parts) {
    const [r, g, b] = hexToRgb(hex);
    for (let n = 0; n < count; n++) {
      px[i++] = r; px[i++] = g; px[i++] = b; px[i++] = 255;
    }
  }
  return px;
}

// A red-and-gold crest on a dark field with a silver rim: the shape of most
// martial arts crests, and of this federation's in particular.
const RED_GOLD = crest([
  ['#CE372C', 4200],   // the kanji and the border
  ['#161617', 3000],   // the field
  ['#F0CE41', 1600],   // the gold
  ['#BDBDBF', 900],    // silver rim
  ['#FFFFFF', 300],    // highlights
]);

// ---------------------------------------------------------------------------

console.log('\nWHAT COMES OUT OF A CREST');
{
  const palette = extractPalette(RED_GOLD);
  ok('the colours are found', palette.length === 5, String(palette.length));
  ok('and ordered by how much of the crest they cover',
    palette.every((c, i) => i === 0 || c.share <= palette[i - 1].share),
    JSON.stringify(palette.map((c) => c.share)));
  ok('the most-used one is the red', palette[0].hex === '#CE372C', palette[0].hex);
  ok('the shares add up to the whole crest',
    Math.abs(palette.reduce((n, c) => n + c.share, 0) - 1) < 0.01);
}

console.log('\nTRANSPARENT PIXELS ARE NOT COLOURS');
{
  // A logo on a transparent background: the transparent half must not become
  // the brand's primary colour just for being the biggest region.
  const px = new Uint8ClampedArray(2000 * 4);
  for (let n = 0; n < 1000; n++) {
    px[n * 4] = 0xCE; px[n * 4 + 1] = 0x37; px[n * 4 + 2] = 0x2C; px[n * 4 + 3] = 255;
  }
  // the rest stay 0,0,0,0 — transparent black
  const palette = extractPalette(px);
  ok('only the opaque colour is reported', palette.length === 1, JSON.stringify(palette));
  ok('and it counts as the whole image', palette[0].share === 1, String(palette[0].share));
}

console.log('\nA COLOUR USED ON ALMOST NOTHING IS NOT A BRAND COLOUR');
{
  const palette = extractPalette(crest([
    ['#CE372C', 9900], ['#00FF00', 100],   // 1%
  ]));
  ok('a one-percent colour is dropped', palette.length === 1, JSON.stringify(palette));
}

console.log('\nNEAR-IDENTICAL SHADES ARE ONE COLOUR');
{
  // Anti-aliasing and JPEG artefacts produce dozens of shades of the same red.
  // Reported separately they would crowd out the gold entirely.
  // #37 and #38 sit either side of a 5-bit boundary, so the bucketing grid
  // alone puts these three reds in two different cells.
  const palette = extractPalette(crest([
    ['#CE372C', 2000], ['#CF382D', 2000], ['#CD362B', 2000],
    ['#F0CE41', 4000],
  ]));
  ok('the three reds are one colour, not two or three',
    palette.length === 2, JSON.stringify(palette));
  ok('with the whole red share behind it',
    Math.abs(palette.find((c) => c.hex.startsWith('#C')).share - 0.6) < 0.01,
    JSON.stringify(palette));
  ok('and the gold is still found',
    palette.some((c) => c.hex.startsWith('#F0')), JSON.stringify(palette));

  // The failure this prevents: fragments of the real brand colour each
  // falling under the 2% floor and vanishing, leaving a minor colour in
  // charge of the whole site.
  const smeared = [];
  for (let i = 0; i < 40; i++)                       // 40 shades of one red
    smeared.push([`#${(0xCE + (i % 3)).toString(16)}${(0x37 + (i % 5))
      .toString(16)}${(0x2C + (i % 4)).toString(16)}`, 200]);
  smeared.push(['#2B4C8C', 1500]);                   // one clean blue
  const real = extractPalette(crest(smeared));
  ok('a smeared crest still reports its red as the main colour',
    real[0].hex.toUpperCase().startsWith('#C'), JSON.stringify(real));
  ok('and the blue second, not first',
    real[1]?.hex === '#2B4C8C', JSON.stringify(real));
}

console.log('\nTHE TOKENS A WEBSITE ACTUALLY NEEDS');
{
  const { tokens, rules, warnings } = deriveTokens(extractPalette(RED_GOLD));

  ok('the primary is the crest red', tokens.primary === '#CE372C', tokens.primary);
  ok('the accent is a different hue, not another red',
    tokens.accent && contrast(tokens.accent, tokens.primary) !== 1, tokens.accent);
  ok('there is a page background', !!tokens.canvas);
  ok('and a text colour', !!tokens.ink);
  ok('body text on the page is readable',
    contrast(tokens.ink, tokens.canvas) >= 7,
    `${contrast(tokens.ink, tokens.canvas).toFixed(2)}:1`);
  ok('muted text still clears the standard',
    rules.muted.onCanvas >= 4.5, `${rules.muted.onCanvas}:1`);

  ok('a link colour is derived that clears the standard',
    contrast(tokens.primaryText, tokens.canvas) >= 4.5,
    `${contrast(tokens.primaryText, tokens.canvas).toFixed(2)}:1`);
  ok('and a darker one still for small text',
    contrast(tokens.primaryTextStrong, tokens.canvas) >= 7,
    `${contrast(tokens.primaryTextStrong, tokens.canvas).toFixed(2)}:1`);
  ok('while the brand colour itself is kept, unaltered, for graphics',
    tokens.primary === '#CE372C');

  // Gold is 1.4:1 on a light page. It is a real brand colour and must not be
  // discarded — but nobody should discover by shipping it that it cannot be
  // read. It is kept, and the warning says where it may be used.
  ok('a colour that only works on dark is flagged, not dropped',
    warnings.some((w) => w.includes('#F0CE41') && w.includes('dark')),
    JSON.stringify(warnings));
  ok('and it is still in the tokens', tokens.accent === '#F0CE41');
}

console.log('\nA CREST WHOSE MAIN COLOUR CANNOT CARRY WHITE TEXT');
{
  // Gold-dominant crest: the primary is unreadable both as text on a light
  // page and under white text on a button. Both must be said out loud.
  const { tokens, warnings } = deriveTokens(extractPalette(crest([
    ['#F0CE41', 6000], ['#2B4C8C', 2500], ['#FFFFFF', 1500],
  ])));
  ok('the gold is taken as the primary', tokens.primary === '#F0CE41',
    tokens.primary);
  ok('and it is reported as too pale for body text',
    warnings.some((w) => w.includes('below 4.5')), JSON.stringify(warnings));
  ok('with a derived colour given for links instead',
    contrast(tokens.primaryText, tokens.canvas) >= 4.5,
    `${contrast(tokens.primaryText, tokens.canvas).toFixed(2)}:1`);
  ok('and white-on-gold buttons are called out too',
    warnings.some((w) => w.includes('White text')), JSON.stringify(warnings));
}

console.log('\nEVERY FOREGROUND TOKEN IS USABLE SOMEWHERE');
{
  const { rules } = deriveTokens(extractPalette(RED_GOLD));
  const orphans = Object.entries(rules)
    .filter(([, r]) => r.unusableAsText)
    .map(([name, r]) => `${name} ${r.hex}`);
  ok('no token is unreadable on both backgrounds', orphans.length === 0,
    orphans.join(', '));
}

console.log('\nA CREST WITH NO COLOUR IN IT AT ALL');
{
  // A black-and-white crest has nothing to make a primary from. It must still
  // produce a usable set rather than an empty one or a crash.
  const { tokens } = deriveTokens(extractPalette(crest([
    ['#111111', 6000], ['#FFFFFF', 4000],
  ])));
  ok('there is still a primary', !!tokens.primary, tokens.primary);
  ok('a canvas', !!tokens.canvas);
  ok('and readable text on it', contrast(tokens.ink, tokens.canvas) >= 7,
    `${contrast(tokens.ink, tokens.canvas).toFixed(2)}:1`);
}

console.log('\nFORCING CONTRAST DARKENS, IT DOES NOT GIVE UP');
{
  const light = '#F0CE41';   // gold: about 1.6:1 on white
  const fixed = forceContrast(light, '#FFFFFF', 4.5);
  ok('gold is adjusted until it is readable on white',
    contrast(fixed, '#FFFFFF') >= 4.5,
    `${contrast(fixed, '#FFFFFF').toFixed(2)}:1`);
  ok('and it is still recognisably gold, not black',
    fixed !== '#000000', fixed);

  const already = forceContrast('#161617', '#FFFFFF', 4.5);
  ok('something already readable is left alone', already === '#161617', already);
}

console.log('\nWHAT GETS WRITTEN INTO THE STYLESHEET');
{
  const brand = buildBrand(RED_GOLD, { discipline: 'karate' });
  ok('the css declares custom properties', brand.css.includes('--'));
  ok('including the primary', brand.css.includes(brand.tokens.primary));
  ok('and nothing is left undefined',
    !brand.css.includes('undefined') && !brand.css.includes('null'), brand.css);

  ok('a karate federation is offered Japanese typefaces',
    brand.typePairings.some((p) => /Mincho|Zen|Noto/.test(p.display + p.body)),
    JSON.stringify(brand.typePairings.map((p) => p.id)));
  ok('and a safe pairing regardless',
    brand.typePairings.some((p) => p.suits.includes('any')));

  const generic = buildBrand(RED_GOLD, { discipline: 'brazilian-jiu-jitsu' });
  ok('a federation that is not Japanese is not given mincho first',
    !/Mincho/.test(generic.typePairings[0].display),
    generic.typePairings[0].display);
}

console.log('\nA WARM CREST GETS A WARM PAGE');
{
  const cool = deriveTokens(extractPalette(RED_GOLD), { warm: false });
  const warm = deriveTokens(extractPalette(RED_GOLD), { warm: true });
  ok('the two canvases differ', cool.tokens.canvas !== warm.tokens.canvas,
    `${cool.tokens.canvas} / ${warm.tokens.canvas}`);
  ok('and both are still readable',
    contrast(cool.tokens.ink, cool.tokens.canvas) >= 7
    && contrast(warm.tokens.ink, warm.tokens.canvas) >= 7);
}

console.log('\nCONTRAST MATHS');
{
  ok('white on black is 21:1', Math.round(contrast('#FFFFFF', '#000000')) === 21);
  ok('a colour against itself is 1:1', contrast('#CE372C', '#CE372C') === 1);
  ok('it does not matter which way round',
    contrast('#CE372C', '#FFFFFF') === contrast('#FFFFFF', '#CE372C'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
