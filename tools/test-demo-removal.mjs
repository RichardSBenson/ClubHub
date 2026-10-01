/**
 * "There are 2 other martial arts in my sign-up. There should only be 1."
 *
 * The demonstration federations had been loaded into the hosted database so
 * Honbu could be shown, and they stayed. The blank-slate work fixed new
 * installs and did nothing for the database that already existed — which is
 * the one a real person was signed in to.
 *
 * Builds a database shaped like that one: the real federation, both demos, a
 * real person with access to all three, and the kind of content people add by
 * clicking around. Runs the migration runner. What must be true afterwards is
 * what the person actually asked for.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from './migrate.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSQL = 'psql -h /tmp/pgrun -p 5433 -U postgres';
const NAME = 'honbu_demo_removal';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));
const sh = (cmd) => execSync(cmd, { stdio: 'pipe', cwd: ROOT }).toString();

async function build() {
  sh(`${PSQL} -d postgres -c "drop database if exists ${NAME}"`);
  sh(`${PSQL} -d postgres -c "create database ${NAME}"`);
  // Schema, then the migration ledger as the hosted database has it: every
  // migration before this one recorded as applied.
  sh(`${PSQL} -d ${NAME} -q -f db/install/schema.sql`);
  sh(`${PSQL} -d ${NAME} -q -f db/seeds/moknz.sql`);
  sh(`${PSQL} -d ${NAME} -q -f db/seeds/demo-federations.sql`);
  const c = new pg.Client({
    connectionString: `postgresql://postgres@localhost/${NAME}?host=/tmp/pgrun&port=5433` });
  await c.connect();
  return c;
}
const n = async (c, sql, a = []) => Number((await c.query(sql, a)).rows[0].count);

const c = await build();

// A real person with access to all three, which is how the dashboard came to
// show them. And the things somebody adds while looking around.
const { rows: [me] } = await c.query(
  `insert into account (email) values ('real@example.nz') returning id`);
const { rows: roots } = await c.query(
  `select id, slug from organisation where parent_id is null`);
for (const r of roots)
  await c.query(`insert into grant_role (account_id, organisation_id, role)
                 values ($1,$2,'owner')`, [me.id, r.id]);
const demoRoot = roots.find((r) => r.slug === 'demo-tkd');
await c.query(`insert into page (organisation_id, slug, title, body, status)
  values ($1,'hello','Hello','{"blocks":[]}'::jsonb,'draft')`, [demoRoot.id]);
await c.query(`insert into asset (organisation_id, kind, filename, mime)
  values ($1,'image','x.png','image/png')`, [demoRoot.id]);
await c.query(`insert into account (email) values ('demo+demo-tkd@example.invalid')`);

const realBefore = {
  clubs: await n(c, `select count(*) from organisation o join organisation r
    on o.path <@ r.path where r.slug='moknz'`),
  people: await n(c, `select count(*) from person where display_number not like 'KTF-%'
    and display_number not like 'SCJJ-%'`),
};

console.log('\nTHE DATABASE LOOKS LIKE THE HOSTED ONE');
ok('three federations', roots.length === 3, String(roots.length));
ok('the real person can see all of them', await n(c,
  `select count(*) from grant_role where account_id=$1`, [me.id]) === 3);

console.log('\nRUNNING THE MIGRATIONS');
{
  const logs = [];
  const r = await migrate(c, { log: (l) => logs.push(l) });
  ok('the removal ran', r.applied.includes('022-remove-demo-federations'),
    JSON.stringify(r));
}

console.log('\nWHAT IS LEFT');
{
  const left = (await c.query(
    `select name from organisation where parent_id is null`)).rows.map((x) => x.name);
  ok('one federation, and it is theirs', left.length === 1
    && /Mas Oyama/.test(left[0]), left.join());
  ok('no demonstration settings anywhere', await n(c,
    `select count(*) from organisation where (settings->>'demo')::boolean`) === 0);
  ok('their dashboard would show only that one', await n(c, `
    select count(*) from visible_orgs($1) v join organisation o
      on o.id = v.organisation_id where o.parent_id is null`, [me.id]) === 1);

  ok('the real federation is untouched', await n(c, `select count(*) from organisation o
    join organisation r on o.path <@ r.path where r.slug='moknz'`) === realBefore.clubs);
  ok('and so are its people', await n(c, `select count(*) from person
    where display_number not like 'KTF-%' and display_number not like 'SCJJ-%'`)
    === realBefore.people);
  ok('the real person still has their own access', await n(c,
    `select count(*) from grant_role where account_id=$1`, [me.id]) === 1);
  ok('the real person still exists', await n(c,
    `select count(*) from account where email='real@example.nz'`) === 1);

  ok('no demonstration people remain', await n(c, `select count(*) from person
    where display_number like 'KTF-%' or display_number like 'SCJJ-%'`) === 0);
  ok('nor the demonstration sign-in', await n(c, `select count(*) from account
    where email like 'demo+%@example.invalid'`) === 0);
  ok('nor anything they added', await n(c, `select count(*) from page`) === await n(c,
    `select count(*) from page p join organisation o on o.id=p.organisation_id
     join organisation r on o.path <@ r.path where r.slug='moknz'`));
}

console.log('\nRUNNING IT AGAIN CHANGES NOTHING');
{
  const r = await migrate(c, { log: () => {} });
  ok('nothing is applied twice', r.applied.length === 0);
}

console.log('\nTHE ONE THAT WAS LEFT: A DEMONSTRATION WITH HISTORY');
{
  // The hosted database's state after 022: one demonstration gone, one left
  // because the audit log mentions it, and 022 already on the ledger so it
  // will never run again. Only 023 can finish this.
  await c.end();
  const d = await build();
  await d.query(`create table schema_migration (id text primary key,
    applied_at timestamptz not null default now(), ran boolean not null default true)`);
  for (const f of fs.readdirSync(path.join(ROOT, 'db')).filter((x) => /^\d{3}-.*\.sql$/.test(x))) {
    if (f.startsWith('023')) continue;
    await d.query(`insert into schema_migration (id) values ($1)`, [f.replace(/\.sql$/, '')]);
  }
  await d.query(fs.readFileSync(path.join(ROOT, 'db/022-remove-demo-federations.sql'), 'utf8')
    .replace(/^--.*$/mg, ''));   // as 022 behaved before anybody had history in it

  const { rows: [kaimai] } = await d.query(`select id from organisation where slug='demo-tkd'`);
  const { rows: [bjj] } = await d.query(`select id from organisation where slug='demo-bjj'`);
  ok('both are gone already, as before the history existed', !kaimai && !bjj);
  await d.end();
}

{
  const d = await build();
  const { rows: [real] } = await d.query(
    `insert into account (email) values ('real@example.nz') returning id`);
  const { rows: roots } = await d.query(`select id, slug from organisation where parent_id is null`);
  for (const r of roots)
    await d.query(`insert into grant_role (account_id, organisation_id, role)
                   values ($1,$2,'owner')`, [real.id, r.id]);
  const tkd = roots.find((r) => r.slug === 'demo-tkd');
  const bjj = roots.find((r) => r.slug === 'demo-bjj');

  // Somebody clicked around in the taekwondo one.
  await d.query(`insert into audit_log (account_id, organisation_id, action, entity)
    values ($1,$2,'asset_upload','asset')`, [real.id, tkd.id]);

  await d.query(`create table schema_migration (id text primary key,
    applied_at timestamptz not null default now(), ran boolean not null default true)`);
  for (const f of fs.readdirSync(path.join(ROOT, 'db')).filter((x) => /^\d{3}-.*\.sql$/.test(x))) {
    if (f.startsWith('022') || f.startsWith('023')) continue;
    await d.query(`insert into schema_migration (id) values ($1)`, [f.replace(/\.sql$/, '')]);
  }

  const said = [];
  let threw = null;
  try { await migrate(d, { log: (l) => said.push(l) }); } catch (e) { threw = e; }
  ok('it does not stop the deploy', !threw, threw?.message);
  ok('and the deploy log says what happened to the one it could not delete',
    said.some((l) => /history in the audit log/.test(l)) && said.some((l) => /Closed the demonstration/.test(l)),
    said.join(' | '));

  ok('the one with history is kept, and closed', await n(d,
    `select count(*) from organisation where path <@ 'demo_tkd' and status = 'closed'`) > 0
    && await n(d, `select count(*) from organisation where path <@ 'demo_tkd'
                   and status <> 'closed'`) === 0);
  ok('with its history intact', await n(d,
    `select count(*) from audit_log where organisation_id = $1`, [tkd.id]) === 1);
  ok('the real person can no longer see it', await n(d, `
    select count(*) from visible_orgs($1) v join organisation o on o.id = v.organisation_id
    where o.path <@ 'demo_tkd'`, [real.id]) === 0);
  ok('and their dashboard has one federation on it', await n(d, `
    select count(*) from visible_orgs($1) v join organisation o on o.id = v.organisation_id
    where o.parent_id is null`, [real.id]) === 1);
  ok('the one without history is deleted outright',
    await n(d, `select count(*) from organisation where id = $1`, [bjj.id]) === 0);
  ok('the real federation is untouched', await n(d,
    `select count(*) from organisation where slug='moknz' and status='active'`) === 1);
  ok('nothing of MOKNZ\'s was closed', await n(d,
    `select count(*) from organisation where path <@ 'moknz' and status = 'closed'`) === 0);

  const again = await migrate(d, { log: () => {} });
  ok('running it again does nothing', again.applied.length === 0);
  await d.end();
}

console.log('\nA DATABASE THAT IS ONLY A DEMONSTRATION IS LEFT ALONE');
{
  sh(`${PSQL} -d postgres -c "drop database if exists ${NAME}"`);
  sh(`${PSQL} -d postgres -c "create database ${NAME}"`);
  sh(`${PSQL} -d ${NAME} -q -f db/install/schema.sql`);
  sh(`${PSQL} -d ${NAME} -q -f db/seeds/demo-federations.sql`);
  const e = new pg.Client({
    connectionString: `postgresql://postgres@localhost/${NAME}?host=/tmp/pgrun&port=5433` });
  await e.connect();
  await migrate(e, { log: () => {} });
  ok('somebody evaluating Honbu keeps the demonstration they loaded',
    await n(e, `select count(*) from organisation where parent_id is null`) === 2);
  await e.end();
}

sh(`${PSQL} -d postgres -c "drop database ${NAME}"`);
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
