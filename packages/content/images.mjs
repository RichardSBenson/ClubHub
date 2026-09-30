/**
 * HONBU — WHAT AN UPLOADED FILE ACTUALLY IS
 *
 * A browser tells you the type of the file it is sending. A browser will tell
 * you anything the person who built the request wants it to. The declared
 * Content-Type of an upload is a claim by the uploader, and an admin screen
 * that stores a file because its claim said 'image/png' will happily store
 * whatever was actually sent and serve it back to somebody else later.
 *
 * So nothing here reads the declared type. Every answer comes from the bytes.
 *
 * Four formats, deliberately:
 *
 *   PNG, JPEG, GIF, WebP — what a phone camera and a screenshot produce, and
 *   what every browser has rendered for fifteen years.
 *
 * Not SVG. An SVG is a document, not a picture: it can carry script, fetch
 * remote content and open links. Serving one from the same origin as the
 * admin hands an uploader a way to run code as whoever views it. A federation
 * wanting a vector crest can convert it; the alternative is a hole with a
 * file extension in front of it.
 *
 * Dimensions come from the header too. They are not decoration: a page that
 * knows an image's real size can reserve space for it, and a build that knows
 * can refuse something 8000 pixels wide before it goes anywhere near a page.
 */

/** A file we will not store, and why — the caller shows this to a person. */
export class NotAnImage extends Error {
  constructor(message) { super(message); this.name = 'NotAnImage'; }
}

const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le32 = (b, i) => (b[i] | (b[i+1] << 8) | (b[i+2] << 16) | (b[i+3] << 24)) >>> 0;

const starts = (b, ...bytes) =>
  b.length >= bytes.length && bytes.every((v, i) => v === null || b[i] === v);

// ---------------------------------------------------------------------------

/** PNG: an 8-byte signature, then IHDR carrying width and height as big-endian. */
function png(b) {
  if (!starts(b, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return null;
  // Bytes 12..15 must spell IHDR, or this is a PNG signature on something else.
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { mime: 'image/png', width: be32(b, 16), height: be32(b, 20) };
}

/** GIF: 'GIF87a' or 'GIF89a', then width and height as little-endian. */
function gif(b) {
  if (b.length < 10) return null;
  const magic = b.toString('latin1', 0, 6);
  if (magic !== 'GIF87a' && magic !== 'GIF89a') return null;
  return { mime: 'image/gif', width: le16(b, 6), height: le16(b, 8) };
}

/**
 * WebP: 'RIFF', a length, 'WEBP', then a chunk whose kind decides the layout.
 * VP8 is lossy, VP8L lossless, VP8X extended — all three store their size
 * differently, and all three are produced by ordinary phones.
 */
function webp(b) {
  if (b.length < 30) return null;
  if (b.toString('latin1', 0, 4) !== 'RIFF') return null;
  if (b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);

  if (chunk === 'VP8 ') {
    // A keyframe: 3-byte frame tag, a 3-byte start code, then 14-bit dimensions.
    if (b[23] !== 0x9D || b[24] !== 0x01 || b[25] !== 0x2A) return null;
    return { mime: 'image/webp',
             width: le16(b, 26) & 0x3FFF, height: le16(b, 28) & 0x3FFF };
  }
  if (chunk === 'VP8L') {
    // 14 bits each, minus one, packed across four bytes after the signature.
    if (b[20] !== 0x2F) return null;
    const bits = le32(b, 21);
    return { mime: 'image/webp',
             width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
  }
  if (chunk === 'VP8X') {
    // Canvas size, 24-bit little-endian, stored minus one.
    const w = b[24] | (b[25] << 8) | (b[26] << 16);
    const h = b[27] | (b[28] << 8) | (b[29] << 16);
    return { mime: 'image/webp', width: w + 1, height: h + 1 };
  }
  return null;
}

/**
 * JPEG: a chain of markers. Walk it to the start-of-frame, which is where the
 * dimensions are. There is no fixed offset — a photo from a phone carries EXIF
 * and often a thumbnail before the frame it is actually describing.
 */
function jpeg(b) {
  if (!starts(b, 0xFF, 0xD8)) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) return null;             // lost the chain; not a JPEG
    const marker = b[i + 1];
    if (marker === 0xFF) { i += 1; continue; }  // fill bytes are legal padding
    // Start-of-frame, every variant except the four that are not frames.
    if (marker >= 0xC0 && marker <= 0xCF
        && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { mime: 'image/jpeg', height: be16(b, i + 5), width: be16(b, i + 7) };
    }
    const length = be16(b, i + 2);
    if (length < 2) return null;                // a segment cannot be shorter
    i += 2 + length;
  }
  return null;
}

const READERS = [png, jpeg, gif, webp];

// ---------------------------------------------------------------------------

/** Every format we accept, for an accept= attribute and for error messages. */
export const ACCEPTED = Object.freeze(['image/png', 'image/jpeg',
                                       'image/gif', 'image/webp']);

/** Beyond this an image is a liability in a page, not a picture. */
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_DIMENSION = 6000;

/**
 * What these bytes are, or a refusal saying why not.
 *
 * Throws rather than returning null because every caller must handle the no,
 * and a null slips through an `if` far more quietly than an exception does.
 */
export function identify(bytes, { filename = null } = {}) {
  if (!bytes || !bytes.length)
    throw new NotAnImage('That file was empty.');

  if (bytes.length > MAX_BYTES)
    // Rounded up, and to two places. Rounding to the nearest tenth told
    // somebody their 5MB-and-one-byte file was 5MB and the limit was 5MB,
    // which reads like the refusal is broken rather than the file too big.
    throw new NotAnImage(
      `That file is ${Math.ceil(bytes.length / 1024 / 1024 * 100) / 100}MB. `
      + `The limit is ${MAX_BYTES / 1024 / 1024}MB — resize it and try again.`);

  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  // Named before the general refusal, because "we do not take SVG" is a
  // different conversation from "that is not an image".
  if (b.toString('latin1', 0, 512).trimStart().match(/^(<\?xml|<svg)/i))
    throw new NotAnImage(
      'SVG files are not accepted: they can carry script, and serving one '
      + 'would let it run on this site. Save it as a PNG instead.');

  let found = null;
  for (const read of READERS) {
    try { found = read(b); } catch { found = null; }
    if (found) break;
  }

  if (!found)
    throw new NotAnImage(filename
      ? `${filename} is not a PNG, JPEG, GIF or WebP — whatever it is named.`
      : 'That is not a PNG, JPEG, GIF or WebP.');

  if (!(found.width > 0) || !(found.height > 0))
    throw new NotAnImage('That image reports no size, so it is damaged.');

  if (found.width > MAX_DIMENSION || found.height > MAX_DIMENSION)
    throw new NotAnImage(
      `That image is ${found.width}×${found.height}. `
      + `The limit is ${MAX_DIMENSION} pixels on a side.`);

  return { ...found, bytes: b.length };
}

/** The extension a stored asset is written out with, from its real type. */
export function extensionFor(mime) {
  return { 'image/png': 'png', 'image/jpeg': 'jpg',
           'image/gif': 'gif', 'image/webp': 'webp' }[mime] ?? 'bin';
}
