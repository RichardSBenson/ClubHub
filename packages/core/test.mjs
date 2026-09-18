/**
 * The point of this file: EVERY test runs the real use cases with no database,
 * no HTTP and no I/O of any kind. If the core were coupled to infrastructure,
 * none of this would be possible.
 */

import { CheckEligibility } from './application/check-eligibility.mjs';
import { AwardGrade } from './application/award-grade.mjs';
import { Refused, NotPermitted } from './application/ports.mjs';
import { RankOrder, MemberNumber, GradingDate, Age, DomainError }
  from './domain/values.mjs';
import { Grade, GradingAuthority, RankHistory, GradingRecord } from './domain/rank.mjs';
import { InMemoryLadder, InMemoryRanks, InMemoryMembers, InMemoryOrganisations,
         AllowAll, DenyAll, FixedClock }
  from '../infrastructure/memory/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const throws = async (n, fn, Type, match) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — did not throw`); }
  catch (e) {
    const right = e instanceof Type && (!match || e.message.includes(match));
    right ? (pass++, console.log(`  ✓ ${n} — ${e.message}`))
          : (fail++, console.log(`  ✗ ${n} — ${e.name}: ${e.message}`));
  }
};

console.log('\nVALUE OBJECTS ENFORCE THEIR OWN RULES');
{
  ok('a rank order must be a positive whole number',
    (() => { try { RankOrder.of(0); return false; } catch { return true; } })());
  ok('ranks compare', RankOrder.of(11).isAbove(RankOrder.of(10)));
  ok('member numbers are normalised', MemberNumber.of(' nz-0417 ').value === 'NZ-0417');
  ok('and validated',
    (() => { try { MemberNumber.of('417'); return false; } catch { return true; } })());
  ok('country prefix is readable', MemberNumber.of('JP-0001').countryCode === 'JP');
  ok('a grading date drops the time',
    GradingDate.of('2026-10-17T23:30:00Z').value === '2026-10-17');
  ok('months between dates are whole months',
    GradingDate.of('2024-10-19').monthsUntil('2026-09-17') === 22);
  ok('age is derived on a given day',
    Age.onDate('2011-08-04', '2026-09-17') === 15);
  ok('and is 14 the day before the birthday',
    Age.onDate('2011-08-04', '2026-08-03') === 14);
}

console.log('\nTHE LADDER AND AUTHORITY ARE DOMAIN OBJECTS');
{
  const shodan = new Grade({ id:'g11', label:'Shodan', rankOrder:11, isDan:true,
    minMonthsAtPrevious:12, minAge:16, minSessions:96 });
  const reqs = shodan.requirementsFor({
    heldSince:'2025-10-18', sessionsSince:40, dateOfBirth:'2011-08-04',
    on:'2026-09-17' });
  ok('every requirement is reported, not just the first',
    reqs.length === 3 && reqs.filter(r => !r.met).length === 3);
  ok('each says how far short', reqs.every(r => r.shortfall != null));
  console.log('      → ' + reqs.map(r => `${r.name} ${r.has}/${r.needs}`).join(', '));

  const auth = new GradingAuthority({ fromRankOrder:11, toRankOrder:15,
    awardedByType:'country', ratifiedByType:'international',
    minPanelSize:3, minPanelRank:14 });
  ok('an authority covers a range', auth.covers(11) && auth.covers(15) && !auth.covers(10));
  const objections = auth.objectionsTo({ grade: shodan, awardingOrgType:'dojo',
    panel:[{personId:'a',rankOrder:12}] });
  ok('it objects to everything wrong at once', objections.length === 3, objections.length);
  objections.forEach(o => console.log('      → ' + o));

  ok('a backwards range is rejected',
    (() => { try { new GradingAuthority({ fromRankOrder:5, toRankOrder:2,
      awardedByType:'dojo' }); return false; } catch { return true; } })());
}

console.log('\nCURRENT GRADE IS DERIVED IN THE DOMAIN');
{
  const grades = new Map([
    ['g1', new Grade({ id:'g1', label:'10th kyu', rankOrder:1 })],
    ['g7', new Grade({ id:'g7', label:'4th kyu', rankOrder:7 })],
    ['g8', new Grade({ id:'g8', label:'3rd kyu', rankOrder:8 })],
  ]);
  const h = new RankHistory([
    new GradingRecord({ personId:'p', gradeId:'g1', awardedOn:'2019-06-15',
      awardedByOrgId:'d' }),
    new GradingRecord({ personId:'p', gradeId:'g8', awardedOn:'2026-10-17',
      awardedByOrgId:'n' }),
    new GradingRecord({ personId:'p', gradeId:'g7', awardedOn:'2024-10-19',
      awardedByOrgId:'n' }),
  ], grades);
  ok('the highest passed grade wins, not the latest row',
    h.current.grade.label === '3rd kyu');
  ok('held since comes with it', h.heldSince.value === '2026-10-17');
  ok('the timeline is in ladder order',
    h.timeline().map(t => t.grade.label).join(' → ')
      === '10th kyu → 4th kyu → 3rd kyu');

  const failed = new RankHistory([
    new GradingRecord({ personId:'p', gradeId:'g8', awardedOn:'2026-10-17',
      awardedByOrgId:'n', result:'fail' }),
  ], grades);
  ok('a failed grading does not count', failed.isEmpty);
}

// ---------------------------------------------------------------------------
// the same use cases, no database
// ---------------------------------------------------------------------------

const LADDER = new InMemoryLadder({
  grades: [
    { id:'g7', label:'4th kyu', rankOrder:7, minMonthsAtPrevious:6, minSessions:48, minAge:7 },
    { id:'g8', label:'3rd kyu', rankOrder:8, minMonthsAtPrevious:6, minSessions:48, minAge:8 },
    { id:'g9', label:'2nd kyu', rankOrder:9, minMonthsAtPrevious:6, minSessions:48, minAge:8 },
  ],
  authorities: [
    { fromRankOrder:1, toRankOrder:7, awardedByType:'dojo', ratifiedByType:'country',
      minPanelSize:1, minPanelRank:11 },
    { fromRankOrder:8, toRankOrder:10, awardedByType:'country',
      ratifiedByType:'country', minPanelSize:2, minPanelRank:12 },
  ],
});

const build = ({ records = [], sessions = {}, auth = new AllowAll() } = {}) => {
  const ranks = new InMemoryRanks(records,
    new Map([['g7',7],['g8',8],['g9',9],['dan',14]]));
  const members = new InMemoryMembers([
    { id:'aroha', dateOfBirth:'2011-08-04', displayNumber:'NZ-0417' },
    { id:'mia', dateOfBirth:'2017-06-30', displayNumber:'NZ-0901' },
  ], sessions);
  const organisations = new InMemoryOrganisations([
    { id:'moknz', type:'country', name:'MOKNZ', federationId:'moknz' },
    { id:'whanganui', type:'dojo', name:'Whanganui', federationId:'moknz' },
  ]);
  const clock = new FixedClock('2026-09-17');
  return {
    check: new CheckEligibility({ ladder: LADDER, ranks, members, clock }),
    award: new AwardGrade({ ladder: LADDER, ranks, members, organisations,
      auth, clock }),
    ranks,
  };
};

// The panel's seniority is read from the register, never taken from the caller.
// So the fake has to hold their gradings too — anything less would be a fake
// that proves nothing.
const PANEL_RECORDS = [
  { personId:'doug', gradeId:'dan', awardedOn:'1990-01-01', awardedByOrgId:'moknz' },
  { personId:'tane', gradeId:'dan', awardedOn:'2014-10-18', awardedByOrgId:'moknz' },
];
const AROHA_AT_4TH = [
  { personId:'aroha', gradeId:'g7', awardedOn:'2024-10-19', awardedByOrgId:'moknz' },
  ...PANEL_RECORDS,
];
const PANEL = [{ personId:'doug' }, { personId:'tane' }];

console.log('\nELIGIBILITY — RUN WITH NO DATABASE AT ALL');
{
  const { check } = build({ records: AROHA_AT_4TH, sessions: { aroha: 192 } });
  const v = await check.execute({ personId:'aroha', federationId:'moknz' });
  ok('eligible when everything is met', v.eligible === true, v.reasons?.join());
  ok('and names the next grade', v.next === '3rd kyu');

  const short = build({ records: AROHA_AT_4TH, sessions: { aroha: 10 } });
  const v2 = await short.check.execute({ personId:'aroha', federationId:'moknz' });
  ok('not eligible when short', v2.eligible === false);
  ok('and says exactly how short', v2.reasons.includes('38 more sessions'),
    v2.reasons.join('; '));
  console.log('      → ' + v2.reasons.join('; '));

  const none = build();
  const v3 = await none.check.execute({ personId:'mia', federationId:'moknz' });
  ok('an ungraded person is offered the bottom rung of the ladder',
    v3.next === '4th kyu', v3.next);
}

console.log('\nAWARDING — THE RULES ARE IN THE CORE, NOT THE CONTROLLER');
{
  const base = () => build({ records: AROHA_AT_4TH, sessions: { aroha: 192 } });

  await throws('a dojo cannot award a national grade', async () => {
    const { award } = base();
    await award.execute({ actorId:'a', personId:'aroha', gradeId:'g8',
      awardingOrgId:'whanganui', panel: PANEL });
  }, Refused, 'must be awarded by a country');

  await throws('a panel of one is refused for a national grade', async () => {
    const { award } = base();
    await award.execute({ actorId:'a', personId:'aroha', gradeId:'g8',
      awardingOrgId:'moknz', panel: [{ personId:'doug' }] });
  }, Refused, 'panel of 2');

  await throws('skipping a grade is refused', async () => {
    const { award } = base();
    await award.execute({ actorId:'a', personId:'aroha', gradeId:'g9',
      awardingOrgId:'moknz', panel: PANEL });
  }, Refused, 'not this person');

  await throws('someone without the role is stopped before anything else', async () => {
    const { award } = build({ records: AROHA_AT_4TH, auth: new DenyAll() });
    await award.execute({ actorId:'a', personId:'aroha', gradeId:'g8',
      awardingOrgId:'moknz', panel: PANEL });
  }, NotPermitted);

  const { award } = base();
  const out = await award.execute({ actorId:'a', personId:'aroha', gradeId:'g8',
    awardingOrgId:'moknz', panel: PANEL });
  ok('a valid grading is recorded', out.record.id.startsWith('mem-'));
  ok('and the authority says who must ratify it',
    out.needsRatification && out.ratifiedBy === 'country');
}

console.log('\nOVERRIDE IS POSSIBLE BUT NEVER SILENT');
{
  const { award } = build({ records: AROHA_AT_4TH, sessions: { aroha: 3 } });
  await throws('ineligible is refused by default', () =>
    award.execute({ actorId:'a', personId:'aroha', gradeId:'g8',
      awardingOrgId:'moknz', panel: PANEL }), Refused);

  const out = await award.execute({ actorId:'a', personId:'aroha', gradeId:'g8',
    awardingOrgId:'moknz', panel: PANEL, overrideEligibility: true });
  ok('a registrar can override', !!out.record.id);
  ok('and what was waived is returned, not swallowed',
    out.waived.length === 1 && out.waived[0].includes('more sessions'));
  console.log('      → waived: ' + out.waived.join('; '));
}

console.log('\nPORTS FAIL AT WIRING TIME, NOT AT CALL TIME');
{
  ok('a missing port is caught immediately',
    (() => { try { new CheckEligibility({ ladder:{}, ranks:{}, members:{}, clock:{} });
      return false; } catch (e) { return e instanceof DomainError
        && e.message.includes('missing'); } })());
  console.log('      → ' + (() => { try { new CheckEligibility({}); }
    catch (e) { return e.message; } })());
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
