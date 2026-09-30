/**
 * HONBU — BRING A DATABASE UP TO THE CODE
 *
 * Run at deploy, before the site builds. Nobody should ever open a SQL file to
 * install this.
 *
 * The thing that made this necessary: a commit shipped that read a table
 * db/016 creates, the migration had not been run against the hosted database,
 * and the deployment died on "relation does not exist" — no indication of
 * which table, which migration, or that the fix was a file sitting in db/. The
 * instruction "deploy the code, then remember to run the migration, in that
 * order" is not something to hand to somebody who bought this.
 *
 * ---------------------------------------------------------------------------
 * How it knows what is already there
 *
 * A database that predates this runner has no record of what has been applied
 * to it. Guessing is not acceptable and re-running is not safe — several of
 * these migrations create tables without `if not exists` and would simply
 * fail.
 *
 * So each migration declares, in its first line, a predicate that is true when
 * it is already in the database:
 *
 *     -- applied-when: select to_regclass('public.asset_blob') is not null
 *
 * The runner asks the database. True means record it and move on; false means
 * run it. That baselines an existing database from evidence rather than from
 * assumption, and it means a fresh install built from db/install/schema.sql —
 * which already contains every migration — records them all without running
 * any of them.
 *
 * A migration without that line is refused. The alternative is a file that
 * quietly re-runs on every deploy.
 *
 * ---------------------------------------------------------------------------
 * What it will not do
 *
 * It does not roll back. A down-migration that has never been tested is a
 * worse position than a forward fix, and it does not create the database or
 * load a schema — `npm run db` does that once, by hand, at install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'db');

/**
 * Only two deployments may migrate the same database at once if one of them
 * wants a corrupt schema. Vercel will happily build two commits in parallel.
 * The number is arbitrary but fixed: it identifies this particular lock.
 */
const LOCK = 8_150_461;

const read = (file) => fs.readFileSync(path.join(DIR, file), 'utf8');

/** Every migration, in order, with the predicate that says it is present. */
export function migrations(dir = DIR) {
  return fs.readdirSync(dir)
    .filter((f) => /^\d{3}-.*\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      // One line, deliberately. A predicate spread over continuation lines
      // silently became "select not exists (select 1 from organisation" —
      // invalid SQL, which the runner read as "not present" and ran a
      // migration that was already applied.
      const m = sql.match(/^--\s*applied-when:\s*(.+)$/mi);
      if (!m) {
        throw new Error(
          `${file} has no "-- applied-when:" line.\n`
          + 'Every migration must say how to tell whether it is already in a '
          + 'database, or the runner cannot know whether to run it. Add a line '
          + 'like:\n\n'
          + "  -- applied-when: select to_regclass('public.my_table') is not null\n");
      }
      return { id: file.replace(/\.sql$/, ''), file, sql, predicate: m[1].trim() };
    });
}

// ---------------------------------------------------------------------------

export async function migrate(client, { log = console.log } = {}) {
  await client.query(`
    create table if not exists schema_migration (
      id          text primary key,
      applied_at  timestamptz not null default now(),
      -- Whether it was run here, or found already present and recorded. The
      -- difference matters when somebody is working out what happened to a
      -- database they did not set up.
      ran         boolean not null default true
    )`);

  const { rows } = await client.query('select id from schema_migration');
  const known = new Set(rows.map((r) => r.id));

  const applied = [], baselined = [], skipped = [];

  for (const m of migrations()) {
    if (known.has(m.id)) { skipped.push(m.id); continue; }

    // Ask the database whether this is already here. A predicate that throws
    // is treated as "not present" — it usually means the table it asks about
    // does not exist, which is the answer.
    let present = false;
    try {
      const { rows: [r] } = await client.query(m.predicate);
      present = Boolean(r && Object.values(r)[0]);
    } catch {
      present = false;
    }

    if (present) {
      await client.query(
        'insert into schema_migration (id, ran) values ($1,false)', [m.id]);
      baselined.push(m.id);
      continue;
    }

    log(`  applying ${m.file}`);
    // Each migration is its own transaction: one that fails leaves the
    // database at the last good migration rather than halfway through this
    // one, and the deploy fails loudly with the file named.
    await client.query('begin');
    try {
      await client.query(m.sql);
      await client.query(
        'insert into schema_migration (id, ran) values ($1,true)', [m.id]);
      await client.query('commit');
      applied.push(m.id);
    } catch (e) {
      await client.query('rollback');
      throw new Error(`${m.file} failed and was rolled back:\n  ${e.message}`);
    }
  }

  return { applied, baselined, skipped };
}

// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.DATABASE_URL) {
    // A build with no database is the files store, which has no schema to
    // migrate. Saying so and succeeding is correct; failing would stop every
    // demo deployment.
    console.log('No DATABASE_URL — nothing to migrate (files store).');
    process.exit(0);
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'insecure'
      ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK]);
    const { applied, baselined, skipped } = await migrate(client);

    if (baselined.length)
      console.log(`  ${baselined.length} already present, recorded: `
        + `${baselined.join(', ')}`);
    if (applied.length) console.log(`  ${applied.length} applied`);
    if (!applied.length && !baselined.length)
      console.log(`Database is up to date (${skipped.length} migrations).`);
  } catch (e) {
    console.error(`\nMigration failed.\n\n${e.message}\n`);
    process.exitCode = 1;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    await client.end();
  }
}
