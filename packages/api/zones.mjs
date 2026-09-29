/**
 * Wall-clock time in and out of a timezone.
 *
 * Somebody scheduling a grading types "9:00 am". They mean nine in the morning
 * where the grading is, and nothing else. A `datetime-local` input sends
 * `2026-12-05T09:00` with no zone attached, and `new Date()` on that string
 * uses whatever zone the SERVER happens to be in — which on Vercel is UTC. So
 * a 9am grading in Whanganui becomes an instant that displays as 10pm, and
 * nobody notices until the day.
 *
 * The organisation already records its timezone. This converts between what a
 * person typed there and the instant the register stores, both directions, so
 * the timestamp is correct regardless of where the server is running or what
 * the browser sent.
 *
 * No library. Intl has the whole timezone database in it, including every
 * daylight-saving rule, and it ships with Node.
 */

const FIELDS = {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
};

const formatters = new Map();
const formatterFor = (zone) => {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US',
      { timeZone: zone, hour12: false, ...FIELDS }));
  }
  return formatters.get(zone);
};

/** How far ahead of UTC the zone is at this instant, in milliseconds. */
function offsetAt(instant, zone) {
  const p = formatterFor(zone).formatToParts(instant)
    .reduce((a, x) => (a[x.type] = x.value, a), {});
  // hour comes back as 24 at midnight in some locales.
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day,
    +p.hour % 24, +p.minute, +p.second);
  return asIfUtc - instant.getTime();
}

/** Whether this is a zone Intl knows. An unknown one would silently be UTC. */
export function isKnownZone(zone) {
  if (!zone) return false;
  try { formatterFor(zone).format(new Date()); return true; }
  catch { return false; }
}

/**
 * 'YYYY-MM-DDTHH:mm' in a zone → Date.
 *
 * Two passes. The first guesses the offset by reading the typed time as though
 * it were UTC; the second corrects it, which matters on the two days a year
 * when the offset either side of the guess is different. A single pass puts an
 * event an hour out on exactly those days — the kind of bug that is reported
 * once a year and never reproduced.
 */
export function toInstant(local, zone) {
  if (!local) return null;
  if (!isKnownZone(zone)) return new Date(local);

  const text = local.length === 16 ? `${local}:00` : local;
  const naive = new Date(`${text}Z`);
  if (Number.isNaN(naive.getTime())) return new Date(local);

  const first = new Date(naive.getTime() - offsetAt(naive, zone));
  const corrected = new Date(naive.getTime() - offsetAt(first, zone));
  return corrected;
}

/** Date → 'YYYY-MM-DDTHH:mm' as the clock on that wall reads, for a form. */
export function toLocalInput(instant, zone) {
  if (!instant) return '';
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  if (!isKnownZone(zone)) return d.toISOString().slice(0, 16);

  const p = formatterFor(zone).formatToParts(d)
    .reduce((a, x) => (a[x.type] = x.value, a), {});
  const hour = String(+p.hour % 24).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

/** Date → something to read: 'Sat 5 Dec 2026, 9:00 am'. */
export function toReadable(instant, zone, { withTime = true } = {}) {
  if (!instant) return '';
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  const options = {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}),
    ...(isKnownZone(zone) ? { timeZone: zone } : { timeZone: 'UTC' }),
  };
  return new Intl.DateTimeFormat('en-NZ', options).format(d);
}
