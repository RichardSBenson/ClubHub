/**
 * The database connection. Infrastructure owns this — it used to live in the
 * adapters layer, which was backwards: an HTTP module deciding how the database
 * is reached is the dependency rule pointing the wrong way.
 *
 * Lazy. Nothing connects until something asks for data, so a cold start on a
 * serverless host does not fail before any route runs.
 */

import pg from 'pg';

let _pool = null;

const connect = () => (_pool ??= new pg.Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL,
        // Serverless: many short-lived instances, so keep each one small.
        max: +(process.env.PGPOOL_MAX ?? 3),
        idleTimeoutMillis: 10_000,
        ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } }
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
