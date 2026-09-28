/**
 * The database connection. Infrastructure owns this — it used to live in the
 * adapters layer, which was backwards: an HTTP module deciding how the database
 * is reached is the dependency rule pointing the wrong way.
 *
 * Lazy. Nothing connects until something asks for data, so a cold start on a
 * serverless host does not fail before any route runs.
 */

import pg from 'pg';

/**
 * How the database connection is verified.
 *
 * This used to be `{ rejectUnauthorized: false }`, which encrypts the
 * connection and then accepts whatever certificate answers — so anything
 * positioned between here and the database could present its own and read the
 * lot. That is the whole register: names, dates of birth, children's details.
 * Encryption without verification is not much of a guarantee.
 *
 * Verification is on. The connection string's own sslmode is not consulted,
 * because passing an explicit ssl option overrides it — which also makes this
 * immune to pg v9 changing what `sslmode=require` means. pg 8 currently treats
 * require as verify-full; pg 9 will adopt libpq semantics, where it verifies
 * nothing. Deciding here rather than in a URL means that change cannot quietly
 * weaken us.
 *
 * PGSSL=off turns TLS off altogether, for a database reached over a socket.
 * PGSSL=insecure restores the old unverified behaviour — a way out if a host's
 * certificate cannot be verified, not something to set and forget.
 */
function sslOption() {
  if (process.env.PGSSL === 'off') return false;
  if (process.env.PGSSL === 'insecure') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

let _pool = null;

const connect = () => (_pool ??= new pg.Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL,
        // Serverless: many short-lived instances, so keep each one small.
        max: +(process.env.PGPOOL_MAX ?? 3),
        idleTimeoutMillis: 10_000,
        ssl: sslOption() }
    : { host: process.env.PGHOST ?? '/tmp/pgrun',
        port: +(process.env.PGPORT ?? 5433),
        user: process.env.PGUSER ?? 'postgres',
        database: process.env.PGDATABASE ?? 'honbu' }));

export const pool = {
  query: (...args) => connect().query(...args),
  connect: () => connect().connect(),
  end: async () => { if (_pool) { await _pool.end(); _pool = null; } },
  get isOpen() { return _pool !== null; },
};
