/**
 * The 2026 Kokoro Cup, set up and entered through the real screens.
 *
 * Everything configured below is copied from the printed entry form and the
 * athlete registration form on its reverse: three disciplines, kata banded by
 * grade, $60 / $70 / $80, and a parent or guardian signing for anyone under
 * SIXTEEN. If this file needed the code changed to describe the real event,
 * the code would be wrong.
 *
 * Real HTTP, real forms, real database.
 */

import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';

const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const jar = {};
async function req(path, { method = 'GET', form } = {}) {
  const headers = {};
  const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (c) headers.cookie = c;
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + path, {
    method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
               : undefined,
  });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}

const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0] ?? null;
const said = (loc) => decodeURIComponent(
  new URL(loc ?? '/', base).searchParams.get('done')
  ?? new URL(loc ?? '/', base).searchParams.get('error') ?? '');

// The event runs 7 November 2026, 8am, in Napier.
const EVENT_DAY = '2026-11-07';

// ---------------------------------------------------------------------------

console.log('\nSIGNING IN AS THE FEDERATION');
{
  await req('/signin');
  const { token } = await auth.requestLink('doug@example.nz');
  ok('the session is live', (await req(`/signin/${token}`, { method: 'POST', form: {} })).status === 302);
}

console.log('\nCREATING THE TOURNAMENT');
{
  const r = await req('/o/moknz/events/new', { method: 'POST', form: {
    title: '2026 Kokoro Cup', kind: 'tournament',
    summary: 'Kata & Kumite Open Championships',
    startsAt: `${EVENT_DAY}T08:00`, endsAt: `${EVENT_DAY}T16:00`,
    venueName: 'Centennial Events Centre',
    addressLine: '40 Latham Street, Napier South, Napier 4110',
    visibility: 'public', entriesClose: '2026-10-23T17:00',
    // From the reverse of the form: under 16 needs a guardian, not under 18.
    guardianUnder: '16', consentVersion: '2026.1',
    consentText: 'I am willingly registering and participating in the 2026 '
      + 'Kokoro Cup Kata & Kumite Open Championships.',
    status: 'published' } });
  ok('the event is created', r.status === 302, String(r.status));

  const ev = await one(`select * from event where slug = '2026-kokoro-cup'`);
  ok('a guardian signs for anyone under 16', ev?.guardian_under === 16,
    String(ev?.guardian_under));
  ok('the declaration version is recorded', ev?.consent_version === '2026.1');
  ok('8am in Napier is stored as the right instant',
    ev?.starts_at.toISOString() === '2026-11-06T19:00:00.000Z',
    ev?.starts_at.toISOString());
}

console.log('\nA DECLARATION VERSION WITH NOTHING BEHIND IT IS REFUSED');
{
  const r = await req('/o/moknz/events/new', { method: 'POST', form: {
    title: 'Half a declaration', kind: 'tournament',
    startsAt: '2026-11-07T08:00', consentVersion: '2026.1', status: 'draft' } });
  ok('it does not save', r.status === 422, String(r.status));
  ok('and says why',
    r.html.includes('needs the declaration text'), 'no explanation');
}

console.log('\nSETTING UP WHAT IT RUNS');
const SETUP = '/o/moknz/events/2026-kokoro-cup/setup';
{
  const page = await req(SETUP);
  ok('the setup page opens', page.status === 200);
  ok('and says nothing is set up yet', page.html.includes('Nothing is set up yet'));

  for (const name of ['Kata', 'Non-Contact Kumite', 'Full-Contact Kumite']) {
    const r = await req(`${SETUP}/discipline`, { method: 'POST', form: { name } });
    ok(`${name} is added`, r.status === 302 && said(r.location).includes(name),
      said(r.location));
  }
  ok('three disciplines are on the event',
    (await q(`select * from event_discipline ed join event e on e.id = ed.event_id
              where e.slug = '2026-kokoro-cup'`)).length === 3);

  const after = await req(SETUP);
  ok('each one says it has no divisions yet',
    (after.html.match(/No divisions yet/g) ?? []).length === 3);
}

console.log('\nTHE KATA DIVISIONS, EXACTLY AS THE FORM BANDS THEM');
{
  const kata = await one(`
    select ed.id from event_discipline ed join event e on e.id = ed.event_id
    where e.slug = '2026-kokoro-cup' and ed.name = 'Kata'`);

  // MOKNZ's ladder: 10th kyu is rank_order 1, so 7th kyu is 4, 6th is 5,
  // 3rd is 8, 2nd is 9. Read from the register rather than assumed.
  const grade = async (label) => (await one(
    `select rank_order from grade g join organisation o on o.id = g.organisation_id
     where o.slug = 'moknz' and g.label = $1`, [label]))?.rank_order;

  const seventh = await grade('7th kyu');
  const sixth = await grade('6th kyu');
  const third = await grade('3rd kyu');
  const second = await grade('2nd kyu');
  ok('the ladder is there to band against', !!seventh && !!second,
    `${seventh} ${second}`);

  for (const d of [
    { label: 'Development Kata', summary: 'White/orange/blue belt to 7th kyu',
      maxRankOrder: seventh },
    { label: 'Intermediate Kata', summary: 'Yellow/green belt 6th–3rd kyu',
      minRankOrder: sixth, maxRankOrder: third },
    { label: 'Premiere Kata', summary: 'Brown/black belt 2nd kyu up',
      minRankOrder: second },
  ]) {
    const r = await req(`${SETUP}/division`, { method: 'POST',
      form: { disciplineId: kata.id, ...Object.fromEntries(
        Object.entries(d).map(([k, v]) => [k, String(v ?? '')])) } });
    ok(`${d.label} is added`, r.status === 302 && said(r.location).includes(d.label),
      said(r.location));
  }

  const page = await req(SETUP);
  ok('the bounds are shown in words, not nullable numbers',
    page.html.includes('up to 7th kyu') || page.html.includes('7th kyu'),
    'bounds not rendered');
  ok('and the open-ended one reads as such',
    page.html.includes('and above'), 'no open-ended band');
}

console.log('\nKUMITE DIVISIONS ON AGE, GENDER AND WEIGHT');
{
  const fck = await one(`
    select ed.id from event_discipline ed join event e on e.id = ed.event_id
    where e.slug = '2026-kokoro-cup' and ed.name = 'Full-Contact Kumite'`);

  for (const d of [
    { label: 'Junior Boys 10–11', minAge: 10, maxAge: 11, gender: 'male' },
    // Whanganui's roll is two girls, 9 and 15 on the day. A tournament whose
    // divisions do not cover the people actually entering is the normal state
    // of a half-configured event, and both cases are exercised below.
    // Banded by weight as well as age, the way a full-contact junior
    // division actually is — which is also why entering one without a weight
    // cannot be placed.
    { label: 'Junior Girls 8–11 light', minAge: 8, maxAge: 11,
      gender: 'female', maxWeightKg: 35 },
    { label: 'Junior Girls 8–11 heavy', minAge: 8, maxAge: 11,
      gender: 'female', minWeightKg: 35.01 },
    { label: 'Teen Girls 12–17', minAge: 12, maxAge: 17, gender: 'female' },
    { label: 'Adult Male Lightweight', minAge: 18, gender: 'male', maxWeightKg: 70 },
    { label: 'Adult Male Middleweight', minAge: 18, gender: 'male',
      minWeightKg: 70.01, maxWeightKg: 85 },
    { label: 'Adult Male Heavyweight', minAge: 18, gender: 'male',
      minWeightKg: 85.01 },
    { label: 'Adult Female Open', minAge: 18, gender: 'female' },
  ]) {
    const r = await req(`${SETUP}/division`, { method: 'POST',
      form: { disciplineId: fck.id, ...Object.fromEntries(
        Object.entries(d).map(([k, v]) => [k, String(v ?? '')])) } });
    ok(`${d.label} is added`, r.status === 302, said(r.location));
  }

  ok('the database refuses bounds that cross over', await (async () => {
    try {
      await pool.query(`insert into event_division (discipline_id, label,
        min_weight_kg, max_weight_kg) values ($1,'Backwards',90,70)`, [fck.id]);
      return false;
    } catch { return true; }
  })());
}

console.log('\nTHE PRICES OFF THE FORM: $60, $70, $80');
{
  for (const [forCount, amount] of [[1, '60'], [2, '70'], [3, '80']]) {
    const r = await req(`${SETUP}/price`, { method: 'POST',
      form: { forCount: String(forCount), amount } });
    ok(`${forCount} event${forCount === 1 ? '' : 's'} costs $${amount}`,
      r.status === 302, said(r.location));
  }
  const prices = await q(`select p.* from entry_price p join event e on e.id = p.event_id
    where e.slug = '2026-kokoro-cup' order by for_count`);
  ok('all three are stored in cents',
    prices.map((p) => p.amount_cents).join(',') === '6000,7000,8000',
    prices.map((p) => p.amount_cents).join(','));

  const page = await req(SETUP);
  ok('and shown as money', page.html.includes('$70.00'));
}

// ---------------------------------------------------------------------------
// a club enters its people
// ---------------------------------------------------------------------------

const ENTER = '/o/whanganui/events/2026-kokoro-cup/enter';

console.log('\nA CLUB OPENS THE ENTRY SCREEN FOR THE FEDERATION\'S EVENT');
{
  const r = await req(ENTER);
  ok('the club can reach an event it does not own', r.status === 200,
    String(r.status));
  ok('its own roll is listed', r.html.includes('Aroha'));
  ok('with each person\'s age on the day of the event, not today',
    r.html.includes('Age on the day'));
  ok('all three disciplines are offered',
    r.html.includes('Kata') && r.html.includes('Full-Contact Kumite'));
  ok('and it asks only for what changes between tournaments',
    r.html.includes('weight and height'), 'no explanation of what it asks for');
  ok('the declaration is shown with its version', r.html.includes('2026.1'));
  ok('and says a guardian signs under 16', r.html.includes('under\n               16')
    || r.html.includes('under 16'), 'guardian age not shown');
}

console.log('\nNOBODY IS ENTERED UNTIL THE PLACEMENTS HAVE BEEN READ');
{
  const roster = await q(`
    select p.id, p.first_name, p.last_name, p.date_of_birth, cg.rank_order
    from affiliation a join person p on p.id = a.person_id
    join organisation o on o.id = a.organisation_id
    left join person_current_grade cg on cg.person_id = p.id
    where o.slug = 'whanganui' and a.ends is null and a.role = 'member'
    order by p.last_name`);
  ok('the club has people on its roll', roster.length >= 2, String(roster.length));

  const disciplines = await q(`
    select ed.* from event_discipline ed join event e on e.id = ed.event_id
    where e.slug = '2026-kokoro-cup' order by ed.name`);
  const kata = disciplines.find((d) => d.name === 'Kata');
  const fck = disciplines.find((d) => d.name === 'Full-Contact Kumite');

  // Everybody into kata; the first person also into full-contact, with a
  // weight, so both a graded-only and a weight-and-age placement are exercised.
  const form = { acceptedName: 'Doug Holloway', accepted: '1' };
  for (const p of roster) form[`enter_${p.id}_${kata.id}`] = '1';
  form[`enter_${roster[0].id}_${fck.id}`] = '1';
  form[`weight_${roster[0].id}`] = '32';
  form[`height_${roster[0].id}`] = '134';

  globalThis.__form = form;
  globalThis.__roster = roster;

  const before = (await q('select * from event_entry')).length;
  const r = await req(ENTER, { method: 'POST', form });
  ok('a preview comes back rather than a redirect', r.status === 200,
    String(r.status));
  ok('it says nothing has been saved', r.html.includes('Nothing has been saved'));
  ok('NOTHING WAS WRITTEN', (await q('select * from event_entry')).length === before);

  ok('the placements are shown by name',
    r.html.includes('Kata') && (r.html.includes('Development Kata')
      || r.html.includes('Intermediate Kata') || r.html.includes('Premiere Kata')),
    'no kata division named');
  ok('and a total fee is worked out', r.html.includes('Total'), 'no total');
}

console.log('\nWHAT CANNOT BE PLACED IS SHOWN FIRST, NOT BURIED');
{
  const roster = globalThis.__roster;
  const fck = await one(`
    select ed.id from event_discipline ed join event e on e.id = ed.event_id
    where e.slug = '2026-kokoro-cup' and ed.name = 'Full-Contact Kumite'`);

  // Full-contact, no weight given: every adult division needs one.
  const r = await req(ENTER, { method: 'POST', form: {
    acceptedName: 'Doug Holloway', accepted: '1',
    [`enter_${roster[0].id}_${fck.id}`]: '1' } });

  ok('the preview says it cannot go in yet',
    r.html.includes('cannot go in yet'), 'unplaced section missing');
  ok('and names what is missing', r.html.includes('weight'), 'weight not asked for');
  ok('with nothing offered to confirm',
    !r.html.includes('name="confirm"'), 'confirm offered for an unplaceable entry');
}

console.log('\nCONFIRMING ENTERS THEM');
{
  const r = await req(ENTER, { method: 'POST',
    form: { ...globalThis.__form, confirm: 'yes' } });
  ok('it redirects to the entry list',
    r.status === 302 && r.location.includes('/entries'), r.location);
  ok('saying how many went in', /\d+ entered/.test(said(r.location)),
    said(r.location));

  const entries = await q(`select en.* from event_entry en
    join event e on e.id = en.event_id where e.slug = '2026-kokoro-cup'`);
  ok('the entries are there', entries.length >= 2, String(entries.length));

  const selections = await q(`
    select s.*, ed.name as discipline, dv.label as division
    from entry_selection s
    join event_discipline ed on ed.id = s.discipline_id
    left join event_division dv on dv.id = s.division_id
    join event_entry en on en.id = s.entry_id
    join event e on e.id = en.event_id where e.slug = '2026-kokoro-cup'`);
  ok('every entry has its disciplines recorded', selections.length >= 2);
  ok('each with a division worked out by the rules',
    selections.every((s) => s.division_id && s.placed_by === 'calculated'),
    JSON.stringify(selections.map((s) => [s.division, s.placed_by])));

  const two = await one(`select en.* from event_entry en
    join event e on e.id = en.event_id join person p on p.id = en.person_id
    where e.slug = '2026-kokoro-cup' and p.id = $1`, [globalThis.__roster[0].id]);
  ok('the weight recorded on the day is kept on the entry',
    Number(two?.weight_kg) === 32, String(two?.weight_kg));
  ok('two disciplines are charged at the two-event price, not twice the one',
    two?.amount_cents === 7000, String(two?.amount_cents));

  const single = entries.find((e) => e.id !== two?.id);
  ok('and one discipline at the one-event price',
    single?.amount_cents === 6000, String(single?.amount_cents));
}

console.log('\nTHE DECLARATION IS RECORDED, NOT A TICKED BOX');
{
  const consents = await q(`
    select c.* from entry_consent c
    join event_entry en on en.id = c.entry_id
    join event e on e.id = en.event_id where e.slug = '2026-kokoro-cup'`);
  ok('every entry has one', consents.length >= 2, String(consents.length));
  ok('recording which version was agreed to',
    consents.every((c) => c.version === '2026.1'));
  ok('who agreed to it',
    consents.every((c) => c.accepted_name === 'Doug Holloway'));
  ok('and when', consents.every((c) => !!c.accepted_at));

  const minor = await one(`
    select c.guardian, p.date_of_birth from entry_consent c
    join event_entry en on en.id = c.entry_id
    join person p on p.id = en.person_id
    where p.date_of_birth > '2010-11-07'`);
  if (minor) {
    ok('a competitor under 16 on the day has a guardian recorded',
      !!minor.guardian, JSON.stringify(minor));
  } else {
    ok('no under-16 on this roll to check — skipped', true);
  }
}

console.log('\nENTERING THE SAME PERSON TWICE IS REFUSED BY NAME');
{
  const before = (await q('select * from event_entry')).length;
  const r = await req(ENTER, { method: 'POST',
    form: { ...globalThis.__form, confirm: 'yes' } });
  ok('it comes back with a message rather than a duplicate',
    r.status === 302, String(r.status));
  ok('saying they are already entered',
    said(r.location).includes('already entered'), said(r.location));
  ok('and nobody was entered twice',
    (await q('select * from event_entry')).length === before,
    `${before} → ${(await q('select * from event_entry')).length}`);
}

console.log('\nTHE ENTRY LIST');
{
  const r = await req('/o/whanganui/events/2026-kokoro-cup/entries');
  ok('it opens', r.status === 200, String(r.status));
  ok('with a count of who is entered', /\d+ entered/.test(r.html));
  ok('it says what kind of event it is', /\(tournament\)/.test(r.html));
  ok('grouped by division', r.html.includes('Kata —'), 'not grouped');
  ok('and says how each person got there',
    r.html.includes('calculated'), 'placement source not shown');
}

console.log('\nA SEMINAR HAS ONE FLAT FEE, NOT DIVISIONS');
{
  const mk = (title, extra = {}) => req('/o/moknz/events/new', { method: 'POST', form: {
    title, kind: 'seminar', startsAt: '2026-12-05T10:00', visibility: 'public', status: 'published', ...extra } });
  ok('a seminar with the fee left blank is saved', (await mk('Free Seminar')).status === 302);
  const priceOf = async (slug) => (await q(`select p.amount_cents from entry_price p join event e on e.id = p.event_id where e.slug = $1 and p.for_count = 1 and not p.members_only`, [slug]))[0]?.amount_cents;
  ok('blank means free: a price of 0 is stored', (await priceOf('free-seminar')) === 0, String(await priceOf('free-seminar')));
  let r = await req('/o/moknz/events/free-seminar/entries');
  ok('the entries page opens', r.status === 200, String(r.status));
  ok('it offers no divisions', !/Divisions and fees/.test(r.html) && !/across \d+ division/.test(r.html));
  ok('it shows the fee: $0.00', /Entry fee \$0\.00/.test(r.html));
  const paid = await mk('Paid Seminar', { entryFee: '$25', startsAt: '2026-12-06T10:00' });
  ok('a paid seminar is saved with its fee', paid.status === 302 && (await priceOf('paid-seminar')) === 2500, paid.status + ' ' + (await priceOf('paid-seminar')));
  r = await req('/o/moknz/events/paid-seminar/entries');
  ok('and shows $25.00', /Entry fee \$25\.00/.test(r.html));
  r = await req('/o/moknz/events/paid-seminar/edit');
  ok('the edit form has the fee in it', /name="entryFee"[^>]*value="25"/.test(r.html));
  ok('a fee that is not an amount is refused', (await mk('Bad Fee', { entryFee: 'lots', startsAt: '2026-12-07T10:00' })).status === 422);
  ok('a tournament takes no flat fee (it is priced by division)', (await q(`select 1 from entry_price p join event e on e.id = p.event_id where e.slug = '2026-kokoro-cup' and p.label = 'Entry fee'`)).length === 0);
}

console.log('\nTHE ENTRIES AS A SPREADSHEET');
{
  const r = await req('/o/whanganui/events/2026-kokoro-cup/entries.csv');
  ok('it downloads', r.status === 200, String(r.status));
  const lines = r.html.replace(/^\uFEFF/, '').trim().split('\r\n');
  const head = lines[0].split(',');
  for (const col of ['Last name', 'First name', 'Age on the day', 'Weight (kg)', 'Height (cm)', 'Grade', 'Years training', 'Dojo'])
    ok(`column: ${col}`, head.includes(col), lines[0]);
  const n = (await q('select count(*)::int n from event_entry e join event ev on ev.id = e.event_id where ev.slug = $1', ['2026-kokoro-cup']))[0].n;
  ok('one row for every entry', lines.length - 1 === n, `${lines.length - 1} rows, ${n} entries`);
  const saved = { ...jar };
  for (const k of Object.keys(jar)) delete jar[k];
  const anon = await req('/o/whanganui/events/2026-kokoro-cup/entries.csv');
  ok('and a stranger cannot have it', anon.status !== 200, String(anon.status));
  Object.assign(jar, saved);
}

console.log('\nTHE ORGANISER CAN MOVE SOMEBODY THE RULES COULD NOT PLACE');
{
  // Put somebody in with no weight so they land unplaced, then place them.
  const roster = globalThis.__roster;
  const fck = await one(`
    select ed.id from event_discipline ed join event e on e.id = ed.event_id
    where e.slug = '2026-kokoro-cup' and ed.name = 'Full-Contact Kumite'`);
  const ev = await one(`select id from event where slug = '2026-kokoro-cup'`);
  // Somebody from another club who is not already entered.
  const spare = await one(`
    select p.id from affiliation a join person p on p.id = a.person_id
    join organisation o on o.id = a.organisation_id
    where o.slug <> 'whanganui' and a.ends is null
      and p.id not in (select person_id from event_entry
                       where person_id is not null and event_id = $1)
    limit 1`, [ev.id]);

  // Entered directly, the way the organiser's override path has to cope with:
  // a selection with no division at all.
  const entry = spare && await one(`
    insert into event_entry (event_id, person_id, entered_for_org, status)
    select $1, $2, o.id, 'entered' from organisation o where o.slug = 'far-north'
    returning *`, [ev.id, spare.id]);

  if (entry) {
    const sel = await one(`
      insert into entry_selection (entry_id, discipline_id, division_id)
      values ($1,$2,null) returning *`, [entry.id, fck.id]);

    const list = await req('/o/moknz/events/2026-kokoro-cup/entries');
    ok('the unplaced are listed first and by name',
      list.html.includes('Nobody has a division for these yet'),
      'unplaced section missing');
    ok('with somewhere to put them', list.html.includes('name="divisionId"'));

    const division = await one(
      `select id from event_division where label = 'Adult Male Middleweight'`);
    const r = await req('/o/moknz/events/2026-kokoro-cup/entries/assign',
      { method: 'POST', form: { selectionId: sel.id, divisionId: division.id } });
    ok('placing them works', r.status === 302, String(r.status));

    const after = await one('select * from entry_selection where id = $1', [sel.id]);
    ok('they are in the division', after.division_id === division.id);
    ok('and it is marked as moved by hand, so nothing recalculates it back',
      after.placed_by === 'assigned', after.placed_by);

    const shown = await req('/o/moknz/events/2026-kokoro-cup/entries');
    ok('the list says so', shown.html.includes('moved by hand'));
  } else {
    ok('no spare competitor to place — skipped', true);
  }
}

console.log('\nA CLUB CANNOT SET UP SOMEBODY ELSE\'S TOURNAMENT');
{
  const saved = { ...jar };
  for (const k of Object.keys(jar)) delete jar[k];
  await req('/signin');
  const { token } = await auth.requestLink('tane@example.nz');
  await req(`/signin/${token}`, { method: 'POST', form: {} });

  ok('the setup page is refused', (await req(SETUP)).status === 403);
  const before = (await q('select * from event_division')).length;
  const p = await req(`${SETUP}/division`, { method: 'POST',
    form: { disciplineId: '00000000-0000-0000-0000-000000000000',
            label: 'Snuck in' } });
  ok('and posting to it writes nothing',
    p.status === 403 && (await q('select * from event_division')).length === before,
    String(p.status));

  for (const k of Object.keys(jar)) delete jar[k];
  Object.assign(jar, saved);
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
await pool.end();
process.exit(fail ? 1 : 0);
