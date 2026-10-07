/**
 * THE PROOF.
 *
 * The same use case objects, constructed with Postgres adapters instead of
 * in-memory ones. Not one line of core code changes. If the inversion were
 * decorative rather than real, this file could not exist.
 */

import '../api/reset.mjs';          // tests own their state; no leftovers
import { pool } from '../infrastructure/postgres/pool.mjs';
import { CheckEligibility } from './application/check-eligibility.mjs';
import { AwardGrade } from './application/award-grade.mjs';
import { Refused, NotPermitted } from './application/ports.mjs';
import { PostgresLadder, PostgresRanks, PostgresMembers,
         PostgresOrganisations, PostgresAuthorisation, PostgresTitles,
         SystemClock }
  from '../infrastructure/postgres/repositories.mjs';
import { InMemoryLadder, InMemoryRanks, InMemoryMembers,
         InMemoryOrganisations, AllowAll, FixedClock }
  from '../infrastructure/memory/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const throws = async (n,fn,T,m) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — did not throw`); }
  catch (e) { (e instanceof T && (!m || e.message.includes(m)))
    ? (pass++, console.log(`  ✓ ${n} — ${e.message}`))
    : (fail++, console.log(`  ✗ ${n} — ${e.name}: ${e.message}`)); }
};

const id = async (sql, p=[]) => (await pool.query(sql,p)).rows[0];
const moknz = (await id(`select id from organisation where slug='moknz'`)).id;
const whanganui = (await id(`select id from organisation where slug='whanganui'`)).id;
const AROHA = '22222222-0000-0000-0000-000000000002';
const DOUG_ACCOUNT = '33333333-0000-0000-0000-000000000001';
const DOUG = '22222222-0000-0000-0000-000000000001';
const TANE = '22222222-0000-0000-0000-000000000003';

const pg = {
  ladder: new PostgresLadder(pool),
  ranks: new PostgresRanks(pool),
  members: new PostgresMembers(pool),
  organisations: new PostgresOrganisations(pool),
  auth: new PostgresAuthorisation(pool),
  // AwardGrade grew a titles port — a panel member's authority depends on the
  // titles they hold, not only their grade. This file never ran, so nothing
  // said it was missing.
  titles: new PostgresTitles(pool),
  clock: new SystemClock(),
};

console.log('\nTHE SAME USE CASE, WIRED TO POSTGRES');
{
  const check = new CheckEligibility(pg);
  const v = await check.execute({ personId: AROHA, federationId: moknz });
  ok('eligibility runs against the real database',
    v.known && v.holds === '4th kyu' && v.next === '3rd kyu');
  ok('and reaches the same verdict', v.eligible === true, v.reasons?.join());
  console.log(`      → holds ${v.holds}, due ${v.next}, eligible ${v.eligible}`);
  console.log('      → ' + v.requirements
    .map(r => `${r.name} ${r.has}/${r.needs}`).join(', '));
}

console.log('\nAUTHORITY RULES HOLD AGAINST REAL DATA');
{
  // MOKNZ's real authority table, which is data and not code:
  //
  //   ranks  1–8   awarded by a dojo,    ratified nationally, panel of 1
  //   ranks  9–10  awarded by a dojo,    ratified nationally, panel of 1
  //   ranks 11–18  awarded by the country,                    panel of 3
  //
  // Kyu grades are a dojo's business and dan grades are the federation's,
  // which is how Kyokushin has always done it. This file was written against
  // an earlier table where 3rd kyu was national, and asserted the opposite of
  // what the register now says. It never ran, so it never disagreed.
  const award = new AwardGrade(pg);
  const grade = async (label) => (await id(
    `select id from grade where label=$2 and organisation_id=$1`,
    [moknz, label])).id;
  const thirdKyu = await grade('3rd kyu');   // rank 8  — a dojo grade
  const shodan   = await grade('1st dan');    // rank 11 — a national grade

  await throws('a dojo cannot award a dan grade', () =>
    award.execute({ actorId: DOUG_ACCOUNT, personId: AROHA, gradeId: shodan,
      awardingOrgId: whanganui, awardedOn:'2026-10-17',
      panel:[{personId:DOUG},{personId:TANE}] }),
    Refused, 'must be awarded by a country');

  await throws('nor can the country award a kyu grade', () =>
    award.execute({ actorId: DOUG_ACCOUNT, personId: AROHA, gradeId: thirdKyu,
      awardingOrgId: moknz, awardedOn:'2026-10-17', panel:[{personId:DOUG}] }),
    Refused, 'must be awarded by a club');

  await throws('a dan panel of two is refused where three are required', () =>
    award.execute({ actorId: DOUG_ACCOUNT, personId: AROHA, gradeId: shodan,
      awardingOrgId: moknz, awardedOn:'2026-10-17',
      panel:[{personId:DOUG},{personId:TANE}] }),
    Refused, 'panel of 3');

  const TANE_ACCOUNT = '33333333-0000-0000-0000-000000000003';
  await throws('a Wellington admin cannot record a Whanganui grading', () =>
    award.execute({ actorId: TANE_ACCOUNT, personId: AROHA, gradeId: thirdKyu,
      awardingOrgId: whanganui, awardedOn:'2026-10-17',
      panel:[{personId:DOUG}] }), NotPermitted);

  const out = await award.execute({ actorId: DOUG_ACCOUNT, personId: AROHA,
    gradeId: thirdKyu, awardingOrgId: whanganui, awardedOn:'2026-09-17',
    panel:[{personId:DOUG}] });
  ok('a valid grading writes to the register', !!out.record.id);
  ok('and the register agrees afterwards',
    (await id(`select g.label as grade_label from person_current_grade cg
      join grade g on g.id=cg.grade_id where cg.person_id=$1`, [AROHA]))
      .grade_label === '3rd kyu');
  await pool.query('delete from grading_record where id=$1', [out.record.id]);
}

console.log('\nBOTH ADAPTERS, IDENTICAL BEHAVIOUR');
{
  // Same scenario expressed twice: once in memory, once in Postgres.
  const memory = new CheckEligibility({
    ladder: new InMemoryLadder({ grades: [
      { id:'g7', label:'4th kyu', rankOrder:7, minMonthsAtPrevious:6,
        minSessions:48, minAge:7 },
      { id:'g8', label:'3rd kyu', rankOrder:8, minMonthsAtPrevious:6,
        minSessions:48, minAge:8 },
    ]}),
    ranks: new InMemoryRanks([{ personId:'x', gradeId:'g7',
      awardedOn:'2024-10-19', awardedByOrgId:'o' }], new Map([['g7',7],['g8',8]])),
    members: new InMemoryMembers([{ id:'x', dateOfBirth:'2011-08-04' }],
      { x: 192 }),
    clock: new FixedClock('2026-09-17'),
  });
  const a = await memory.execute({ personId:'x', federationId:'f' });

  const postgres = new CheckEligibility(pg);
  const b = await postgres.execute({ personId: AROHA, federationId: moknz,
    on: '2026-09-17' });

  ok('same holds', a.holds === b.holds);
  ok('same next grade', a.next === b.next);
  ok('same verdict', a.eligible === b.eligible);
  ok('same requirement names',
    a.requirements.map(r=>r.name).join() === b.requirements.map(r=>r.name).join());
  console.log(`      → memory: ${a.holds} → ${a.next}, eligible ${a.eligible}`);
  console.log(`      → postgres: ${b.holds} → ${b.next}, eligible ${b.eligible}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
