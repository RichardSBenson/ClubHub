/**
 * DOMAIN — forms and consent
 *
 * A dojo or federation builds its own forms (a waiver, a photo consent, a medical form) out of a few plain question types,
 * and people fill them in once, or again every so many months. Nothing here touches a database.
 *
 * Rules that matter:
 *  - Changing the wording of a published form does not make anybody sign again by itself: a typo is a typo. Asking everybody
 *    to sign again is a deliberate act (it raises the form's version), and an answer counts only for the version it was given on.
 *  - Anyone under 18 has a parent or guardian answer for them.
 *  - Answers are checked against the form as it stood: a choice must be one of the choices, a required question must be answered.
 */

import { ADULT_AGE } from './defaults.mjs';

export const FIELD_TYPES = Object.freeze({
  agree:      'A statement to agree to (a tick)',
  text:       'Short answer',
  longtext:   'Long answer',
  choice:     'Pick one',
  checkboxes: 'Pick any',
  date:       'Date',
});
export const KINDS = Object.freeze({ waiver: 'Waiver', consent: 'Consent', medical: 'Medical', other: 'Other' });
export const AUDIENCES = Object.freeze({ all: 'Everyone on the roll', juniors: 'Juniors', seniors: 'Adults' });
export const MAX_FIELDS = 40;
export const MAX_OPTIONS = 20;

const str = (v, n) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);

/** One question, cleaned. Returns the field or null when it has no usable wording. */
export function cleanField(raw = {}, idFor = () => Math.random().toString(36).slice(2, 8)) {
  const type = Object.hasOwn(FIELD_TYPES, raw.type) ? raw.type : 'text';
  const label = str(raw.label, type === 'agree' ? 1000 : 200);
  if (!label) return null;
  const options = ['choice', 'checkboxes'].includes(type)
    ? [...new Set(String(Array.isArray(raw.options) ? raw.options.join('\n') : raw.options ?? '').split('\n').map((o) => str(o, 120)).filter(Boolean))].slice(0, MAX_OPTIONS)
    : [];
  // A statement to agree to is always required: a tick nobody has to give means nothing.
  const required = type === 'agree' || raw.required === true || raw.required === 'on';
  return { id: str(raw.id, 20) || idFor(), type, label, required, options, help: str(raw.help, 300) || undefined };}

export function problemsWithForm(f = {}) {
  const out = [];
  if (!str(f.title, 120)) out.push('Give the form a name.');
  if (!Object.hasOwn(KINDS, f.kind ?? 'other')) out.push('Choose what kind of form it is.');
  if (!Object.hasOwn(AUDIENCES, f.audience ?? 'all')) out.push('Choose who it is for.');
  if (f.renewMonths != null && !(Number.isInteger(f.renewMonths) && f.renewMonths >= 1 && f.renewMonths <= 60)) out.push('"Ask again after" must be between 1 and 60 months.');
  const fields = f.fields ?? [];
  if (fields.length > MAX_FIELDS) out.push(`A form can have up to ${MAX_FIELDS} questions.`);
  const seen = new Set();
  for (const q of fields) {
    if (seen.has(q.id)) out.push('Two questions share an id.');
    seen.add(q.id);
    if (['choice', 'checkboxes'].includes(q.type) && q.options.length < 2) out.push(`"${q.label}" needs at least two choices.`);
  }
  return out;
}

/** A form can be published only when somebody could actually answer it. */
export const problemsWithPublishing = (f) => [
  ...problemsWithForm(f),
  ...((f.fields ?? []).length ? [] : ['Add at least one question first.']),
];

const ageOn = (dob, day) => {
  if (!dob) return null;
  const a = new Date(`${String(dob).slice(0, 10)}T00:00:00Z`), b = new Date(`${day}T00:00:00Z`);
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y -= 1;
  return y;
};
export const isMinor = (dob, day, adultAge = ADULT_AGE) => { const a = ageOn(dob, day); return a != null && a < adultAge; };

/** Is this form asked of this person at all? Unknown age counts as an adult for 'seniors' only. */
export function appliesTo(form, { dob }, day, adultAge = ADULT_AGE) {
  if (form.audience === 'all' || !form.audience) return true;
  const a = ageOn(dob, day);
  if (form.audience === 'juniors') return a != null && a < adultAge;
  if (form.audience === 'seniors') return a == null || a >= adultAge;
  return true;
}

/**
 * Where a person stands on a form: 'missing', 'current', or 'expired'. `response` is their latest answer to ANY version.
 * An answer given to an older version counts as missing, because the form has changed under it.
 */
export function standingOn(form, response, day) {
  if (!response || response.withdrawn_at || response.form_version !== form.version) return 'missing';
  if (response.expires_on && String(response.expires_on).slice(0, 10) < day) return 'expired';
  return 'current';
}

export function expiryFor(form, day) {
  if (!form.renew_months) return null;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + form.renew_months);
  return d.toISOString().slice(0, 10);
}

/**
 * Check what was submitted against the form. `raw` is the posted object with keys `q_<fieldId>`; a checkboxes question
 * arrives as `q_<id>_<n>` per ticked box. Returns { answers, problems }.
 */
export function readAnswers(fields, raw = {}) {
  const answers = {}, problems = [];
  for (const q of fields) {
    const key = `q_${q.id}`;
    let v;
    if (q.type === 'agree') v = raw[key] === 'on';
    else if (q.type === 'checkboxes') v = q.options.filter((_, i) => raw[`${key}_${i}`] === 'on');
    else v = str(raw[key], q.type === 'longtext' ? 4000 : 500);
    const empty = q.type === 'agree' ? v === false : q.type === 'checkboxes' ? !v.length : !v;
    if (empty) { if (q.required) problems.push(q.type === 'agree' ? `Please tick: "${q.label.slice(0, 80)}"` : `Please answer: "${q.label}"`); answers[q.id] = v; continue; }
    if (q.type === 'choice' && !q.options.includes(v)) problems.push(`"${q.label}": choose one of the options.`);
    if (q.type === 'date' && !(/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))) problems.push(`"${q.label}": give a date.`);
    answers[q.id] = v;
  }
  return { answers, problems };
}

/** What gets signed: the typed name must look like a name. */
export const problemsWithSignature = (name) => str(name, 120).length < 2 ? ['Type your full name to sign.'] : [];

/** Starter forms, so nobody starts from a blank page. Plain wording a club can change. */
export const STARTERS = Object.freeze({
  waiver: { title: 'Membership waiver', kind: 'waiver', audience: 'all', renewMonths: 12,
    intro: 'Training in martial arts involves physical contact and a risk of injury. Please read and agree before you train.',
    fields: [
      { type: 'agree', label: 'I understand that training involves physical contact and a risk of injury, and I accept that risk.' },
      { type: 'agree', label: 'I will tell my instructor straight away about any injury or health problem that could affect my training.' },
      { type: 'agree', label: 'I agree to follow the club\'s rules and my instructors\' directions.' },
    ] },
  photos: { title: 'Photo and video consent', kind: 'consent', audience: 'all', renewMonths: null,
    intro: 'Photos and video are sometimes taken at classes and events. Tell us where they may be used.',
    fields: [
      { type: 'choice', label: 'May the club use photos and video of me (or my child)?', options: 'Yes, anywhere the club promotes itself\nYes, but only inside the club (no website or social media)\nNo, please do not use photos of us', required: true },
      { type: 'longtext', label: 'Anything we should know?', required: false },
    ] },
  medical: { title: 'Medical information', kind: 'medical', audience: 'all', renewMonths: 12,
    intro: 'This helps your instructors look after you. Only people who need it can see your answers.',
    fields: [
      { type: 'longtext', label: 'Medical conditions, allergies or injuries we should know about', required: false, help: 'Write "none" if there is nothing.' },
      { type: 'text', label: 'Regular medication', required: false },
      { type: 'text', label: 'Doctor\'s name and phone', required: false },
      { type: 'agree', label: 'The information I have given is correct, and I will tell the club if it changes.' },
    ] },
});
