/**
 * Rebuild the database from the canonical setup file. Tests must start from a
 * known state, and the state they should know is the one production has.
 *
 * Loads db/install/schema.sql — every table, function and migration, and no
 * federation's data — then db/seeds/moknz.sql, which is customer zero's
 * register. The two were one file until the install was separated out, and a
 * database built from the halves is byte-identical to one built from the
 * whole: the split was checked with pg_dump, not assumed.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

// -d postgres explicitly: without it psql honours PGDATABASE from the
// environment, connects to honbu, and then cannot drop the database it is
// sitting in. Inheriting the connection you are about to destroy is not a
// thing to leave to whatever the shell happens to export.
const PSQL = 'psql -h /tmp/pgrun -p 5433 -U postgres';
const ADMIN = `${PSQL} -d postgres`;
const run = (cmd) => execSync(cmd, { stdio: 'pipe' }).toString();

// Structure first, then one customer's data. They used to be one file, which
// is why a new federation's install had seventeen karate dojo in it.
const files = ['../../db/install/schema.sql', '../../db/seeds/moknz.sql'];
if (process.env.HONBU_SEED_DEMOS) files.push('../../db/seeds/demo-federations.sql');

for (const f of files) {
  fs.copyFileSync(new URL(f, import.meta.url), `/tmp/${f.split('/').pop()}`);
}

// Two calls, not one psql with two -c flags: DROP DATABASE and CREATE
// DATABASE cannot share a transaction, and whether psql gives them one depends
// on the version. Separate invocations are unambiguous.
//
// WITH (FORCE) because a connection left open by the previous test file makes
// an ordinary drop fail with "database is being accessed by other users", and
// a test helper that fails intermittently is worse than no test helper.
run(`su postgres -c "${ADMIN} -c 'drop database if exists honbu with (force)'"`);
run(`su postgres -c "${ADMIN} -c 'create database honbu'"`);
for (const f of files) {
  const name = f.split('/').pop();
  run(`su postgres -c "${PSQL} -d honbu -v ON_ERROR_STOP=1 -f /tmp/${name}"`);
}
console.log('database reset\n');
