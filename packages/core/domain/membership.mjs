/**
 * DOMAIN — membership fees and renewal
 *
 * Every dojo sets its own prices. A price is a line in the dojo's own fee
 * schedule: what it is called, for whom, how often, how much. Nothing here
 * knows a price; it only chooses among the dojo's.
 *
 * "Paid until" on a person's membership is the date their fees run to. A
 * renewal moves it on from whichever is LATER — today, or where it already
 * runs to — so paying early does not throw away the days already paid for, and
 * paying late does not backdate cover to a time they were not a member.
 *
 * A member can be EXEMPT: the dojo has decided they do not pay (an instructor
 * who gives their time, a life member, hardship). The reason is recorded. They
 * still renew — their membership is carried forward — they are simply never
 * asked for money.
 */

export const PERIODS = Object.freeze({
  annual:  { label: 'Per year',  months: 12 },
  term:    { label: 'Per term',  months: 3 },
  monthly: { label: 'Per month', months: 1 },
  once:    { label: 'One-off (joining fee)', months: 0 },
});

export const CATEGORIES = Object.freeze({
  junior: 'Juniors (under 18)',
  adult:  'Adults',
  member: 'Everyone',
});

export const EXEMPT_REASONS = Object.freeze({
  instructor: 'Instructor — gives their time',
  life:       'Life member',
  hardship:   'Hardship',
  other:      'Other',
});

/** How a person who is not charged online has paid. */
export const MANUAL_METHODS = Object.freeze({
  cash:     'Cash',
  transfer: 'Bank transfer to the dojo',
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const real = (s) => DATE.test(s ?? '') && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Add whole months to a YYYY-MM-DD, clamping to the end of a short month. */
export function addMonths(day, months) {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Where fees run to after renewing for `months`. */
export function extendedUntil(paidUntil, today, months) {
  const from = paidUntil && real(paidUntil) && paidUntil > today ? paidUntil : today;
  return addMonths(from, months);
}

/**
 * Where a member stands, in words a registrar can act on.
 *   exempt   never asked
 *   overdue  fees ran out
 *   due      runs out within `soonDays`
 *   current  fine
 *   unpaid   no date at all — never paid
 */
export function standing({ paidUntil, exempt = false }, today, soonDays = 30) {
  if (exempt) return 'exempt';
  if (!paidUntil) return 'unpaid';
  if (paidUntil < today) return 'overdue';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + soonDays);
  return paidUntil <= soon.toISOString().slice(0, 10) ? 'due' : 'current';
}

export const STANDING_WORDS = Object.freeze({
  exempt: 'Not charged', overdue: 'Overdue', due: 'Due soon', current: 'Paid up', unpaid: 'Never paid',
});

/** Which of the dojo's prices applies to this person for this period. */
export function feeFor(schedules, { ageYears, period, today }) {
  const wanted = ageYears != null && ageYears < 18 ? 'junior' : 'adult';
  const live = schedules.filter((f) => f.period === period
    && f.effective_from <= today && (!f.effective_to || f.effective_to >= today));
  for (const category of [wanted, 'member']) {
    const hit = live.filter((f) => f.applies_to === category)
      .sort((a, b) => (b.effective_from > a.effective_from ? 1 : -1))[0];
    if (hit) return hit;
  }
  return null;
}

export function readFee(form = {}) {
  const t = (k, n) => String(form[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return { label: t('label', 80), appliesTo: t('appliesTo', 20), period: t('period', 20),
           amountText: t('amount', 12), effectiveFrom: t('effectiveFrom', 10) };
}

export function problemsWithFee(f, centsFrom) {
  const out = [];
  if (!f.label) out.push('Give the price a name, like “Adult annual”.');
  if (!CATEGORIES[f.appliesTo]) out.push('Choose who it is for.');
  if (!PERIODS[f.period]) out.push('Choose how often it is paid.');
  const cents = centsFrom(f.amountText);
  if (cents == null) out.push('Enter an amount, like 180 or 45.50.');
  else if (cents > 500_000) out.push('That amount is too large.');
  if (f.effectiveFrom && !real(f.effectiveFrom)) out.push('The start date should look like 2026-10-01.');
  return out;
}

export function readExemption(form = {}) {
  return { exempt: form.exempt === '1', reason: String(form.reason ?? '').trim() };
}

export function problemsWithExemption({ exempt, reason }) {
  return exempt && !EXEMPT_REASONS[reason] ? ['Choose why they are not charged.'] : [];
}
