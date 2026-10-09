/**
 * DOMAIN — the shop
 *
 * Gear a member orders from their own dojo: gi, gloves, shin pads, tournament tee shirts. A product belongs to one
 * organisation. The federation's products are the national range, which every dojo beneath it can offer; a dojo's own
 * products are shown to that dojo's members and nobody else. A dojo can hide a national item or set its own price.
 *
 * The price on an order is always the price the SERVER works out. Nothing a browser sends can set one.
 *
 * Nothing here touches a database.
 */

export const CATEGORIES = {
  gi:             'Gi',
  gloves:         'Gloves',
  shin_pads:      'Shin pads',
  tournament_tee: 'Tournament tee shirt',
  other:          'Other',
};

export const ORDER_STATUSES = {
  placed:    'Ordered',
  paid:      'Paid',
  ready:     'Ready to collect',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

/** What a dojo may move an order to from where it is now. */
const NEXT = {
  placed: ['paid', 'ready', 'cancelled'],
  paid: ['ready', 'collected', 'cancelled'],
  ready: ['collected', 'paid', 'cancelled'],
  collected: [],
  cancelled: [],
};
export const mayMoveOrder = (from, to) => (NEXT[from] ?? []).includes(to);

export const MAX_QUANTITY = 20;
export const MAX_PRICE_CENTS = 1000000;

/** Dollars from a form field ("89", "89.5", "$89.50") to whole cents; blank is `null`. */
export function readMoney(raw) {
  const t = String(raw ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (t === '') return { value: null };
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return { problem: 'A price is dollars and cents, like 89 or 89.50.' };
  const cents = Math.round(parseFloat(t) * 100);
  if (cents > MAX_PRICE_CENTS) return { problem: 'That price is too high.' };
  return { value: cents };
}

/** "S, M, L" or "110 120 130" to a clean list; at most 30, each short, no repeats. */
export function readSizes(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw ?? '').split(/[,\n;]+|\s{2,}/)) {
    const s = part.replace(/\s+/g, ' ').trim().slice(0, 12);
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return out.slice(0, 30);
}

/** A product from the add/edit form. */
export function readProduct(f) {
  const name = String(f.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { problem: 'Give the item a name.' };
  if (name.length > 100) return { problem: 'The name is too long.' };
  const category = Object.hasOwn(CATEGORIES, f.category) ? f.category : null;
  if (!category) return { problem: 'Choose what kind of item it is.' };
  const price = readMoney(f.price);
  if (price.problem) return { problem: price.problem };
  if (price.value === null) return { problem: 'Give the item a price.' };
  const description = String(f.description ?? '').trim().slice(0, 500) || null;
  return { value: { name, category, price_cents: price.value, description, sizes: readSizes(f.sizes) } };
}

/** What a dojo's own say over a national item comes to: a price (or blank for the national price) and shown or hidden. */
export function readListing(f) {
  const price = readMoney(f.price);
  if (price.problem) return { problem: price.problem };
  return { value: { hidden: f.hidden === 'on' || f.hidden === 'yes' || f.hidden === '1', price_cents: price.value } };
}

/** The price a member pays at a dojo: the dojo's own price for the item if it set one, otherwise the item's. */
export const priceAt = (product, listing) => listing?.price_cents ?? product.price_cents;

import { money } from './money.mjs';
export { money };

/**
 * The basket from the shop form: fields `qty_<productId>` and `size_<productId>`. `visible` is the range this member is
 * allowed to see; anything outside it is refused, whatever the form says. Returns the lines with SERVER prices.
 */
export function readBasket(form, visible) {
  const lines = [];
  for (const p of visible) {
    const raw = String(form[`qty_${p.id}`] ?? '').trim();
    if (raw === '' || raw === '0') continue;
    if (!/^\d{1,2}$/.test(raw) || +raw < 1 || +raw > MAX_QUANTITY)
      return { problem: `Quantity for ${p.name} must be a whole number from 1 to ${MAX_QUANTITY}.` };
    const size = String(form[`size_${p.id}`] ?? '').trim();
    if (p.sizes?.length) {
      if (!p.sizes.includes(size)) return { problem: `Choose a size for ${p.name}.` };
    }
    lines.push({ product_id: p.id, name: p.name, size: p.sizes?.length ? size : null, quantity: +raw, unit_cents: p.price_cents });
  }
  if (!lines.length) return { problem: 'Choose at least one item.' };
  return { value: lines, total_cents: orderTotal(lines) };
}

export const orderTotal = (lines) => lines.reduce((n, l) => n + l.unit_cents * l.quantity, 0);

/** An order note: short, plain text. */
export const readNote = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
