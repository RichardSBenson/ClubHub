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

const [dojoFile, sessionFile, instructorFile] = process.argv.slice(2);
if (!dojoFile) {
  console.error('usage: node import.mjs <dojos.csv> [sessions.csv] [instructors.csv]');
  process.exit(1);
}

const dojos = parseCsv(fs.readFileSync(dojoFile, 'utf8'));
const sessions = sessionFile ? parseCsv(fs.readFileSync(sessionFile, 'utf8')) : [];

const instructors = instructorFile ? parseCsv(fs.readFileSync(instructorFile, 'utf8')) : [];

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
    let { rows: [org] } = await client.query(
      'select id, name from organisation where slug = $1', [row.slug]);
    if (!org && row.name) {
      // A dojo the register does not have yet is added beneath the federation, the way the Add a club screen does.
      const { rows: [root] } = await client.query(
        'select id, path, country_code, timezone from organisation where parent_id is null order by created_at limit 1');
      if (root) {
        ({ rows: [org] } = await client.query(`
          insert into organisation (parent_id, type, name, slug, path, country_code, timezone, status)
          values ($1,'club',$2,$3,($4 || '.' || $5)::ltree,$6,$7,'active') returning id, name`,
          [root.id, row.name, row.slug, root.path, row.slug.replace(/-/g, '_'), nul(row.country) ?? root.country_code, nul(row.timezone) ?? root.timezone]));
        console.log(`  + added ${row.name} to the register`);
      }
    }
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

// ---------------------------------------------------------------------------
// Instructors: put each person on their dojo's roll as an instructor, at the dan grade they hold.
// Re-runnable: a person already on the roll is found by name, not added twice, and a grade they
// already hold (or a higher one) is left alone. This puts people on the roll; it does not put
// them on the website. That still needs their own consent, a write-up and current checks.
// ---------------------------------------------------------------------------
if (instructors.length) {
  const c = await pool.connect();
  const out = { added: 0, onRoll: 0, instructor: 0, graded: 0 };
  try {
    await c.query('begin');
    const { rows: [root] } = await c.query('select id, coalesce(short_name, slug) as prefix from organisation where parent_id is null order by created_at limit 1');
    const prefix = String(root.prefix).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'M';
    const { rows: [seq] } = await c.query(`select coalesce(max(substring(display_number from '[0-9]+$')::int), 0) as last from person where display_number like $1`, [`${prefix}-%`]);
    let next = seq.last;
    const { rows: ladder } = await c.query('select id, rank_order from grade where organisation_id = $1 and is_dan', [root.id]);
    for (const r of instructors) {
      const { rows: [org] } = await c.query('select id from organisation where slug = $1', [r.slug]);
      if (!org) { console.log(`  ? no dojo "${r.slug}" for ${r.first_name} ${r.last_name} — skipped`); continue; }
      const first = r.first_name.trim(), last = r.last_name.trim();
      // The same name on another dojo's roll is the same person (Craig and Elaine teach at two), unless the row says it is not.
      let { rows: [who] } = await c.query(
        `select p.id from person p where lower(p.first_name) = lower($1) and lower(p.last_name) = lower($2)
           and ($3 or exists (select 1 from affiliation a where a.person_id = p.id and a.organisation_id = $4))
         order by p.created_at limit 1`, [first, last, !yes(r.distinct), org.id]);
      if (!who) {
        next += 1;
        ({ rows: [who] } = await c.query(
          `insert into person (display_number, first_name, last_name) values ($1,$2,$3) returning id`,
          [`${prefix}-${String(next).padStart(4, '0')}`, first, last]));
        out.added++;
      }
      const { rows: [aff] } = await c.query('select id, role from affiliation where person_id = $1 and organisation_id = $2 and ends is null', [who.id, org.id]);
      if (!aff) {
        await c.query(`insert into affiliation (person_id, organisation_id, role, starts, status) values ($1,$2,'instructor',current_date,'active')`, [who.id, org.id]);
        out.onRoll++; out.instructor++;
      } else if (aff.role === 'member') {
        await c.query(`update affiliation set role = 'instructor' where id = $1`, [aff.id]);
        out.instructor++;
      }
      const target = ladder.find((g) => g.rank_order === 10 + Number(r.dan));
      if (target) {
        const { rows: [held] } = await c.query('select max(g.rank_order) as top from grading_record gr join grade g on g.id = gr.grade_id where gr.person_id = $1 and gr.result = $2', [who.id, 'pass']);
        if (!held.top || held.top < target.rank_order) {
          await c.query(`insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result, panel, notes) values ($1,$2,current_date,$3,'pass','[]',$4)`,
            [who.id, target.id, org.id, "Held on joining. Imported from the dojo's own records; not graded through this system."]);
          out.graded++;
        }
      }
    }
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  console.log(`Instructors: ${out.added} people added, ${out.instructor} made or kept as instructors, ${out.graded} grades recorded.`);
}

const { rows: [tally] } = await pool.query(`
  select count(*) filter (where published) as live,
         count(*) as total from dojo_profile`);
console.log(`\nRegister: ${tally.live} of ${tally.total} dojo pages complete.\n`);

await pool.end();
