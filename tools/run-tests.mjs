/**
 * HONBU — THE TEST RUNNER
 *
 * Why this exists. The suite used to be a hand-written chain in package.json:
 *
 *     cd packages/api && node test-auth.mjs && node test-server.mjs && ...
 *
 * A file only ran if somebody remembered to add it to that chain, and nothing
 * ever checked. Thirteen test files — a third of them — had never run once.
 * Among them were real failures. The suite reported "1054 checks passing" and
 * the number was true about the files it knew, which is not the same as true.
 *
 * So the list is gone. This finds every test file on disk and runs it. A new
 * test file is in the suite the moment it is saved, and forgetting is no longer
 * possible.
 *
 * Known failures are declared below rather than skipped. They still run, they
 * are still reported, and the runner fails if one of them starts passing —
 * because a quarantine nobody empties is just a list of things being ignored.
 */
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Failures that exist today, each with the reason and the date it was found.
 * This is a debt register, not a bin. Everything here is a bug to fix or a
 * test to delete — nothing is allowed to sit here quietly forever.
 */
const KNOWN_BROKEN = {
  'packages/api/test-bootstrap.mjs':
    'null accountId — found 2026-09-30, alongside the bootstrap door we are closing anyway',
  'packages/core/test-against-postgres.mjs':
    'date_of_birth comes back a string, not a Date — found 2026-09-30, real and worth chasing',
  'packages/core/test-content-types-postgres.mjs':
    'same date handling as test-against-postgres — found 2026-09-30',
  'packages/core/test-publishing-postgres.mjs':
    'same date handling as test-against-postgres — found 2026-09-30',
  'packages/infrastructure/test-events.mjs':
    'looks for /tmp/002-revisions.sql, a path from the old schema layout — found 2026-09-30',
};

/**
 * Steps that are part of the suite but are not named like tests: the static
 * site has to build before it can be verified. Ordered, and run last.
 */
const EXTRA = [
  'packages/site/build.mjs',
  'packages/site/verify.mjs',
];

/** Every test file on disk, deepest-stable order. */
function discover(dir = ROOT, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist'
        || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) discover(full, found);
    else if (/^test.*\.mjs$/.test(entry.name)) found.push(relative(ROOT, full));
  }
  return found.sort();
}

function run(file) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [file.split('/').pop()], {
    cwd: join(ROOT, dirname(file)),
    encoding: 'utf8',
    timeout: 5 * 60_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const tally = output.match(/^(\d+) passed, (\d+) failed$/m);
  return {
    file,
    ok: result.status === 0,
    passed: tally ? Number(tally[1]) : 0,
    failed: tally ? Number(tally[2]) : 0,
    crashed: !tally,
    seconds: ((Date.now() - started) / 1000).toFixed(1),
    output,
  };
}

// ---------------------------------------------------------------------------

const files = [...discover(), ...EXTRA.filter((f) => existsSync(join(ROOT, f)))];

let passed = 0, failed = 0;
const broke = [];     // failing, and not expected to
const expected = [];  // failing, and declared above
const revived = [];   // declared broken, but passing now

for (const file of files) {
  const r = run(file);
  passed += r.passed;
  failed += r.failed;

  const declared = KNOWN_BROKEN[file];
  const mark = r.ok ? '✓' : '✗';
  const count = r.crashed ? (r.ok ? '' : 'crashed') : `${r.passed}`;

  if (r.ok && declared) revived.push(file);
  else if (!r.ok && declared) expected.push({ ...r, why: declared });
  else if (!r.ok) broke.push(r);

  const tag = !r.ok && declared ? '  (known)' : '';
  console.log(`  ${mark} ${file.padEnd(46)} ${String(count).padStart(7)}  ${r.seconds}s${tag}`);
}

console.log(`\n${files.length} files, ${passed} checks, ${failed} failed`);

for (const r of broke) {
  console.log(`\n─── ${r.file} ${'─'.repeat(Math.max(0, 60 - r.file.length))}`);
  console.log(r.output.trimEnd().split('\n').slice(-25).join('\n'));
}

if (expected.length) {
  console.log('\nKNOWN BROKEN — each of these is a bug to fix or a test to delete:');
  for (const r of expected) console.log(`  · ${r.file}\n      ${r.why}`);
}

if (revived.length) {
  console.log('\nThese are listed as known-broken but passed. Remove them from'
    + '\nKNOWN_BROKEN in tools/run-tests.mjs so they count for real:');
  for (const f of revived) console.log(`  · ${f}`);
}

process.exit(broke.length || revived.length ? 1 : 0);
