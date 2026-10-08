/**
 * HONBU — THE VAULT
 *
 * Health notes and uploaded documents are encrypted before they reach the database, so a copy of the database
 * or of a backup is not a copy of anybody's medical history. AES-256-GCM: every value has its own random
 * nonce, and a value that has been altered refuses to open rather than opening as nonsense.
 *
 * The key is HONBU_DATA_KEY: 32 random bytes, base64. It lives in the host's environment, never in the database
 * and never in the code. LOSE IT AND THE SEALED DATA IS GONE: keep a copy somewhere safe.
 *
 * Sealed text looks like  enc:v1:<base64 of nonce + tag + ciphertext>.  Sealed bytes begin HNB1.
 * Anything that does not begin that way is old, unsealed data, and is read as it is, so sealing can be
 * switched on without a flag day (tools/seal-existing.mjs then seals what is already there).
 *
 * Without a key, development and tests store plain text. A real deployment (VERCEL or NODE_ENV=production)
 * refuses to store sensitive data at all without one: a missing key must be a loud failure, not a quiet one.
 */
import crypto from 'node:crypto';

const TEXT_PREFIX = 'enc:v1:';
const BYTES_MAGIC = Buffer.from('HNB1');

export class VaultError extends Error {}

function key() {
  const raw = process.env.HONBU_DATA_KEY;
  if (!raw) {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production')
      throw new VaultError('HONBU_DATA_KEY is not set, so sensitive details cannot be stored safely.');
    return null;
  }
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new VaultError('HONBU_DATA_KEY must be 32 random bytes, base64 encoded.');
  return k;
}

function lock(plain, k) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, nonce);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([nonce, c.getAuthTag(), body]);
}

function unlock(blob, k) {
  const d = crypto.createDecipheriv('aes-256-gcm', k, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

/** Text in, sealed text out. Empty stays empty. */
export function seal(text) {
  if (text == null || text === '') return text;
  const s = String(text);
  if (s.startsWith(TEXT_PREFIX)) return s;
  const k = key();
  return k ? TEXT_PREFIX + lock(Buffer.from(s, 'utf8'), k).toString('base64') : s;
}

/** Sealed text in, plain text out. Old unsealed text passes through. */
export function open(value) {
  if (value == null || typeof value !== 'string' || !value.startsWith(TEXT_PREFIX)) return value;
  const k = key();
  if (!k) throw new VaultError('This detail is sealed and HONBU_DATA_KEY is not set.');
  try { return unlock(Buffer.from(value.slice(TEXT_PREFIX.length), 'base64'), k).toString('utf8'); }
  catch { throw new VaultError('This detail could not be opened: the key is wrong or the data was altered.'); }
}

export const isSealed = (value) => typeof value === 'string' && value.startsWith(TEXT_PREFIX);

export function sealBytes(bytes) {
  const k = key();
  return k && !isSealedBytes(bytes) ? Buffer.concat([BYTES_MAGIC, lock(Buffer.from(bytes), k)]) : Buffer.from(bytes);
}

export function openBytes(bytes) {
  const b = Buffer.from(bytes);
  if (!isSealedBytes(b)) return b;
  const k = key();
  if (!k) throw new VaultError('This file is sealed and HONBU_DATA_KEY is not set.');
  try { return unlock(b.subarray(4), k); }
  catch { throw new VaultError('This file could not be opened: the key is wrong or the data was altered.'); }
}

export const isSealedBytes = (b) => !!b && b.length > 32 && Buffer.from(b.subarray(0, 4)).equals(BYTES_MAGIC);
