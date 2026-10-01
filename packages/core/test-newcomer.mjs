import { readNewcomer, problemsWithNewcomer, ageToday, isChild, timeToTalk } from './domain/newcomer.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const today = '2026-10-02';
const adult = { firstName: 'Sam', lastName: 'Walker', email: 'sam@x.nz', phone: '', dateOfBirth: '1990-05-01',
  guardianName: '', guardianPhone: '', emergencyName: 'Pat', emergencyPhone: '021 555 1234', medicalNotes: '', consentName: 'Sam Walker', consentGiven: true };
const kid = { ...adult, firstName: 'Kai', dateOfBirth: '2016-03-14', guardianName: 'Mere Walker', guardianPhone: '021 555 9999', emergencyName: '', emergencyPhone: '', consentName: 'Mere Walker' };
const p = (o) => problemsWithNewcomer({ ...adult, ...o }, today);

console.log('\nAGE');
ok('born in May is 36 in October', ageToday('1990-05-01', today) === 36);
ok('the day before the 18th birthday is a child', isChild('2008-10-03', today));
ok('on the 18th birthday is an adult', !isChild('2008-10-02', today));

console.log('\nWHAT IS NEEDED');
ok('a complete adult has no problems', p({}).length === 0, p({}).join());
ok('a complete child has no problems', problemsWithNewcomer(kid, today).length === 0, problemsWithNewcomer(kid, today).join());
ok('names are needed', p({ firstName: '' }).length === 1 && p({ lastName: '' }).length === 1);
ok('a way to reach them', p({ email: '', phone: '' }).length === 1);
ok('a phone alone is enough', p({ email: '', phone: '021 1' }).length === 0);
ok('a bad email is refused', p({ email: 'sam@' }).length === 1);
ok('a date of birth is needed', p({ dateOfBirth: '' }).length === 1);
ok('a real date', p({ dateOfBirth: '2015-02-30' }).length >= 1);
ok('not the future', p({ dateOfBirth: '2027-01-01' }).length === 1);
ok('a child needs a parent\'s name and phone', problemsWithNewcomer({ ...kid, guardianName: '', guardianPhone: '' }, today).filter((x) => /parent or guardian/.test(x)).length === 2);
ok('a child\'s parent\'s phone covers the emergency contact', problemsWithNewcomer({ ...kid, emergencyPhone: '' }, today).length === 0);
ok('an adult needs an emergency contact', p({ emergencyPhone: '' }).length === 1);
ok('the waiver must be accepted', p({ consentGiven: false }).length === 1);
ok('and by somebody named', p({ consentName: '' }).length === 1);

console.log('\nREADING A FORM');
const r = readNewcomer({ firstName: '  Sam ', email: ' SAM@X.NZ ', consent: '1', medicalNotes: 'asthma\r\ninhaler', consentName: 'Sam' });
ok('trimmed and lower-cased', r.firstName === 'Sam' && r.email === 'sam@x.nz');
ok('consent is a tick', r.consentGiven === true && readNewcomer({}).consentGiven === false);
ok('medical notes keep their lines', r.medicalNotes === 'asthma\ninhaler');
ok('time to talk after three classes', !timeToTalk(2) && timeToTalk(3));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
