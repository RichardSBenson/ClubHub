/**
 * WHAT SOMEBODY GETS ON THE DAY THEY INSTALL THIS
 *
 * "Why am I seeing taekwondo and BJJ on this one platform — imagine I have
 * just purchased this, I do not want to see anything, it needs to be a blank
 * slate just like a fresh WordPress installation."
 *
 * That was right, and it was three separate faults pointing the same way:
 *
 *   - the build carried a list of sites in a source file, so every install
 *     published MOKNZ at the root with a taekwondo and a jiu-jitsu demo
 *     underneath, whatever was actually in the database
 *   - `npm run db`, the documented install step, loaded MOKNZ's whole
 *     register — seventeen clubs, a named instructor, a belt system
 *   - and with nothing in the database the build crashed writing a sitemap
 *     into a directory it had not created, so a first deploy failed
 *
 * This runs the install the way the instructions say to, against a database
 * that has never been touched, and checks that what comes out is empty.
 * It is the one test that fails if somebody later adds a convenient default.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSQL = 'psql -h /tmp/pgrun -p 5433 -U postgres';
const DB = 'honbu_fresh_install';
const OUT = '/tmp/honbu-fresh-install';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));
const sh = (cmd, env = {}) => execSync(cmd, {
  cwd: ROOT, stdio: 'pipe', env: { ...process.env, ...env } }).toString();
// One line, because JSON.stringify turns a newline into a literal \n and
// psql reads a backslash at the start of a line as one of its own commands.
const q = (sql, db = DB) =>
  sh(`${PSQL} -d ${db} -tAc ${JSON.stringify(sql.replace(/\s+/g, ' ').trim())}`)
    .trim();

const url = `postgresql://postgres@localhost/${DB}?host=/tmp/pgrun&port=5433`;
const asFresh = { HONBU_STORE: 'postgres', PGSSL: 'off', DATABASE_URL: url,
                  OUT, FEDERATION: '' };

sh(`${PSQL} -d postgres -c "drop database if exists ${DB}"`);
sh(`${PSQL} -d postgres -c "create database ${DB}"`);
fs.rmSync(OUT, { recursive: true, force: true });

// ---------------------------------------------------------------------------

console.log('\nTHE DOCUMENTED INSTALL BRINGS NOTHING WITH IT');
{
  // Exactly what `npm run db` does, against the new database.
  sh(`${PSQL} -d ${DB} -q -f db/install/schema.sql`);

  ok('the schema is there', Number(q(`
    select count(*) from information_schema.tables
    where table_schema='public'`)) > 20);

  ok('and not one organisation came with it',
    q('select count(*) from organisation') === '0',
    `${q('select count(*) from organisation')} organisations`);
  ok('nor a person', q('select count(*) from person') === '0');
  ok('nor a grade', q('select count(*) from grade') === '0');
  ok('nor an account', q('select count(*) from account') === '0');
  ok('nor a page', q('select count(*) from page') === '0');

  // The install script itself must not mention anybody's seed.
  const scripts = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  ok('and `npm run db` does not load a seed',
    !/seeds\//.test(scripts.db), scripts.db);
  ok('the example register is a separate, clearly named command',
    /seeds\/moknz/.test(scripts['db:example'] ?? ''));
  ok('and so are the demonstrations',
    /seeds\/demo/.test(scripts['db:demos'] ?? ''));
}

console.log('\nBUILDING AN EMPTY INSTALL SUCCEEDS');
{
  let built = true;
  try { sh('node packages/site/build.mjs', asFresh); }
  catch (e) { built = false; console.log(`      ${e.stderr?.toString().slice(-300)}`); }
  ok('the build does not fail on a database with nothing in it', built);

  ok('there is an output directory, so a deploy has something to publish',
    fs.existsSync(OUT));
  const index = path.join(OUT, 'index.html');
  ok('with a page on it', fs.existsSync(index));

  const html = fs.existsSync(index) ? fs.readFileSync(index, 'utf8') : '';
  ok('saying nothing is set up yet', /Nothing here yet/.test(html));
  ok('and how to set it up', /npm run found/.test(html));
  ok('kept out of search engines until it is real',
    /noindex/.test(html)
    && /Disallow/.test(fs.readFileSync(path.join(OUT, 'robots.txt'), 'utf8')));
}

console.log('\nNOBODY ELSE\'S FEDERATION IS ANYWHERE IN IT');
{
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full); else files.push(full);
    }
  };
  if (fs.existsSync(OUT)) walk(OUT);

  const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const word of ['Mas Oyama', 'MOKNZ', 'Kyokushin', 'Taekwondo',
                      'Jiu-Jitsu', 'Whanganui', 'Doug']) {
    ok(`no mention of ${word}`, !text.includes(word), 'LEAKED into a new install');
  }
  ok('and no page was published for anybody', files.length <= 2,
    files.map((f) => path.relative(OUT, f)).join(', '));
}

console.log('\nONCE A FEDERATION EXISTS, IT IS THE ONLY ONE PUBLISHED');
{
  // Muay Thai, deliberately. An aikido federation calling its places dojos is
  // correct — aikido trains in a dojo — so it proved nothing. A Muay Thai
  // federation calling them dojos would mean the install had borrowed
  // karate's word from somewhere.
  sh('node tools/found.mjs --name "Taranaki Muay Thai" --art "Muay Thai"'
    + ' --country NZ --email secretary@example.org', asFresh);

  ok('founding wrote exactly one federation',
    q(`select count(*) from organisation where parent_id is null`) === '1');

  fs.rmSync(OUT, { recursive: true, force: true });
  sh('node packages/site/build.mjs', asFresh);

  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  ok('the site at the root is theirs', html.includes('Taranaki Muay Thai'));
  ok('and the placeholder is gone', !/Nothing here yet/.test(html));
  ok('nothing is published under /demo', !fs.existsSync(path.join(OUT, 'demo')));
  ok('nor under /f', !fs.existsSync(path.join(OUT, 'f')));

  // Their own words, not somebody else's.
  ok('it uses their art\'s word for a place to train',
    html.includes('Find a gym'), 'did not use the art\'s own word');
  ok('and not karate\'s', !html.includes('Find a dojo'),
    'borrowed another art\'s word');

  // data/settings.json in this repository describes MOKNZ. It must not reach
  // somebody else's site.
  for (const word of ['Mas Oyama', 'MOKNZ', 'Kyokushin', '1965']) {
    ok(`no trace of ${word} on their site`, !html.includes(word),
      'the deployment settings file leaked');
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
sh(`${PSQL} -d postgres -c "drop database ${DB}"`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
