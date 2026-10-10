/** Photos and the instructor switch with no database. */
import { CheckMayChangePhoto, SetPhoto, ClearPhoto, SetAbout, OpenPhoto } from './application/photos.mjs';
import { SetInstructor } from './application/instructor-role.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const yes = { async hasRoleAt() { return true; } }, no = { async hasRoleAt() { return false; } };
function store({ dob = '1990-01-01', home = 'club', asset = 'a1', isInstructor = false, grade = { label: '1st Dan', is_dan: true } } = {}) {
  const log = { photo: [], cleared: 0, about: [], audit: [], appointed: 0, resigned: 0 };
  const s = { log, async atomically(w) { return w(s); },
    async homeOf() { return home; }, async homesOf() { return ['club']; }, async dateOfBirthOf() { return dob; }, async nameOf() { return 'Ana T'; },
    async addPhotoAsset(a) { log.photo.push(a); return { id: 'new' }; }, async setPhoto(p, id) { log.photoSet = id; }, async clearPhoto() { log.cleared++; },
    async setAbout(p, t) { log.about.push(t); }, async photoAssetIdOf() { return asset; }, async photoFile() { return { mime: 'image/png', bytes: Buffer.from('x') }; },
    async isInstructor() { return isInstructor; }, async currentGrade() { return grade; }, async appoint() { log.appointed++; }, async resign() { log.resigned++; },
    async audit(a) { log.audit.push(a); } };
  return s;
}
const deps = (st, { auth = yes, how = async () => 'self' } = {}) => ({ store: st, auth, howMayActFor: how, adultAge: () => 18, today: () => '2026-10-10' });
const img = { bytes: Buffer.from('img'), identified: { mime: 'image/png', width: 1, height: 1, bytes: 3 }, filename: 'a.png' };

console.log('\nPhotos');
{ const st = store(); await new SetPhoto(deps(st)).execute({ actorId: 'a', personId: 'p', ...img });
  ok('an adult may set their own, no consent needed', st.log.photoSet === 'new');
  ok('alt text names them, consent is dated', st.log.photo[0].altText === 'Photograph of Ana T' && /2026-10-10/.test(st.log.photo[0].consentRef)); ok('audited', st.log.audit[0].action === 'person_photo_set'); }
await refuses('a child\'s photo needs a parent\'s yes', () => new SetPhoto(deps(store({ dob: '2018-01-01' }))).execute({ actorId: 'a', personId: 'p', ...img }), Refused, 'parent or guardian agrees');
{ const st = store({ dob: '2018-01-01' }); await new SetPhoto(deps(st)).execute({ actorId: 'a', personId: 'p', ...img, consent: true }); ok('with consent it is kept', st.log.photoSet === 'new'); }
await refuses('a stranger may not change it', () => new SetPhoto(deps(store(), { auth: no, how: async () => null })).execute({ actorId: 'a', personId: 'p', ...img }), NotPermitted);
await refuses('nor check it', () => new CheckMayChangePhoto(deps(store(), { auth: no, how: async () => null })).execute({ actorId: 'a', personId: 'p' }), NotPermitted);
{ const st = store(); await new ClearPhoto(deps(st)).execute({ actorId: 'a', personId: 'p' }); ok('clearing is recorded', st.log.cleared === 1 && st.log.audit[0].action === 'person_photo_cleared'); }
{ const st = store(); await new SetAbout(deps(st)).execute({ actorId: 'a', personId: 'p', text: ' hi\r\nthere ' }); ok('about is trimmed and normalised', st.log.about[0] === 'hi\nthere'); }
{ const st = store(); await new SetAbout(deps(st)).execute({ actorId: 'a', personId: 'p', text: '  ' }); ok('and blank clears it', st.log.about[0] === null); }
await refuses('about is limited to 280', () => new SetAbout(deps(store())).execute({ actorId: 'a', personId: 'p', text: 'x'.repeat(281) }), Refused, '280');
ok('a teacher may see the photo', (await new OpenPhoto(deps(store(), { how: async () => null })).execute({ actorId: 'a', personId: 'p' })).mime === 'image/png');
await refuses('a stranger may not', () => new OpenPhoto(deps(store(), { auth: no, how: async () => null })).execute({ actorId: 'a', personId: 'p' }), NotPermitted);
await refuses('no photo', () => new OpenPhoto(deps(store({ asset: null }))).execute({ actorId: 'a', personId: 'p' }), Missing);

console.log('\nSetInstructor');
const inst = (st, auth = yes) => new SetInstructor({ store: st, auth });
{ const st = store(); const r = await inst(st).execute({ actorId: 'a', personId: 'p', on: true }); ok('appoints a dan grade', r.changed && st.log.appointed === 1 && st.log.audit[0].action === 'instructor_on'); }
await refuses('not below the grade required', () => inst(store({ grade: { label: '5th Kyu', is_dan: false } })).execute({ actorId: 'a', personId: 'p', on: true }), Refused);
{ const st = store({ isInstructor: true }); const r = await inst(st).execute({ actorId: 'a', personId: 'p', on: false }); ok('resigns, keeping history', r.changed && st.log.resigned === 1 && st.log.audit[0].action === 'instructor_off'); }
{ const st = store({ isInstructor: true }); const r = await inst(st).execute({ actorId: 'a', personId: 'p', on: true }); ok('ticking an instructor changes nothing', !r.changed && st.log.audit.length === 0); }
await refuses('needs MANAGE', () => inst(store(), no).execute({ actorId: 'a', personId: 'p', on: true }), NotPermitted);
await refuses('no club', () => inst(store({ home: null })).execute({ actorId: 'a', personId: 'p', on: true }), Missing);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
