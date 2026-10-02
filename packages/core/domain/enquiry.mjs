/**
 * DOMAIN — website enquiries
 *
 * A public form is a door anybody can knock on. What lets it stay open:
 * a hidden box that only a robot fills in, a limit on how often one visitor
 * and one organisation can write, strict length limits, and never letting
 * visitor-supplied text into anything but the body of an email.
 */
export const PER_VISITOR_PER_HOUR = 5;
export const PER_ORGANISATION_PER_DAY = 60;
export const RETAIN_DAYS = 365;
export const KINDS = Object.freeze({ contact: 'Contact', trial: 'Try a class' });

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const oneLine = (v, n) => clean(v, n).replace(/\s+/g, ' ');

export function readEnquiry(form = {}) {
  return {
    kind: form.kind === 'trial' ? 'trial' : 'contact',
    name: oneLine(form.name, 100), email: oneLine(form.email, 120).toLowerCase(),
    phone: oneLine(form.phone, 30), who: oneLine(form.who, 100),
    message: clean(form.message, 2000).replace(/\r\n/g, '\n'),
  };
}

/** The hidden "website" box: filled in means a script, not a person. */
export const looksLikeRobot = (form = {}) => String(form.website ?? '').trim() !== '';

/** Links are how spam advertises. A genuine first enquiry rarely needs more than one. */
export const tooManyLinks = (text) => (String(text).match(/https?:\/\/|www\./gi) ?? []).length > 2;

export function problemsWithEnquiry(e) {
  const out = [];
  if (!e.name) out.push('Please tell us your name.');
  if (!EMAIL.test(e.email)) out.push('That email address does not look right.');
  if (e.kind === 'contact' && !e.message) out.push('Please write a message.');
  if (tooManyLinks(`${e.message} ${e.who}`)) out.push('Please leave out the web links — they are how spam is sent.');
  return out;
}

/** A form posted from our own pages. Browsers send Origin on POST; absent is allowed (older clients), wrong is not. */
export function sameSite(headers = {}) {
  const host = String(headers.host ?? '').toLowerCase();
  const from = String(headers.origin ?? headers.referer ?? '');
  if (!from) return true;
  try { return new URL(from).host.toLowerCase() === host; } catch { return false; }
}

export function emailBody(e, club) {
  const lines = [
    e.kind === 'trial' ? `Somebody has asked about a free class at ${club}.` : `A message for ${club} from the website.`, '',
    `Name:  ${e.name}`, `Email: ${e.email}`, ...(e.phone ? [`Phone: ${e.phone}`] : []),
    ...(e.who ? [`For:    ${e.who}`] : []), '', e.message || '(no message)', '',
    '— Reply to this email to answer them. It is also in Enquiries in the admin.'];
  return lines.join('\n');
}
