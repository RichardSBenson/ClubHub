/**
 * Themes and settings saved before the platform dropped karate's word from its own names still say "dojoGrid" and
 * "dojoPage". They keep working: this reads the old names as the new ones, so nothing a federation saved has to be redone.
 * (The only file that may still say the old word, besides the migration that renamed the database.)
 */
const SECTION = { 'dojoGrid': 'clubGrid' };
const PATH = { '/find-a-club': '/find-a-club' };

const sections = (list) => Array.isArray(list) ? list.map((s) => SECTION[s] ?? s) : list;

export function modernise(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const out = { ...doc };
  if (out['dojoPage'] !== undefined) { out.clubPage = out.clubPage ?? out['dojoPage']; delete out['dojoPage']; }
  for (const k of ['homePage', 'clubPage'])
    if (out[k]?.sections) out[k] = { ...out[k], sections: sections(out[k].sections) };
  if (out.navigation?.items) out.navigation = { ...out.navigation,
    items: out.navigation.items.map((i) => i && PATH[i.href] ? { ...i, href: PATH[i.href] } : i) };
  return out;
}
