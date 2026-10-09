/**
 * DOMAIN — booking a place in a class
 *
 * A class on the timetable repeats every week. A club can give a class a number of places; people then book a place on a
 * particular date. When the class is full they join a waiting list, and when somebody cancels the person who has waited
 * longest gets the place. A class with no number is not booked at all: people just turn up.
 *
 * Nothing here touches a database.
 */
import { addDays } from './attendance.mjs';
import { weekdayOf, mayAttend, DAY_NAMES } from './portal.mjs';

export const BOOK_DAYS_AHEAD = 14;
export const MAX_CAPACITY = 500;

export { DAY_NAMES };

/** Whole-number places from a form field: blank means "not booked", otherwise 1 to MAX_CAPACITY. */
export function readCapacity(raw) {
  const t = String(raw ?? '').trim();
  if (t === '') return { value: null };
  if (!/^\d{1,4}$/.test(t) || +t < 1 || +t > MAX_CAPACITY) return { problem: `Places must be a whole number from 1 to ${MAX_CAPACITY}, or left blank for no booking.` };
  return { value: +t };
}

/** The dates a weekly class can be booked: from now, up to `daysAhead`, leaving out a class that has already started. */
export function bookableDates(session, now, daysAhead = BOOK_DAYS_AHEAD) {
  const out = [];
  for (let i = 0; i <= daysAhead; i++) {
    const date = addDays(now.date, i);
    if (weekdayOf(date) !== session.weekday) continue;
    if (i === 0 && String(session.starts).slice(0, 5) <= now.time) continue;
    out.push(date);
  }
  return out;
}

/** A place, or a place in the queue. */
export const placeFor = ({ capacity, booked }) => (booked < capacity ? 'booked' : 'waiting');

/** Why this person cannot book this date, or null. */
export function problemWithBooking({ session, date, now, who, daysAhead = BOOK_DAYS_AHEAD }) {
  if (session.capacity == null) return 'This class does not need booking — just turn up.';
  if (!bookableDates(session, now, daysAhead).includes(date)) return 'That class is not open for booking: it has passed, or is too far away.';
  if (!mayAttend(session, who)) return 'This class is not for this person (age or grade).';
  return null;
}

/** Who moves up when a place opens: those waiting, longest first. Returns how many places are free to fill. */
export const placesFree = ({ capacity, booked }) => Math.max(0, capacity - booked);
const byWaiting = (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime();   // earliest first; ties keep the order given
export const nextInQueue = (waiting, free = 1) => [...waiting].sort(byWaiting).slice(0, free);

/** The 1-based place in the queue of one person. */
export const queuePosition = (waiting, id) => [...waiting].sort(byWaiting).findIndex((w) => w.id === id) + 1;
