/**
 * A kung fu federation stands up its own install.
 *
 * Starts from a database with NOTHING in it — schema only, no seed, no MOKNZ
 * — and checks that what comes out is theirs and contains no trace of anybody
 * else's. That last part is the whole test: the reason this work exists is
 * that a new customer used to find seventeen karate dojo and a man called
 * Hanshi Doug already in their database.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import pg from 'pg';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const DB = 'honbu_found_test';
const PSQL = 'psql -h /tmp/pgrun -p 5433 -U postgres';
const run = (cmd) => execSync(`su postgres -c "${cmd}"`, { stdio: 'pipe' }).toString();

// An empty database with only the structure in it.
const schema = new URL('../db/install/schema.sql', import.meta.url).pathname;
fs.copyFileSync(schema, '/tmp/install-schema.sql');
fs.chmodSync('/tmp/install-schema.sql', 0o644);
run(`${PSQL} -d postgres -q -c 'drop database if exists ${DB} with (force)'`);
run(`${PSQL} -d postgres -q -c 'create database ${DB}'`);
run(`${PSQL} -d ${DB} -q -v ON_ERROR_STOP=1 -f /tmp/install-schema.sql`);

process.env.DATABASE_URL = `postgresql://postgres@localhost/${DB}?host=/tmp/pgrun&port=5433`;
process.env.PGSSL = 'off';

const { found } = await import('./found.mjs');
const { pool } = await import('../packages/infrastructure/postgres/pool.mjs');
const q = async (sql, a = []) => (await pool.query(sql, a)).rows;
const one = async (sql, a = []) => (await q(sql, a))[0] ?? null;

// ---------------------------------------------------------------------------

console.log('\nTHE DATABASE STARTS GENUINELY EMPTY');
{
  ok('the tables are all there',
    (await q(`select tablename from pg_tables where schemaname='public'`)).length > 30,
    String((await q(`select tablename from pg_tables where schemaname='public'`)).length));
  ok('and not one organisation is in it',
    (await q('select * from organisation')).length === 0);
  ok('nor one person', (await q('select * from person')).length === 0);
  ok('nor one grade', (await q('select * from grade')).length === 0);
  ok('the functions the register depends on exist', !!await one(
    `select proname from pg_proc where proname = 'has_role_at'`));
}

console.log('\nFOUNDING A KUNG FU FEDERATION');
{
  const { organisation, account, vocabulary } = await found({
    name: 'British Kung Fu Association', art: 'Kung Fu', country: 'GB',
    email: 'secretary@bkfa.org.uk',
  }, { quiet: true });

  ok('the federation exists', organisation.name === 'British Kung Fu Association');
  ok('with a web address made from its name',
    organisation.slug === 'british-kung-fu-association', organisation.slug);
  ok('short name from the initials', organisation.short_name === 'BKFA',
    organisation.short_name);
  ok('at the top of its own tree', organisation.parent_id === null);
  ok('with the right country', organisation.country_code === 'GB');
  ok('and a timezone that follows from it',
    organisation.timezone === 'Europe/London', organisation.timezone);

  ok('their clubs are kwoons, not dojos',
    vocabulary.clubPlural === 'Kwoons', JSON.stringify(vocabulary));
  ok('their instructors are sifu, not sensei',
    vocabulary.instructor === 'Sifu', vocabulary.instructor);
  ok('and the words are stored where the admin and the site both read them',
    (await one('select settings from organisation where id=$1',
      [organisation.id])).settings.vocabulary.club === 'Kwoon');

  ok('the secretary owns the install', !!account && await one(
    `select 1 from grant_role where account_id=$1 and role='owner'`,
    [account.id]));
  ok('they need never have trained — the account has no person',
    account.person_id === null);
}

console.log('\nNOTHING OF ANYBODY ELSE\'S IS IN THERE');
{
  // The thing this whole change exists to prevent.
  for (const [table, what] of [
    ['organisation', 'organisations'], ['person', 'people'],
    ['grade', 'grades'], ['title', 'titles'], ['event', 'events'],
    ['article', 'articles'], ['dojo_profile', 'club profiles'],
    ['qualification', 'qualifications'], ['brand', 'brands'],
  ]) {
    const rows = await q(`select * from ${table}`); /* security-ok: table comes from a literal list in this test */
    const text = JSON.stringify(rows).toLowerCase();
    ok(`no karate ${what}`,
      !text.includes('moknz') && !text.includes('oyama')
      && !text.includes('kyokushin') && !text.includes('holloway'),
      `${table} mentions it`);
  }

  ok('exactly one organisation, theirs',
    (await q('select * from organisation')).length === 1);
  ok('and one account, theirs',
    (await q('select * from account')).length === 1);
  ok('no dojo called Whanganui or anything else',
    (await q(`select * from organisation where type='club'`)).length === 0);
}

console.log('\nTHEY CAN GRADE SOMEBODY ON DAY ONE');
{
  const grades = await q('select * from grade order by rank_order');
  ok('there is a ladder', grades.length === 3, String(grades.length));
  // Kung fu's word for a grade is "level", so that is what the ladder says.
  ok('in their words, not karate\'s',
    grades.every((g) => g.label.includes('level'))
    && !grades.some((g) => /kyu|dan|belt/i.test(g.label)),
    grades.map((g) => g.label).join(', '));
  ok('with gaps in the numbering so they can insert their own',
    grades[1].rank_order - grades[0].rank_order > 1,
    grades.map((g) => g.rank_order).join(','));
  ok('and somebody is allowed to award them',
    (await q('select * from grade_authority')).length === 1);
  ok('permissively, so nothing is blocked before they configure it',
    (await one('select * from grade_authority')).min_panel_size === 1);
}

console.log('\nTHEIR WEBSITE IS NOT AN EMPTY SHELL');
{
  const page = await one('select * from page');
  ok('there is a page to edit', !!page);
  ok('naming them', page.title.includes('British Kung Fu Association'));
  ok('it is a draft, not published without them asking',
    page.status === 'draft', page.status);
  ok('and it pulls their clubs and events in once they have some',
    JSON.stringify(page.body).includes('dojoList')
    && JSON.stringify(page.body).includes('eventList'));
}

console.log('\nIT WILL NOT RUN TWICE');
{
  let refused = null;
  try {
    await found({ name: 'Someone Else', art: 'Judo', country: 'NZ',
      email: 'other@example.com' }, { quiet: true });
  } catch (e) { refused = e; }

  ok('a second founding is refused', !!refused, 'it ran again');
  ok('naming who is already here',
    refused?.message.includes('British Kung Fu Association'), refused?.message);
  ok('and says what to do instead',
    refused?.message.includes('empty database'), refused?.message);
  ok('nothing was written', (await q('select * from organisation')).length === 1);
  ok('not even half of it', (await q('select * from account')).length === 1);
}

console.log('\nWHAT IT WILL NOT ACCEPT');
{
  const refuse = async (answers) => {
    try { await found(answers, { quiet: true }); return null; }
    catch (e) { return e; }
  };
  ok('no name', (await refuse({ art: 'Judo', email: 'a@b.nz' }))
    ?.problems?.some((p) => p.includes('name')));
  ok('no art — it decides the vocabulary',
    (await refuse({ name: 'X', email: 'a@b.nz' }))
      ?.problems?.some((p) => p.includes('martial art')));
  ok('no administrator', (await refuse({ name: 'X', art: 'Judo' }))
    ?.problems?.some((p) => p.includes('administrator')));
  ok('an email that is not one',
    (await refuse({ name: 'X', art: 'Judo', email: 'not-an-email' }))
      ?.problems?.some((p) => p.includes('does not look like')));
  ok('a country code that is not one',
    (await refuse({ name: 'X', art: 'Judo', email: 'a@b.nz',
      country: 'Britain' }))?.problems?.some((p) => p.includes('two-letter')));
  ok('every problem at once, not the first',
    (await refuse({}))?.problems?.length >= 3);
}

console.log('\nOTHER ARTS GET THEIR OWN WORDS');
{
  const { vocabularyFor, NEUTRAL_VOCABULARY } =
    await import('../packages/core/domain/founding.mjs');
  for (const [art, word] of [
    ['Karate', 'Dojo'], ['Taekwondo', 'Dojang'], ['Kung Fu', 'Kwoon'],
    ['Brazilian Jiu-Jitsu', 'Academy'], ['BJJ', 'Academy'],
    ['Muay Thai', 'Gym'],
    // The one that was wrong: "brazilian jiu-jitsu" contains "jiu-jitsu",
    // which is Japanese, so list order put a BJJ academy in a dojo.
    ['Japanese Jiu-Jitsu', 'Dojo'],
    ['Capoeira', 'Group'], ['Pencak Silat', 'School'],
  ]) {
    ok(`${art} trains at a ${word.toLowerCase()}`,
      vocabularyFor(art).club === word, vocabularyFor(art).club);
  }
  ok('an art nobody anticipated gets neutral words, never somebody else\'s',
    vocabularyFor('Bartitsu').club === NEUTRAL_VOCABULARY.club,
    vocabularyFor('Bartitsu').club);
  ok('and so does no art at all',
    vocabularyFor('').club === 'Club');
}

// ---------------------------------------------------------------------------

await pool.end();
run(`${PSQL} -d postgres -q -c 'drop database if exists ${DB} with (force)'`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
