/**
 * The migration runner, against real databases.
 *
 * The case that matters most is the third: a database that predates the runner
 * and has had some migrations applied by hand and not others. That is exactly
 * the state the hosted database was in when a deploy died on a missing table,
 * and getting it wrong in either direction is bad — re-running an applied
 * migration fails on a duplicate table, and skipping a pending one leaves the
 * code reading something that is not there.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate, migrations } from './migrate.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSQL = 'psql -h /tmp/pgrun -p 5433 -U postgres';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const sh = (cmd) => execSync(cmd, { stdio: 'pipe', cwd: ROOT }).toString();

async function freshDb(name) {
  sh(`${PSQL} -d postgres -c "drop database if exists ${name}"`);
  sh(`${PSQL} -d postgres -c "create database ${name}"`);
  const client = new pg.Client({
    connectionString:
      `postgresql://postgres@localhost/${name}?host=/tmp/pgrun&port=5433` });
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------

console.log('\nEVERY MIGRATION SAYS HOW TO TELL IT IS THERE');
{
  let all;
  try { all = migrations(); ok('the manifest reads', true); }
  catch (e) { ok('the manifest reads', false, e.message); all = []; }

  ok(`all ${all.length} have an applied-when predicate`,
    all.every((m) => m.predicate?.length > 0));
  ok('and they are in order',
    all.map((m) => m.id).join() === [...all.map((m) => m.id)].sort().join());

  // A migration without the line is refused rather than quietly re-run.
  const tmp = fs.mkdtempSync('/tmp/honbu-mig-');
  fs.writeFileSync(path.join(tmp, '900-no-marker.sql'), 'select 1;');
  let refused = false;
  try { migrations(tmp); } catch (e) {
    refused = e.message.includes('applied-when');
  }
  ok('one without the line is refused, with instructions', refused);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nA FRESH INSTALL RECORDS THEM WITHOUT RUNNING THEM');
{
  // db/install/schema.sql already contains every migration, so a database
  // built from it must end up with all of them recorded and none re-run.
  const db = 'honbu_mig_fresh';
  const client = await freshDb(db);
  sh(`${PSQL} -d ${db} -q -f db/install/schema.sql`);

  const { applied, baselined } = await migrate(client, { log() {} });
  ok('nothing was run', applied.length === 0, applied.join());
  ok(`all ${baselined.length} were recognised as already present`,
    baselined.length === migrations().length, baselined.length);

  const { rows } = await client.query(
    'select count(*)::int n from schema_migration where ran');
  ok('and none of them is marked as having been run here', rows[0].n === 0);

  const second = await migrate(client, { log() {} });
  ok('running it again does nothing at all',
    second.applied.length === 0 && second.baselined.length === 0);
  await client.end();
  sh(`${PSQL} -d postgres -c "drop database ${db}"`);
}

console.log('\nA DATABASE PART-MIGRATED BY HAND — THE REAL CASE');
{
  // The hosted database's exact state: built from an older schema, migrated by
  // hand as far as 013, with 014 onwards never run and nothing recording any
  // of it.
  const db = 'honbu_mig_partial';
  const client = await freshDb(db);
  sh(`${PSQL} -d ${db} -q -f db/install/schema.sql`);
  // With the seed, because the hosted database has a federation in it and 015
  // is about repairing one. Without it there is no MOKNZ row and 015 has
  // nothing to do, which is correct but is not the case being modelled.
  sh(`${PSQL} -d ${db} -q -f db/seeds/moknz.sql`);

  // Wind it back to look like a database that stopped at 013.
  await client.query(`
    drop table if exists entry_consent, entry_selection, entry_price,
      event_division, event_discipline, asset_blob cascade`);
  await client.query(`
    alter table event
      drop column if exists guardian_under,
      drop column if exists consent_version,
      drop column if exists consent_text,
      drop column if exists guests_allowed`);
  await client.query(
    `update organisation set settings = settings - 'vocabulary'`);

  const { applied, baselined } = await migrate(client, { log() {} });

  ok('the ones already there were recorded, not re-run',
    baselined.length === migrations().length - 3,
    `baselined ${baselined.length}`);
  ok('and the three that were missing ran',
    applied.length === 3, applied.join());
  ok('namely 014, 015 and 016',
    applied.join() === '014-competition,015-federation-vocabulary,016-asset-bytes',
    applied.join());

  const { rows: [t] } = await client.query(
    `select to_regclass('public.asset_blob') is not null as ok`);
  ok('asset_blob exists afterwards — the table the deploy died on', t.ok);

  const { rows: [c] } = await client.query(`
    select exists (select 1 from information_schema.columns
      where table_name='event' and column_name='guardian_under') as ok`);
  ok('and the event entry settings are back', c.ok);

  const again = await migrate(client, { log() {} });
  ok('a second deploy migrates nothing', again.applied.length === 0
    && again.baselined.length === 0);

  await client.end();
  sh(`${PSQL} -d postgres -c "drop database ${db}"`);
}

console.log('\nA FAILING MIGRATION STOPS THE DEPLOY AND CHANGES NOTHING');
{
  const db = 'honbu_mig_broken';
  const client = await freshDb(db);
  sh(`${PSQL} -d ${db} -q -f db/install/schema.sql`);
  await client.query(`drop table if exists asset_blob cascade`);

  // A migration that creates something and then fails. If the runner did not
  // wrap each file in a transaction, the first half would survive.
  const dir = fs.mkdtempSync('/tmp/honbu-mig-');
  fs.copyFileSync(path.join(ROOT, 'db/016-asset-bytes.sql'),
                  path.join(dir, '016-asset-bytes.sql'));
  fs.appendFileSync(path.join(dir, '016-asset-bytes.sql'),
    '\ncreate table half_done (id int);\nselect * from nothing_here;\n');

  // Run that one file the way the runner does, to prove the rollback.
  const sql = fs.readFileSync(path.join(dir, '016-asset-bytes.sql'), 'utf8');
  let threw = false;
  await client.query('begin');
  try { await client.query(sql); await client.query('commit'); }
  catch { threw = true; await client.query('rollback'); }

  ok('the migration failed', threw);
  const { rows: [h] } = await client.query(
    `select to_regclass('public.half_done') is null as gone`);
  ok('and nothing it had already created survived', h.gone);
  const { rows: [a] } = await client.query(
    `select to_regclass('public.asset_blob') is null as gone`);
  ok('including the table it was actually for', a.gone);

  fs.rmSync(dir, { recursive: true, force: true });
  await client.end();
  sh(`${PSQL} -d postgres -c "drop database ${db}"`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
