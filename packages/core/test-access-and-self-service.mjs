/** GrantAccess and SelfService with no database. */
import { GrantAccess } from './application/grant-access.mjs';
import { SelfService } from './application/self-service.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';
import { AllowAll, DenyAll } from '../infrastructure/memory/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const ana = { id: 'ana', first_name: 'Ana', last_name: 'T', email: 'Ana@Example.com', dob: '2000-01-01' };
function register({ person = ana, home = 'o1', owner = null } = {}) {
  const log = { roles: [], audit: [], accounts: [] };
  return { log, async inTransaction(work) { return work({
    async personForAccess() { return person; }, async defaultHomeFor() { return home; }, async accountByEmail() { return owner; },
    async upsertAccount(p, a) { log.accounts.push(a); return { id: 'acc', email: a }; },
    async grantRole(r) { log.roles.push(r); }, async audit(a) { log.audit.push(a); },
  }); } };
}
console.log('\nGrantAccess');
{ const r = register(); const out = await new GrantAccess({ register: r, auth: new AllowAll() }).execute({ actorId: 'a', personId: 'ana', role: 'instructor' });
  ok('lower-cases the address from their record', r.log.accounts[0] === 'ana@example.com');
  ok('grants the role at their home club', r.log.roles[0].organisationId === 'o1' && r.log.roles[0].role === 'instructor');
  ok('audited', r.log.audit[0].action === 'grant_access'); ok('hands back the account', out.account.id === 'acc'); }
await refuses('unknown person', () => new GrantAccess({ register: register({ person: null }), auth: new AllowAll() }).execute({ actorId: 'a', personId: 'x' }), Missing);
await refuses('no affiliation', () => new GrantAccess({ register: register({ home: null }), auth: new AllowAll() }).execute({ actorId: 'a', personId: 'ana' }), Missing);
await refuses('needs MANAGE', () => new GrantAccess({ register: register(), auth: new DenyAll() }).execute({ actorId: 'a', personId: 'ana' }), NotPermitted);
await refuses('no address on file', () => new GrantAccess({ register: register({ person: { ...ana, email: '' } }), auth: new AllowAll() }).execute({ actorId: 'a', personId: 'ana' }), Refused, 'no email');
await refuses('not an address', () => new GrantAccess({ register: register(), auth: new AllowAll() }).execute({ actorId: 'a', personId: 'ana', email: 'nope' }), Refused, 'does not look');
await refuses('somebody else owns it, and it says who', () => new GrantAccess({ register: register({ owner: { person_id: 'bob', first_name: 'Bob', last_name: 'Q', display_number: 'M-0002', dob: '1970-01-01' } }), auth: new AllowAll() }).execute({ actorId: 'a', personId: 'ana' }), Refused, 'Bob Q');
await refuses('the same person entered twice is called that', () => new GrantAccess({ register: register({ owner: { person_id: 'ana2', first_name: 'ana', last_name: 't', display_number: 'M-0003', dob: '2000-01-01' } }), auth: new AllowAll() }).execute({ actorId: 'a', personId: 'ana' }), Refused, 'same person entered twice');

console.log('\nSelfService');
const reads = (fees = { anySet: false, guardianIds: [] }) => ({
  async selfOf(acc) { return acc === 'mum-acc' ? { id: 'mum' } : null; },
  async dependantsOf() { return [{ id: 'kid' }]; }, async personIdOf() { return 'mum'; }, async feePayersOf() { return fees; } });
const svc = (f) => new SelfService({ reads: reads(f), adultAge: () => 18 });
ok('yourself', await svc().mayActFor('mum-acc', 'mum') === 'self');
ok('your child', await svc().mayActFor('mum-acc', 'kid') === 'guardian');
ok('a stranger gets nothing', await svc().mayActFor('mum-acc', 'other') === null);
ok('no person, nothing', await svc().mayActFor('ghost', 'kid') === null);
await refuses('assert refuses a stranger', () => svc().assertMayActFor('mum-acc', 'other'), NotPermitted);
ok('pays for yourself', await svc().mayPayFor('mum-acc', 'mum') === true);
ok('pays for a child when nobody is marked', await svc().mayPayFor('mum-acc', 'kid') === true);
ok('and when she is the one marked', await svc({ anySet: true, guardianIds: ['mum'] }).mayPayFor('mum-acc', 'kid') === true);
ok('but not when somebody else is marked', await svc({ anySet: true, guardianIds: ['dad'] }).mayPayFor('mum-acc', 'kid') === false);
ok('and never for a stranger', await svc().mayPayFor('mum-acc', 'other') === false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
