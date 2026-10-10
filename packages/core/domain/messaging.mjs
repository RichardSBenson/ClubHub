/**
 * DOMAIN — messaging
 *
 * What a club may say to its people, who that reaches, and who it appears to
 * come from. Pure: no database, no network.
 *
 * One sender per club. Members know their club, not the federation's mail
 * system, so the message says it is from the club ("Whanganui Kyokushin") and
 * a reply goes to the club's own contact address. The address it is SENT from
 * is on the federation's verified sending domain, because a provider will only
 * send from a domain somebody has proved they own — that is DNS, done once.
 */

export const AUDIENCES = Object.freeze([
  ['members',     'Everyone (every member of this organisation and the clubs under it)'],
  ['instructors', 'Instructors only'],
  ['udansha',     'Black belts only (udansha)'],
  ['event',       'People entered in an event'],
  ['person',      'One person'],
  ['selected',    'People I tick from the list'],
]);

/** Which affiliation roles an audience means, for the audiences that are decided by role. Everyone is the default. */
export const rolesForAudience = (audience) =>
  audience === 'instructors' ? ['instructor'] : ['member', 'instructor', 'assistant', 'official'];

/**
 * `announcement` honours a person's opt-out. `event` is about something the
 * person has already entered, so it is a service message and is not stopped by
 * one — the screen says so, rather than leaving it to be discovered.
 */
export const KINDS = Object.freeze([
  ['announcement', 'Announcement'],
  ['event', 'About an event they entered'],
  ['renewal', 'About their membership fees'],
]);

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
export const isEmail = (v) => EMAIL.test(String(v ?? '').trim());

/** The local part of a sending address: letters, digits, hyphens. */
export const localPartFor = (slug) =>
  String(slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'club';

/**
 * Who a message from this club appears to be from.
 *
 * `baseFrom` is the federation's configured address, which supplies the
 * verified domain. Returns null when there is no usable domain, so the caller
 * can say so rather than send from a made-up one.
 */
export function senderFor({ club, baseFrom, contactEmail = null, actorEmail = null }) {
  const at = String(baseFrom ?? '').match(/@([^\s>]+)>?$/)?.[1];
  if (!at || !at.includes('.')) return null;
  const replyTo = [contactEmail, actorEmail].find(isEmail) ?? null;
  return {
    name: String(club.name).replace(/["\r\n<>]/g, '').slice(0, 80),
    address: `${localPartFor(club.slug)}@${at}`,
    replyTo,
  };
}

export const CHANNELS = Object.freeze([
  ['both', 'Email and a notification on their phone'],
  ['app',  'A notification on their phone only (no email)'],
]);

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readMessage(form = {}) {
  // People ticked on the compose screen arrive as pick_<id>=1.
  const personIds = Object.keys(form).filter((k) => k.startsWith('pick_') && form[k] === '1')
    .map((k) => k.slice(5)).filter((id) => ID.test(id));
  const t = (k, n) => String(form[k] ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);
  return {
    audience: t('audience', 20),
    eventId: t('eventId', 40) || null,
    personNumber: t('personNumber', 30) || null,
    kind: t('kind', 20) || 'announcement',
    channel: t('channel', 10) || 'both',
    personIds,
    subject: String(form.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 150),
    body: t('body', 10_000),
  };
}

export function problemsWithMessage(m) {
  const out = [];
  if (!AUDIENCES.some(([k]) => k === m.audience)) out.push('Choose who this is for.');
  if (!KINDS.some(([k]) => k === m.kind)) out.push('Choose what kind of message this is.');
  if (!CHANNELS.some(([k]) => k === (m.channel ?? 'both'))) out.push('Choose how it is sent.');
  if (m.audience === 'selected' && !m.personIds?.length) out.push('Tick at least one person.');
  if (m.audience === 'event' && !m.eventId) out.push('Choose the event.');
  if (m.audience === 'person' && !m.personNumber) out.push('Enter the member number of the person.');
  if (m.kind === 'renewal' && m.audience !== 'selected')
    out.push('A fees reminder goes to people picked from the renewals list.');
  if (m.kind === 'event' && m.audience !== 'event')
    out.push('A message about an event they entered can only go to people entered in an event.');
  if (!m.subject) out.push('A message needs a subject.');
  if (m.body.length < 2) out.push('A message needs something in it.');
  return out;
}

/** What the recipient reads: the words, a line saying who it is from, a way out. */
export function renderBody({ text, club, unsubscribeUrl = null, optOutHonoured = true, serviceNote = null }) {
  const lines = [String(text).trim(), '', '—', `Sent by ${club.name}.`];
  if (unsubscribeUrl && optOutHonoured)
    lines.push(`Stop getting announcements from clubs: ${unsubscribeUrl}`);
  else if (unsubscribeUrl)
    lines.push(serviceNote ?? 'This is about something you entered, so it is sent whatever your email settings.');
  return lines.join('\n');
}

/**
 * Who actually gets it.
 *
 * `candidates` are people with the addresses to try. A child with linked
 * guardians is written to through them — a club should not be emailing an
 * eight-year-old — and a child with nobody linked is written to directly. One
 * address gets one copy however many children it covers.
 */
export function chooseRecipients(candidates, { honourOptOut = true, preferFees = false, appOnly = false } = {}) {
  const sendTo = new Map();
  const skipped = [];
  for (const c of candidates) {
    const minor = c.isMinor === true;
    // By app alone nobody needs an address: a child's notice goes to the parents' phones, anybody else's to their own.
    let guardians = (c.guardians ?? []).filter((g) => appOnly || isEmail(g.email));
    // A child's main contact gets the mail; other parents only if marked "also copy".
    // With no main contact set, every linked parent is written to, as always.
    if (guardians.some((g) => g.main)) guardians = guardians.filter((g) => g.main || g.alsoCopy);
    // Money messages (renewals) go to whoever looks after the fees, when somebody does.
    if (preferFees && guardians.some((g) => g.pays)) guardians = guardians.filter((g) => g.pays);
    const targets = minor && guardians.length
      ? guardians.map((g) => ({ personId: g.personId, email: g.email,
                                optedOut: g.optedOut, via: c.personId }))
      : appOnly ? [{ personId: c.personId, email: null, optedOut: c.optedOut, via: null }]
      : isEmail(c.email) ? [{ personId: c.personId, email: c.email,
                               optedOut: c.optedOut, via: null }] : [];
    if (!targets.length) { skipped.push({ personId: c.personId, reason: 'no_email' }); continue; }
    for (const t of targets) {
      const key = t.email ? t.email.toLowerCase() : `person:${t.personId}`;
      if (honourOptOut && t.optedOut) {
        skipped.push({ personId: t.personId, email: t.email, reason: 'opted_out' }); continue;
      }
      if (!sendTo.has(key)) sendTo.set(key, t);
    }
  }
  return { recipients: [...sendTo.values()], skipped };
}
