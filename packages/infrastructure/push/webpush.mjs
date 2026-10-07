/**
 * INFRASTRUCTURE — Web Push
 *
 * Sends a short notification to a browser or installed app through the browser maker's push service, using only
 * node:crypto. Two standards do the work:
 *
 *   RFC 8291  message encryption (aes128gcm): the push service carries the message but cannot read it.
 *   RFC 8292  VAPID: we sign a short token so the push service knows the message is from this site.
 *
 * Keys come from the environment — VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (both base64url) and VAPID_SUBJECT (a mailto:
 * address or https URL the push service can contact). `node tools/vapid-keys.mjs` makes a pair. With no keys set,
 * `pushFromEnv()` returns null and nothing is sent: push is simply off.
 */
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

export function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(pub.x), unb64u(pub.y)])), privateKey: priv.d };
}

const privateKeyObject = (publicKey, privateKey) => {
  const raw = unb64u(publicKey);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)), d: privateKey }, format: 'jwk' });
};

/** The Authorization header for one push service (RFC 8292). */
export function vapidHeaders({ endpoint, subject, publicKey, privateKey, now = Date.now(), ttlSeconds = 12 * 3600 }) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + ttlSeconds, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKeyObject(publicKey, privateKey), dsaEncoding: 'ieee-p1363' });
  return { authorization: `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}` };
}

/** Encrypt a message for one subscription (RFC 8291). `p256dh` and `auth` are the subscription's base64url keys. */
export function encrypt(plaintext, { p256dh, auth }, { salt = crypto.randomBytes(16), asKeys = null } = {}) {
  const ua = unb64u(p256dh), authSecret = unb64u(auth);
  const ecdh = asKeys ?? crypto.createECDH('prime256v1');
  if (!asKeys) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(ua);
  const ikm = hkdf(secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, data]);
}

/** The other end, for tests: what a browser does with what arrives. */
export function decrypt(body, { ecdh, auth }) {
  const salt = body.subarray(0, 16), idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
  const ua = ecdh.getPublicKey();
  const ikm = hkdf(ecdh.computeSecret(asPublic), unb64u(auth), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

export class WebPush {
  constructor({ publicKey, privateKey, subject }, fetchFn = fetch) {
    this.name = 'webpush'; this.publicKey = publicKey; this.privateKey = privateKey; this.subject = subject; this.fetch = fetchFn;
  }

  /**
   * One message to one subscription. Returns 'sent', 'gone' (the subscription is dead: forget it) or 'failed' (try later).
   * The message is kept small and plain: { title, body, url }.
   */
  async send(sub, message) {
    const payload = JSON.stringify({ title: String(message.title ?? '').slice(0, 80), body: String(message.body ?? '').slice(0, 200), url: message.url ?? '/' });
    let res;
    try {
      res = await this.fetch(sub.endpoint, { method: 'POST', body: encrypt(payload, sub), signal: AbortSignal.timeout(8000), headers: {
        ...vapidHeaders({ endpoint: sub.endpoint, subject: this.subject, publicKey: this.publicKey, privateKey: this.privateKey }),
        'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'normal' } });
    } catch { return 'failed'; }
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.status >= 200 && res.status < 300 ? 'sent' : 'failed';
  }
}

/** For tests: remembers what it was asked to send. */
export class TestPush {
  constructor() { this.name = 'test'; this.publicKey = generateVapidKeys().publicKey; this.sent = []; this.gone = new Set(); }
  async send(sub, message) { if (this.gone.has(sub.endpoint)) return 'gone'; this.sent.push({ endpoint: sub.endpoint, ...message }); return 'sent'; }
}

export function pushFromEnv(env = process.env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return new WebPush({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' });
}
