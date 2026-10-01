/**
 * HONBU — A CLUB'S OWN DETAILS
 *
 * What the club is, as an organisation: its name, when it began, which
 * timezone its timetable is in, and whether it is running. Everything a
 * stranger reads — address, phone, description, training times — is the
 * club's PAGE and lives there, once. This is deliberately not a second place
 * to type the same phone number.
 *
 * Pure: no database, no request.
 */

/** Dormant is a club taking a break: off the website, nothing deleted. */
export const STATES = Object.freeze({
  active: 'Running',
  dormant: 'On a break',
});

const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function readClubProfile(form = {}) {
  return {
    name: clean(form.name, 80),
    shortName: clean(form.shortName, 12) || null,
    founded: clean(form.founded, 10) || null,
    timezone: clean(form.timezone, 60),
    status: clean(form.status, 10),
  };
}

const validZone = (z) => {
  try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; }
  catch { return false; }
};

export function problemsWithClubProfile(p, { today = new Date() } = {}) {
  const out = [];
  if (p.name.length < 2) out.push('The club needs a name.');
  if (p.founded) {
    const d = new Date(`${p.founded}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.founded) || Number.isNaN(d.getTime()))
      out.push('The date the club began should look like 2009-03-14.');
    else if (d > today) out.push('The club cannot have begun in the future.');
  }
  if (!p.timezone || !validZone(p.timezone))
    out.push('Choose a timezone from the list, like Pacific/Auckland.');
  if (!Object.hasOwn(STATES, p.status))
    out.push('A club is either running or on a break.');
  return out;
}

/** Only what a change affects the public website, so only then is a rebuild worth asking for. */
export const changesTheSite = (before, after) =>
  before.name !== after.name || before.status !== after.status;
