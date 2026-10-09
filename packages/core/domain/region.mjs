/**
 * DOMAIN — a country's assumptions
 *
 * Currency, language and the age at which somebody stops needing a parent are properties of where an organisation
 * is, not of the software. A federation sets them once and every club beneath it inherits them (a club may differ).
 * Anything not set falls back to the platform defaults in defaults.mjs.
 */
import { DEFAULT_CURRENCY, DEFAULT_LOCALE, ADULT_AGE } from './defaults.mjs';
import { problemsWithTax } from './tax.mjs';

export const ADULT_AGE_RANGE = Object.freeze([16, 21]);

/** What an organisation has said, completed with the platform defaults. */
export function resolveRegion(stored = {}) {
  const s = stored ?? {};
  return Object.freeze({
    currency: s.currency || DEFAULT_CURRENCY,
    locale: s.locale || DEFAULT_LOCALE,
    adultAge: Number.isInteger(s.adultAge) ? s.adultAge : ADULT_AGE,
    taxName: String(s.taxName ?? ''),
    taxPercent: Number(s.taxPercent) > 0 ? Number(s.taxPercent) : 0,
    taxNumber: String(s.taxNumber ?? ''),
  });
}

/** What may be saved. Returns reasons (text); an empty list means fine. */
export function problemsWithRegion({ currency, locale, adultAge, taxName, taxPercent, taxNumber } = {}) {
  const out = problemsWithTax({ taxName, taxPercent, taxNumber });
  if (!/^[A-Z]{3}$/.test(String(currency ?? ''))) out.push('Currency is a three-letter code, like NZD, AUD, USD or GBP.');
  else {
    try { new Intl.NumberFormat('en', { style: 'currency', currency }); } // arch-ok: validating a code, not formatting
    catch { out.push(`"${currency}" is not a currency code.`); }
  }
  try {
    if (!locale || Intl.getCanonicalLocales(String(locale)).length !== 1) throw new Error();
  } catch { out.push('Language is a code like en-NZ, en-AU, en-US, en-GB, fr-CA or ja.'); }
  const [lo, hi] = ADULT_AGE_RANGE;
  if (!Number.isInteger(adultAge) || adultAge < lo || adultAge > hi)
    out.push(`The age of adulthood is a whole number from ${lo} to ${hi}.`);
  return out;
}

/** The form's fields, read the same way wherever they come from. */
export const readRegionForm = (f = {}) => ({
  currency: String(f.currency ?? '').trim().toUpperCase(),
  locale: String(f.locale ?? '').trim(),
  adultAge: Number.parseInt(String(f.adultAge ?? '').trim(), 10),
  taxName: String(f.taxName ?? '').trim(),
  taxPercent: Number(String(f.taxPercent ?? '').trim() || 0),
  taxNumber: String(f.taxNumber ?? '').trim(),
});
