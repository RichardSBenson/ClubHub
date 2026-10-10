/** AddClub with no database. */
import { AddClub } from './application/add-club.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const yes = { async hasRoleAt() { return true; } }, no = { async hasRoleAt() { return false; } };
function orgs({ parent = { id: 'fed', type: 'federation', name: 'MOKNZ', path: 'moknz' }, taken = [], accounts = [] } = {}) {
  const log = { added: [] };
  return { log, async organisationById() { return parent; }, async slugTaken(s) { return taken.includes(s); },
    async emailHasAccount(e) { return accounts.includes(e); }, async addClub(c) { log.added.push(c); return { id: 'club1', ...c }; } };
}
const calls = { enrol: [], grant: [] };
const make = (o, auth = yes, extra = {}) => new AddClub({ organisations: o, auth,
  enrol: async (a, f) => { calls.enrol.push(f); return { id: 'person1' }; },
  grantAccess: async (a, id, f) => { calls.grant.push(f); return { account: { id: 'acc' } }; }, ...extra });
const input = { name: 'Taupo Karate', adminFirst: 'Hana', adminLast: 'T', adminEmail: 'hana@example.com', city: 'Taupo' };

console.log('\nAddClub');
{ const o = orgs(); const out = await make(o).execute({ actorId: 'a', parentId: 'fed', input });
  ok('derives the web address from the name', o.log.added[0].slug === 'taupo-karate');
  ok('passes the city and who added it', o.log.added[0].city === 'Taupo' && o.log.added[0].addedBy === 'a');
  ok('enrols the administrator at the new club', calls.enrol[0].organisationId === 'club1' && calls.enrol[0].role === 'member');
  ok('and gives them administrator access there', calls.grant[0].role === 'administrator' && calls.grant[0].organisationId === 'club1');
  ok('returns both', out.club.id === 'club1' && out.admin.account.id === 'acc'); }
{ const o = orgs(); await make(o).execute({ actorId: 'a', parentId: 'fed', input: { name: 'No Admin Dojo' } });
  ok('no administrator named: only the club', calls.enrol.length === 1 && o.log.added.length === 1); }
await refuses('needs MANAGE at the parent', () => make(orgs(), no).execute({ actorId: 'a', parentId: 'fed', input }), NotPermitted);
await refuses('unknown parent', () => make(orgs({ parent: null })).execute({ actorId: 'a', parentId: 'x', input }), Missing);
await refuses('a club cannot have clubs', () => make(orgs({ parent: { id: 'c', type: 'club', path: 'x' } })).execute({ actorId: 'a', parentId: 'c', input }), Refused, 'cannot have clubs');
await refuses('a taken web address', () => make(orgs({ taken: ['taupo-karate'] })).execute({ actorId: 'a', parentId: 'fed', input }), Refused, 'already an organisation');
await refuses('an administrator who already has an account', () => make(orgs({ accounts: ['hana@example.com'] })).execute({ actorId: 'a', parentId: 'fed', input }), Refused, 'already has an account');
await refuses('a nameless club', () => make(orgs()).execute({ actorId: 'a', parentId: 'fed', input: { name: '' } }), Refused);
{ const o = orgs(); let e2;
  try { await make(o, yes, { grantAccess: async () => { throw new Error('boom'); } }).execute({ actorId: 'a', parentId: 'fed', input }); } catch (e) { e2 = e; }
  ok('if the administrator step fails, the error carries the club that now exists', e2?.club?.id === 'club1'); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
