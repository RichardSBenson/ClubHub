/**
 * A signed, short-lived token that says "this address proved it is theirs, for this event".
 *
 * Stateless: nothing is stored for an address that has not been registered.
 * Needs a secret; with none configured it refuses to issue one, so a forgotten
 * environment variable shuts the door rather than leaving it unlocked.
 */
import crypto from 'node:crypto';

const secret = () => process.env.ENTRY_SECRET ?? process.env.CRON_SECRET ?? null;
const sign = (body, key) => crypto.createHmac('sha256', key).update(body).digest('base64url');
export const TOKEN_MINUTES = 60;

export function signEntryToken({ email, eventId }, now = Date.now()) {
  const key = secret();
  if (!key) return null;
  const body = Buffer.from(JSON.stringify({ e: email, v: eventId, x: now + TOKEN_MINUTES * 60000 })).toString('base64url');
  return `${body}.${sign(body, key)}`;
}

export function readEntryToken(token, { eventId }, now = Date.now()) {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 600) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body, key)), got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (t.v !== eventId || !(t.x > now)) return null;
    return { email: String(t.e) };
  } catch { return null; }
}
