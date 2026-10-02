/**
 * DOMAIN — qualifications and compliance
 *
 * A grade is permanent; a first aid certificate, a police vet and child
 * protection training are not. A federation's real question is "who may not
 * instruct right now?", and this answers it from dates rather than memory.
 *
 * What is recorded is the FACT of a qualification — what, when it was issued,
 * when it lapses, by whom, a reference — never the content of a check. A
 * police vet is recorded as "completed, valid until"; what it found is not
 * something this system holds.
 */
import { isDate, addDays } from './attendance.mjs';

export const CATEGORIES = Object.freeze({
  instructing: 'Instructing', officiating: 'Officiating', safety: 'Safety',
  safeguarding: 'Safeguarding', medical: 'Medical', other: 'Other',
});
/** What a qualification may be required for. */
export const REQUIRED_FOR = Object.freeze({
  instruct: 'Teaching a class', judge: 'Judging or refereeing', panel: 'Sitting on a grading panel',
});
export const EXPIRING_DAYS = 60;
export const EXPIRED_REMIND_DAYS = 90;

/** Offered as one-click starters. The periods are placeholders for a federation to confirm. */
export const STARTERS = Object.freeze([
  { code: 'first-aid', label: 'First aid', category: 'medical', validMonths: 36, requiredFor: ['instruct'] },
  { code: 'police-vet', label: 'Police vetting', category: 'safeguarding', validMonths: 36, requiredFor: ['instruct'] },
  { code: 'child-protection', label: 'Child protection training', category: 'safeguarding', validMonths: 36, requiredFor: ['instruct'] },
  { code: 'instructor-cert', label: 'Instructor certificate', category: 'instructing', validMonths: null, requiredFor: [] },
  { code: 'referee', label: 'Referee / judge licence', category: 'officiating', validMonths: 24, requiredFor: ['judge'] },
]);

export const slugOf = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function readQualification(form = {}) {
  const t = (k, n) => String(form[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const requiredFor = Object.keys(REQUIRED_FOR).filter((k) => form[`for_${k}`] === '1');
  return { label: t('label', 80), code: slugOf(t('code', 40) || t('label', 80)),
    category: t('category', 20) || 'other', validMonths: t('validMonths', 4), requiredFor };
}

export function problemsWithQualification(q) {
  const out = [];
  if (!q.label) out.push('A name is needed, like "First aid".');
  if (!q.code) out.push('A name with letters or numbers is needed.');
  if (!CATEGORIES[q.category]) out.push('Choose a category.');
  if (q.validMonths !== '' && q.validMonths != null) {
    const n = Number(q.validMonths);
    if (!Number.isInteger(n) || n < 1 || n > 240) out.push('How long it is valid for should be 1 to 240 months, or blank if it never expires.');
  }
  return out;
}

export function readAward(form = {}) {
  const t = (k, n) => String(form[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return { qualificationId: t('qualificationId', 40), awardedOn: t('awardedOn', 10), expiresOn: t('expiresOn', 10),
    issuedBy: t('issuedBy', 100), reference: t('reference', 100) };
}

export function problemsWithAward(a, today) {
  const out = [];
  if (!a.qualificationId) out.push('Choose the qualification.');
  if (!isDate(a.awardedOn)) out.push('The date it was issued should look like 2026-03-14.');
  else if (a.awardedOn > today) out.push('It cannot have been issued in the future.');
  else if (a.awardedOn < '1950-01-01') out.push('That issue date is too long ago to be right.');
  if (a.expiresOn) {
    if (!isDate(a.expiresOn)) out.push('The expiry date should look like 2029-03-14.');
    else if (isDate(a.awardedOn) && a.expiresOn < a.awardedOn) out.push('It cannot expire before it was issued.');
  }
  return out;
}

/** permanent · current · expiring · expired, by the club's own today. */
export function statusOf(expiresOn, today) {
  if (!expiresOn) return 'permanent';
  if (expiresOn < today) return 'expired';
  return expiresOn < addDays(today, EXPIRING_DAYS) ? 'expiring' : 'current';
}
export const daysLeft = (expiresOn, today) =>
  expiresOn ? Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5) : null;

/** Of several awards of the same qualification, the one that counts: never-expires, else the latest expiry. */
export function latestPerQualification(awards) {
  const best = new Map();
  for (const a of awards) {
    const k = `${a.person_id ?? ''}|${a.qualification_id}`;
    const cur = best.get(k);
    const rank = (x) => (x.expires_on ? x.expires_on : '9999-99-99');
    if (!cur || rank(a) > rank(cur) || (rank(a) === rank(cur) && a.awarded_on > cur.awarded_on)) best.set(k, a);
  }
  return [...best.values()];
}

/**
 * Is this person clear to do what the required qualifications gate?
 * `required`: [{ id, label }]; `awards`: that person's awards.
 * Returns each requirement's state: current / expiring / permanent are all
 * fine (expiring is a warning, not a bar); expired and missing are bars.
 */
export function clearance(required, awards, today) {
  const mine = latestPerQualification(awards);
  const items = required.map((r) => {
    const a = mine.find((x) => x.qualification_id === r.id);
    if (!a) return { id: r.id, label: r.label, state: 'missing', expires_on: null };
    return { id: r.id, label: r.label, state: statusOf(a.expires_on, today), expires_on: a.expires_on ?? null,
      days_left: daysLeft(a.expires_on, today) };
  });
  const barred = items.filter((i) => ['expired', 'missing'].includes(i.state));
  return { cleared: barred.length === 0, items, barred, warnings: items.filter((i) => i.state === 'expiring') };
}

/**
 * Which reminders should go out now. `already` is a Set of "awardId|stage".
 * One at the start of the expiring window, one when it lapses (only if it
 * lapsed recently — nobody is told about a certificate that ran out years ago).
 */
export function remindersDue(latest, today, already = new Set()) {
  const out = [];
  for (const a of latest) {
    if (!a.expires_on) continue;
    const s = statusOf(a.expires_on, today);
    const ago = -daysLeft(a.expires_on, today);
    if (s === 'expiring' && !already.has(`${a.id}|expiring`)) out.push({ awardId: a.id, stage: 'expiring' });
    if (s === 'expired' && ago <= EXPIRED_REMIND_DAYS && !already.has(`${a.id}|expired`)) out.push({ awardId: a.id, stage: 'expired' });
  }
  return out;
}

export const STATE_WORDS = Object.freeze({
  permanent: 'Does not expire', current: 'Current', expiring: 'Expiring soon', expired: 'Expired', missing: 'Not recorded',
});

export function reminderText(stage, { label, expiresOn }) {
  return stage === 'expiring'
    ? { subject: `Your ${label} runs out on ${expiresOn}`,
        body: `Kia ora,\n\nYour ${label} is valid until ${expiresOn}. Please renew it and send the new certificate details to {club} so your record stays up to date.\n\nThank you,\n{club}` }
    : { subject: `Your ${label} has run out`,
        body: `Kia ora,\n\nYour ${label} ran out on ${expiresOn}. Until it is renewed and recorded you may not be able to take classes or sit on gradings. Please send the new certificate details to {club}.\n\nThank you,\n{club}` };
}
