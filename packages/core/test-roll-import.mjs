/**
 * Reading a club's spreadsheet, with no database anywhere.
 *
 * The rows here are the shapes real rolls actually arrive in: headings nobody
 * agreed on, dates written six ways, a name in one column, the same person
 * entered twice, a belt spelled differently from the syllabus.
 */

import { parseTable, splitLine, detectDelimiter, mapHeaders, readDate, planImport }
  from './domain/roll-import.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const LADDER = [
  { id: 'g1', label: '10th kyu', shortLabel: '10k', rankOrder: 1 },
  { id: 'g9', label: '2nd kyu', shortLabel: '2k', rankOrder: 9 },
  { id: 'g10', label: '1st kyu', shortLabel: '1k', rankOrder: 10 },
  { id: 'g11', label: 'Shodan', shortLabel: '1d', rankOrder: 11 },
];

const plan = (text, opts = {}) =>
  planImport(parseTable(text), { grades: LADDER, today: '2026-09-30', ...opts });

// ---------------------------------------------------------------------------

console.log('\nWHAT COMES OFF THE CLIPBOARD');
{
  // Selecting cells in Excel or Google Sheets and pressing copy gives tabs.
  const t = 'First Name\tLast Name\tEmail\nAroha\tTe Rangi\taroha@example.nz';
  ok('tabs are detected', detectDelimiter(t) === '\t');
  const { headers, rows } = parseTable(t);
  ok('the heading row is separated', headers.length === 3, JSON.stringify(headers));
  ok('and the data row read', rows[0][1] === 'Te Rangi', JSON.stringify(rows));
}

console.log('\nA SAVED CSV WORKS TOO');
{
  ok('commas are detected', detectDelimiter('a,b,c\n1,2,3') === ',');
  ok('and semicolons, which European exports use',
    detectDelimiter('a;b;c\n1;2;3') === ';');
  ok('a quoted comma does not split the field',
    splitLine('"Smith, Jr",Wellington', ',')[0] === 'Smith, Jr',
    JSON.stringify(splitLine('"Smith, Jr",Wellington', ',')));
  ok('a doubled quote is one quote',
    splitLine('"He said ""go""",x', ',')[0] === 'He said "go"');
}

console.log('\nNOBODY USES OUR WORDS FOR THE COLUMNS');
{
  ok('given/family names',
    JSON.stringify(mapHeaders(['Given Name', 'Family Name']))
      === '["firstName","lastName"]');
  ok('surname and DOB',
    JSON.stringify(mapHeaders(['Surname', 'D.O.B.']))
      === '["lastName","dateOfBirth"]');
  ok('mobile is a phone number',
    mapHeaders(['Mobile'])[0] === 'phone');
  ok('but an emergency number is not the member\'s phone',
    JSON.stringify(mapHeaders(['Emergency Contact', 'Emergency Phone', 'Mobile']))
      === '["emergencyName","emergencyPhone","phone"]');
  ok('a column we do not use is left alone, not guessed at',
    mapHeaders(['Locker number'])[0] === null);
  ok('and spacing and case do not matter',
    mapHeaders(['  first_name ', 'LASTNAME'])[0] === 'firstName');
}

console.log('\nDATES, AS PEOPLE ACTUALLY WRITE THEM');
{
  ok('already unambiguous', readDate('2015-04-03').date === '2015-04-03');
  ok('written out', readDate('5 March 2015').date === '2015-03-05');
  ok('abbreviated', readDate('5 Mar 15').date === '2015-03-05');
  ok('month first', readDate('March 5, 2015').date === '2015-03-05');
  ok('a day above twelve settles it', readDate('25/12/2015').date === '2015-12-25');
  ok('and so does a month above twelve the other way',
    readDate('12/25/2015').date === '2015-12-25');
  ok('dots and dashes work too', readDate('25.12.2015').date === '2015-12-25');

  // The one that silently ruins a register.
  const both = readDate('03/04/2015');
  ok('a date that could be read two ways is refused, not guessed',
    both.date === null && both.problem.includes('could be'), JSON.stringify(both));
  ok('and it says exactly what to write instead',
    both.problem.includes('2015-04-03'), both.problem);

  ok('a founding member born in 65 is not born in 2065',
    readDate('14/08/65').date === '1965-08-14', JSON.stringify(readDate('14/08/65')));
  ok('while a child born in 15 is',
    readDate('14/08/15').date === '2015-08-14');

  ok('the 31st of February is refused',
    readDate('2015-02-31').date === null);
  ok('not a date at all is refused',
    readDate('sometime in the winter').date === null);
  ok('and an empty cell is simply empty',
    readDate('').date === null && !readDate('').problem);
}

console.log('\nA ROLL THAT IS FINE');
{
  const r = plan(
    'First Name\tLast Name\tDOB\tEmail\tGrade\n'
    + 'Aroha\tTe Rangi\t14/08/2009\taroha@example.nz\t2nd kyu\n'
    + 'Sam\tPatel\t03 June 1988\tsam@example.nz\tShodan\n');
  ok('both rows would be added', r.counts.add === 2, JSON.stringify(r.counts));
  ok('nothing is refused', r.counts.refuse === 0);
  ok('the dates are resolved', r.plan[0].values.dateOfBirth === '2009-08-14',
    r.plan[0].values.dateOfBirth);
  ok('the grade is matched to the federation\'s own ladder',
    r.plan[0].values.gradeId === 'g9', JSON.stringify(r.plan[0].notes));
  ok('and said so plainly',
    r.plan[0].notes.some((n) => n.includes('already held')));
  ok('everybody defaults to member',
    r.plan.every((p) => p.values.role === 'member'));
}

console.log('\nONE NAME IN ONE COLUMN');
{
  const r = plan('Name\tEmail\nAroha Te Rangi\taroha@example.nz\n'
               + 'Sam van der Berg\tsam@example.nz\n');
  ok('it is split', r.plan[0].values.firstName === 'Aroha'
    && r.plan[0].values.lastName === 'Te Rangi',
    JSON.stringify(r.plan[0].values));
  ok('and a multi-word surname stays whole',
    r.plan[1].values.lastName === 'van der Berg', r.plan[1].values.lastName);
}

console.log('\nWHAT IS WRONG IS SAID PER ROW, NOT PER FILE');
{
  const r = plan(
    'First Name\tLast Name\tDOB\tEmail\n'
    + 'Aroha\tTe Rangi\t14/08/2009\taroha@example.nz\n'
    + '\tPatel\t03/04/2015\tnot-an-email\n'
    + 'Mere\tWirepa\t2030-01-01\tmere@example.nz\n');

  ok('the good row is still going in', r.counts.add === 1, JSON.stringify(r.counts));
  ok('two rows are refused', r.counts.refuse === 2);

  const bad = r.plan[1];
  ok('a missing name is reported',
    bad.problems.some((p) => p.includes('first name')), JSON.stringify(bad.problems));
  ok('the ambiguous date too', bad.problems.some((p) => p.includes('could be')));
  ok('and the email, all three at once',
    bad.problems.some((p) => p.includes('email')) && bad.problems.length >= 3,
    JSON.stringify(bad.problems));

  ok('a date of birth in the future is caught',
    r.plan[2].problems.some((p) => p.includes('future')),
    JSON.stringify(r.plan[2].problems));

  ok('each problem is tied to the line in their spreadsheet',
    r.plan[1].line === 3 && r.plan[2].line === 4,
    JSON.stringify(r.plan.map((p) => p.line)));
}

console.log('\nSOMEBODY ALREADY ON THE ROLL IS NOT ADDED TWICE');
{
  const existing = [
    { id: 'p1', firstName: 'Aroha', lastName: 'Te Rangi',
      email: 'aroha@example.nz', dateOfBirth: '2009-08-14' },
  ];
  const r = plan('First Name\tLast Name\tEmail\n'
               + 'Aroha\tTe Rangi\taroha@example.nz\n'
               + 'Sam\tPatel\tsam@example.nz\n', { existing });
  ok('the one already there is marked a duplicate',
    r.plan[0].action === 'duplicate', r.plan[0].action);
  ok('and points at the record it matched', r.plan[0].matchedId === 'p1');
  ok('the new one is still added', r.counts.add === 1, JSON.stringify(r.counts));

  // Matched on email even when the spelling of the name has changed.
  const renamed = plan('First Name\tLast Name\tEmail\n'
                     + 'Aroha\tTe-Rangi\tAROHA@example.nz\n', { existing });
  ok('a changed surname and different case still matches on email',
    renamed.plan[0].action === 'duplicate', renamed.plan[0].action);

  // And on name plus date of birth when there is no email at all.
  const noEmail = plan('First Name\tLast Name\tDOB\n'
                     + 'Aroha\tTe Rangi\t14/08/2009\n', { existing });
  ok('no email still matches on name and date of birth',
    noEmail.plan[0].action === 'duplicate', noEmail.plan[0].action);
}

console.log('\nTHE SAME PERSON TWICE IN ONE SPREADSHEET');
{
  const r = plan('First Name\tLast Name\tEmail\n'
               + 'Sam\tPatel\tsam@example.nz\n'
               + 'Sam\tPatel\tsam@example.nz\n');
  ok('only one is added', r.counts.add === 1, JSON.stringify(r.counts));
  ok('the second is a duplicate', r.plan[1].action === 'duplicate');
  ok('and says which line it repeats',
    r.plan[1].notes.some((n) => n.includes('line 2')), JSON.stringify(r.plan[1].notes));
}

console.log('\nA BELT THAT IS NOT IN THE SYLLABUS');
{
  const r = plan('First Name\tLast Name\tGrade\nSam\tPatel\tPurple belt\n');
  ok('the person is still imported', r.counts.add === 1, JSON.stringify(r.counts));
  ok('without a grade', !r.plan[0].values.gradeId);
  ok('and it says so rather than dropping it silently',
    r.plan[0].notes.some((n) => n.includes('not a grade')),
    JSON.stringify(r.plan[0].notes));
}

console.log('\nBELTS SPELLED LOOSELY STILL MATCH');
{
  for (const [written, id] of [['1st kyu', 'g10'], ['1 kyu', 'g10'],
                               ['1K', 'g10'], ['shodan', 'g11'],
                               ['  2nd Kyu  ', 'g9']]) {
    const r = plan(`First Name\tLast Name\tGrade\nX\tY\t${written}\n`);
    ok(`"${written}" finds its grade`, r.plan[0].values.gradeId === id,
      String(r.plan[0].values.gradeId));
  }
}

console.log('\nROLES ARE TRANSLATED, NOT REFUSED');
{
  const r = plan('First Name\tLast Name\tType\n'
               + 'A\tB\tInstructor\n'
               + 'C\tD\tSenior student\n'
               + 'E\tF\tLife Member\n');
  ok('an instructor is an instructor', r.plan[0].values.role === 'instructor');
  ok('a senior student is a member', r.plan[1].values.role === 'member');
  ok('something we do not recognise falls back rather than failing',
    r.plan[2].values.role === 'member' && r.plan[2].action === 'add');
  ok('and says what it did',
    r.plan[2].notes.some((n) => n.includes('not a role')),
    JSON.stringify(r.plan[2].notes));
}

console.log('\nA SPREADSHEET MISSING WHAT IT NEEDS');
{
  const r = plan('Email\tPhone\nsam@example.nz\t0211234567\n');
  ok('it says which columns are missing',
    r.missing.includes('firstName') && r.missing.includes('lastName'),
    JSON.stringify(r.missing));
  ok('rather than silently importing nobodies', r.counts.refuse === 1);
}

console.log('\nCOLUMNS WE DO NOT USE ARE REPORTED, NOT IGNORED');
{
  const r = plan('First Name\tLast Name\tLocker\tSubs paid by\n'
               + 'Sam\tPatel\t14\tDirect debit\n');
  ok('the unused headings are listed',
    r.unmapped.includes('Locker') && r.unmapped.includes('Subs paid by'),
    JSON.stringify(r.unmapped));
  ok('and the row still imports', r.counts.add === 1);
}

console.log('\nBLANK LINES AND STRAY WHITESPACE');
{
  const r = plan('First Name\tLast Name\n\nSam\tPatel\n\n\n  \t \n');
  ok('empty lines are skipped, not counted as people',
    r.counts.add === 1 && r.plan.length === 1,
    JSON.stringify(r.counts) + ' ' + r.plan.length);
}

console.log('\nNOTHING IS DECIDED BY THIS — IT ONLY SAYS WHAT WOULD HAPPEN');
{
  const r = plan('First Name\tLast Name\nSam\tPatel\n');
  ok('every row carries an action', r.plan.every((p) => p.action));
  ok('and the totals match the rows',
    r.counts.add + r.counts.duplicate + r.counts.refuse === r.plan.length);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
