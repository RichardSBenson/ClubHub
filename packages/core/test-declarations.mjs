/** The declaration use cases with no database. */
import { DeclarationStanding, PublishDeclaration, SignDeclaration } from './application/declarations.mjs';
import { Refused, NotPermitted } from './application/ports.mjs';
import { AllowAll, DenyAll } from '../infrastructure/memory/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
function store({ current = { id: 'd1', version: '1' }, signed = null, age = 30, home = 'o1', used = false } = {}) {
  const log = { signings: [], published: [] };
  return { log,
    async ownerOf() { return { id: 'fed' }; }, async currentOf() { return current; }, async firstHomeOf() { return home; },
    async signingOf() { return log.signings.length ? { signed_name: 'x' } : signed; }, async ageOf() { return age; },
    async addSigning(s) { log.signings.push(s); }, async publish(p) { if (used) return null; log.published.push(p); return { id: 'd2', version: p.version }; },
    async signedAmong() { return new Set(); }, async signedCount() { return 0; } };
}
const sign = (st, how = 'self') => new SignDeclaration({ store: st, standing: new DeclarationStanding({ store: st }), howMayActFor: async () => how, adultAge: () => 18 });

console.log('\nDeclarationStanding');
ok('nothing published', (await new DeclarationStanding({ store: store({ current: null }) }).execute({ personId: 'p' })).state === 'none');
ok('to sign', (await new DeclarationStanding({ store: store() }).execute({ personId: 'p' })).state === 'unsigned');
ok('signed', (await new DeclarationStanding({ store: store({ signed: { signed_name: 'x' } }) }).execute({ personId: 'p' })).state === 'signed');
ok('no club, nothing to sign', (await new DeclarationStanding({ store: store({ home: null }) }).execute({ personId: 'p' })).state === 'none');

console.log('\nPublishDeclaration');
{ const st = store(); await new PublishDeclaration({ store: st, auth: new AllowAll() }).execute({ actorId: 'a', organisationId: 'o', version: ' 2026.1 ', body: ' I agree to train safely, to follow the instructions of my instructors, and to tell them about any injury or illness. ' });
  ok('trims and publishes under the owner', st.log.published[0].version === '2026.1' && st.log.published[0].ownerId === 'fed'); }
await refuses('needs the register role', () => new PublishDeclaration({ store: store(), auth: new DenyAll() }).execute({ actorId: 'a', organisationId: 'o', version: '1', body: 'I agree to train safely and follow my instructors.' }), NotPermitted);
await refuses('needs a version', () => new PublishDeclaration({ store: store(), auth: new AllowAll() }).execute({ actorId: 'a', organisationId: 'o', version: '', body: 'b' }), Refused);
await refuses('a used version', () => new PublishDeclaration({ store: store({ used: true }), auth: new AllowAll() }).execute({ actorId: 'a', organisationId: 'o', version: '1', body: 'I agree to train safely and follow my instructors.' }), Refused, 'already been used');

console.log('\nSignDeclaration');
{ const st = store(); const out = await sign(st).execute({ actorId: 'a', personId: 'p', accepted: true, name: ' Ana T ' });
  ok('records the signing, trimmed, not as a guardian', st.log.signings[0].name === 'Ana T' && st.log.signings[0].guardian === false);
  ok('and returns signed', out.state === 'signed'); }
{ const st = store({ age: 9 }); await sign(st, 'guardian').execute({ actorId: 'a', personId: 'p', accepted: true, name: 'Mum' });
  ok('a guardian signing for a child is recorded as one', st.log.signings[0].guardian === true); }
await refuses('a child cannot sign for themselves', () => sign(store({ age: 9 })).execute({ actorId: 'a', personId: 'p', accepted: true, name: 'Kid' }), Refused, 'parent or guardian');
await refuses('must tick the box', () => sign(store()).execute({ actorId: 'a', personId: 'p', accepted: false, name: 'Ana' }), Refused, 'Tick');
await refuses('a stranger may not sign', () => sign(store(), null).execute({ actorId: 'a', personId: 'p', accepted: true, name: 'X' }), NotPermitted);
await refuses('nothing to sign yet', () => sign(store({ current: null })).execute({ actorId: 'a', personId: 'p', accepted: true, name: 'X' }), Refused, 'no declaration');
{ const st = store({ signed: { signed_name: 'x' } }); const out = await sign(st).execute({ actorId: 'a', personId: 'p', accepted: true, name: 'X' });
  ok('already signed: nothing recorded twice', out.state === 'signed' && st.log.signings.length === 0); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
