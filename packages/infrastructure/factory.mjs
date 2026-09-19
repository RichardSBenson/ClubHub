/**
 * Which adapters the application uses. The ONLY place that decides.
 *
 * No database configured → files. Configure DATABASE_URL → Postgres.
 * Nothing in the core changes, because the core never knew.
 */

import { JsonData, JsonLadder, JsonRanks, JsonMembers, JsonOrganisations,
         JsonAuthorisation, JsonSiteContent, SystemClock as JsonClock }
  from './json/repositories.mjs';

export const STORE = process.env.DATABASE_URL ? 'postgres' : 'files';

export async function repositories({ dataDir = null } = {}) {
  if (STORE === 'postgres') {
    const { pool } = await import('../api/data.mjs');
    const pg = await import('./postgres/repositories.mjs');
    return {
      store: 'postgres',
      ladder: new pg.PostgresLadder(pool),
      ranks: new pg.PostgresRanks(pool),
      members: new pg.PostgresMembers(pool),
      organisations: new pg.PostgresOrganisations(pool),
      auth: new pg.PostgresAuthorisation(pool),
      site: new pg.PostgresSiteContent(pool),
      clock: new pg.SystemClock(),
      writable: true,
    };
  }

  const dir = dataDir
    ?? process.env.HONBU_DATA
    ?? new URL('../../data/', import.meta.url).pathname;
  const data = new JsonData(dir);

  return {
    store: 'files',
    data,
    ladder: new JsonLadder(data),
    ranks: new JsonRanks(data),
    members: new JsonMembers(data),
    organisations: new JsonOrganisations(data),
    auth: new JsonAuthorisation(data),
    site: new JsonSiteContent(data),
    clock: new JsonClock(),
    writable: false,
  };
}
