/** The site-settings use cases with no database. */
import { ReadSiteSettings, SaveNavigation, ApplyTheme, ResetTheme, SetCrest, SetHomePage, ViewClubProfile, SaveClubProfile } from './application/site-settings.mjs';
import { Refused, NotPermitted, Missing } from './application/ports.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`));
const refuses = async (n, fn, Type, match) => {
  try { await fn(); ok(n + ' (did not throw)', false); } catch (e) { ok(n, e instanceof Type && (!match || e.message.includes(match))); }
};
const yes = { async hasRoleAt() { return true; } }, no = { async hasRoleAt() { return false; } };
function store({ settings = {}, owner = 'org', club = { id: 'org', name: 'Taupo', status: 'active', parent_id: 'fed' } } = {}) {
  const log = { audit: [], put: {}, removed: [] };
  const s = { log, async atomically(w) { return w(s); },
    async settingsOf() { return settings; }, async putSetting(o, k, v) { log.put[k] = v; }, async removeSetting(o, k) { log.removed.push(k); },
    async assetOwner() { return owner; }, async authoredPages() { return [{ slug: 'about', title: 'About' }]; },
    async clubRow() { return club; }, async updateClub(o, i) { return { ...club, name: i.name, status: i.status, short_name: i.shortName, founded_iso: i.founded, timezone: i.timezone }; },
    async clubOverview() { return { administrators: [], counts: {}, page: null, parent: null }; }, async audit(a) { log.audit.push(a); } };
  return s;
}
const rules = { destinations: ({ authored }) => authored.map((p) => '/p/' + p.slug), problemsWithNavigation: (items, ok2) => items.filter((i) => !ok2.includes(i.href.trim())).map((i) => `${i.href} goes nowhere.`), readTheme: (d) => d?.name ? { ok: true, theme: d } : { ok: false, problems: ['No name.'] } };
const mk = (C, st, auth = yes) => new C({ store: st, auth, ...rules });

console.log('\nMenu');
{ const st = store(); const r = await mk(SaveNavigation, st).execute({ actorId: 'a', organisationId: 'org', items: [{ href: ' /p/about ', label: ' About ' }] });
  ok('trims and stores', r[0].href === '/p/about' && st.log.put.navigation.items[0].label === 'About' && st.log.audit[0].action === 'navigation_save'); }
await refuses('an item pointing nowhere is refused', () => mk(SaveNavigation, store()).execute({ actorId: 'a', organisationId: 'org', items: [{ href: '/x', label: 'X' }] }), Refused, 'goes nowhere');
await refuses('saving needs MANAGE', () => mk(SaveNavigation, store(), no).execute({ actorId: 'a', organisationId: 'org', items: [] }), NotPermitted);
ok('editing reads stored menu and pages', (await mk(ReadSiteSettings, store({ settings: { navigation: { items: [] } } })).navigation({ actorId: 'a', organisationId: 'org' })).authored.length === 1);

console.log('\nLook, crest, home page');
{ const st = store(); await mk(ApplyTheme, st).execute({ actorId: 'a', organisationId: 'org', doc: { name: 'Red' } }); ok('theme stored and audited', st.log.put.theme.name === 'Red' && st.log.audit[0].after.name === 'Red'); }
await refuses('a bad theme is refused', () => mk(ApplyTheme, store()).execute({ actorId: 'a', organisationId: 'org', doc: {} }), Refused, 'No name');
{ const st = store(); await mk(ResetTheme, st).execute({ actorId: 'a', organisationId: 'org' }); ok('reset removes theme', st.log.removed[0] === 'theme'); }
{ const st = store(); await mk(SetCrest, st).execute({ actorId: 'a', organisationId: 'org', assetId: 'p1' }); ok('crest set', st.log.put.logoAssetId === 'p1');
  await mk(SetCrest, st).execute({ actorId: 'a', organisationId: 'org', assetId: null }); ok('crest cleared', st.log.removed[0] === 'logoAssetId'); }
await refuses("someone else's picture", () => mk(SetCrest, store({ owner: 'other' })).execute({ actorId: 'a', organisationId: 'org', assetId: 'p1' }), Refused, 'own pictures');
{ const st = store({ settings: { homePage: { heroHeading: 'Old', heroText: 'keep' } } });
  await mk(SetHomePage, st).execute({ actorId: 'a', organisationId: 'org', heroHeading: ' New ', heroText: undefined, heroButton: '' });
  ok('trims, leaves undefined alone, clears blanks', st.log.put.homePage.heroHeading === 'New' && st.log.put.homePage.heroText === 'keep' && !('heroButton' in st.log.put.homePage)); }
await refuses('heading too long', () => mk(SetHomePage, store()).execute({ actorId: 'a', organisationId: 'org', heroHeading: 'x'.repeat(81) }), Refused, '80');
await refuses('text too long', () => mk(SetHomePage, store()).execute({ actorId: 'a', organisationId: 'org', heroText: 'x'.repeat(301) }), Refused, '300');
ok('home defaults blank', (await mk(ReadSiteSettings, store()).home({ actorId: 'a', organisationId: 'org' })).heroHeading === '');
await refuses('reading needs WRITE', () => mk(ReadSiteSettings, store(), no).theme({ actorId: 'a', organisationId: 'org' }), NotPermitted);

console.log('\nClub profile');
ok('view includes club', (await mk(ViewClubProfile, store()).execute({ actorId: 'a', organisationId: 'org' })).club.name === 'Taupo');
await refuses('unknown club', () => mk(ViewClubProfile, store({ club: null })).execute({ actorId: 'a', organisationId: 'org' }), Missing);
{ const st = store(); const r = await mk(SaveClubProfile, st).execute({ actorId: 'a', organisationId: 'org', input: { name: 'Taupo Karate', shortName: 'TK', founded: '2001-01-01', timezone: 'Pacific/Auckland', status: 'active' } });
  ok('saves and audits before/after', r.club.name === 'Taupo Karate' && st.log.audit[0].before.name === 'Taupo' && st.log.audit[0].after.name === 'Taupo Karate' && r.siteChanged === true); }
await refuses('a blank name is refused', () => mk(SaveClubProfile, store()).execute({ actorId: 'a', organisationId: 'org', input: { name: '', shortName: '', founded: '', timezone: 'Pacific/Auckland', status: 'active' } }), Refused);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
