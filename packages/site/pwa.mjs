/**
 * The installable app: a manifest, icons and an offline page, written into the static output.
 *
 * The icons are drawn here (a letter H on the app colour) so that no image tooling is needed and every install gets
 * valid, correctly sized PNGs. A federation can replace them by putting its own files in the output after the build.
 */
import zlib from 'node:zlib';
import { region } from '../infrastructure/region-context.mjs';

export const APP_COLOUR = '#3451D1';
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A square PNG: the app colour with a white H. `maskable` keeps the H inside the safe centre 80%. */
export function iconPng(size, { colour = APP_COLOUR, maskable = false } = {}) {
  const [r, g, b] = hex(colour);
  const k = maskable ? 0.8 : 1;                       // scale of the drawing
  const o = (1 - k) / 2;                              // offset
  const inH = (x, y) => {
    const u = (x / size - o) / k, v = (y / size - o) / k;
    if (u < 0 || u > 1 || v < 0.28 || v > 0.72) return false;
    return (u >= 0.30 && u <= 0.40) || (u >= 0.60 && u <= 0.70) || (u >= 0.30 && u <= 0.70 && v >= 0.46 && v <= 0.54);
  };
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++) {
      const w = inH(x, y), p = y * row + 1 + x * 3;
      raw[p] = w ? 255 : r; raw[p + 1] = w ? 255 : g; raw[p + 2] = w ? 255 : b;
    }
  }
  const chunk = (type, data) => {
    const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Pixels of an 8-bit RGB or RGBA PNG that is not interlaced, or null for anything else (the caller falls back). */
export function readPng(buf) {
  try {
    if (buf.subarray(1, 4).toString() !== 'PNG') return null;
    let pos = 8, w = 0, h = 0, type = 0, ok = false; const idat = [];
    while (pos < buf.length) {
      const len = buf.readUInt32BE(pos), kind = buf.subarray(pos + 4, pos + 8).toString(), data = buf.subarray(pos + 8, pos + 8 + len);
      if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; ok = data[8] === 8 && data[12] === 0 && (type === 2 || type === 6); }
      if (kind === 'IDAT') idat.push(data);
      if (kind === 'IEND') break;
      pos += 12 + len;
    }
    if (!ok || !w || !h) return null;
    const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * 4);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let add = 0;
        if (f === 1) add = a; else if (f === 2) add = b; else if (f === 3) add = (a + b) >> 1;
        else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        else if (f !== 0) return null;
        line[i] = (line[i] + add) & 255;
      }
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2]; out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
      }
      prev = line;
    }
    return { w, h, px: out };
  } catch { return null; }
}

/**
 * The federation's own crest as an app icon: the crest, centred and kept whole, on a plain square.
 * `maskable` leaves the margin a phone needs when it crops the icon to a circle or a squircle.
 * Returns null when the crest cannot be read, so the caller can draw the plain icon instead.
 */
export function crestIconPng(crestBuf, size, { colour = '#FFFFFF', maskable = false } = {}) {
  const img = readPng(crestBuf);
  if (!img) return null;
  const [br, bg, bb] = hex(colour);
  const fit = (maskable ? 0.58 : 0.82) * size;
  const k = Math.min(fit / img.w, fit / img.h), dw = img.w * k, dh = img.h * k;
  const x0 = (size - dw) / 2, y0 = (size - dh) / 2;
  const sample = (u, v) => {                         // bilinear, with colour weighted by alpha
    const fx = Math.min(img.w - 1, Math.max(0, u - 0.5)), fy = Math.min(img.h - 1, Math.max(0, v - 0.5));
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, jx = Math.min(img.w - 1, ix + 1), jy = Math.min(img.h - 1, iy + 1);
    const acc = [0, 0, 0, 0];
    for (const [px, py, wgt] of [[ix, iy, (1 - tx) * (1 - ty)], [jx, iy, tx * (1 - ty)], [ix, jy, (1 - tx) * ty], [jx, jy, tx * ty]]) {
      const o = (py * img.w + px) * 4, a = img.px[o + 3] / 255;
      acc[0] += img.px[o] * a * wgt; acc[1] += img.px[o + 1] * a * wgt; acc[2] += img.px[o + 2] * a * wgt; acc[3] += a * wgt;
    }
    return acc;
  };
  const row = size * 3 + 1, raw = Buffer.alloc(row * size), S = 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S - x0) / k, v = (y + (sy + 0.5) / S - y0) / k;
        if (u < 0 || v < 0 || u >= img.w || v >= img.h) continue;
        const s = sample(u, v); r += s[0]; g += s[1]; b += s[2]; a += s[3];
      }
      const n = S * S, al = a / n, p = y * row + 1 + x * 3;
      raw[p] = Math.round(r / n + br * (1 - al)); raw[p + 1] = Math.round(g / n + bg * (1 - al)); raw[p + 2] = Math.round(b / n + bb * (1 - al));
    }
  }
  return encode(size, raw);
}

/**
 * The small icon in the phone's status bar and at the corner of a notification.
 *
 * Android uses only this picture's transparency and paints it one colour, so it has to be a white shape on a clear
 * background — a full-colour square comes out as a plain white block, which looks like no icon at all. The shape is the
 * crest's own outline when there is one, otherwise the same H the app icon uses.
 */
export function badgePng(crestBuf, size = 96) {
  const img = crestBuf ? readPng(crestBuf) : null;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cover = (x, y) => {
    if (img) {
      const fit = 0.92 * size, k = Math.min(fit / img.w, fit / img.h);
      const u = Math.floor((x + 0.5 - (size - img.w * k) / 2) / k), v = Math.floor((y + 0.5 - (size - img.h * k) / 2) / k);
      return u < 0 || v < 0 || u >= img.w || v >= img.h ? 0 : img.px[(v * img.w + u) * 4 + 3];
    }
    const u = x / size, v = y / size;
    return v >= 0.2 && v <= 0.8 && ((u >= 0.25 && u <= 0.38) || (u >= 0.62 && u <= 0.75) || (u >= 0.25 && u <= 0.75 && v >= 0.45 && v <= 0.55)) ? 255 : 0;
  };
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const p = row + 1 + x * 4;
      raw[p] = raw[p + 1] = raw[p + 2] = 255; raw[p + 3] = cover(x, y);
    }
  }
  return encode(size, raw, 6);
}

function encode(size, raw, colourType = 2) {
  const chunk = (type, data) => {
    const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = colourType;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function manifest({ name, shortName = null, background = '#ffffff' }) {
  return {
    id: '/me', name, short_name: (shortName ?? name).slice(0, 12), lang: region().locale, dir: 'ltr',
    description: `${name} — your membership card, classes, events, payments and shop`,
    start_url: '/me', scope: '/', display: 'standalone', display_override: ['standalone', 'minimal-ui'], orientation: 'any',
    background_color: background, theme_color: APP_COLOUR, categories: ['sports', 'lifestyle', 'education'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press the app icon: straight to the things people open it for.
    shortcuts: [
      { name: 'My details', short_name: 'Me', url: '/me', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Events', short_name: 'Events', url: '/me/events', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Classes', short_name: 'Classes', url: '/me/classes', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Shop', short_name: 'Shop', url: '/me/shop', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}

export const offlinePage = (name) => `<!DOCTYPE html><html lang="${region().locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — ${name.replace(/[<&>]/g, '')}</title><style>body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#fff;color:#1c2333;text-align:center;padding:24px}
h1{font-size:1.4rem}p{max-width:30em;color:#555}a{color:#263CA3}</style></head><body><main><h1>You are offline</h1>
<p>${name.replace(/[<&>]/g, '')} needs a connection to show your details. Your information is not stored on this device, so nobody else can read it here.</p>
<p><a href="/me">Try again</a></p></main></body></html>`;
