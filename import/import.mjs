/**
 * HONBU — CSV import (command line)
 *
 * Loads dojo detail, training times and instructors from the CSVs in /import. The same code runs
 * behind the Register import screen in the app, which is the way to do it on the live site.
 *
 * Rules:
 *  - Blank means unknown. It is stored as NULL, and the site says "to confirm".
 *  - A dojo publishes only when publish=yes AND the facts a visitor needs are present.
 *  - Re-runnable. Importing twice does not duplicate anything.
 *
 * Usage:  node import.mjs dojos.csv [sessions.csv] [instructors.csv]
 */

import fs from 'node:fs';
import { pool } from '../packages/api/data.mjs';
import { applyRegister } from '../packages/api/register-import.mjs';
import { parseCsv } from '../packages/core/domain/register-csv.mjs';

const [dojoFile, sessionFile, instructorFile] = process.argv.slice(2);
if (!dojoFile) {
  console.error('usage: node import.mjs <dojos.csv> [sessions.csv] [instructors.csv]');
  process.exit(1);
}
const read = (f) => (f ? parseCsv(fs.readFileSync(f, 'utf8')) : []);

const client = await pool.connect();
let report;
try {
  await client.query('begin');
  report = await applyRegister(client, { dojos: read(dojoFile), sessions: read(sessionFile), instructors: read(instructorFile) });
  await client.query('commit');
} catch (e) {
  await client.query('rollback');
  throw e;
} finally {
  client.release();
}

for (const n of report.added) console.log(`  + added ${n} to the register`);
for (const n of report.notes) console.log(`  ? ${n}`);
console.log(`\n${report.updated} dojo updated, ${report.published} published`);
if (report.held.length) {
  console.log('\nHeld back — marked publish=yes but missing facts a visitor needs:');
  for (const h of report.held) console.log(`  ${h.slug.padEnd(16)} needs ${h.missing.join(', ')}`);
  console.log('\nA half-filled page is worse than no page. Fill these and re-run.');
}
if (instructorFile) console.log(`Instructors: ${report.people.added} people added, ${report.people.instructors} made instructors, ${report.people.graded} grades recorded.`);

const { rows: [tally] } = await pool.query(`
  select count(*) filter (where published) as live, count(*) as total from dojo_profile`);
console.log(`\nRegister: ${tally.live} of ${tally.total} dojo pages complete.\n`);
await pool.end();
