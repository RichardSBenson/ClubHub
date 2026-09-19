import './reset.mjs';
import { orgs, people, rank, events, billing, pool, Forbidden, Invalid }
  from './data.mjs';

// This suite needs the database, reached over a local socket.
process.env.HONBU_STORE = 'postgres';

const DOUG = '33333333-0000-0000-0000-000000000001';   // owner, national
const TANE = '33333333-0000-0000-0000-000000000003';   // admin, Wellington only
const AROHA = '22222222-0000-0000-0000-000000000002';  // 4th kyu, Whanganui
const MIA = '22222222-0000-0000-0000-000000000004';    // 10th kyu, Whanganui

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
};
const throws = async (name, fn, type) => {
  try { await fn(); fail++; console.log(`  ✗ ${name} — did not throw`); }
  catch (e) {
    if (e instanceof type) { pass++; console.log(`  ✓ ${name} — ${e.message}`); }
    else { fail++; console.log(`  ✗ ${name} — wrong error: ${e.message}`); }
  }
};

const moknz = await orgs.bySlug('moknz');
const whanganui = await orgs.bySlug('whanganui');
const wellington = await orgs.bySlug('wellington');

console.log('\nPERMISSIONS');
{
  const dougSees = await orgs.visibleTo(DOUG);
  const taneSees = await orgs.visibleTo(TANE);
  ok('national owner sees the whole tree', dougSees.length === 18, dougSees.length);
  ok('dojo admin sees only their dojo',
    taneSees.length === 1 && taneSees[0].slug === 'wellington');
  await throws('dojo admin cannot read another dojo roster',
    () => people.roster(TANE, whanganui.id), Forbidden);
  ok('national owner can read any dojo roster',
    (await people.roster(DOUG, whanganui.id)).length === 3);
}

console.log('\nPRIVATE DATA IS A SEPARATE PERMISSION');
{
  const basic = await people.roster(DOUG, whanganui.id);
  ok('roster omits emergency contact by default',
    !('emergency_phone' in basic[0]));
  const full = await people.roster(DOUG, whanganui.id, { includePrivate: true });
  ok('registrar can request it explicitly', 'emergency_phone' in full[0]);
}

console.log('\nTHE REGISTER FOLLOWS THE PERSON');
{
  const before = await people.record(DOUG, AROHA);
  ok('seven gradings on file', before.history.length === 7);
  ok('history spans dojo and national',
    new Set(before.history.map(h => h.awarded_by)).size === 2);

  await people.transfer(DOUG, AROHA, wellington.id, '2026-09-17');
  const after = await people.record(DOUG, AROHA);
  ok('grading history survives a transfer', after.history.length === 7);
  ok('both dojo appear in affiliation history',
    after.affiliations.length === 2);
  ok('old affiliation closed, new one open',
    after.affiliations.filter(a => a.ends === null).length === 1);

  await people.transfer(DOUG, AROHA, whanganui.id, '2026-09-18');  // put her back
}

console.log('\nELIGIBILITY');
{
  const a = await rank.eligibility(AROHA, moknz.id);
  ok('Aroha is eligible for 3rd kyu', a.eligible === true,
    JSON.stringify(a.unmet));
  ok('next grade named correctly', a.next === '3rd kyu');

  const m = await rank.eligibility(MIA, moknz.id);
  ok('Mia is not eligible', m.eligible === false);
  ok('and is told exactly what is missing',
    m.unmet.some(u => u.includes('training sessions')), JSON.stringify(m.unmet));
  console.log(`      → Mia: ${m.unmet.join('; ')}`);
}

console.log('\nGRADING AUTHORITY IS ENFORCED');
{
  const ladder = await rank.ladder(moknz.id);
  const thirdKyu = ladder.find(g => g.label === '3rd kyu');
  const eighthKyu = ladder.find(g => g.label === '8th kyu');
  const shodan = ladder.find(g => g.label === 'Shodan');
  const DOUG_P = '22222222-0000-0000-0000-000000000001';  // Godan
  const TANE_P = '22222222-0000-0000-0000-000000000003';  // Nidan

  await throws('a dojo cannot award 3rd kyu (national grade)',
    () => rank.award(DOUG, {
      personId: AROHA, gradeId: thirdKyu.id, awardedByOrg: whanganui.id,
      awardedOn: '2026-10-17', panel: [DOUG_P, TANE_P],
    }), Invalid);

  await throws('national cannot award shodan with a panel of one',
    () => rank.award(DOUG, {
      personId: AROHA, gradeId: shodan.id, awardedByOrg: moknz.id,
      awardedOn: '2026-10-17', panel: [DOUG_P],
    }), Invalid);

  await throws('panel must be senior enough',
    () => rank.award(DOUG, {
      personId: AROHA, gradeId: shodan.id, awardedByOrg: moknz.id,
      awardedOn: '2026-10-17', panel: [DOUG_P, TANE_P, TANE_P],
    }), Invalid);

  const awarded = await rank.award(DOUG, {
    personId: AROHA, gradeId: thirdKyu.id, awardedByOrg: moknz.id,
    awardedOn: '2026-10-17', panel: [DOUG_P, TANE_P],
  });
  ok('a valid national grading is accepted', !!awarded?.id);

  const now = await people.record(DOUG, AROHA);
  ok('her current grade moved to 3rd kyu',
    now.history.at(-1).label === '3rd kyu');

  await pool.query('delete from grading_record where id = $1', [awarded.id]);
}

console.log('\nEVENT SCOPING');
{
  const wh = await events.forOrg('whanganui', { isMember: true, viewerRankOrder: 7 });
  const we = await events.forOrg('wellington', { isMember: true, viewerRankOrder: 7 });
  const pub = await events.forOrg('whanganui');

  ok('Whanganui sees its own fight night',
    wh.some(e => e.slug === 'fight-night-sep'));
  ok('Wellington does not see it',
    !we.some(e => e.slug === 'fight-night-sep'));
  ok('both see the national grading',
    wh.some(e => e.slug.startsWith('national-kyu')) &&
    we.some(e => e.slug.startsWith('national-kyu')));
  ok('a 4th kyu does not see the black belt seminar',
    !wh.some(e => e.slug === 'black-belt-seminar-nov'));
  ok('the public sees neither the seminar nor the fight night',
    !pub.some(e => ['black-belt-seminar-nov','fight-night-sep'].includes(e.slug)));

  const dan = await events.forOrg('whanganui', { isMember: true, viewerRankOrder: 12 });
  ok('a nidan does see the black belt seminar',
    dan.some(e => e.slug === 'black-belt-seminar-nov'));
}

console.log('\nENTRY CHECKS');
{
  const seminar = (await pool.query(
    `select id from event where slug='black-belt-seminar-nov'`)).rows[0].id;
  const r = await events.canEnter(seminar, AROHA);
  ok('Aroha is blocked from the black belt seminar', r.canEnter === false);
  console.log(`      → ${r.blocked.join('; ')}`);
}

console.log('\nPUBLISH UP IS REQUESTED, THEN APPROVED');
{
  const fightNight = (await pool.query(
    `select id from event where slug='fight-night-sep'`)).rows[0].id;
  await throws('a dojo-only event cannot be pushed to the national calendar',
    () => events.requestPublishUp(DOUG, fightNight), Invalid);

  const { rows: [ev] } = await pool.query(`
    insert into event (organisation_id, kind, title, slug, starts_at, visibility, status)
    values ($1,'grading','Whanganui dojo grading','wh-grading-sep',
            '2026-09-27 10:00+12','public','published') returning id`,
    [whanganui.id]);

  const req = await events.requestPublishUp(DOUG, ev.id);
  ok('request recorded', req.publish_up_state === 'requested');
  const dec = await events.decidePublishUp(DOUG, ev.id, true);
  ok('national approved it', dec.publish_up_state === 'approved');

  await pool.query('delete from event where id = $1', [ev.id]);
}

console.log('\nINVOICING FROM THE REGISTER');
{
  const { invoice, lines } = await billing.draftAffiliationInvoice(DOUG, {
    fromOrg: moknz.id, toOrg: whanganui.id,
    periodStart: '2026-01-01', periodEnd: '2026-12-31', unitCents: 4000,
  });
  ok('one line per member', lines === 2, lines);
  ok('subtotal matches', invoice.subtotal_cents === 8000, invoice.subtotal_cents);
  console.log(`      → invoice for $${(invoice.subtotal_cents/100).toFixed(2)}, ` +
    `${lines} members`);
  await pool.query('delete from invoice where id = $1', [invoice.id]);
}

console.log('\nPUBLIC WEBSITE QUERY (no auth)');
{
  const dojos = await orgs.publicDojos('moknz');
  ok('seventeen dojo returned for the site', dojos.length === 17, dojos.length);
  ok('includes the Japan branch', dojos.some(d => d.slug === 'japan'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
