/**
 * HONBU — WHAT THE SCHEMA PROMISES THAT NO CODE KEEPS
 *
 * Three bugs in one day had the same shape: a column in the database that no
 * code ever read, and a feature that therefore did nothing without ever
 * saying so.
 *
 *   - asset.storage_key pointed at a blob service that was never set up, so
 *     every image block on every page rendered as an empty string.
 *   - article.body was never selected by the site query, so every news page
 *     was a headline, a date, and nothing else.
 *   - article.publish_up existed and nothing honoured it, so a dojo's notice
 *     appeared on the national site whether it meant it to or not.
 *
 * None of them failed. That is what made them expensive: an empty string is a
 * perfectly good return value, and a suite stays green while a page quietly
 * says nothing.
 *
 * This lists every column no source file mentions, and fails if one turns up
 * that is not accounted for below. A column lands in one of three places:
 *
 *   it is used          — nothing to do
 *   it is listed here   — somebody decided, in writing, and said why
 *   it is neither       — the check fails, and somebody has to decide
 *
 * The point is not that unused columns are wrong. Half of these are the right
 * kind of unused: a schema laid down ahead of a feature that is honestly not
 * built. The point is that nobody should find out by accident, in production,
 * that a thing they thought worked never did.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../packages/infrastructure/postgres/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Columns deliberately not read yet, and why.
 *
 * Every line is a decision somebody made with their eyes open. Delete a line
 * when the column starts being used; add one, with a real reason, when a
 * schema is laid down ahead of its feature. "Not sure" is not a reason — if
 * nobody knows what it is for, it should not be in the schema.
 */
const ACCOUNTED_FOR = {
  // --- whole subsystems that are honestly not built -------------------------
  'invoice.issued_on': 'payments are not built; section 17 of the build list',
  'invoice.due_on': 'payments are not built',
  'invoice.paid_on': 'payments are not built',
  'payment.event_entry_id': 'payments are not built',
  'payment.provider_ref': 'payments are not built',
  'fee_schedule.period': 'fees are configured but not yet charged',
  'fee_schedule.applies_to': 'fees are configured but not yet charged',
  'fee_schedule.effective_from': 'fees are configured but not yet charged',
  'fee_schedule.effective_to': 'fees are configured but not yet charged',
  'event_entry.fee_id': 'entries are priced but nothing takes money yet',

  'qualification.valid_months': 'qualifications are schema-only so far',
  'qualification.required_for': 'qualifications are schema-only so far',
  'qualification_award.qualification_id': 'qualifications are schema-only so far',
  'qualification_award.expires_on': 'qualifications are schema-only so far',
  'qualification_award.issued_by_org': 'qualifications are schema-only so far',
  'qualification_award.issued_by_other': 'qualifications are schema-only so far',
  'qualification_award.document_asset_id': 'qualifications are schema-only so far',
  'qualification_status.required_for': 'a view over the above',
  'qualification_status.expires_on': 'a view over the above',
  'qualification_status.days_left': 'a view over the above',

  'internal_link.from_kind': 'link checking is not built; section 13',
  'internal_link.from_id': 'link checking is not built',
  'internal_link.resolved': 'link checking is not built',
  'internal_link.checked_at': 'link checking is not built',
  'redirect.hits': 'nothing counts redirect use yet',
  'redirect.last_hit_at': 'nothing counts redirect use yet',

  // --- recorded for the audit trail, never read back ------------------------
  'attendance.recorded_by': 'written for the record; no screen reads it yet',
  'grant_role.granted_at': 'written for the record; no screen reads it yet',
  'rebuild_queue.built_at': 'written by the queue; nothing reports on it yet',

  // --- real gaps, named rather than hidden ----------------------------------
  'brand.crest_asset_id': 'the crest the brand palette was generated from. '
    + 'Uploading one through the media library is not wired up.',
  'grading_record.ratified_by_org': 'national ratification of a dan grade is '
    + 'recorded in the authority rules but not against the record itself.',
  'grading_record.certificate_asset_id': 'no certificate is generated yet.',
  'person_private.medical_notes': 'deliberately has no screen. Writing one '
    + 'means deciding who may read it, and that decision has not been made.',
  'entry_consent.accepted_at': 'the consent row implies the moment; the '
    + 'column duplicates it and nothing writes it.',
  'event_entry.waiver_ok': 'superseded by entry_consent, which records what '
    + 'was agreed rather than a boolean. Should probably be dropped.',
  'event_discipline.allows_team': 'team events are not built.',
  'training_session.min_grade_id': 'a session restricted by grade. Nothing '
    + 'in the editor sets it.',
};

/** Columns every table has, which prove nothing either way. */
const STRUCTURAL = new Set(['id', 'created_at', 'updated_at',
  'organisation_id', 'person_id', 'account_id', 'at', 'parent_id']);

const camel = (s) => {
  const [first, ...rest] = s.split('_');
  return first + rest.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
};

function sources(dir = ROOT, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.claude'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, found);
    // This file is excluded from its own search. Every column name appears in
    // ACCOUNTED_FOR below, so including it meant the check proved that the
    // check mentions them — and reported all forty as used.
    else if (entry.name.endsWith('.mjs') && !entry.name.startsWith('test')
             && entry.name !== 'check-schema-coverage.mjs')
      found.push(full);
  }
  return found;
}

// ---------------------------------------------------------------------------

const blob = sources().map((f) => readFileSync(f, 'utf8')).join('\n');

const { rows } = await pool.query(`
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position`);

const unused = [];
for (const { table_name: table, column_name: col } of rows) {
  if (STRUCTURAL.has(col)) continue;
  const named = new RegExp(`\\b(${col}|${camel(col)})\\b`);
  if (named.test(blob)) continue;
  unused.push(`${table}.${col}`);
}

const unexplained = unused.filter((k) => !(k in ACCOUNTED_FOR));
const stale = Object.keys(ACCOUNTED_FOR).filter((k) => !unused.includes(k));

console.log(`\n${rows.length} columns, ${unused.length} that no source file `
  + `mentions, ${unexplained.length} unaccounted for.`);

if (unexplained.length) {
  console.error('\nThese columns exist and no code touches them:\n');
  for (const k of unexplained) console.error(`  ${k}`);
  console.error(`
Each one is a promise the database makes that nothing keeps. Either wire it
up, drop it, or add it to ACCOUNTED_FOR in tools/check-schema-coverage.mjs
with a reason somebody else would accept.
`);
}

if (stale.length) {
  console.error('\nThese are listed as unused but something now reads them.'
    + '\nRemove them from ACCOUNTED_FOR so the list stays worth reading:\n');
  for (const k of stale) console.error(`  ${k}`);
}

if (!unexplained.length && !stale.length)
  console.log('Every column is either used or accounted for.\n');

await pool.end();
process.exit(unexplained.length || stale.length ? 1 : 0);
