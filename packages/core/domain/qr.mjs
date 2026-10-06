/**
 * DOMAIN — a QR code, drawn with no library
 *
 * Byte mode, error correction level M (about 15% of the code can be damaged and it still reads —
 * a cracked phone screen), versions 1 to 10 (up to 213 bytes). A card or check-in link is
 * about a hundred, so that is plenty; anything longer is refused rather than drawn too small to scan.
 *
 * `qrMatrix(text)` gives rows of booleans (true = dark). `qrSvg(text)` draws them.
 */

// [total codewords, ecc codewords per block, [[blocks, data codewords per block], …]] — level M
const VERSIONS = [
  null,
  [26, 10, [[1, 16]]], [44, 16, [[1, 28]]], [70, 26, [[1, 44]]], [100, 18, [[2, 32]]],
  [134, 24, [[2, 43]]], [172, 16, [[4, 27]]], [196, 18, [[4, 31]]], [242, 22, [[2, 38], [2, 39]]],
  [292, 22, [[3, 36], [2, 37]]], [346, 26, [[4, 43], [1, 44]]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const MAX_BYTES = 213;

// ---- Reed–Solomon over GF(256) ------------------------------------------------------------------

const EXP = new Array(512), LOG = new Array(256);
{ let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
    g = next;
  }
  return g;       // highest power first
}

function remainder(data, degree) {
  const g = generator(degree);
  const out = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ out.shift();
    out.push(0);
    if (factor) for (let i = 0; i < degree; i++) out[i] ^= mul(g[i + 1], factor);
  }
  return out;
}

// ---- the codewords ------------------------------------------------------------------------------

function pickVersion(n) {
  for (let v = 1; v <= 10; v++) {
    const [total, ecc, groups] = VERSIONS[v];
    const data = total - ecc * groups.reduce((s, [b]) => s + b, 0);
    if (n <= data - (v < 10 ? 2 : 3)) return v;     // mode (4 bits) + count (8 bits; 16 from v10) + terminator
  }
  return null;
}

function codewords(bytes, version) {
  const [total, ecc, groups] = VERSIONS[version];
  const blocksN = groups.reduce((s, [b]) => s + b, 0);
  const dataLen = total - ecc * blocksN;

  const bits = [];
  const push = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks = [];
  let at = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) { blocks.push(data.slice(at, at + size)); at += size; }
  const eccs = blocks.map((b) => remainder(b, ecc));

  const out = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecc; i++) for (const e of eccs) out.push(e[i]);
  return out;
}

// ---- the grid -----------------------------------------------------------------------------------

// format: 5 data bits, 10 check bits, xor 0x5412
function formatBits(mask) {
  const data = (0b00 << 3) | mask;                       // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
// version: 6 data bits, 12 check bits
function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function build(version, words, mask) {
  const size = 17 + version * 4;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, v) => { dark[y][x] = v; fixed[y][x] = true; };

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }

  const pos = ALIGN[version];
  for (const cy of pos) for (const cx of pos) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  // format information (both copies) and the fixed dark module
  const f = formatBits(mask);
  const fb = (i) => ((f >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, fb(i));
  set(8, 7, fb(6)); set(8, 8, fb(7)); set(7, 8, fb(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, fb(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fb(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, fb(i));
  set(8, size - 8, true);

  if (version >= 7) {
    const v = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((v >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit); set(b, a, bit);
    }
  }

  // data, in the zig-zag the standard lays out
  const bits = [];
  for (const w of words) for (let i = 7; i >= 0; i--) bits.push(((w >>> i) & 1) === 1);
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let n = 0; n < size; n++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - n : n;
      if (fixed[y][x]) continue;
      let bit = k < bits.length ? bits[k++] : false;
      const flip = [
        (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0,
        (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0,
        (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
      ][mask];
      dark[y][x] = bit !== flip;
    }
  }
  return dark;
}

/** The standard's four penalty rules; the mask with the lowest score reads best. */
function penalty(g) {
  const n = g.length;
  let score = 0;
  const run = (line) => {
    let s = 0, len = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) len++;
      else { if (len >= 5) s += len - 2; len = 1; }
    }
    return s;
  };
  const pattern = (line) => {
    let s = 0;
    for (let i = 0; i + 11 <= line.length; i++) {
      const w = line.slice(i, i + 11).map(Number).join('');
      if (w === '10111010000' || w === '00001011101') s += 40;
    }
    return s;
  };
  for (let i = 0; i < n; i++) {
    const row = g[i], col = g.map((r) => r[i]);
    score += run(row) + run(col) + pattern(row) + pattern(col);
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++)
    if (g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) score += 3;
  const darkN = g.flat().filter(Boolean).length;
  score += Math.floor(Math.abs(darkN * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  const version = pickVersion(bytes.length);
  if (!version) throw new RangeError(`Too long for a QR code here (${bytes.length} bytes, most is ${MAX_BYTES}).`);
  const words = codewords(bytes, version);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const g = build(version, words, mask), s = penalty(g);
    if (!best || s < best.s) best = { g, s };
  }
  return best.g;
}

/** An SVG that scales with its container. The four-module quiet zone is part of the picture. */
export function qrSvg(text, { label = 'QR code', dark = '#000', light = '#fff' } = {}) {
  const g = qrMatrix(text), n = g.length, quiet = 4, size = n + quiet * 2;
  let path = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!g[y][x]) { x++; continue; }
      let end = x; while (end < n && g[y][end]) end++;
      path += `M${x + quiet} ${y + quiet}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  }
  const esc = String(label).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
