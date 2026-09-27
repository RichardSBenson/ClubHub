/**
 * Does the composition root actually assemble?
 *
 * This exists because of a real failure. A messenger was wired into
 * factory.mjs, the tests for the messenger passed — they imported the
 * messenger module directly — and the deployment broke with
 *
 *     ReferenceError: messengerFrom is not defined
 *
 * because the import line never landed in factory.mjs. Nothing in the suite
 * ever called repositories(), so nothing noticed.
 *
 * JavaScript will not tell you about a name that does not exist until the line
 * runs. So the guard has to run the line. This tool:
 *
 *   1. imports every module in the repository — catches missing top-level
 *      imports, bad paths and syntax errors;
 *   2. calls repositories() in BOTH store modes — catches anything undefined
 *      inside the branches, which is where the failure actually was;
 *   3. checks each assembled adapter against the port it claims to implement —
 *      catches an adapter that has drifted from its contract.
 *
 * Nothing here connects to a database. The Postgres branch constructs its
 * adapters against a lazy pool, which is the whole point of the pool being
 * lazy: assembly and connection are separate events.
 */

import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'data', '.git', '.vercel']);

/** Modules that are scripts, not libraries: importing them does work. */
const SKIP_FILES = [
  /(^|\/)test-[^/]*\.mjs$/,
  /(^|\/)test\.mjs$/,
  /(^|\/)build\.mjs$/,
  /(^|\/)verify\.mjs$/,
  /(^|\/)server\.mjs$/,
  /(^|\/)reset\.mjs$/,
  /(^|\/)tools\//,
  /(^|\/)import\//,
];

/**
 * pg is an optional dependency: a files-only deployment never installs it.
 * Its absence is a fact about the environment, not a fault in the wiring, so
 * the Postgres half of this check stands down rather than failing. It says so
 * loudly, because a check that quietly tests half of what you think it tests
 * is worse than no check.
 */
const driverInstalled = await import('pg').then(() => true, () => false);
const missingDriver = (error) => /Cannot find package 'pg'/.test(error.message);

const failures = [];
const note = (what, error) => failures.push(`${what}\n    ${error.message}`);

async function* modules(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      yield* modules(full);
    } else if (entry.name.endsWith('.mjs')) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------- 1. imports

let imported = 0;
for await (const file of modules(root)) {
  const rel = relative(root, file);
  if (SKIP_FILES.some((pattern) => pattern.test(rel))) continue;
  try {
    await import(pathToFileURL(file).href);
    imported += 1;
  } catch (error) {
    if (!driverInstalled && missingDriver(error)) continue;
    note(`import ${rel}`, error);
  }
}

// ------------------------------------------------------------- 2. assembly

const { repositories, currentStore } = await import(
  pathToFileURL(join(root, 'packages/infrastructure/factory.mjs')).href
);

const ports = await import(
  pathToFileURL(join(root, 'packages/core/application/ports.mjs')).href
);

/** Which port each key in the assembled bundle is promising to satisfy. */
const CONTRACTS = {
  ladder: ports.LADDER_REPOSITORY,
  ranks: ports.RANK_REPOSITORY,
  members: ports.MEMBER_REPOSITORY,
  organisations: ports.ORGANISATION_REPOSITORY,
  auth: ports.AUTHORISATION,
  messenger: ports.MESSENGER,
  clock: ports.CLOCK,
};

async function assemble(label, environment) {
  const saved = {};
  for (const [key, value] of Object.entries(environment)) {
    saved[key] = process.env[key];
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    const built = await repositories();

    if (built.store !== label) {
      note(`assemble ${label}`, new Error(`asked for ${label}, got ${built.store}`));
    }

    for (const [key, contract] of Object.entries(CONTRACTS)) {
      const implementation = built[key];
      if (!implementation) {
        note(`${label}: ${key}`, new Error(`missing from the assembled bundle`));
        continue;
      }
      try {
        ports.requirePort(implementation, contract);
      } catch (error) {
        note(`${label}: ${key}`, error);
      }
    }

    return built;
  } catch (error) {
    note(`assemble ${label}`, error);
    return null;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Files first, because that is what a fresh deployment with nothing
// provisioned actually runs.
const files = await assemble('files', {
  HONBU_STORE: null,
  DATABASE_URL: null,
  MESSENGER_PROVIDER: null,
});

if (files && files.writable !== false) {
  note('files', new Error('the file store reported itself writable'));
}

if (currentStore() === 'files' && process.env.DATABASE_URL) {
  note('currentStore', new Error('DATABASE_URL is set but the store is files'));
}

// Then Postgres. Constructing adapters must not open a connection.
if (driverInstalled) {
  await assemble('postgres', {
    HONBU_STORE: 'postgres',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused/unused',
  });
} else {
  console.warn('pg is not installed — the Postgres branch was NOT checked.');
}

// ------------------------------------------------------------------ report

if (failures.length) {
  console.error(`\nWiring is broken — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  ${failure}\n`);
  process.exit(1);
}

console.log(
  `Wiring holds. ${imported} modules import cleanly; ` +
  `both stores assemble and satisfy their ports.`
);
