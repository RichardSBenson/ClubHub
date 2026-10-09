/**
 * HONBU — data access
 *
 * Every function that touches an organisation takes an `actor` and checks permission in SQL, not in the caller.
 * There is no way to query a branch you do not have a grant on, because the check is in the query itself.
 *
 * The code lives in ./data/, one file per subject; this file is the one place the rest of the application imports
 * it from, so splitting or moving a subject never changes a caller.
 */

export { pool } from '../infrastructure/postgres/pool.mjs';
export * from './data/attendance.mjs';
export * from './data/billing.mjs';
export * from './data/content.mjs';
export * from './data/events.mjs';
export * from './data/forms.mjs';
export * from './data/grading.mjs';
export * from './data/messaging.mjs';
export * from './data/organisations.mjs';
export * from './data/people.mjs';
export * from './data/reporting.mjs';
export * from './data/shared.mjs';
export * from './data/visitors.mjs';
