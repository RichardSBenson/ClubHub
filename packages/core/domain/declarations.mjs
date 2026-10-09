/**
 * DOMAIN — the federation's declaration
 *
 * One waiver-and-consent for the whole federation, written once. A member (or a parent or guardian for a child)
 * signs it once and the signing keeps the exact version. New wording is a new version, and everyone signs again.
 * Events do not carry their own copy of it; a camp or tournament may add wording of its own on top.
 */

/** A child cannot sign for themselves. Age unknown is treated as an adult, as the rest of the register does. */
export const needsGuardian = (age) => age != null && age < 18;

/** none: nothing published. unsigned: published, not yet signed. signed: signed this version. */
export const stateOf = ({ current, signed }) => !current ? 'none' : signed ? 'signed' : 'unsigned';

/** What is wrong with a signing about to be recorded, as sentences. `how` is 'self' or how the signer is linked. */
export function problemsWithSigning({ accepted, name, isChild, how }) {
  const out = [];
  if (!accepted) out.push('Tick the box to agree to the declaration.');
  if (!String(name ?? '').trim()) out.push('Type your full name to sign.');
  if (isChild && how === 'self') out.push('A parent or guardian has to sign for a child. Ask them to sign in and sign for them.');
  return out;
}

/** What is wrong with the wording about to be published. */
export function problemsWithPublishing({ version, body }) {
  const out = [];
  if (!String(version ?? '').trim()) out.push('Give this wording a version, such as 2026.1.');
  else if (String(version).trim().length > 40) out.push('The version is too long (40 characters at most).');
  if (String(body ?? '').trim().length < 40) out.push('Write the declaration itself.');
  if (String(body ?? '').length > 20000) out.push('The declaration is too long.');
  return out;
}

/**
 * Plain starting wording, offered when the federation has not written its own. It is generic on purpose and is
 * not legal advice: the federation should have its own advisers read it before publishing.
 */
export const STARTER_DECLARATION = `I understand that karate training, gradings, seminars, camps and tournaments involve physical contact and carry a risk of injury.

I confirm that I (or the child I am signing for) am fit to take part, and I will tell the instructor about any injury, illness or condition that could affect training.

I agree to follow the instructions of instructors and officials, and to train safely and with respect for others.

If there is an emergency and I cannot be reached, I consent to first aid and to emergency medical treatment being arranged for me (or the child I am signing for).

The personal and medical information I have given is true and up to date, and I will keep it so.

I accept that I take part at my own risk, as far as the law allows.`;
