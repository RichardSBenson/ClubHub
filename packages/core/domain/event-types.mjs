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
/** What a federation that has not listed its own kinds of event is offered. */
export const GENERIC_EVENT_TYPES = Object.freeze([
  { key: 'camp',       label: 'Training camp', kind: 'camp',       top: null, main: 'Training Camp' },
  { key: 'grading',    label: 'Grading',       kind: 'grading',    top: null, main: 'Grading' },
  { key: 'tournament', label: 'Tournament',    kind: 'tournament', top: null, main: 'Tournament' },
  { key: 'seminar',    label: 'Seminar',       kind: 'seminar',    top: null, main: 'Seminar' },
  { key: 'meeting',    label: 'Meeting',       kind: 'other',      top: null, main: 'Meeting' },
]);

export const EVENT_KINDS = Object.freeze(['grading', 'tournament', 'camp', 'seminar', 'fight_night', 'training', 'social', 'other']);

/** The organisation's own list if it has one that is valid, else the generic one. */
export function resolveEventTypes(stored) {
  return Array.isArray(stored) && stored.length && problemsWithEventTypes(stored).length === 0
    ? Object.freeze(stored.map((t) => Object.freeze({ key: t.key, label: t.label, kind: t.kind, top: t.top || null, main: t.main })))
    : GENERIC_EVENT_TYPES;
}

/** What is wrong with a list of event types, as sentences. */
export function problemsWithEventTypes(list) {
  const out = [], seen = new Set();
  if (!Array.isArray(list) || !list.length) return ['Add at least one kind of event.'];
  if (list.length > 40) out.push('That is a lot of kinds of event; 40 at most.');
  list.forEach((t, i) => {
    const n = i + 1;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(String(t?.key ?? ''))) out.push(`Row ${n}: the code is lowercase letters, numbers and underscores, starting with a letter.`);
    else if (seen.has(t.key)) out.push(`Row ${n}: the code "${t.key}" is used twice.`);
    else seen.add(t.key);
    if (!String(t?.label ?? '').trim()) out.push(`Row ${n}: a name is needed.`);
    if (!EVENT_KINDS.includes(t?.kind)) out.push(`Row ${n}: choose what sort of event it is.`);
    if (!String(t?.main ?? '').trim()) out.push(`Row ${n}: the banner needs its main word.`);
    for (const k of ['label', 'top', 'main']) if (String(t?.[k] ?? '').length > 80) out.push(`Row ${n}: ${k} is too long.`);
  });
  return out;
}

/** The editor's form: rows `key_i`, `label_i`, `kind_i`, `top_i`, `main_i`; a blank row is ignored, `remove_i` drops one. */
export function readEventTypesForm(f = {}) {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    if (f[`remove_${i}`] === 'on') continue;
    const row = { key: String(f[`key_${i}`] ?? '').trim(), label: String(f[`label_${i}`] ?? '').trim(), kind: String(f[`kind_${i}`] ?? '').trim(),
      top: String(f[`top_${i}`] ?? '').trim() || null, main: String(f[`main_${i}`] ?? '').trim() };
    if (!row.key && !row.label && !row.main) continue;
    rows.push(row);
  }
  return rows;
}

export const typeFor = (key, types = GENERIC_EVENT_TYPES) => types.find((t) => t.key === key) ?? null;

/** The title to offer when somebody picks a type and has not typed one. */
export const defaultTitle = (key, types = GENERIC_EVENT_TYPES) => {
  const t = typeFor(key, types);
  return t ? [t.top, t.main].filter(Boolean).join(' ') : '';
};

/**
 * The three lines of a banner for an event. A type with no fixed top line
 * (a seminar) uses the event's own title there, so "Karate Seminar with
 * Shihan Tanaka" reads as itself above the word SEMINAR. An event with no
 * type shows its title and its kind.
 */
export function bannerLines(ev, types = GENERIC_EVENT_TYPES) {
  const t = typeFor(ev.type_key ?? ev.typeKey, types);
  if (!t) return { top: ev.title, main: String(ev.kind ?? '').replace('_', ' ') };
  return { top: t.top ?? ev.title, main: t.main };
}

/** Normalises a form value: a known key, or null. */
export const readType = (v, types = GENERIC_EVENT_TYPES) => (types.some((t) => t.key === v) ? v : null);

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
