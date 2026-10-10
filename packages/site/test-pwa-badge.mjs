/** The notification's small icon: a white shape on a clear background, because Android paints it one colour. */
import fs from 'node:fs';
import { badgePng, readPng } from './pwa.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`, d));

const crest = fs.readFileSync(new URL('../../data/media/crest-full-colour.png', import.meta.url));
for (const [name, buf] of [['from the crest', crest], ['without a crest', null]]) {
  const img = readPng(badgePng(buf, 96));
  ok(`${name}: a readable 96-pixel picture with transparency`, img?.w === 96 && img.h === 96);
  const alphas = []; for (let i = 3; i < img.px.length; i += 4) alphas.push(img.px[i]);
  const solid = alphas.filter((a) => a === 255).length / alphas.length;
  ok(`${name}: some of it is clear and some is solid`, solid > 0.1 && solid < 0.9, String(solid));
  ok(`${name}: every visible pixel is white`, [...Array(img.px.length / 4).keys()].every((i) => img.px[i * 4 + 3] === 0 || (img.px[i * 4] === 255 && img.px[i * 4 + 1] === 255 && img.px[i * 4 + 2] === 255)));
}
ok('the service worker uses it as the badge', /badge: '\/icons\/badge-96\.png'/.test(fs.readFileSync(new URL('../../vendor/honbu/sw.js', import.meta.url), 'utf8')));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
