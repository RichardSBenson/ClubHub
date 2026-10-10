/** UpdatePerson and TransferMember with no database. */
import { UpdatePerson, TransferMember } from './application/change-person.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';
import { AllowAll, DenyAll } from '../infrastructure/memory/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};

function fakeRegister({ home = { organisationId: 'o1' }, membership = { id: 'm1', organisationId: 'o1' } } = {}) {
  const log = { person: [], emergency: [], affiliation: [], audit: [], ended: [], added: [] };
  return { log, async inTransaction(work) {
    return work({
      async homeOf() { return home; }, async currentMembership() { return membership; },
      async snapshotOf() { return { first_name: 'Old' }; },
      async changePerson(id, c) { log.person.push(c); }, async changeEmergencyContact(id, c) { log.emergency.push(c); },
      async changeAffiliation(id, c) { log.affiliation.push(c); }, async audit(a) { log.audit.push(a); },
      async endAffiliation(id, on) { log.ended.push([id, on]); },
      async addAffiliation(a) { log.added.push(a); return a; },
    });
  } };
}
const use = (r, auth = new AllowAll()) => new UpdatePerson({ register: r, auth });

console.log('\nUpdatePerson');
{
  const r = fakeRegister();
  await use(r).execute({ actorId: 'a', personId: 'p', fields: { firstName: 'New', emergencyPhone: '021', status: 'active' } });
  ok('changes the person', r.log.person[0].firstName === 'New');
  ok('changes the emergency contact only where given', r.log.emergency[0].phone === '021' && r.log.emergency[0].name === undefined);
  ok('changes the affiliation', r.log.affiliation[0].status === 'active');
  ok('audits before and after', r.log.audit[0].before.first_name === 'Old' && r.log.audit[0].after.firstName === 'New');
}
{
  const r = fakeRegister();
  await use(r).execute({ actorId: 'a', personId: 'p', fields: { phone: '027' } });
  ok('leaves the emergency contact alone when not given', r.log.emergency.length === 0 && r.log.affiliation.length === 0);
}
await refuses('nothing to change', () => use(fakeRegister()).execute({ actorId: 'a', personId: 'p', fields: {} }), Refused, 'Nothing to change');
await refuses('a bad date of birth is refused', () => use(fakeRegister()).execute({ actorId: 'a', personId: 'p', fields: { dateOfBirth: 'nonsense' } }), Refused);
await refuses('unknown person', () => use(fakeRegister({ home: null })).execute({ actorId: 'a', personId: 'p', fields: { phone: '1' } }), Missing);
await refuses('no register role', () => use(fakeRegister(), new DenyAll()).execute({ actorId: 'a', personId: 'p', fields: { phone: '1' } }), NotPermitted);
{
  const r = fakeRegister(); await use(r, new DenyAll()).execute({ actorId: 'a', personId: 'p', fields: { phone: '1' } }).catch(() => {});
  ok('and nothing was written', r.log.person.length === 0 && r.log.audit.length === 0);
}

console.log('\nTransferMember');
{
  const r = fakeRegister();
  await new TransferMember({ register: r, auth: new AllowAll() }).execute({ actorId: 'a', personId: 'p', toOrganisationId: 'o2', on: '2026-10-01' });
  ok('closes the old membership', r.log.ended[0][0] === 'm1' && r.log.ended[0][1] === '2026-10-01');
  ok('opens the new one as a member', r.log.added[0].organisationId === 'o2' && r.log.added[0].role === 'member');
}
await refuses('no current membership', () => new TransferMember({ register: fakeRegister({ membership: null }), auth: new AllowAll() }).execute({ actorId: 'a', personId: 'p', toOrganisationId: 'o2', on: 'x' }), Missing);
await refuses('needs the register role at both clubs', () => new TransferMember({ register: fakeRegister(), auth: new DenyAll() }).execute({ actorId: 'a', personId: 'p', toOrganisationId: 'o2', on: 'x' }), NotPermitted);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
