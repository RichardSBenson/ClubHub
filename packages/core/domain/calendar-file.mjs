/**
 * DOMAIN — an event as an iCalendar file (.ics)
 *
 * Pure: no I/O, no clock unless one is passed. A visitor presses "Add to calendar" and their
 * phone or desktop calendar opens it. Every calendar app reads this format (RFC 5545).
 *
 * Times go out in UTC, which is unambiguous; the calendar shows them in the visitor's own zone.
 * An event with no end time is left without one rather than given an invented length.
 */

const pad = (n) => String(n).padStart(2, '0');

/** 2026-11-14T21:00:00Z → 20261114T210000Z */
export function utc(d) {
  const x = new Date(d);
  return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}${pad(x.getUTCSeconds())}Z`;
}

/** Text values: backslash, semicolon, comma and line breaks are escaped. */
export const escapeText = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r\n?|\n/g, '\\n');

/** Lines longer than 75 bytes are folded: a CRLF and one space. Never split a character. */
export function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const out = [];
  let cur = '';
  let limit = 75;
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > limit) { out.push(cur); cur = ''; limit = 74; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * @param ev      { id, title, summary, description, starts_at, ends_at, venue_name, address_line, status }
 * @param opts    { url, host, now }   `url` is the event's public page; `host` makes the UID unique
 */
export function eventToIcs(ev, { url = null, host = 'honbu', now = new Date() } = {}) {
  if (!ev?.starts_at || Number.isNaN(new Date(ev.starts_at).getTime())) return null;
  const where = [ev.venue_name, ev.address_line].filter(Boolean).join(', ');
  const about = [ev.summary, ev.description].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Honbu//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.id ?? utc(ev.starts_at)}@${host}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(ev.starts_at)}`,
    ev.ends_at && new Date(ev.ends_at) > new Date(ev.starts_at) ? `DTEND:${utc(ev.ends_at)}` : null,
    `SUMMARY:${escapeText(ev.title)}`,
    where ? `LOCATION:${escapeText(where)}` : null,
    about ? `DESCRIPTION:${escapeText(about)}` : null,
    url ? `URL:${url}` : null,
    ev.status === 'cancelled' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

/**
 * One-tap "add to my calendar" addresses for the calendars most people use, so nobody has to download and open a file.
 * Google and Outlook.com open their own "new event" page with everything filled in. An event with no end time is given
 * one hour, because both of them insist on an end.
 */
export function calendarLinks(ev, { url = null } = {}) {
  if (!ev?.starts_at || Number.isNaN(new Date(ev.starts_at).getTime())) return null;
  const start = new Date(ev.starts_at);
  const end = ev.ends_at && new Date(ev.ends_at) > start ? new Date(ev.ends_at) : new Date(start.getTime() + 3600e3);
  const where = [ev.venue_name, ev.address_line].filter(Boolean).join(', ');
  const about = [ev.summary, ev.description, url ? `More: ${url}` : null].filter(Boolean).join('\n\n').slice(0, 1500);
  const google = new URL('https://calendar.google.com/calendar/render');
  google.searchParams.set('action', 'TEMPLATE');
  google.searchParams.set('text', ev.title ?? '');
  google.searchParams.set('dates', `${utc(start)}/${utc(end)}`);
  if (about) google.searchParams.set('details', about);
  if (where) google.searchParams.set('location', where);
  const outlook = new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  outlook.searchParams.set('path', '/calendar/action/compose');
  outlook.searchParams.set('rru', 'addevent');
  outlook.searchParams.set('subject', ev.title ?? '');
  outlook.searchParams.set('startdt', start.toISOString());
  outlook.searchParams.set('enddt', end.toISOString());
  if (about) outlook.searchParams.set('body', about);
  if (where) outlook.searchParams.set('location', where);
  return { google: google.toString(), outlook: outlook.toString() };
}
