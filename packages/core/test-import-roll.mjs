/** ImportRoll and ReadRoll with no database. */
import { ImportRoll, ReadRoll } from './application/import-roll.mjs';
import { Refused, NotPermitted } from './application/ports.mjs';
import { AllowAll, DenyAll } from '../infrastructure/memory/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
function register() {
  const log = { people: [], affiliations: [], emergency: [], grades: [], audit: [], locked: 0 };
  return { log, async inTransaction(work) {
    return work({
      async lockEnrolment() { log.locked++; }, async federationShortNameFor() { return 'MOKNZ'; }, async lastNumberIn() { return 9; },
      async addPerson(p) { const r = { id: 'p' + (log.people.length + 1), ...p }; log.people.push(r); return r; },
      async addEmergencyContact(...a) { log.emergency.push(a); }, async addAffiliation(a) { log.affiliations.push(a); },
      async recordHeldGrade(g) { log.grades.push(g); }, async audit(a) { log.audit.push(a); },
      async rollOf() { return [{ id: 'x' }]; },
    });
  } };
}
const row = (n, extra = {}) => ({ action: 'add', line: n, values: { firstName: ' Ana ', lastName: 'T', ...extra } });

console.log('\nImportRoll');
{ const r = register();
  const out = await new ImportRoll({ register: r, auth: new AllowAll() }).execute({ actorId: 'a', organisationId: 'o', rows: [row(2, { gradeId: 'g1', emergencyPhone: '021' }), row(3), { action: 'skip', line: 4, values: {} }] });
  ok('adds only the rows planned as add', out.added === 2 && r.log.people.length === 2);
  ok('numbers them on from the last used', out.created[0].number === 'MOKNZ-0010' && out.created[1].number === 'MOKNZ-0011');
  ok('a held grade is recorded as held, not awarded', out.graded === 1 && /not graded through this system/.test(r.log.grades[0].note));
  ok('emergency contact only where there is one', r.log.emergency.length === 1);
  ok('one audit entry for the whole import', r.log.audit.length === 1 && r.log.audit[0].after.numbers.length === 2);
  ok('trims names', r.log.people[0].firstName === 'Ana'); }
await refuses('nothing to import', () => new ImportRoll({ register: register(), auth: new AllowAll() }).execute({ actorId: 'a', organisationId: 'o', rows: [] }), Refused, 'nothing to import');
await refuses('needs the register role', () => new ImportRoll({ register: register(), auth: new DenyAll() }).execute({ actorId: 'a', organisationId: 'o', rows: [row(2)] }), NotPermitted);
ok('reads the roll', (await new ReadRoll({ register: register(), auth: new AllowAll() }).execute({ actorId: 'a', organisationId: 'o' })).length === 1);
await refuses('reading needs the register role too', () => new ReadRoll({ register: register(), auth: new DenyAll() }).execute({ actorId: 'a', organisationId: 'o' }), NotPermitted);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
