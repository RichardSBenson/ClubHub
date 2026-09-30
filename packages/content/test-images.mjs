/**
 * Every fixture here is built byte by byte, and the PNG and GIF ones are real
 * files a browser will render — checked by eye once, then pinned here. A test
 * that feeds the parser bytes the parser's author invented proves only that
 * the author was consistent with himself.
 */
import { identify, extensionFor, NotAnImage, MAX_BYTES, MAX_DIMENSION }
  from './images.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n} ${d}`));
const refuses = (n, bytes, fragment) => {
  try { identify(bytes); fail++; console.log(`  ✗ ${n} — it was accepted`); }
  catch (e) {
    if (!(e instanceof NotAnImage)) {
      fail++; console.log(`  ✗ ${n} — wrong error type: ${e.name}: ${e.message}`);
    } else if (fragment && !e.message.includes(fragment)) {
      fail++; console.log(`  ✗ ${n} — "${e.message}"`);
    } else { pass++; console.log(`  ✓ ${n} — ${e.message}`); }
  }
};

// ---------------------------------------------------------------------------
// fixtures

/** A real 1x1 red PNG. Decoded from the smallest one a browser will render. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  + 'IQAAAABJRU5ErkJggg==', 'base64');

/** A PNG header claiming a specific size, for dimension reading. */
const pngOf = (w, h) => {
  const b = Buffer.alloc(24);
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};

/** A real 1x1 transparent GIF — the classic tracking pixel. */
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64');

/** A JPEG with EXIF before the frame, which is what a phone actually sends. */
const jpegOf = (w, h) => {
  const exif = Buffer.alloc(2 + 2 + 60);          // APP1 marker, length, payload
  exif.writeUInt16BE(0xFFE1, 0); exif.writeUInt16BE(62, 2);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xFFC0, 0);                   // start of frame, baseline
  sof.writeUInt16BE(8, 2);                        // segment length
  sof.writeUInt8(8, 4);                           // bit depth
  sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), exif, sof]);
};

const webpLossy = (w, h) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1');
  b.write('VP8 ', 12, 'latin1');
  b[23] = 0x9D; b[24] = 0x01; b[25] = 0x2A;
  b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28);
  return b;
};

const webpLossless = (w, h) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1');
  b.write('VP8L', 12, 'latin1');
  b[20] = 0x2F;
  b.writeUInt32LE(((h - 1) << 14) | (w - 1), 21);
  return b;
};

const webpExtended = (w, h) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b[24] = (w-1) & 0xFF; b[25] = ((w-1) >> 8) & 0xFF; b[26] = ((w-1) >> 16) & 0xFF;
  b[27] = (h-1) & 0xFF; b[28] = ((h-1) >> 8) & 0xFF; b[29] = ((h-1) >> 16) & 0xFF;
  return b;
};

// ---------------------------------------------------------------------------

console.log('\nREAL FILES, READ FROM THEIR BYTES');
{
  const p = identify(PNG_1x1);
  ok('a real PNG', p.mime === 'image/png' && p.width === 1 && p.height === 1,
    JSON.stringify(p));
  const g = identify(GIF_1x1);
  ok('a real GIF', g.mime === 'image/gif' && g.width === 1 && g.height === 1,
    JSON.stringify(g));
  ok('and the byte count is the file, not the header',
    identify(PNG_1x1).bytes === PNG_1x1.length);
}

console.log('\nDIMENSIONS COME OUT RIGHT, NOT JUST THE TYPE');
{
  const cases = [
    ['PNG 1920x1080',      pngOf(1920, 1080),          'image/png',  1920, 1080],
    ['PNG 1x1',            pngOf(1, 1),                'image/png',     1,    1],
    ['JPEG past its EXIF', jpegOf(4032, 3024),         'image/jpeg', 4032, 3024],
    ['JPEG portrait',      jpegOf(3024, 4032),         'image/jpeg', 3024, 4032],
    ['WebP lossy',         webpLossy(800, 600),        'image/webp',  800,  600],
    ['WebP lossless',      webpLossless(640, 480),     'image/webp',  640,  480],
    ['WebP extended',      webpExtended(2000, 1500),   'image/webp', 2000, 1500],
  ];
  for (const [name, bytes, mime, w, h] of cases) {
    const r = identify(bytes);
    ok(name, r.mime === mime && r.width === w && r.height === h,
      `got ${r.mime} ${r.width}x${r.height}`);
  }
}

console.log('\nA DECLARED TYPE IS A CLAIM, NOT A FACT');
{
  // The whole point: the parser is never told what the uploader said it was.
  const script = Buffer.from('<?php system($_GET["c"]); ?>', 'latin1');
  refuses('a php script named photo.jpg', script, 'not a PNG');

  const html = Buffer.from('<html><script>alert(1)</script>', 'latin1');
  refuses('an html page', html, 'not a PNG');

  const zip = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
  refuses('a zip archive', zip);

  const pdf = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  refuses('a pdf', pdf);
}

console.log('\nSVG IS REFUSED BY NAME, AND SAYS WHY');
{
  refuses('a plain svg',
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
    'can carry script');
  refuses('one behind an xml declaration',
    Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
    'can carry script');
  refuses('one behind whitespace',
    Buffer.from('\n\n   <svg xmlns="http://www.w3.org/2000/svg"/>'),
    'can carry script');
  refuses('and one with script actually in it',
    Buffer.from('<svg onload="fetch(\'/o/moknz/members\')"/>'),
    'can carry script');
}

console.log('\nBROKEN AND HOSTILE FILES');
{
  refuses('nothing at all', Buffer.alloc(0), 'empty');
  refuses('a PNG signature on an empty file',
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]));
  refuses('a PNG signature with no IHDR',
    Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
                   Buffer.alloc(16)]));
  refuses('a PNG claiming zero width', pngOf(0, 100), 'damaged');

  // A JPEG whose segment length is zero: follow it and the offset never moves,
  // which is how a parser written the obvious way spins forever.
  const spin = Buffer.from([0xFF,0xD8, 0xFF,0xE0, 0x00,0x00, 0,0,0,0,0,0]);
  const started = Date.now();
  refuses('a JPEG segment claiming zero length', spin);
  ok('and it returned rather than looping', Date.now() - started < 1000);

  // A JPEG that is all markers and never reaches a frame.
  refuses('a JPEG that never reaches a frame',
    Buffer.concat([Buffer.from([0xFF,0xD8]), Buffer.alloc(200, 0xFF)]));
}

console.log('\nLIMITS');
{
  const huge = Buffer.alloc(MAX_BYTES + 1);
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]).copy(huge, 0);
  refuses('a file over the size limit', huge, 'limit is 5MB');
  ok('and the size it reports is above the limit, not equal to it',
    (() => { try { identify(huge); } catch (e) {
      return /That file is 5\.01MB/.test(e.message); } })());

  refuses('an image past the dimension limit',
    pngOf(MAX_DIMENSION + 1, 100), `${MAX_DIMENSION} pixels`);
  ok('but exactly at the limit is fine',
    identify(pngOf(MAX_DIMENSION, MAX_DIMENSION)).width === MAX_DIMENSION);

  // Size is checked before the bytes are read, so a huge file is refused
  // without parsing it.
  ok('the size refusal names the actual size',
    (() => { try { identify(huge); } catch (e) { return e.message.includes('5MB'); } })());
}

console.log('\nEXTENSIONS FOLLOW THE BYTES, NOT THE NAME');
{
  ok('png', extensionFor('image/png') === 'png');
  ok('jpeg becomes jpg', extensionFor('image/jpeg') === 'jpg');
  ok('gif', extensionFor('image/gif') === 'gif');
  ok('webp', extensionFor('image/webp') === 'webp');
  ok('and anything else is bin, never guessed',
    extensionFor('application/x-php') === 'bin');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
