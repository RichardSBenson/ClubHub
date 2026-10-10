/** The member-document use cases with no database. */
import { DocumentChoices, ListDocuments, SendDocument, OpenDocument, ReviewDocument, WaitingDocuments } from './application/member-documents.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
function store({ home = 'club', doc = { id: 'd1', status: 'pending', title: 'First aid', qualification_id: 'q1', awarded_on: '2026-01-01', expires_on: null }, qual = { id: 'q1', label: 'First aid' } } = {}) {
  const log = { added: [], audit: [], awards: [], reviewed: [] };
  const s = { log,
    async atomically(work) { return work(s); },
    async homeOf() { return home; }, async homesOf() { return ['club']; }, async todayAt() { return '2026-10-10'; },
    async qualificationChoices() { return [{ id: 'q1', label: 'First aid' }]; }, async qualificationAt(h, id) { return id === 'q1' ? qual : null; },
    async documentsOf() { return [{ id: 'd1' }]; }, async addDocument(d) { log.added.push(d); return { id: 'new' }; },
    async documentFile() { return { mime: 'application/pdf', bytes: Buffer.from('x'), title: 'First aid' }; },
    async documentToReview() { return doc; }, async addAward(a) { log.awards.push(a); return { id: 'aw1' }; },
    async markReviewed(r) { log.reviewed.push(r); }, async waitingUnder() { return [{ id: 'd1' }]; }, async audit(a) { log.audit.push(a); } };
  return s;
}
const registrar = { async hasRoleAt() { return true; } }, nobody = { async hasRoleAt() { return false; } };
const mk = (C, st, { auth = registrar, how = async () => 'self' } = {}) => new C({ store: st, auth, howMayActFor: how });
const pdf = { filename: 'a.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4 test') };

console.log('\nSending and listing');
ok('choices come from the home club', (await mk(DocumentChoices, store()).execute({ personId: 'p' })).length === 1);
ok('no club, no choices', (await mk(DocumentChoices, store({ home: null })).execute({ personId: 'p' })).length === 0);
{ const st = store(); await mk(SendDocument, st).execute({ actorId: 'a', personId: 'p', file: pdf, qualificationId: 'q1', awardedOn: '2026-01-01' });
  ok('the title is the qualification\'s label', st.log.added[0].title === 'First aid'); ok('audited', st.log.audit[0].action === 'document_sent'); }
await refuses('a stranger may not send', () => mk(SendDocument, store(), { auth: nobody, how: async () => null }).execute({ actorId: 'a', personId: 'p', file: pdf, title: 'x' }), NotPermitted);
await refuses('nobody to send it to', () => mk(SendDocument, store({ home: null })).execute({ actorId: 'a', personId: 'p', file: pdf, title: 'x' }), Refused, 'nobody to send');
await refuses('not asked for by this club', () => mk(SendDocument, store()).execute({ actorId: 'a', personId: 'p', file: pdf, qualificationId: 'other' }), Refused, 'not something');
await refuses('a stranger may not list', () => mk(ListDocuments, store(), { auth: nobody, how: async () => null }).execute({ actorId: 'a', personId: 'p' }), NotPermitted);
ok('the person lists their own, not as an official', (await mk(ListDocuments, store(), { auth: nobody }).execute({ actorId: 'a', personId: 'p' })).official === false);

console.log('\nOpening');
{ const st = store(); await mk(OpenDocument, st, { how: async () => null }).execute({ actorId: 'reg', personId: 'p', docId: 'd1' });
  ok('an official opening somebody else\'s is written down', st.log.audit[0]?.action === 'document_opened'); }
{ const st = store(); await mk(OpenDocument, st, { how: async () => 'self' }).execute({ actorId: 'me', personId: 'p', docId: 'd1' });
  ok('opening your own is not', st.log.audit.length === 0); }
await refuses('a stranger may not open', () => mk(OpenDocument, store(), { auth: nobody, how: async () => null }).execute({ actorId: 'a', personId: 'p', docId: 'd1' }), NotPermitted);

console.log('\nReviewing');
{ const st = store(); await mk(ReviewDocument, st).execute({ actorId: 'reg', personId: 'p', docId: 'd1', accept: true });
  ok('accepting a qualification records the award, with this file as the proof', st.log.awards[0].qualificationId === 'q1' && st.log.reviewed[0].awardId === 'aw1' && st.log.reviewed[0].accepted); }
{ const st = store(); await mk(ReviewDocument, st).execute({ actorId: 'reg', personId: 'p', docId: 'd1', accept: false, note: 'blurry' });
  ok('declining records no award', st.log.awards.length === 0 && st.log.reviewed[0].accepted === false && st.log.audit[0].action === 'document_declined'); }
await refuses('only an official reviews', () => mk(ReviewDocument, store(), { auth: nobody }).execute({ actorId: 'a', personId: 'p', docId: 'd1', accept: true }), NotPermitted);
await refuses('already dealt with', () => mk(ReviewDocument, store({ doc: { id: 'd1', status: 'accepted' } })).execute({ actorId: 'a', personId: 'p', docId: 'd1', accept: true }), Refused, 'already been dealt');
await refuses('no issue date, no acceptance', () => mk(ReviewDocument, store({ doc: { id: 'd1', status: 'pending', qualification_id: 'q1', awarded_on: null } })).execute({ actorId: 'a', personId: 'p', docId: 'd1', accept: true }), Refused, 'issue date');
ok('waiting needs the register role', (await mk(WaitingDocuments, store()).execute({ actorId: 'a', organisationId: 'o' })).length === 1);
await refuses('and refuses others', () => mk(WaitingDocuments, store(), { auth: nobody }).execute({ actorId: 'a', organisationId: 'o' }), NotPermitted);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
