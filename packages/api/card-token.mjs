/**
 * Two signed tokens that go into QR codes.
 *
 * The CARD token is the wallet package's door token — member number, rank, expiry, federation —
 * so the same signature is checked whether it came from a wallet pass or from a card on screen.
 * On screen it is good for a week: long enough to open the card with no signal at the door,
 * short enough that a screenshot passed round the playground stops working.
 *
 * The CHECK-IN token says "this class, on this day", and lives five minutes. The screen that
 * shows it refreshes itself every minute, so a photo of it taken at home is dead by the time
 * anyone gets there.
 *
 * Both need a secret; with none configured they refuse to issue, so a forgotten environment
 * variable shuts the door rather than leaving it open.
 */
import crypto from 'node:crypto';
import { signToken, verifyToken } from '../wallet/index.mjs';

const secret = () => process.env.CARD_SECRET ?? process.env.ENTRY_SECRET ?? process.env.CRON_SECRET ?? null;

export const CARD_DAYS = 7;
export const CHECKIN_MINUTES = 5;
export const CHECKIN_REFRESH_SECONDS = 60;

export function signCard({ memberNumber, rankOrder, expires, orgSlug }) {
  const key = secret();
  return key ? signToken({ memberNumber, rankOrder, expires, orgSlug }, key) : null;
}

export function readCard(token, now = new Date()) {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 300) return { valid: false, reason: 'Not a card' };
  return verifyToken(token, key, now);
}

const mac = (body, key) => crypto.createHmac('sha256', key).update(`checkin:${body}`).digest('base64url');

export function signCheckin({ sessionId, date }, now = Date.now()) {
  const key = secret();
  if (!key) return null;
  const body = Buffer.from(JSON.stringify({ s: sessionId, d: date, x: now + CHECKIN_MINUTES * 60000 })).toString('base64url');
  return `${body}.${mac(body, key)}`;
}

export function readCheckin(token, now = Date.now()) {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 400) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body, key)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!(t.x > now)) return { expired: true };
    return { sessionId: String(t.s), date: String(t.d) };
  } catch { return null; }
}
