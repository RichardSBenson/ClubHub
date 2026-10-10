/** The guardian use cases with no database. */
import { LinkGuardian, SetGuardianContact, UnlinkGuardian, ListGuardians } from './application/guardians.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const auth = (allowed) => ({ async hasRoleAt(actor, org) { return allowed.includes(org); } });
const people = {
  mum: { id: 'mum', first_name: 'Mere', last_name: 'T', date_of_birth: '1985-01-01' },
  kid: { id: 'kid', first_name: 'Ana', last_name: 'T', date_of_birth: '2018-01-01' },
  adult: { id: 'adult', first_name: 'Hone', last_name: 'T', date_of_birth: '1990-01-01' },
};
function register({ links = [] } = {}) {
  const log = { audit: [], added: [], ended: [], contact: [] };
  return { log, async inTransaction(work) {
    return work({
      async personById(id) { return people[id] ?? null; },
      async homesOf() { return ['club1', 'club2']; },
      async linkById(id) { return links.find((l) => l.id === id) ?? null; },
      async addLink(l) { if (links.some((x) => x.guardian_id === l.guardianId)) return null; log.added.push(l); return { id: 'L', ...l }; },
      async chooseContact(link, c) { log.contact.push(c); },
      async endLink(id) { log.ended.push(id); },
      async guardiansOf() { return [{ id: 'L' }]; },
      async audit(a) { log.audit.push(a); },
    });
  } };
}
const link = { id: 'L1', child_id: 'kid', guardian_id: 'mum', g_first: 'Mere', g_last: 'T', c_first: 'Ana', c_last: 'T' };
const linker = (r, a = auth(['club2'])) => new LinkGuardian({ register: r, auth: a, adultAge: () => 18 });

console.log('\nLinkGuardian');
{ const r = register(); await linker(r).execute({ actorId: 'a', guardianId: 'mum', childId: 'kid' });
  ok('links them', r.log.added.length === 1);
  ok('audited at the club where the actor is a registrar, not the first club', r.log.audit[0].organisationId === 'club2'); }
await refuses('a registrar at neither club is refused', () => linker(register(), auth(['elsewhere'])).execute({ actorId: 'a', guardianId: 'mum', childId: 'kid' }), NotPermitted);
await refuses('somebody cannot guard an adult', () => linker(register()).execute({ actorId: 'a', guardianId: 'mum', childId: 'adult' }), Refused);
await refuses('unknown person', () => linker(register()).execute({ actorId: 'a', guardianId: 'nobody', childId: 'kid' }), Missing);
await refuses('already linked', () => linker(register({ links: [link] })).execute({ actorId: 'a', guardianId: 'mum', childId: 'kid' }), Refused, 'already linked');

console.log('\nSetGuardianContact, UnlinkGuardian, ListGuardians');
{ const r = register({ links: [link] }); await new SetGuardianContact({ register: r, auth: auth(['club1']) }).execute({ actorId: 'a', linkId: 'L1', main: true, copy: true });
  ok('a main contact is never also "copied in"', r.log.contact[0].main === true && r.log.contact[0].copy === false);
  ok('and it is audited', r.log.audit[0].action === 'guardian_contact'); }
{ const r = register({ links: [link] }); await new UnlinkGuardian({ register: r, auth: auth(['club1']) }).execute({ actorId: 'a', linkId: 'L1' });
  ok('ends the link and records who', r.log.ended[0] === 'L1' && r.log.audit[0].after.guardian === 'Mere T'); }
await refuses('no such link', () => new UnlinkGuardian({ register: register(), auth: auth(['club1']) }).execute({ actorId: 'a', linkId: 'zzz' }), Missing);
await refuses('listing needs a registrar', () => new ListGuardians({ register: register(), auth: auth([]) }).execute({ actorId: 'a', childId: 'kid' }), NotPermitted);
ok('a registrar may list', (await new ListGuardians({ register: register(), auth: auth(['club1']) }).execute({ actorId: 'a', childId: 'kid' })).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
