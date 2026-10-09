/**
 * DOMAIN — API tokens and webhooks
 *
 * Lets a federation or club connect Honbu to other systems (an accounting package, a website, a spreadsheet) without
 * giving anybody a login. Nothing here touches a database or the network.
 *
 *  - An API token is read-only, belongs to one organisation, and sees that organisation and what is beneath it.
 *    It is shown once; only a fingerprint is kept.
 *  - A webhook is a web address we tell when something happens. Each message is signed so the receiver can check it
 *    came from us, and is retried a few times if the receiver is down.
 *  - We never call addresses inside our own network.
 */
export const SCOPES = Object.freeze({
  'organisations:read': 'The organisations (federation, regions, clubs)',
  'members:read': 'Members: names, numbers, grades, membership status',
  'events:read': 'Events and their entries',
});

export const EVENTS = Object.freeze({
  'member.created': 'A person is added to the roll',
  'payment.succeeded': 'A payment is made',
  'form.signed': 'A form is signed',
  'class.booked': 'A place in a class is booked',
  'ping': 'A test message',
});

export const MAX_TOKENS = 20;
export const MAX_WEBHOOKS = 10;
export const MAX_ATTEMPTS = 6;
/** Minutes to wait before attempt 2, 3, 4, 5, 6. */
export const RETRY_MINUTES = Object.freeze([1, 5, 30, 120, 720]);
export const DISABLE_AFTER_FAILED_DELIVERIES = 20;

export const retryAt = (attempts, now = new Date()) => attempts >= MAX_ATTEMPTS ? null : new Date(now.getTime() + RETRY_MINUTES[attempts - 1] * 60_000);

export function readScopes(form) {
  const wanted = [].concat(form.scopes ?? []);
  return Object.keys(SCOPES).filter((s) => wanted.includes(s));
}

export const problemsWithToken = ({ name, scopes }) => [
  ...(String(name ?? '').trim().length < 2 ? ['Give the token a name, so you know what it is for.'] : []),
  ...(String(name ?? '').length > 80 ? ['Keep the name under 80 characters.'] : []),
  ...(!scopes?.length ? ['Choose what it may read.'] : []),
];

/** True for an address that is not the public internet: loopback, private, link-local, unique-local, unspecified. */
export function isPrivateAddress(ip) {
  const s = String(ip).toLowerCase();
  if (s.includes(':')) {                     // IPv6
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('::ffff:')) return isPrivateAddress(s.slice(7));
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
  }
  const p = s.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Why this web address cannot be a webhook, or null. */
export function problemWithUrl(raw) {
  let u; try { u = new URL(String(raw ?? '').trim()); } catch { return 'Give a full web address, starting with https://.'; }
  if (u.protocol !== 'https:') return 'The address must start with https://.';
  if (u.username || u.password) return 'The address must not contain a password.';
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') && !host.includes(':')) return 'Give a full website address.';
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'That address is not on the public internet.';
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) { if (isPrivateAddress(host.replace(/^\[|\]$/g, ''))) return 'That address is not on the public internet.'; }
  if (String(raw).length > 500) return 'That address is too long.';
  return null;
}

export const problemsWithWebhook = ({ url, events }) => [
  ...(problemWithUrl(url) ? [problemWithUrl(url)] : []),
  ...(!events?.length ? ['Choose at least one thing to be told about.'] : []),
];

export const readEvents = (form) => Object.keys(EVENTS).filter((e) => e !== 'ping' && [].concat(form.events ?? []).includes(e));

/** Which of these webhooks want this event. An endpoint on an organisation hears about everything beneath it. */
export const wants = (endpoint, event) => endpoint.active && !endpoint.disabled_at && endpoint.events.includes(event);

export const pageSize = (raw, max = 200, dflt = 50) => { const n = parseInt(raw, 10); return Number.isInteger(n) && n > 0 ? Math.min(n, max) : dflt; };
