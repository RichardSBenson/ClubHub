/** Web Push: encryption round-trips, the VAPID token verifies, dead subscriptions are reported, the PWA files are valid. */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { encrypt, decrypt, vapidHeaders, generateVapidKeys, WebPush, pushFromEnv } from './push/webpush.mjs';
import { iconPng, manifest, offlinePage } from '../site/pwa.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const b64u = (b) => Buffer.from(b).toString('base64url');

console.log('\nENCRYPTION');
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = b64u(crypto.randomBytes(16));
const sub = { endpoint: 'https://push.example.net/send/abc', p256dh: b64u(ua.getPublicKey()), auth };
{
  const body = encrypt('{"title":"Kia ora — ✓"}', sub);
  ok('a message round-trips, accents and all', decrypt(body, { ecdh: ua, auth }) === '{"title":"Kia ora — ✓"}');
  ok('the header is salt, record size 4096, a 65-byte key', body.readUInt32BE(16) === 4096 && body[20] === 65 && body[21] === 4);
  ok('the content is not readable in transit', !body.includes(Buffer.from('Kia ora')));
  ok('every message uses a fresh salt and key', !encrypt('x', sub).equals(encrypt('x', sub)) );
  let threw = false; const bad = Buffer.from(body); bad[bad.length - 3] ^= 1;
  try { decrypt(bad, { ecdh: ua, auth }); } catch { threw = true; }
  ok('tampering is detected', threw);
  const other = crypto.createECDH('prime256v1'); other.generateKeys();
  threw = false; try { decrypt(body, { ecdh: other, auth }); } catch { threw = true; }
  ok('another device cannot read it', threw);
}

console.log('\nVAPID');
{
  const k = generateVapidKeys();
  ok('keys are the right sizes', Buffer.from(k.publicKey, 'base64url').length === 65 && Buffer.from(k.privateKey, 'base64url').length === 32);
  const h = vapidHeaders({ endpoint: sub.endpoint, subject: 'mailto:a@b.nz', ...k, now: 1_700_000_000_000 });
  const m = h.authorization.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  ok('the header has the standard shape', !!m && m[4] === k.publicKey);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
  ok('it names the push service and this site', claims.aud === 'https://push.example.net' && claims.sub === 'mailto:a@b.nz' && claims.exp === 1_700_000_000 + 43200);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(Buffer.from(k.publicKey, 'base64url').subarray(1, 33)), y: b64u(Buffer.from(k.publicKey, 'base64url').subarray(33)) }, format: 'jwk' });
  ok('the signature verifies with the public key', crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
}

console.log('\nSENDING');
{
  const k = generateVapidKeys();
  const calls = [];
  const mk = (status) => new WebPush({ ...k, subject: 'mailto:a@b.nz' }, async (url, init) => { calls.push({ url, init }); if (status === 'throw') throw new Error('net'); return { status }; });
  ok('a 201 is sent', await mk(201).send(sub, { title: 'Hi', body: 'There', url: '/me' }) === 'sent');
  const c = calls[0];
  ok('posted to the device\'s address with the right headers', c.url === sub.endpoint && c.init.headers['content-encoding'] === 'aes128gcm' && /^vapid t=/.test(c.init.headers.authorization) && c.init.headers.ttl);
  ok('what was posted decrypts to the message', JSON.parse(decrypt(Buffer.from(c.init.body), { ecdh: ua, auth })).title === 'Hi');
  ok('a 410 means the device is gone', await mk(410).send(sub, { title: 'x' }) === 'gone');
  ok('a 404 means the device is gone', await mk(404).send(sub, { title: 'x' }) === 'gone');
  ok('a 500 is a failure to retry later', await mk(500).send(sub, { title: 'x' }) === 'failed');
  ok('no network is a failure, not a crash', await mk('throw').send(sub, { title: 'x' }) === 'failed');
  ok('long titles are cut', JSON.parse(decrypt(Buffer.from((await (async () => { let b; await new WebPush({ ...k, subject: 's' }, async (u, i) => { b = i.body; return { status: 201 }; }).send(sub, { title: 'T'.repeat(500) }); return b; })())), { ecdh: ua, auth })).title.length === 80);
  ok('with no keys set, push is off', pushFromEnv({}) === null && pushFromEnv({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey }) !== null);
}

console.log('\nTHE APP FILES');
{
  const png = iconPng(192);
  ok('an icon is a real PNG of the right size', png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 192 && png.readUInt32BE(20) === 192);
  const idat = png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 4);
  const raw = zlib.inflateSync(idat);
  ok('and decodes to the right amount of pixels', raw.length === 192 * (192 * 3 + 1));
  ok('the corner is the app colour, the middle of the H is white', raw[1] === 0x34 && raw[2] === 0x51 && raw[3] === 0xD1 && raw[(96) * (192 * 3 + 1) + 1 + 96 * 3] === 255);
  const m = manifest({ name: 'MOKNZ' });
  ok('the manifest starts the app at My details and has its four icons', m.start_url === '/me' && m.display === 'standalone' && m.icons.length === 4 && m.icons.some((i) => i.purpose === 'maskable'));
  ok('names are kept short for the home screen', manifest({ name: 'A very long federation name indeed' }).short_name.length <= 12);
  ok('the offline page is plain and safe', !/<script/i.test(offlinePage('X<script>')) && !offlinePage('X<script>').includes('X<script>'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
