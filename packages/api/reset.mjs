/** Rebuild the database from schema + seed. Tests must start from a known state. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const PSQL = 'psql -h /tmp/pgrun -p 5433 -U postgres';
const run = (cmd) => execSync(cmd, { stdio: 'pipe' }).toString();

for (const f of ['../../db/schema.sql', '../../db/seed-moknz.sql']) {
  fs.copyFileSync(new URL(f, import.meta.url), `/tmp/${f.split('/').pop()}`);
}
run(`su postgres -c "${PSQL} -c 'drop database if exists honbu' -c 'create database honbu'"`);
run(`su postgres -c "${PSQL} -d honbu -v ON_ERROR_STOP=1 -f /tmp/schema.sql"`);
run(`su postgres -c "${PSQL} -d honbu -v ON_ERROR_STOP=1 -f /tmp/seed-moknz.sql"`);
console.log('database reset\n');
