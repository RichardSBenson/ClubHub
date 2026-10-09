/** The one place an amount in cents becomes words. */
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from './defaults.mjs';

/** "$12.50", in the currency and language given ("—" when there is no amount). */
export const money = (cents, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) =>
  cents == null ? '—'
    : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);

/** "$12.00": always two decimals. For tables where amounts line up. */
export const dollars = (cents, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format((cents ?? 0) / 100);

/** "$12" or "$12.50": whole amounts without the noughts, for the public site. */
export const tidyMoney = (cents, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: (cents / 100) % 1 ? 2 : 0 }).format(cents / 100);
