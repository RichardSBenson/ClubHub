/**
 * HONBU — CSV import
 *
 * Loads dojo detail and training times from the two templates in /import.
 *
 * Rules:
 *  - Blank means unknown. It is stored as NULL, and the site says "to confirm".
 *    Never write a placeholder string into the database.
 *  - A dojo publishes only when publish=yes AND the facts a visitor needs are
 *    present. The importer refuses to publish a half-filled page.
 *  - Re-runnable. Importing twice does not duplicate anything.
 *
 * Usage:  node import.mjs ../import/dojos.csv ../import/sessions.csv
 */

import fs from 'node:fs';
import { pool } from '../packages/api/data.mjs';

const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

/** Minimal CSV reader — handles quoted fields and embedded commas. */
function parseCsv(text) {
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

const nul = (v) => (v === '' || v === undefined ? null : v);
const num = (v) => (nul(v) === null ? null : Number(v));
const yes = (v) => /^(y|yes|true|1)$/i.test(v ?? '');

/** Enough for a stranger to turn up: where, when, and who to ask. */
function publishable(row, sessionCount) {
  const missing = [];
  if (!nul(row.venue_name)) missing.push('venue');
  if (!nul(row.address_line) && !nul(row.suburb)) missing.push('address');
  if (!sessionCount) missing.push('training times');
  if (!nul(row.phone) && !nul(row.email)) missing.push('phone or email');
  return missing;
}

const [dojoFile, sessionFile] = process.argv.slice(2);
if (!dojoFile) {
  console.error('usage: node import.mjs <dojos.csv> [sessions.csv]');
  process.exit(1);
}

const dojos = parseCsv(fs.readFileSync(dojoFile, 'utf8'));
const sessions = sessionFile ? parseCsv(fs.readFileSync(sessionFile, 'utf8')) : [];

const byDojo = new Map();
for (const s of sessions) {
  if (!byDojo.has(s.slug)) byDojo.set(s.slug, []);
  byDojo.get(s.slug).push(s);
}

const client = await pool.connect();
let updated = 0, published = 0, held = [];

try {
  await client.query('begin');

  for (const row of dojos) {
    const { rows: [org] } = await client.query(
      'select id, name from organisation where slug = $1', [row.slug]);
    if (!org) { console.log(`  ? no organisation with slug "${row.slug}" — skipped`); continue; }

    const mine = byDojo.get(row.slug) ?? [];
    const missing = publishable(row, mine.length);
    const willPublish = yes(row.publish) && missing.length === 0;
    if (yes(row.publish) && missing.length) held.push({ slug: row.slug, missing });

    await client.query(`
      insert into dojo_profile (organisation_id, venue_name, address_line, suburb,
        city, postcode, latitude, longitude, directions, phone, email, blurb,
        who_trains, published, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
      on conflict (organisation_id) do update set
        venue_name=excluded.venue_name, address_line=excluded.address_line,
        suburb=excluded.suburb, city=excluded.city, postcode=excluded.postcode,
        latitude=excluded.latitude, longitude=excluded.longitude,
        directions=excluded.directions, phone=excluded.phone, email=excluded.email,
        blurb=excluded.blurb, who_trains=excluded.who_trains,
        published=excluded.published, updated_at=now()`,
      [org.id, nul(row.venue_name), nul(row.address_line), nul(row.suburb),
       nul(row.city), nul(row.postcode), num(row.latitude), num(row.longitude),
       nul(row.directions), nul(row.phone), nul(row.email), nul(row.blurb),
       nul(row.who_trains), willPublish]);

    if (mine.length) {
      await client.query('delete from training_session where organisation_id = $1',
        [org.id]);
      let order = 0;
      for (const s of mine) {
        const wd = DAYS.indexOf(String(s.weekday).trim().toLowerCase());
        if (wd < 0) { console.log(`  ? "${s.weekday}" is not a weekday — skipped`); continue; }
        await client.query(`
          insert into training_session (organisation_id, label, weekday, starts, ends,
            min_age, max_age, sort_order)
          values ($1,$2,$3,$4::time,$5::time,$6,$7,$8)`,
          [org.id, s.label, wd, s.starts, s.ends,
           num(s.min_age), num(s.max_age), order++]);
      }
    }

    updated++;
    if (willPublish) published++;
  }

  await client.query('commit');
} catch (e) {
  await client.query('rollback');
  throw e;
} finally {
  client.release();
}

console.log(`\n${updated} dojo updated, ${published} published`);

if (held.length) {
  console.log('\nHeld back — marked publish=yes but missing facts a visitor needs:');
  for (const h of held) console.log(`  ${h.slug.padEnd(16)} needs ${h.missing.join(', ')}`);
  console.log('\nA half-filled page is worse than no page. Fill these and re-run.');
}

const { rows: [tally] } = await pool.query(`
  select count(*) filter (where published) as live,
         count(*) as total from dojo_profile`);
console.log(`\nRegister: ${tally.live} of ${tally.total} dojo pages complete.\n`);

await pool.end();
