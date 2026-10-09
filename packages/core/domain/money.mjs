/** The one place an amount in cents becomes words. */

/** "$12.50", in the currency given ("—" when there is no amount). */
export const money = (cents, currency = 'NZD') =>
  cents == null ? '—'
    : new Intl.NumberFormat('en-NZ', { style: 'currency', currency }).format(cents / 100);

/** "$12.00" — always two decimals, dollars only. For tables where amounts line up. */
export const dollars = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`;

/** "$12" or "$12.50": whole dollars without the noughts, for the public site. Other currencies are named. */
export const tidyMoney = (cents, currency = 'NZD') =>
  `$${(cents / 100) % 1 ? (cents / 100).toFixed(2) : String(cents / 100)}${currency === 'NZD' ? '' : ` ${currency}`}`;
