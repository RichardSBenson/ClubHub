/**
 * DOMAIN — sales tax (GST, VAT, sales tax) on what members pay
 *
 * Prices are entered as the member pays them, tax included, which is how GST and VAT countries show prices. This
 * works out how much of an amount is tax so a receipt and the accounts can say so. An organisation that charges no
 * tax has a rate of nothing and every function here returns nothing for it.
 */
export const TAX_PERCENT_MAX = 30;

/** The tax inside an amount that already includes it, in cents. */
export const taxInside = (cents, percent) =>
  !percent || !cents ? 0 : Math.round((cents * percent) / (100 + percent));

/** "includes GST of $1.30" — or '' when there is no tax to speak of. `format` turns cents into money words. */
export const taxLine = (cents, { taxName, taxPercent }, format) => {
  const tax = taxInside(cents, taxPercent);
  return tax > 0 && taxName ? `includes ${taxName} of ${format(tax)}` : '';
};

/** What may be saved for the tax part of the country settings. Reasons (text); empty means fine. */
export function problemsWithTax({ taxName = '', taxPercent = 0, taxNumber = '' } = {}) {
  const out = [];
  if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > TAX_PERCENT_MAX)
    out.push(`The tax rate is a percentage from 0 to ${TAX_PERCENT_MAX}.`);
  else if (taxPercent > 0 && !String(taxName).trim()) out.push('Give the tax a name, such as GST or VAT.');
  if (String(taxName).length > 20) out.push('The tax name is too long.');
  if (String(taxNumber).length > 30) out.push('The tax number is too long.');
  return out;
}
