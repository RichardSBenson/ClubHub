/** The instructor-profile use cases with no database. */
import { InstructorReadiness, InstructorStates, SaveInstructorProfile, RemoveInstructorProfile, BulkInstructors, ListInstructorProfiles }
  from './application/instructor-profiles.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const yes = { async hasRoleAt() { return true; } }, no = { async hasRoleAt() { return false; } };
function store({ dob = '1980-01-01', about = 'I teach.', required = [], awards = [], isInstructor = true, profile = null, members = new Map([['p', 'club']]), rows = [] } = {}) {
  const log = { saved: [], removed: 0, audit: [] };
  const s = { log, async atomically(w) { return w(s); },
    async personForReadiness() { return { dob, about }; }, async settingsOf() { return {}; }, async todayAt() { return '2026-10-10'; },
    async instructorQualifications() { return required; }, async awardsOf() { return awards; }, async instructorRows() { return rows; },
    async membersWithin() { return members; }, async nameOf() { return 'Ana T'; }, async profileOf() { return profile; },
    async personForProfile() { return { id: 'p', date_of_birth: dob, is_instructor: isInstructor }; },
    async saveProfile(p) { log.saved.push(p); return { id: 'prof', published: p.published }; },
    async removeProfile() { log.removed++; return profile ?? null; }, async siteStatus() { return null; }, async profilesFor() { return [{ person_id: 'p' }]; },
    async audit(a) { log.audit.push(a); } };
  return s;
}
const deps = (st, auth = yes, setInstructor = async () => ({ changed: true })) =>
  ({ store: st, auth, adultAge: () => 18, validateBio: (b) => ({ doc: b }), setInstructor });
const firstAid = { id: 'q1', label: 'First aid' };

console.log('\nReadiness');
ok('ready when adult, cleared and written up', (await new InstructorReadiness(deps(store())).execute({ clubId: 'c', personId: 'p' })).missing.length === 0);
ok('a minor can never be shown', (await new InstructorReadiness(deps(store({ dob: '2015-01-01' }))).execute({ clubId: 'c', personId: 'p' })).never === 'under 18');
ok('no date of birth is named', (await new InstructorReadiness(deps(store({ dob: null }))).execute({ clubId: 'c', personId: 'p' })).never === 'no date of birth recorded');
{ const r = await new InstructorReadiness(deps(store({ required: [firstAid], about: '' }))).execute({ clubId: 'c', personId: 'p' });
  ok('names what is missing', r.missing.includes('First aid') && r.missing.includes('a write-up about themselves')); }
{ const st = store({ required: [firstAid], rows: [{ person_id: 'p', club_id: 'c', published: false }, { person_id: 'q', club_id: 'c', published: true }] });
  const m = await new InstructorStates(deps(st)).execute({ personIds: ['p', 'q'] });
  ok('states: unpublished shows what holds them back', m.get('p').missing.includes('First aid') && m.get('p').published === false);
  ok('and published needs nothing', m.get('q').published === true && m.get('q').missing.length === 0); }

console.log('\nSave and remove');
{ const st = store(); await new SaveInstructorProfile(deps(st)).execute({ actorId: 'a', organisationId: 'c', personId: 'p', bio: { blocks: [] }, published: true, startedYear: '1998' });
  ok('publishes, stamping the actor', st.log.saved[0].publishedBy === 'a' && st.log.saved[0].year === 1998); ok('audited as a publish', st.log.audit[0].action === 'instructor_publish'); }
{ const st = store(); await new SaveInstructorProfile(deps(st)).execute({ actorId: 'a', organisationId: 'c', personId: 'p', published: false });
  ok('saving unpublished stamps nobody', st.log.saved[0].publishedBy === null && st.log.audit[0].action === 'instructor_save'); }
await refuses('not an instructor here', () => new SaveInstructorProfile(deps(store({ isInstructor: false }))).execute({ actorId: 'a', organisationId: 'c', personId: 'p', published: true }), Refused, 'not recorded as an instructor');
await refuses('a minor cannot be published', () => new SaveInstructorProfile(deps(store({ dob: '2015-01-01' }))).execute({ actorId: 'a', organisationId: 'c', personId: 'p', published: true }), Refused);
await refuses('a silly year', () => new SaveInstructorProfile(deps(store())).execute({ actorId: 'a', organisationId: 'c', personId: 'p', published: false, startedYear: 1800 }), Refused, 'must be a year');
await refuses('needs MANAGE', () => new SaveInstructorProfile(deps(store(), no)).execute({ actorId: 'a', organisationId: 'c', personId: 'p', published: false }), NotPermitted);
await refuses('listing needs MANAGE', () => new ListInstructorProfiles(deps(store(), no)).execute({ actorId: 'a', organisationId: 'c' }), NotPermitted);
await refuses('removing what is not there', () => new RemoveInstructorProfile(deps(store())).execute({ actorId: 'a', organisationId: 'c', personId: 'p' }), Missing);
{ const st = store({ profile: { id: 'prof', published: true } }); await new RemoveInstructorProfile(deps(st)).execute({ actorId: 'a', organisationId: 'c', personId: 'p' });
  ok('removes and records what it was', st.log.removed === 1 && st.log.audit[0].before.was === true); }

console.log('\nBulk');
{ const st = store(); const out = await new BulkInstructors(deps(st)).execute({ actorId: 'a', scopeOrgId: 'c', personIds: ['p', 'p', 'ghost'], mode: 'show' });
  ok('people not on the roll are named, not skipped silently', out.skipped.some((s) => s.reason === 'not on the roll here'));
  ok('ready people are made instructors and shown, once each', out.changed === 1 && out.shown === 1); }
{ const st = store({ required: [firstAid] }); const out = await new BulkInstructors(deps(st)).execute({ actorId: 'a', scopeOrgId: 'c', personIds: ['p'], mode: 'show' });
  ok('someone not ready is an instructor but not shown, with the reason', out.changed === 1 && out.shown === 0 && /Still needs First aid/.test(out.skipped[0].reason)); }
{ const out = await new BulkInstructors(deps(store())).execute({ actorId: 'a', scopeOrgId: 'c', personIds: ['p'], mode: 'off' }); ok('off takes the role away', out.changed === 1 && out.shown === 0); }
await refuses('bulk needs MANAGE', () => new BulkInstructors(deps(store(), no)).execute({ actorId: 'a', scopeOrgId: 'c', personIds: ['p'], mode: 'on' }), NotPermitted);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
