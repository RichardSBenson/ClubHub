/**
 * The same use cases, a third time — now backed by files, with no database
 * process running at all.
 */

import { CheckEligibility } from '../core/application/check-eligibility.mjs';
import { AwardGrade } from '../core/application/award-grade.mjs';
import { repositories, STORE } from './factory.mjs';
import { ReadOnlyStore } from './json/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));

delete process.env.DATABASE_URL;
const repos = await repositories();

console.log('\nNO DATABASE CONFIGURED, NOTHING TO PROVISION');
{
  ok('the factory chose files', repos.store === 'files');
  ok('and says it cannot be written to', repos.writable === false);

  const { pool } = await import('../api/data.mjs');
  ok('the database pool was never opened', pool.isOpen === false);
}

console.log('\nTHE PUBLIC SITE RUNS FROM FILES');
{
  const dojos = await repos.organisations.publicDojos('moknz');
  ok('seventeen dojo load', dojos.length === 17, dojos.length);
  const wh = dojos.find(d => d.slug === 'whanganui');
  ok('with their profile attached', wh.venueName === 'Springvale Community Hall');
  ok('and their training sessions', wh.sessions.length === 5, wh.sessions.length);
  ok('an unfilled dojo still loads, with nothing invented',
    dojos.find(d => d.slug === 'milton').venueName === undefined);
}

console.log('\nTHE SAME USE CASE, THIRD ADAPTER');
{
  const moknz = (await repos.organisations.byId(
    (await repos.organisations.publicDojos('moknz'))[0].parentId));
  const check = new CheckEligibility(repos);

  const grades = await repos.ladder.gradesFor(moknz.id);
  ok('the ladder loads from file', grades.length === 15, grades.length);
  ok('in rank order', grades[0].label === '10th kyu'
    && grades.at(-1).label === 'Godan');

  const auth = await repos.ladder.authorityFor(moknz.id, 8);
  ok('authority rules load too', auth?.awardedByType === 'country');
  ok('and still object correctly',
    auth.objectionsTo({ grade: grades[7], awardingOrgType: 'dojo', panel: [] })
      .length === 2);
}

console.log('\nWRITES REFUSE LOUDLY, NOT SILENTLY');
{
  // Reach the write itself, not the permission check in front of it — a test
  // that stops early proves nothing about the store.
  let err = null;
  try {
    await repos.ranks.save({ personId:'p', gradeId:'g', awardedOn:'2026-01-01' });
  } catch (e) { err = e; }
  ok('the store itself refuses to write', err instanceof ReadOnlyStore, err?.name);
  ok('with 503, because this is a deployment state not a user error',
    err.status === 503);
  ok('and an explanation a person can act on',
    err.message.includes('Connect a database'));
  console.log(`      → ${err.message}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
