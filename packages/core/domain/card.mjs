/**
 * DOMAIN — the digital card and class check-in
 *
 * Decisions only; signing and the database live elsewhere.
 */
import { addDays } from './attendance.mjs';
import { mayAttend } from './portal.mjs';

/** The last day a card shown today will verify: a week on, or when the membership runs out. */
export function cardValidThrough({ paidUntil = null, exempt = false }, today, days = 7) {
  const week = addDays(today, days);
  if (exempt || !paidUntil) return exempt ? week : null;      // no paid-until and not exempt: no card
  return paidUntil < week ? paidUntil : week;
}

/** Why somebody cannot have a card, in words they can act on. Null when they can. */
export function cardRefusal({ role, status, paidUntil, exempt, displayNumber }, today) {
  if (role !== 'member') return 'Only members have a card.';
  if (status !== 'active') return `Your membership is ${status}.`;
  if (!displayNumber) return 'No member number has been given yet — ask your club.';
  if (!exempt && !paidUntil) return 'There is no paid-until date on your membership.';
  if (!exempt && paidUntil < today) return `Your membership ran out on ${paidUntil}. Renew it to get your card back.`;
  return null;
}

/** What a verifier is told about a card: only what a person on the door needs. */
export function verdictFor({ signature, live, today }) {
  if (!signature.valid) return { ok: false, headline: 'Not valid', why: signature.reason };
  if (!live) return { ok: false, headline: 'Not a current member', why: 'This code is genuine but nobody holds that number now.' };
  const why = cardRefusal(live, today);
  return why ? { ok: false, headline: 'Not a current member', why } : { ok: true, headline: 'Current member', why: null };
}

/**
 * Who in this family may be checked in to this class, and who is already in.
 * `people` [{ id, name, ageYears, rankOrder, member }], `here` Set of ids.
 */
export function checkinPlan(people, session, here = new Set()) {
  return people.map((p) => {
    if (!p.member) return { ...p, state: 'not-member', reason: 'Not a member of this club' };
    if (here.has(p.id)) return { ...p, state: 'here', reason: 'Already checked in' };
    if (!mayAttend(session, { ageYears: p.ageYears, rankOrder: p.rankOrder }))
      return { ...p, state: 'not-for-them', reason: 'This class is not for their age or grade' };
    return { ...p, state: 'can', reason: null };
  });
}
