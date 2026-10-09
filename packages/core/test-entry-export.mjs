import { ENTRY_COLUMNS, entryRows } from './domain/entry-export.mjs';
import { toCsv } from './domain/csv.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

const member = { id: 'e1', person_id: 'p1', first_name: 'Ana', last_name: 'Smith', display_number: 'M-12',
  person_gender: 'F', date_of_birth: '2010-11-15', weight_kg: '48.50', height_cm: 158, grade: '5th kyu',
  years_training: 4, prior_events: 2, entered_for: 'Whanganui', status: 'entered', paid: true, consents: 1,
  consent_guardian: { name: 'Jo Smith', contact: '021 555 1234' }, created_at: new Date('2026-10-01T02:00:00Z'),
  selections: [{ discipline: 'Kumite', division: 'Girls 12-13' }, { discipline: 'Kata', division: null }] };
const guest = { id: 'e2', person_id: null, guest: { name: '=HYPERLINK("x") Evil', club: 'Other Dojo', grade: 'Brown' },
  status: 'entered', paid: false, consents: 0, selections: [] };

const rows = entryRows([member, guest], '2026-11-14');
const m = rows.find((r) => r.first === 'Ana');
ok('name, weight, height, grade, experience, dojo are all there',
  m.last === 'Smith' && m.weight === '48.50' && m.height === 158 && m.grade === '5th kyu'
  && m.experience === 4 && m.club === 'Whanganui');
ok('age is on the day of the event, not today', m.age === 15, m.age);
ok('the day before a birthday is still the younger age', entryRows([member], '2026-11-14')[0].age === 15
  && entryRows([member], '2026-11-15')[0].age === 16);
ok('disciplines and divisions are listed, unplaced marked', m.disciplines === 'Kumite; Kata'
  && m.divisions === 'Kumite: Girls 12-13; Kata: not placed', m.divisions);
ok('paid, declaration and guardian', m.paid === 'Yes' && m.consent === 'Yes' && m.guardian === 'Jo Smith');
const g = rows.find((r) => r.type === 'Guest');
ok('a guest is a row too, with their club and claimed grade', g.club === 'Other Dojo' && g.grade === 'Brown' && g.paid === 'No');
ok('rows are sorted by surname', rows[0].last <= rows[1].last);

const csv = toCsv(ENTRY_COLUMNS, rows);
ok('the header has every column', csv.split('\r\n')[0].includes('Weight (kg)') && csv.includes('Age on the day'));
ok('a name that is a formula is defused', !/(^|,)=HYPERLINK/.test(csv) && csv.includes("'=HYPERLINK"));
ok('an empty event is just a header', toCsv(ENTRY_COLUMNS, entryRows([], null)).trim().split('\r\n').length === 1);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
