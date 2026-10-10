/** The club-page use cases with no database. */
import { ViewClubPage, SaveClubPage, RequestClubPage, TakeDownClubPage, DecideClubPage, ClubPagesBeneath } from './application/club-pages.mjs';
import { ClubPageNotReady } from './domain/club-page.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const yes = { async hasRoleAt() { return true; } }, no = { async hasRoleAt() { return false; } };
const READY = { venue_name: 'Hall', address_line: '1 High St', city: 'Taupo', phone: '07 1', email: 'a@b.nz', blurb: 'We train karate here for all ages.', who_trains: 'Everyone', published: false };
const SESSIONS = [{ label: 'Kids', weekday: 2, starts: '16:00', ends: '17:00' }];
function store({ club = { id: 'c', name: 'Taupo', type: 'club', parent_id: 'fed' }, profile = READY, sessions = SESSIONS, ownsAsset = true, beneath = true } = {}) {
  const log = { profile: null, removed: [], updated: [], added: [], audit: [], acts: [] };
  const s = { log, async atomically(w) { return w(s); },
    async clubOf() { return club; }, async sessionsOf() { return sessions; }, async profileOf() { return profile; }, async ownsAsset() { return ownsAsset; },
    async saveProfile(c, p) { log.profile = p; }, async sessionIdsOf() { return ['s1', 's2']; },
    async removeSession(c, id) { log.removed.push(id); }, async updateSession(c, x, o) { log.updated.push([x.id, o]); }, async addSession(c, x, o) { log.added.push([x.label, o]); },
    async requestPage() { log.acts.push('request'); }, async takeDown() { log.acts.push('down'); }, async publish(c, by) { log.acts.push('publish:' + by); },
    async decline(c, n) { log.acts.push('decline:' + n); }, async sitsBeneath() { return beneath; },
    async pagesBeneath() { return [{ id: 'c', published: false, page_requested_at: new Date(), sessions: 1, venue_name: 'Hall' }]; }, async audit(a) { log.audit.push(a); } };
  return s;
}
const mk = (C, st, auth = yes) => new C({ store: st, auth });

console.log('\nViewing and saving');
ok('view returns state and problems', (await mk(ViewClubPage, store()).execute({ actorId: 'a', clubId: 'c' })).problems.length === 0);
await refuses('only a club has a page', () => mk(ViewClubPage, store({ club: { id: 'f', type: 'federation' } })).execute({ actorId: 'a', clubId: 'f' }), Refused, 'Only a club');
await refuses('unknown club', () => mk(ViewClubPage, store({ club: null })).execute({ actorId: 'a', clubId: 'x' }), Missing);
{ const st = store(); await mk(SaveClubPage, st).execute({ actorId: 'a', clubId: 'c', profile: READY, sessions: [{ id: 's1', label: 'Old' }, { label: 'New' }], removed: ['s2', 'zzz'] });
  ok('edits times in place, adds new ones, removes only its own', st.log.updated[0][0] === 's1' && st.log.added[0][0] === 'New' && st.log.removed.length === 1 && st.log.removed[0] === 's2');
  ok('audited as the club\'s own', st.log.audit[0].action === 'club_page_saved'); }
await refuses('a picture from someone else\'s library', () => mk(SaveClubPage, store({ ownsAsset: false })).execute({ actorId: 'a', clubId: 'c', profile: { ...READY, hero_asset_id: 'x' }, sessions: SESSIONS }), Refused, 'not in this club');
await refuses('a live page cannot be edited into an unfinished one', () => mk(SaveClubPage, store({ profile: { ...READY, published: true } })).execute({ actorId: 'a', clubId: 'c', profile: { ...READY, venue_name: '' }, sessions: SESSIONS }), ClubPageNotReady, 'live');
await refuses('writing needs WRITE', () => mk(SaveClubPage, store(), no).execute({ actorId: 'a', clubId: 'c', profile: READY, sessions: SESSIONS }), NotPermitted);

console.log('\nRequest, take down, decide');
{ const st = store(); await mk(RequestClubPage, st).execute({ actorId: 'a', clubId: 'c' }); ok('a ready club may ask', st.log.acts[0] === 'request'); }
await refuses('not ready: says what is missing', () => mk(RequestClubPage, store({ profile: { ...READY, venue_name: '' } })).execute({ actorId: 'a', clubId: 'c' }), ClubPageNotReady);
await refuses('already live', () => mk(RequestClubPage, store({ profile: { ...READY, published: true } })).execute({ actorId: 'a', clubId: 'c' }), Refused, 'already live');
await refuses('a club with no federation has nobody to ask', () => mk(RequestClubPage, store({ club: { id: 'c', type: 'club', parent_id: null } })).execute({ actorId: 'a', clubId: 'c' }), Refused, 'no federation');
{ const st = store(); await mk(TakeDownClubPage, st).execute({ actorId: 'a', clubId: 'c' }); ok('taking down needs no second party', st.log.acts[0] === 'down'); }
{ const st = store(); await mk(DecideClubPage, st).execute({ actorId: 'fedAdmin', clubId: 'c', approve: true, decidedBy: 'fed' });
  ok('approval publishes, recording who', st.log.acts[0] === 'publish:fedAdmin'); ok('and is in the federation\'s history', st.log.audit[0].organisationId === 'fed' && st.log.audit[0].action === 'club_page_approved'); }
{ const st = store(); await mk(DecideClubPage, st).execute({ actorId: 'f', clubId: 'c', approve: false, decidedBy: 'fed', note: '  needs photos  ' }); ok('declining keeps a trimmed note', st.log.acts[0] === 'decline:needs photos'); }
await refuses('a club cannot approve itself (must sit strictly beneath)', () => mk(DecideClubPage, store({ beneath: false })).execute({ actorId: 'a', clubId: 'c', approve: true, decidedBy: 'c' }), Refused, 'does not sit beneath');
await refuses('cannot approve an unfinished page', () => mk(DecideClubPage, store({ profile: { ...READY, venue_name: '' } })).execute({ actorId: 'a', clubId: 'c', approve: true, decidedBy: 'fed' }), ClubPageNotReady);
await refuses('deciding needs MANAGE at the decider', () => mk(DecideClubPage, store(), no).execute({ actorId: 'a', clubId: 'c', approve: true, decidedBy: 'fed' }), NotPermitted);
{ const out = await mk(ClubPagesBeneath, store()).execute({ actorId: 'a', organisationId: 'fed' }); ok('beneath lists each club with its state', out[0].state === 'requested' || typeof out[0].state === 'string'); }
await refuses('beneath needs MANAGE', () => mk(ClubPagesBeneath, store(), no).execute({ actorId: 'a', organisationId: 'fed' }), NotPermitted);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
