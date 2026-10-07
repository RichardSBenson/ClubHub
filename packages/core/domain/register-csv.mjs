/**
 * DOMAIN — reading the dojo register's three CSV files.
 *
 * Pure: text in, rows out. Blank means unknown and is stored as NULL; nothing here invents a value.
 */

/** Minimal CSV reader — handles quoted fields and embedded commas. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  return body.map((r) => Object.fromEntries(
    head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export const nul = (v) => (v === '' || v === undefined ? null : v);
export const num = (v) => (nul(v) === null ? null : Number(v));
export const yes = (v) => /^(y|yes|true|1)$/i.test(v ?? '');

export const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

/** Enough for a stranger to turn up: where, when, and who to ask. Returns what is missing. */
export function publishable(row, sessionCount) {
  const missing = [];
  if (!nul(row.venue_name)) missing.push('venue');
  if (!nul(row.address_line) && !nul(row.suburb)) missing.push('address');
  if (!sessionCount) missing.push('training times');
  if (!nul(row.phone) && !nul(row.email)) missing.push('phone or email');
  return missing;
}
