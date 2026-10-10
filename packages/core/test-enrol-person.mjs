/** EnrolPerson with no database: a fake register, a fake authorisation, a fake announcer. */
import { EnrolPerson } from './application/enrol-person.mjs';
import { Refused, NotPermitted } from './application/ports.mjs';
import { AllowAll, DenyAll } from '../infrastructure/memory/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); }
  catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};

function fakeRegister(existing = [], shortName = 'MOKNZ') {
  const log = { people: [], affiliations: [], emergency: [], audit: [], locked: 0, committed: false };
  return { log, async inTransaction(work) {
    const tx = {
      async lockEnrolment() { log.locked++; },
      async peopleNamed() { return existing; },
      async federationShortNameFor() { return shortName; },
      async lastNumberIn() { return existing.length + log.people.length + 41; },
      async addPerson(p) { const row = { id: 'p' + (log.people.length + 1), first_name: p.firstName, last_name: p.lastName, number: p.number }; log.people.push(row); return row; },
      async addEmergencyContact(id, n, ph) { log.emergency.push([id, n, ph]); },
      async addAffiliation(a) { log.affiliations.push(a); },
      async audit(a) { log.audit.push(a); },
    };
    const r = await work(tx); log.committed = true; return r;
  } };
}
const announced = [];
const announcer = { async announce(...a) { announced.push(a); } };
const base = { actorId: 'a1', organisationId: 'o1', firstName: ' Aroha ', lastName: 'Smith', dateOfBirth: '2001-02-03', email: 'a@example.com' };

console.log('\nEnrolPerson');
{
  const register = fakeRegister();
  const person = await new EnrolPerson({ register, auth: new AllowAll(), announcer }).execute({ ...base, emergencyName: 'Mum', emergencyPhone: '021' });
  ok('numbers the member from the federation prefix', person.number === 'MOKNZ-0042');
  ok('trims the name', register.log.people[0].first_name === 'Aroha');
  ok('takes the emergency contact', register.log.emergency.length === 1);
  ok('affiliates them to the organisation', register.log.affiliations[0].organisationId === 'o1');
  ok('audits it', register.log.audit[0].action === 'enrol' && register.log.audit[0].after.number === 'MOKNZ-0042');
  ok('locks so a double submit cannot pass twice', register.log.locked === 1);
  ok('announces member.created after the commit', announced[0]?.[1] === 'member.created' && register.log.committed);
}
{
  const register = fakeRegister();
  await new EnrolPerson({ register, auth: new AllowAll(), announcer }).execute({ ...base });
  ok('no emergency contact row when none is given', register.log.emergency.length === 0);
}
await refuses('nobody without the register role', () => new EnrolPerson({ register: fakeRegister(), auth: new DenyAll(), announcer }).execute(base), NotPermitted);
await refuses('a missing last name is refused', () => new EnrolPerson({ register: fakeRegister(), auth: new AllowAll(), announcer }).execute({ ...base, lastName: '' }), Refused);
await refuses('the same person twice is refused, saying where the first is',
  () => new EnrolPerson({ register: fakeRegister([{ display_number: 'MOKNZ-0007', first_name: 'Aroha', last_name: 'Smith', date_of_birth: '2001-02-03', email: null }]), auth: new AllowAll(), announcer }).execute(base),
  Refused, 'MOKNZ-0007');
{
  const before = announced.length;
  await refuses('a refusal announces nothing', () => new EnrolPerson({ register: fakeRegister(), auth: new AllowAll(), announcer }).execute({ ...base, firstName: '' }), Refused);
  ok('and so nothing went out', announced.length === before);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
