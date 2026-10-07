/**
 * The installable app: a manifest, icons and an offline page, written into the static output.
 *
 * The icons are drawn here (a letter H on the app colour) so that no image tooling is needed and every install gets
 * valid, correctly sized PNGs. A federation can replace them by putting its own files in the output after the build.
 */
import zlib from 'node:zlib';

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

export function manifest({ name, shortName = null }) {
  return {
    name, short_name: (shortName ?? name).slice(0, 12), description: `${name} — your membership, classes, events and payments`,
    start_url: '/me', scope: '/', display: 'standalone', background_color: '#ffffff', theme_color: APP_COLOUR,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

export const offlinePage = (name) => `<!DOCTYPE html><html lang="en-NZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — ${name.replace(/[<&>]/g, '')}</title><style>body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#fff;color:#1c2333;text-align:center;padding:24px}
h1{font-size:1.4rem}p{max-width:30em;color:#555}a{color:#263CA3}</style></head><body><main><h1>You are offline</h1>
<p>${name.replace(/[<&>]/g, '')} needs a connection to show your details. Your information is not stored on this device, so nobody else can read it here.</p>
<p><a href="/me">Try again</a></p></main></body></html>`;
