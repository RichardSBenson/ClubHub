/**
 * DOMAIN — the kinds of event a federation runs, and how each is announced
 *
 * An event's banner is made from text, not from a designed picture: the
 * federation's crest, then up to three lines — a region or qualifier in the
 * quiet colour, the name of the event in the bright one, and the date. Change
 * the date and the banner is right; nobody opens a design tool.
 *
 * `kind` is the broader category the register already knows (grading, camp,
 * tournament…); `key` is the specific thing the federation chose from the list.
 */
export const EVENT_TYPES = Object.freeze([
  { key: 'camp_north',   label: 'Training Camp — North Island', kind: 'camp',       top: 'North Island', main: 'Training Camp' },
  { key: 'camp_south',   label: 'Training Camp — South Island', kind: 'camp',       top: 'South Island', main: 'Training Camp' },
  { key: 'shinsa_north', label: 'Shinsa — North Island',        kind: 'grading',    top: 'North Island', main: 'Shinsa' },
  { key: 'shinsa_south', label: 'Shinsa — South Island',        kind: 'grading',    top: 'South Island', main: 'Shinsa' },
  { key: 'nationals',    label: 'Nationals',                    kind: 'tournament', top: 'New Zealand',  main: 'Nationals' },
  { key: 'kyu_grading',  label: 'Kyu Grading',                  kind: 'grading',    top: 'Kyu',          main: 'Grading' },
  { key: 'seminar',      label: 'Seminar',                      kind: 'seminar',    top: null,           main: 'Seminar' },
  { key: 'operators',    label: 'Dojo Operators Meeting',       kind: 'other',      top: 'Dojo Operators', main: 'Meeting' },
]);

const BY_KEY = new Map(EVENT_TYPES.map((t) => [t.key, t]));

export const typeFor = (key) => BY_KEY.get(key) ?? null;

/** The title to offer when somebody picks a type and has not typed one. */
export const defaultTitle = (key) => {
  const t = typeFor(key);
  return t ? [t.top, t.main].filter(Boolean).join(' ') : '';
};

/**
 * The three lines of a banner for an event. A type with no fixed top line
 * (a seminar) uses the event's own title there, so "Karate Seminar with
 * Shihan Tanaka" reads as itself above the word SEMINAR. An event with no
 * type shows its title and its kind.
 */
export function bannerLines(ev) {
  const t = typeFor(ev.type_key ?? ev.typeKey);
  if (!t) return { top: ev.title, main: String(ev.kind ?? '').replace('_', ' ') };
  return { top: t.top ?? ev.title, main: t.main };
}

/** Normalises a form value: a known key, or null. */
export const readType = (v) => (BY_KEY.has(v) ? v : null);

const SAFE_URL = /^https:\/\/[^\s"'<>]+$/i;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** What is wrong with the details a person typed, as sentences. */
export function problemsWithDetail(d) {
  const out = [];
  if (d.contactEmail && !EMAIL.test(d.contactEmail)) out.push('The contact email does not look right.');
  if (d.infoUrl && !SAFE_URL.test(d.infoUrl)) out.push('The more-information link must start with https://.');
  if (d.latitude != null && !(d.latitude >= -90 && d.latitude <= 90)) out.push('Latitude must be between -90 and 90.');
  if (d.longitude != null && !(d.longitude >= -180 && d.longitude <= 180)) out.push('Longitude must be between -180 and 180.');
  if (d.description && d.description.length > 4000) out.push('The description is too long (4000 characters at most).');
  if ((d.latitude == null) !== (d.longitude == null)) out.push('Give both latitude and longitude for the map pin, or neither.');
  return out;
}

/** A map link that needs no key: coordinates when there are some, the address when not. */
export function mapLinks({ latitude, longitude, venue, address }) {
  const has = latitude != null && longitude != null;
  const q = encodeURIComponent([venue, address].filter(Boolean).join(', '));
  if (!has && !q) return null;
  return {
    google: has ? `https://www.google.com/maps?q=${latitude},${longitude}` : `https://www.google.com/maps/search/?api=1&query=${q}`,
    osm: has ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}` : `https://www.openstreetmap.org/search?query=${q}`,
    embed: has ? `https://www.openstreetmap.org/export/embed.html?bbox=${(+longitude - 0.006).toFixed(5)}%2C${(+latitude - 0.004).toFixed(5)}%2C${(+longitude + 0.006).toFixed(5)}%2C${(+latitude + 0.004).toFixed(5)}&layer=mapnik&marker=${latitude}%2C${longitude}` : null,
  };
}
