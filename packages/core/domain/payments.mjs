/**
 * DOMAIN — who gets paid
 *
 * The rule is about WHAT is being bought, never about who is buying or which
 * card they use. Written down once, here, so a screen cannot decide it
 * differently from another.
 *
 *   dojo fees           → the member's dojo
 *   kyu grading         → the member's dojo
 *   tournament entry    → whoever runs the tournament (usually a local dojo)
 *   black belt grading  → the federation (national)
 *   uniforms            → the member's dojo
 *   all other equipment → the member's dojo
 *
 * Money never moves "through" a level. A charge has exactly one payee and is
 * paid to that organisation's own account — see docs/payments.md.
 */

import { money } from './money.mjs';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from './defaults.mjs';

export const KINDS = Object.freeze({
  dojo_fee:         { label: 'Dojo fees',           payee: 'club' },
  tournament_entry: { label: 'Tournament entry',    payee: 'organiser' },
  kyu_grading:      { label: 'Kyu grading',         payee: 'club' },
  dan_grading:      { label: 'Black belt grading',  payee: 'federation' },
  uniform:          { label: 'Uniform',             payee: 'club' },
  equipment:        { label: 'Equipment',           payee: 'club' },
});

/** What a club administrator may ask a member for. A tournament entry is made by entering. */
export const ASKABLE = Object.freeze(
  Object.keys(KINDS).filter((k) => k !== 'tournament_entry'));

export const METHODS = Object.freeze({
  card:          { label: 'Credit or debit card',     settles: 'now' },
  bank:          { label: 'Internet banking',         settles: 'later' },
  direct_debit:  { label: 'Direct debit',             settles: 'later' },
});

export const STATUSES = Object.freeze({
  pending:   'To pay',
  awaiting:  'Waiting for the bank',
  succeeded: 'Paid',
  failed:    'Did not go through',
  refunded:  'Refunded',
  void:      'Cancelled',
});

/**
 * The organisation that receives the money.
 *
 *   clubId        the member's own club (where they train)
 *   organiserId   the organisation running the event, for an entry
 *   federationId  the top of the tree
 *
 * Throws rather than guessing: a charge with no clear payee is a charge that
 * must not be created, because "to the federation, by default" is how a club's
 * uniform money ends up somewhere it should not.
 */
export function payeeFor(kind, { clubId = null, organiserId = null, federationId = null } = {}) {
  const rule = KINDS[kind];
  if (!rule) throw new Error(`Unknown kind of charge "${kind}"`);
  const id = { club: clubId, organiser: organiserId, federation: federationId }[rule.payee];
  if (!id) {
    throw new Error({
      club: 'This person is not in a club, so there is nobody to pay.',
      organiser: 'This event has no organiser to pay.',
      federation: 'The federation could not be found.',
    }[rule.payee]);
  }
  return id;
}

/** One payment per payee: a basket with two payees is two payments. */
export function groupByPayee(lines) {
  const by = new Map();
  for (const l of lines) {
    if (!by.has(l.payeeId)) by.set(l.payeeId, []);
    by.get(l.payeeId).push(l);
  }
  return [...by.entries()].map(([payeeId, ls]) => ({
    payeeId, lines: ls, amountCents: ls.reduce((n, l) => n + l.amountCents, 0) }));
}

// ---------------------------------------------------------------------------

export const dollars = (cents, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) => money(cents ?? 0, currency, locale);

/** "12.50" or "12" → 1250. Null when it is not a sensible amount. */
export function centsFrom(text) {
  const t = String(text ?? '').replace(/[$,\s]/g, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  const n = Math.round(parseFloat(t) * 100);
  return n > 0 ? n : null;
}

export function readPaymentRequest(form = {}) {
  const t = (k, n) => String(form[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    received: ['cash', 'transfer'].includes(form.received) ? form.received : null,
    personNumber: t('personNumber', 30),
    kind: t('kind', 30),
    description: t('description', 140),
    amountCents: centsFrom(form.amount),
    amountText: t('amount', 12),
  };
}

export function problemsWithPaymentRequest(r) {
  const out = [];
  if (!r.personNumber) out.push('Enter the member number of the person to ask.');
  if (!ASKABLE.includes(r.kind)) out.push('Choose what the payment is for.');
  if (r.amountCents == null) out.push('Enter an amount, like 45 or 45.50.');
  if (r.amountCents != null && r.amountCents > 500_000) out.push('That amount is too large to take online.');
  return out;
}

export function readPayment(form = {}) {
  return {
    method: String(form.method ?? '').trim(),
    card: String(form.card ?? '').replace(/\D/g, '').slice(0, 19),
  };
}

export function problemsWithPayment({ method, card }) {
  const out = [];
  if (!METHODS[method]) out.push('Choose how you want to pay.');
  if (method === 'card' && card.length < 12) out.push('Enter the card number.');
  return out;
}
