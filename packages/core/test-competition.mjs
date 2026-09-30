/**
 * Placing competitors, configured as the 2026 Kokoro Cup actually is.
 *
 * The divisions, grade bands, fees and the under-16 guardian rule below are
 * copied from the printed entry form and the athlete registration form on its
 * reverse. Nothing here is invented, which is the point: if this code needed
 * changing to run the real tournament, it would be the wrong code.
 *
 * No database anywhere. If a rule needs Postgres to be true, it is in the
 * wrong layer.
 */

import { Competitor, Division, placeIn, placeEntry, priceFor, money,
         consentNeeded, problemsWithConsent } from './domain/competition.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const EVENT_DAY = '2026-11-07';          // 7 November 2026, from the form

// MOKNZ's ladder: 10th kyu is 1, 1st kyu is 10, Shodan is 11.
const KYU = { '10th': 1, '9th': 2, '8th': 3, '7th': 4, '6th': 5, '5th': 6,
              '4th': 7, '3rd': 8, '2nd': 9, '1st': 10 };
const SHODAN = 11;

// ---------------------------------------------------------------------------
// Kata, exactly as the reverse of the form bands it
// ---------------------------------------------------------------------------

const KATA = [
  new Division({ id: 'k1', disciplineId: 'kata', label: 'Development Kata',
    summary: 'White/orange/blue belt to 7th kyu',
    maxRankOrder: KYU['7th'],
    options: { elimination: ['Taikyoku Ichi', 'Taikyoku Ni'],
               final: ['Taikyoku San'] } }),
  new Division({ id: 'k2', disciplineId: 'kata', label: 'Intermediate Kata',
    summary: 'Yellow/green belt 6th–3rd kyu',
    minRankOrder: KYU['6th'], maxRankOrder: KYU['3rd'],
    options: { elimination: ['Pinan Ni', 'Pinan San'], final: ['Gekisai Dai'] } }),
  new Division({ id: 'k3', disciplineId: 'kata', label: 'Premiere Kata',
    summary: 'Brown/black belt 2nd kyu up',
    minRankOrder: KYU['2nd'],
    options: { elimination: ['Pinan Go', 'Tsuki No Kata'], final: ['Gekisai Sho'] } }),
];

console.log('\nKATA DIVISIONS, BANDED BY GRADE');
{
  const beginner = new Competitor({ name: 'A', rankOrder: KYU['9th'] });
  const middling = new Competitor({ name: 'B', rankOrder: KYU['4th'] });
  const senior = new Competitor({ name: 'C', rankOrder: SHODAN });

  ok('a 9th kyu is Development',
    placeIn(KATA, beginner, EVENT_DAY).division?.label === 'Development Kata');
  ok('a 4th kyu is Intermediate',
    placeIn(KATA, middling, EVENT_DAY).division?.label === 'Intermediate Kata');
  ok('a black belt is Premiere',
    placeIn(KATA, senior, EVENT_DAY).division?.label === 'Premiere Kata');

  // The band edges are where a paper form gets argued about.
  ok('7th kyu is the top of Development, not the bottom of Intermediate',
    placeIn(KATA, new Competitor({ rankOrder: KYU['7th'] }), EVENT_DAY)
      .division?.label === 'Development Kata');
  ok('6th kyu is the bottom of Intermediate',
    placeIn(KATA, new Competitor({ rankOrder: KYU['6th'] }), EVENT_DAY)
      .division?.label === 'Intermediate Kata');
  ok('3rd kyu is the top of Intermediate',
    placeIn(KATA, new Competitor({ rankOrder: KYU['3rd'] }), EVENT_DAY)
      .division?.label === 'Intermediate Kata');
  ok('2nd kyu is the bottom of Premiere',
    placeIn(KATA, new Competitor({ rankOrder: KYU['2nd'] }), EVENT_DAY)
      .division?.label === 'Premiere Kata');
}

console.log('\nTHE DIVISION CARRIES ITS KATA LIST AND NOTHING READS IT');
{
  const r = placeIn(KATA, new Competitor({ rankOrder: KYU['4th'] }), EVENT_DAY);
  ok('the permitted kata come with the division',
    r.division.options.final[0] === 'Gekisai Dai',
    JSON.stringify(r.division.options));
  ok('and the division judged on grade alone',
    JSON.stringify(r.division.judgesOn) === '["grade"]',
    JSON.stringify(r.division.judgesOn));
}

console.log('\nSOMEBODY WITH NO GRADE RECORDED IS A QUESTION, NOT A REFUSAL');
{
  const unknown = new Competitor({ name: 'D' });
  const r = placeIn(KATA, unknown, EVENT_DAY);
  ok('the outcome is that we do not know', r.outcome === 'unknown', r.outcome);
  ok('and it says exactly what to ask for',
    r.missing.includes('grade'), JSON.stringify(r.missing));
  ok('nobody is placed', r.division === null);
}

// ---------------------------------------------------------------------------
// Kumite — age, weight, grade and experience, as the form says
// ---------------------------------------------------------------------------

const KUMITE = [
  new Division({ id: 'j1', disciplineId: 'kumite', label: 'Junior Boys 10–11',
    minAge: 10, maxAge: 11, gender: 'male', maxWeightKg: 40 }),
  new Division({ id: 'j2', disciplineId: 'kumite', label: 'Junior Boys 10–11 heavy',
    minAge: 10, maxAge: 11, gender: 'male', minWeightKg: 40.01 }),
  new Division({ id: 'a1', disciplineId: 'kumite', label: 'Adult Male Lightweight',
    minAge: 18, gender: 'male', maxWeightKg: 70 }),
  new Division({ id: 'a2', disciplineId: 'kumite', label: 'Adult Male Middleweight',
    minAge: 18, gender: 'male', minWeightKg: 70.01, maxWeightKg: 85 }),
  new Division({ id: 'a3', disciplineId: 'kumite', label: 'Adult Male Heavyweight',
    minAge: 18, gender: 'male', minWeightKg: 85.01 }),
  new Division({ id: 'w1', disciplineId: 'kumite', label: 'Adult Female Open',
    minAge: 18, gender: 'female' }),
];

console.log('\nTHE MIDDLEWEIGHT EXAMPLE FROM THE SPEC');
{
  // "Adult Male / Middleweight — 70.01–85 kg", for an 82 kg competitor.
  const john = new Competitor({ name: 'John Smith', dateOfBirth: '1995-05-14',
    gender: 'Male', weightKg: 82, heightCm: 181, rankOrder: KYU['3rd'] });
  const r = placeIn(KUMITE, john, EVENT_DAY);
  ok('82 kg is Middleweight', r.division?.label === 'Adult Male Middleweight',
    r.division?.label);

  ok('exactly 85.00 is still Middleweight',
    placeIn(KUMITE, new Competitor({ dateOfBirth: '1995-05-14', gender: 'm',
      weightKg: 85 }), EVENT_DAY).division?.label === 'Adult Male Middleweight');
  ok('85.01 is Heavyweight',
    placeIn(KUMITE, new Competitor({ dateOfBirth: '1995-05-14', gender: 'm',
      weightKg: 85.01 }), EVENT_DAY).division?.label === 'Adult Male Heavyweight');
  ok('exactly 70.00 is Lightweight',
    placeIn(KUMITE, new Competitor({ dateOfBirth: '1995-05-14', gender: 'm',
      weightKg: 70 }), EVENT_DAY).division?.label === 'Adult Male Lightweight');
}

console.log('\nAGE IS AGE ON THE DAY, NOT AGE TODAY');
{
  // Twelve when their club enters them in August, twelve at the tournament.
  const born = '2015-12-01';               // turns 11 AFTER 7 November 2026
  const justUnder = new Competitor({ dateOfBirth: born, gender: 'male',
    weightKg: 35 });
  ok('they are 10 on the day, so they are in the 10–11 division',
    placeIn(KUMITE, justUnder, EVENT_DAY).division?.label
      === 'Junior Boys 10–11', String(justUnder.ageAt(EVENT_DAY)));
  ok('the age is computed for the event date', justUnder.ageAt(EVENT_DAY) === 10,
    String(justUnder.ageAt(EVENT_DAY)));

  // A birthday the week before the tournament moves them up a year.
  const turnsEleven = new Competitor({ dateOfBirth: '2015-11-01', gender: 'male',
    weightKg: 35 });
  ok('somebody whose birthday falls just before the event is a year older',
    turnsEleven.ageAt(EVENT_DAY) === 11, String(turnsEleven.ageAt(EVENT_DAY)));

  // And the answer does not depend on when you ask.
  ok('asked about a different date it gives a different, correct answer',
    turnsEleven.ageAt('2026-10-31') === 10,
    String(turnsEleven.ageAt('2026-10-31')));
}

console.log('\nGENDER IS MATCHED, NOT GUESSED');
{
  const woman = new Competitor({ dateOfBirth: '1990-01-01', gender: 'Female',
    weightKg: 62 });
  ok('she is in the women\'s division',
    placeIn(KUMITE, woman, EVENT_DAY).division?.label === 'Adult Female Open');

  for (const written of ['F', 'female', 'Woman', 'WOMEN']) {
    ok(`"${written}" is matched to female`,
      placeIn(KUMITE, new Competitor({ dateOfBirth: '1990-01-01',
        gender: written, weightKg: 62 }), EVENT_DAY).division?.label
        === 'Adult Female Open');
  }

  // Not guessed at. A federation running divisions this does not anticipate
  // still gets exact matching rather than a wrong bracket.
  const other = new Competitor({ dateOfBirth: '1990-01-01', gender: 'non-binary',
    weightKg: 62 });
  ok('a gender no division names finds none, and says so',
    placeIn(KUMITE, other, EVENT_DAY).outcome === 'none');
}

console.log('\nWEIGHT NOBODY RECORDED IS ASKED FOR, NOT ASSUMED');
{
  const noWeight = new Competitor({ dateOfBirth: '1995-05-14', gender: 'male' });
  const r = placeIn(KUMITE, noWeight, EVENT_DAY);
  ok('the outcome is unknown', r.outcome === 'unknown', r.outcome);
  ok('and weight is what it wants', r.missing.includes('weight'),
    JSON.stringify(r.missing));
  ok('nobody is put in a bracket on a guess', r.division === null);
}

console.log('\nOVERLAPPING BANDS ARE THE ORGANISER\'S TO FIX');
{
  const overlapping = [
    new Division({ id: 'x', label: 'Lightweight', maxWeightKg: 75 }),
    new Division({ id: 'y', label: 'Middleweight', minWeightKg: 70 }),
  ];
  const r = placeIn(overlapping,
    new Competitor({ weightKg: 72 }), EVENT_DAY);
  ok('nobody is placed', r.outcome === 'ambiguous' && r.division === null,
    r.outcome);
  ok('both candidates are named', r.candidates.length === 2);
  ok('and the organiser is told which ones overlap',
    r.reasons[0].includes('Lightweight') && r.reasons[0].includes('Middleweight'),
    r.reasons[0]);
}

console.log('\nNO DIVISION AT ALL — WHAT THE FORM CALLS "NO MATCH AVAILABLE"');
{
  // Seven years old at a tournament whose youngest division starts at ten.
  const tooYoung = new Competitor({ dateOfBirth: '2019-03-01', gender: 'male',
    weightKg: 25 });
  const r = placeIn(KUMITE, tooYoung, EVENT_DAY);
  ok('the outcome is none, not an error', r.outcome === 'none', r.outcome);
  ok('and each division says why it refused',
    r.reasons.length === KUMITE.length, String(r.reasons.length));
  ok('in words an organiser can act on',
    r.reasons.some((x) => x.includes('is below 10')), JSON.stringify(r.reasons));
}

console.log('\nAN OPEN DIVISION ADMITS EVERYBODY, WITHOUT A SPECIAL CASE');
{
  const absolute = [new Division({ id: 'abs', label: 'Absolute' })];
  ok('it is recognised as open', absolute[0].isOpen);
  for (const who of [new Competitor({ dateOfBirth: '1950-01-01', weightKg: 120 }),
                     new Competitor({}),
                     new Competitor({ rankOrder: 1, gender: 'female' })]) {
    ok('somebody is admitted', placeIn(absolute, who, EVENT_DAY).outcome === 'placed');
  }
}

// ---------------------------------------------------------------------------
// the whole entry
// ---------------------------------------------------------------------------

const DISCIPLINES = [
  { id: 'kata', name: 'Kata' },
  { id: 'nck', name: 'Non-Contact Kumite' },
  { id: 'fck', name: 'Full-Contact Kumite' },
];
const BY_DISCIPLINE = { kata: KATA, nck: KUMITE, fck: KUMITE };

console.log('\nENTERING TWO OF THE THREE');
{
  const john = new Competitor({ name: 'John Smith', dateOfBirth: '1995-05-14',
    gender: 'Male', weightKg: 82, rankOrder: KYU['3rd'] });
  const r = placeEntry({ disciplines: DISCIPLINES,
    divisionsByDiscipline: BY_DISCIPLINE }, john,
    { eventDate: EVENT_DAY, wanted: ['kata', 'fck'] });

  ok('two placements come back', r.placements.length === 2);
  ok('kata by grade', r.placements[0].division?.label === 'Intermediate Kata');
  ok('kumite by age, gender and weight',
    r.placements[1].division?.label === 'Adult Male Middleweight');
  ok('the entry is ready to confirm', r.ready === true);
  ok('with nothing outstanding', r.unplaced.length === 0 && r.needs.length === 0);

  ok('the one they did not tick is not entered',
    !r.placements.some((p) => p.discipline.id === 'nck'));
}

console.log('\nAN ENTRY THAT IS NOT READY SAYS WHAT IS MISSING');
{
  const noWeight = new Competitor({ name: 'X', dateOfBirth: '1995-05-14',
    gender: 'male', rankOrder: KYU['3rd'] });
  const r = placeEntry({ disciplines: DISCIPLINES,
    divisionsByDiscipline: BY_DISCIPLINE }, noWeight,
    { eventDate: EVENT_DAY, wanted: ['kata', 'fck'] });

  ok('it is not ready', r.ready === false);
  ok('kata is still placed — one unknown does not block the rest',
    r.placements[0].outcome === 'placed');
  ok('and the one question is asked once', JSON.stringify(r.needs) === '["weight"]',
    JSON.stringify(r.needs));
}

console.log('\nA DISCIPLINE WITH NO DIVISIONS SET UP YET');
{
  const r = placeEntry({ disciplines: DISCIPLINES,
    divisionsByDiscipline: { kata: KATA } },
    new Competitor({ rankOrder: KYU['4th'] }),
    { eventDate: EVENT_DAY, wanted: ['kata', 'nck'] });
  ok('it does not crash', r.placements.length === 2);
  ok('and says so plainly',
    r.placements[1].reasons[0].includes('no divisions set up'),
    r.placements[1].reasons[0]);
}

// ---------------------------------------------------------------------------
// fees, as printed: $60 one, $70 any two, $80 all three
// ---------------------------------------------------------------------------

const PRICES = [
  { forCount: 1, amountCents: 6000 },
  { forCount: 2, amountCents: 7000 },
  { forCount: 3, amountCents: 8000 },
];

console.log('\nTHE PRICE IS FOR A COUNT, NOT PER EVENT');
{
  ok('one event is $60', priceFor(1, PRICES).amountCents === 6000);
  ok('two events are $70, not $120', priceFor(2, PRICES).amountCents === 7000);
  ok('all three are $80, not $180', priceFor(3, PRICES).amountCents === 8000);
  ok('nothing entered costs nothing', priceFor(0, PRICES).amountCents === 0);

  ok('and it reads back as money', money(7000) === '$70.00', money(7000));
}

console.log('\nMORE THAN THE ORGANISER PLANNED FOR');
{
  const r = priceFor(5, PRICES);
  ok('the top band holds rather than falling through',
    r.amountCents === 8000, String(r.amountCents));
  ok('and says why, so nobody assumes a bug',
    r.reason.includes('highest set'), r.reason);
}

console.log('\nAN EVENT WITH NO PRICES SET');
{
  const r = priceFor(2, []);
  ok('no amount is invented', r.amountCents === null);
  ok('and it says what is wrong',
    r.reason.includes('no entry prices are set'), r.reason);
}

console.log('\nA MEMBERS-ONLY PRICE IS NOT OFFERED TO A GUEST');
{
  const mixed = [
    { forCount: 1, amountCents: 4000, membersOnly: true },
    { forCount: 1, amountCents: 6000, membersOnly: false },
  ];
  ok('a member gets the member price',
    priceFor(1, mixed, { isMember: true }).amountCents === 4000);
  ok('a guest does not',
    priceFor(1, mixed, { isMember: false }).amountCents === 6000);
}

// ---------------------------------------------------------------------------
// consent — under SIXTEEN at this event, not eighteen
// ---------------------------------------------------------------------------

console.log('\nWHO HAS TO SIGN');
{
  const settings = { eventDate: EVENT_DAY, guardianUnder: 16, version: '2026.1' };

  const child = new Competitor({ dateOfBirth: '2012-01-01' });   // 14 on the day
  const adult = new Competitor({ dateOfBirth: '1995-01-01' });
  const sixteen = new Competitor({ dateOfBirth: '2010-11-07' }); // exactly 16

  ok('a fourteen-year-old needs a guardian',
    consentNeeded(child, settings).guardian === true);
  ok('and it says whose signature',
    consentNeeded(child, settings).whose.includes('guardian'));
  ok('an adult signs for themselves',
    consentNeeded(adult, settings).guardian === false);
  ok('somebody exactly sixteen on the day signs for themselves',
    consentNeeded(sixteen, settings).guardian === false,
    String(sixteen.ageAt(EVENT_DAY)));

  ok('with no date of birth, silence is not consent',
    consentNeeded(new Competitor({}), settings).unknown === true);

  // The threshold belongs to the event. An event that sets none asks for
  // nobody's guardian rather than guessing at a number.
  ok('an event with no threshold set asks for no guardian',
    consentNeeded(child, { eventDate: EVENT_DAY, version: '1' })
      .guardian === false);
}

console.log('\nA CONSENT RECORD THAT PROVES SOMETHING');
{
  const need = consentNeeded(new Competitor({ dateOfBirth: '2012-01-01' }),
    { eventDate: EVENT_DAY, guardianUnder: 16, version: '2026.1' });

  const nothing = problemsWithConsent({}, need);
  ok('an unticked declaration is refused',
    nothing.some((p) => p.includes('not been agreed')), JSON.stringify(nothing));
  ok('so is one with nobody\'s name on it',
    nothing.some((p) => p.includes('name of whoever')));
  ok('and one with no version to record against',
    nothing.some((p) => p.includes('version')));
  ok('a child\'s entry demands the guardian',
    nothing.some((p) => p.includes('parent or guardian must be named'))
    && nothing.some((p) => p.includes('contact for the parent')));

  const good = problemsWithConsent({ accepted: true, acceptedName: 'Kiri Harrison',
    version: '2026.1', guardianName: 'Kiri Harrison',
    guardianContact: '021 555 0101' }, need);
  ok('a complete one is accepted', good.length === 0, JSON.stringify(good));

  const adultNeed = consentNeeded(new Competitor({ dateOfBirth: '1995-01-01' }),
    { eventDate: EVENT_DAY, guardianUnder: 16, version: '2026.1' });
  ok('an adult is not asked for a guardian',
    problemsWithConsent({ accepted: true, acceptedName: 'John Smith',
      version: '2026.1' }, adultNeed).length === 0);
}

console.log('\nNOTHING HERE KNOWS WHAT A KATA IS');
{
  // The same code, configured as a BJJ open. If this needed changing, the
  // divisions were not really configuration.
  const bjj = [
    new Division({ id: 'b1', label: 'Gi Adult Male Feather',
      minAge: 18, gender: 'male', maxWeightKg: 70 }),
    new Division({ id: 'b2', label: 'Gi Adult Male Middle',
      minAge: 18, gender: 'male', minWeightKg: 70.01, maxWeightKg: 82.3 }),
    new Division({ id: 'b3', label: 'Gi Masters 1 Male',
      minAge: 30, gender: 'male', minWeightKg: 70.01, maxWeightKg: 82.3,
      minYearsTraining: 2 }),
  ];
  ok('a BJJ competitor is placed by the same rules',
    placeIn(bjj, new Competitor({ dateOfBirth: '2000-01-01', gender: 'male',
      weightKg: 68 }), EVENT_DAY).division?.label === 'Gi Adult Male Feather');
  ok('and an overlap between adult and masters is reported, not broken',
    placeIn(bjj, new Competitor({ dateOfBirth: '1990-01-01', gender: 'male',
      weightKg: 80, yearsTraining: 5 }), EVENT_DAY).outcome === 'ambiguous');

  // And as taekwondo, where a division judges on experience.
  const tkd = [
    new Division({ id: 't1', label: 'Poomsae Novice', maxPriorEvents: 2 }),
    new Division({ id: 't2', label: 'Poomsae Experienced', minPriorEvents: 3 }),
  ];
  ok('a first-timer is a novice',
    placeIn(tkd, new Competitor({ priorEvents: 0 }), EVENT_DAY)
      .division?.label === 'Poomsae Novice');
  ok('and somebody with five events behind them is not',
    placeIn(tkd, new Competitor({ priorEvents: 5 }), EVENT_DAY)
      .division?.label === 'Poomsae Experienced');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
