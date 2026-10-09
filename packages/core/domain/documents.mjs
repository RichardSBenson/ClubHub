/**
 * DOMAIN — documents a member sends to their club
 *
 * A first aid certificate, a police vet, a letter. Anybody linked to the person may send one, at any age: a
 * parent sends a child's, a grown member sends their own. What the file is gets decided from its bytes, never
 * from the name it arrived with.
 */
import { ADULT_AGE } from './defaults.mjs';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** `%PDF-` at the start. A PDF is the one non-image document a phone or an email attachment commonly gives us. */
export const isPdf = (bytes) => !!bytes && bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';

/** What is wrong with a document being sent, as sentences. `file` is { mime, size }. */
export function problemsWithDocument({ title, awardedOn, expiresOn, hasQualification }, file, { today }) {
  const out = [];
  if (!file) return ['Choose the file to send.'];
  if (file.size > MAX_DOCUMENT_BYTES) out.push(`That file is over ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB. Take a smaller photo or save the PDF smaller.`);
  if (!hasQualification && !String(title ?? '').trim()) out.push('Say what this document is.');
  for (const [v, what] of [[awardedOn, 'The date it was issued'], [expiresOn, 'The date it runs out']])
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) out.push(`${what} is not a date.`);
  if (awardedOn && awardedOn > today) out.push('The date it was issued is in the future.');
  if (hasQualification && !awardedOn) out.push('Give the date it was issued, so the club can record it.');
  if (awardedOn && expiresOn && expiresOn < awardedOn) out.push('It cannot run out before it was issued.');
  return out;
}

/** Photographs on a record need somebody's yes only for a child: an adult speaks for themselves. */
export const photoNeedsConsent = (age, adultAge = ADULT_AGE) => age == null || age < adultAge;
