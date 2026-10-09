/**
 * DOMAIN — adult free trials and referrals
 *
 * Decisions only. What a club offers is its own: how long a trial lasts, what a referral earns,
 * what has to happen before the reward is paid. Nothing here names a price.
 */
import { addDays } from './attendance.mjs';
import { phoneKey } from './outsider.mjs';
import { isRealDate } from './people.mjs';

import { ADULT_AGE } from './defaults.mjs';

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;
const oneLine = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const int = (v, lo, hi, dflt) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

// ---- what a club has chosen ----------------------------------------------------------------------

export const REWARD_KINDS = Object.freeze({
  none: 'No reward',
  free_weeks: 'Free weeks',
  credit: 'Account credit',
  event_credit: 'Event credit',
  grading_credit: 'Grading credit',
  merchandise: 'Merchandise',
  custom: 'Something else',
});
/** Only free weeks can be given by the system. Anything else is owed until a person hands it over. */
export const AUTOMATIC = Object.freeze(['free_weeks']);
const MONEY = ['credit', 'event_credit', 'grading_credit'];

export const DEFAULTS = Object.freeze({
  trial: { enabled: false, days: 30, minAge: ADULT_AGE },
  referral: { enabled: false, minClasses: 3, maxPerYear: 5,
    referrer: { kind: 'free_weeks', weeks: 4, cents: 0, note: '' },
    referred: { kind: 'none', weeks: 0, cents: 0, note: '' } },
});

const readReward = (r = {}, dflt) => {
  const kind = Object.hasOwn(REWARD_KINDS, r.kind) ? r.kind : dflt.kind;
  return { kind,
    weeks: kind === 'free_weeks' ? int(r.weeks, 1, 52, dflt.weeks || 4) : 0,
    cents: MONEY.includes(kind) ? int(r.cents, 0, 1_000_000, 0) : 0,
    note: ['merchandise', 'custom'].includes(kind) ? oneLine(r.note, 120) : '' };
};

/** Whatever is stored, as a complete and sane setting. */
export function readGrowth(raw = {}) {
  const t = raw?.trial ?? {}, r = raw?.referral ?? {};
  return {
    trial: { enabled: t.enabled === true, days: int(t.days, 1, 90, DEFAULTS.trial.days), minAge: int(t.minAge, 10, 99, DEFAULTS.trial.minAge) },
    referral: { enabled: r.enabled === true, minClasses: int(r.minClasses, 0, 50, DEFAULTS.referral.minClasses),
      maxPerYear: int(r.maxPerYear, 1, 100, DEFAULTS.referral.maxPerYear),
      referrer: readReward(r.referrer, DEFAULTS.referral.referrer), referred: readReward(r.referred, DEFAULTS.referral.referred) },
  };
}

/** The settings form, read the same way. Money is typed in dollars. */
export function readGrowthForm(f = {}) {
  const dollars = (v) => Math.round(Number.parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')) * 100) || 0;
  const reward = (p) => ({ kind: f[`${p}_kind`], weeks: f[`${p}_weeks`], cents: dollars(f[`${p}_amount`]), note: f[`${p}_note`] });
  return readGrowth({
    trial: { enabled: f.trial_enabled === '1', days: f.trial_days, minAge: f.trial_min_age },
    referral: { enabled: f.referral_enabled === '1', minClasses: f.min_classes, maxPerYear: f.max_per_year,
      referrer: reward('referrer'), referred: reward('referred') },
  });
}

export function problemsWithGrowth(g) {
  const out = [];
  if (g.referral.enabled && !g.trial.enabled) out.push('Referrals bring people in through the free trial, so turn the trial on too.');
  for (const [who, r] of [['referring member', g.referral.referrer], ['new member', g.referral.referred]]) {
    if (r.kind === 'credit' || r.kind === 'event_credit' || r.kind === 'grading_credit')
      if (!r.cents) out.push(`Say how much the ${who} is credited.`);
    if ((r.kind === 'merchandise' || r.kind === 'custom') && !r.note) out.push(`Say what the ${who} receives.`);
  }
  return out;
}

export function rewardText(r) {
  if (!r || r.kind === 'none') return '';
  if (r.kind === 'free_weeks') return `${r.weeks} free week${r.weeks === 1 ? '' : 's'}`;
  if (MONEY.includes(r.kind)) return `$${(r.cents / 100).toFixed(2).replace(/\.00$/, '')} ${REWARD_KINDS[r.kind].toLowerCase()}`;
  return r.note || REWARD_KINDS[r.kind];
}

// ---- the trial -----------------------------------------------------------------------------------

export const trialEnds = (start, days) => addDays(start, days);
export const daysLeft = (ends, today) => Math.round((Date.parse(`${ends}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);

export function ageOn(dob, date) {
  const [y, m, d] = String(dob).split('-').map(Number), [cy, cm, cd] = String(date).split('-').map(Number);
  return cy - y - ((cm < m || (cm === m && cd < d)) ? 1 : 0);
}

export function readTrialSignup(f = {}) {
  return { firstName: oneLine(f.firstName, 60), lastName: oneLine(f.lastName, 60), email: oneLine(f.email, 120).toLowerCase(),
    phone: oneLine(f.phone, 30), dateOfBirth: oneLine(f.dateOfBirth, 10), emergencyName: oneLine(f.emergencyName, 80),
    emergencyPhone: oneLine(f.emergencyPhone, 30), medical: String(f.medical ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000),
    accepted: f.accepted === '1', code: normaliseCode(f.code) };
}

export function problemsWithTrialSignup(i, { today, minAge = ADULT_AGE }) {
  const out = [];
  if (!i.firstName) out.push('Please give your first name.');
  if (!i.lastName) out.push('Please give your last name.');
  if (!EMAIL.test(i.email ?? '')) out.push('That email address does not look right.');
  if (!phoneKey(i.phone)) out.push('Please give a mobile number we can reach you on.');
  if (!i.dateOfBirth || !isRealDate(i.dateOfBirth) || i.dateOfBirth > today || i.dateOfBirth < '1900-01-01')
    out.push('Please give your date of birth as YYYY-MM-DD.');
  else if (ageOn(i.dateOfBirth, today) < minAge)
    out.push(`The free trial is for people aged ${minAge} and over. For a younger person, ask the club about trying a class.`);
  if (!i.emergencyName || !phoneKey(i.emergencyPhone)) out.push('Please give an emergency contact: a name and a phone number.');
  if (!i.accepted) out.push('Please tick that you have read and accept the waiver.');
  return out;
}

/**
 * Which trials are owed an email today. `rows` [{ id, ends, status, sent7, sent2 }].
 * A trial that has run out is ended once; one reminded is not reminded again.
 */
export function trialsDue(rows, today) {
  const out = { week: [], lastDays: [], ended: [] };
  for (const r of rows) {
    if (r.status !== 'trialling') continue;
    const left = daysLeft(r.ends, today);
    if (left < 0) out.ended.push(r);
    else if (left <= 2 && !r.sent2) out.lastDays.push(r);
    else if (left <= 7 && left > 2 && !r.sent7) out.week.push(r);
  }
  return out;
}

// ---- referrals -----------------------------------------------------------------------------------

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';        // no 0/O, 1/I/L
export const CODE_LENGTH = 6;
export function newCode(random = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return s;
}
export const normaliseCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/**
 * May this signup count as a referral? A signup that fails is still a trial — it just earns nobody a reward.
 * `referrer` { active, email, phone }, `recent` how many this referrer brought in the last day.
 */
export function referralVerdict({ referrer, referred, recent = 0, settings }) {
  if (!settings.referral.enabled) return { ok: false, reason: 'Referrals are not switched on' };
  if (!referrer?.active) return { ok: false, reason: 'The referring person is not a current member' };
  if (referrer.email && referred.email && referrer.email.toLowerCase() === referred.email.toLowerCase())
    return { ok: false, reason: 'Same email address as the referrer' };
  const a = phoneKey(referrer.phone), b = phoneKey(referred.phone);
  if (a && b && a === b) return { ok: false, reason: 'Same phone number as the referrer' };
  if (recent >= 5) return { ok: false, reason: 'The referrer has brought in a lot of people today' };
  return { ok: true, reason: null };
}

/** Has the referred person done what the club asked before the reward is paid? */
export function referralQualifies({ trialClasses, referrerActive, rewardsThisYear, settings }) {
  const r = settings.referral;
  if (!r.enabled) return { ok: false, reason: 'Referrals are not switched on' };
  if (!referrerActive) return { ok: false, reason: 'The referring person is no longer a current member' };
  if (trialClasses < r.minClasses)
    return { ok: false, wait: true, reason: `They have been to ${trialClasses} of the ${r.minClasses} classes the club asks for` };
  if (rewardsThisYear >= r.maxPerYear) return { ok: false, reason: `The referrer has reached the limit of ${r.maxPerYear} rewards in a year` };
  return { ok: true, reason: null };
}

/** The rewards a qualifying referral earns. Nothing for a side that is set to none. */
export function rewardsFor(settings) {
  const out = [];
  const r = settings.referral;
  if (r.referrer.kind !== 'none') out.push({ to: 'referrer', ...r.referrer });
  if (r.referred.kind !== 'none') out.push({ to: 'referred', ...r.referred });
  return out;
}
