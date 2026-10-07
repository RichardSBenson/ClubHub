/**
 * DOMAIN — reading the dojo register's three CSV files.
 *
 * Pure: text in, rows out. Blank means unknown and is stored as NULL; nothing here invents a value.
 */

/**
 * Minimal CSV reader — handles quoted fields and embedded commas.
 * Also reads tab-separated text, which is what a copy from a spreadsheet gives you, and ignores
 * the invisible mark some editors put at the start of a file. The result carries `.columns`.
 */
export function parseCsv(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const firstLine = text.split('\n', 1)[0];
  const sep = (firstLine.match(/\t/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? '\t' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const out = body.map((r) => Object.fromEntries(
    head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
  out.columns = (head ?? []).map((h) => h.trim());
  return out;
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
