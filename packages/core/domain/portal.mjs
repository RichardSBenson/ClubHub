/**
 * DOMAIN — what a member's own home screen says
 *
 * Everything here is worked out from the record, never typed in: the next class
 * they could go to, and what needs their attention.
 */
import { addDays } from './attendance.mjs';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const weekdayOf = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

const hhmm = (t) => String(t ?? '').slice(0, 5);

/** May this person go to this class? Age and grade limits are the club's. */
export function mayAttend(session, { ageYears = null, rankOrder = null } = {}) {
  if (session.min_age != null && (ageYears == null || ageYears < session.min_age)) return false;
  if (session.max_age != null && (ageYears == null || ageYears > session.max_age)) return false;
  if (session.min_rank_order != null && (rankOrder == null || rankOrder < session.min_rank_order)) return false;
  return true;
}

/**
 * The next class they could go to. `now` is { date: 'YYYY-MM-DD', time: 'HH:MM' } in the club's own
 * time zone; a class that has already finished today is not "next".
 */
export function nextSession(sessions, now, who = {}) {
  const usable = sessions.filter((s) => mayAttend(s, who));
  for (let offset = 0; offset <= 7; offset++) {
    const date = addDays(now.date, offset);
    const day = weekdayOf(date);
    const today = usable
      .filter((s) => s.weekday === day && (offset > 0 || hhmm(s.ends) > now.time))
      .sort((a, b) => hhmm(a.starts).localeCompare(hhmm(b.starts)));
    if (today.length) return { ...today[0], date, daysAway: offset, weekdayName: DAY_NAMES[day] };
  }
  return null;
}

/**
 * What needs this person's attention, most pressing first.
 *
 * `owed` [{ id, amount_cents, description }], `memberships` [{ name, standing, paid_until }],
 * `closing` [{ title, entries_close }], `qualifications` [{ label, state, expires_on }],
 * `details` { emergencyContact: bool }
 */
export function actionsFor({ personId, owed = [], memberships = [], closing = [], qualifications = [],
                             details = { emergencyContact: true }, trial = null, termsOpen = [], formsDue = [] }) {
  const out = [];
  if (trial && trial.left != null)
    out.push({ kind: 'trial', urgent: trial.left <= 3, href: `/me/${personId}/join`,
      text: trial.left < 0 ? 'Your free month has ended — join to keep training'
        : trial.left === 0 ? 'Your free month ends today — join to keep training'
        : `Your free month ends in ${trial.left} day${trial.left === 1 ? '' : 's'} — join to keep training` });
  if (owed.length) {
    const total = owed.reduce((n, p) => n + (p.amount_cents ?? 0), 0);
    out.push({ kind: 'payment', urgent: true, href: '/me/payments', total, count: owed.length,
      text: owed.length === 1 ? `One payment to make: ${owed[0].description}` : `${owed.length} payments to make` });
  }
  for (const m of memberships) {
    if (m.standing === 'overdue')
      out.push({ kind: 'membership', urgent: true, href: '/me/payments', text: `Your ${m.name} membership ran out on ${m.paid_until}` });
    else if (m.standing === 'due')
      out.push({ kind: 'membership', urgent: false, href: '/me/payments', text: `Your ${m.name} membership runs out on ${m.paid_until}` });
  }
  for (const f of formsDue)
    out.push({ kind: 'form', urgent: f.expired, href: `/me/forms/${f.id}/${f.personId}`,
      text: f.expired ? `${f.title} for ${f.first} has run out — please sign it again` : `Please complete ${f.title} for ${f.first}` });
  for (const t of termsOpen)
    out.push({ kind: 'term', urgent: false, href: '/me/terms', text: `${t.name} enrolment is open for ${t.first}` });
  for (const c of closing)
    out.push({ kind: 'event', urgent: false, href: '/me/events', text: `Entries for ${c.title} close soon` });
  for (const q of qualifications) {
    if (q.state === 'expired') out.push({ kind: 'qualification', urgent: true, href: `/me/${personId}/documents`, text: `${q.label} has expired` });
    else if (q.state === 'expiring') out.push({ kind: 'qualification', urgent: false, href: `/me/${personId}/documents`, text: `${q.label} expires on ${q.expires_on}` });
  }
  if (!details.emergencyContact)
    out.push({ kind: 'details', urgent: false, href: `/me/${personId}`, text: 'Add an emergency contact' });
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

/** The words of a message as its recipient sees it. Only the two merge tokens the senders use. */
export function messageText(body, { club = '' } = {}) {
  return String(body ?? '').replace(/\{club\}/g, club).replace(/\{payLink\}/g, 'your payments page');
}
