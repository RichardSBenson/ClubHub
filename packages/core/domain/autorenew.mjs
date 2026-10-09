/**
 * DOMAIN — automatic renewal
 *
 * A member (or a parent) lets the club charge their saved card or bank debit each time their membership is about to
 * run out, at the club's own price for their age. Nothing here touches a database or a provider.
 *
 *  - The card number never reaches us: the provider keeps it and gives back a token. We keep the token and the last four.
 *  - The charge is made CHARGE_LEAD_DAYS before fees run out, so a hiccup leaves time to fix it.
 *  - A failed charge is tried again after 3 days, then after 7; the third failure pauses auto-renew and the member is told.
 *  - Cancelling is one press and takes effect at once. Nobody is charged after that.
 */
export const CHARGE_LEAD_DAYS = 3;
export const RETRY_AFTER_DAYS = Object.freeze([3, 7]);
export const MAX_FAILURES = RETRY_AFTER_DAYS.length + 1;
export const METHODS = Object.freeze({ card: 'Credit or debit card', direct_debit: 'Bank direct debit' });
export const PERIOD_CHOICES = Object.freeze(['annual', 'term', 'monthly']);

export const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function problemsWithSetup({ method, period, agreed } = {}) {
  const out = [];
  if (!Object.hasOwn(METHODS, method)) out.push('Choose how to pay.');
  if (!PERIOD_CHOICES.includes(period)) out.push('Choose how often to renew.');
  if (!agreed) out.push('Please tick that you agree to the club charging you automatically.');
  return out;
}

/** What we keep of a card: never the number. */
export const cardLabel = (card) => { const d = String(card ?? '').replace(/\D/g, ''); return d.length >= 4 ? `Card ending ${d.slice(-4)}` : 'Card'; };

/** Is it time to charge? Active, not waiting on a retry date, and fees run out within the lead time (or already have). */
export function chargeDue({ status, nextAttemptOn, paidUntil, exempt = false }, today) {
  if (status !== 'active' || exempt) return false;
  if (nextAttemptOn && nextAttemptOn > today) return false;
  return !paidUntil || paidUntil <= addDays(today, CHARGE_LEAD_DAYS);
}

/** After a failed charge: how many failures now, whether it carries on, and when to try again. */
export function afterFailure(failures, today) {
  const n = failures + 1;
  if (n >= MAX_FAILURES) return { failures: n, status: 'paused', nextAttemptOn: null };
  return { failures: n, status: 'active', nextAttemptOn: addDays(today, RETRY_AFTER_DAYS[n - 1]) };
}
