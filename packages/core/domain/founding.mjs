/**
 * DOMAIN — founding a federation
 *
 * What has to be true to stand up a new install, and what a federation starts
 * with before anybody has configured anything.
 *
 * One install is one federation. Its own database, its own domain, its own
 * country if its law requires that — the way a self-hosted site is its own
 * site rather than a row in somebody's platform. So founding is not a signup
 * flow; it is the moment an empty database becomes somebody's register.
 *
 * The hard part is not the SQL. It is deciding what a federation gets by
 * default when the platform must not assume it teaches karate.
 *
 * Pure. No database, no HTTP.
 */

import { isRealDate } from './people.mjs';

// ---------------------------------------------------------------------------
// what a new federation is asked for
// ---------------------------------------------------------------------------

/**
 * Four answers, and four is the limit.
 *
 * "Onboarding should not require administrators to configure hundreds of
 * fields before they can use the system." Everything else — belt colours,
 * titles, divisions, what they call their clubs — is reachable from inside
 * once they are in, and guessing wrong is recoverable. Being unable to get
 * in at all is not.
 */
export function problemsWithFounding(answers = {}) {
  const out = [];
  const name = String(answers.name ?? '').trim();
  const art = String(answers.art ?? '').trim();
  const email = String(answers.email ?? '').trim();
  const country = String(answers.country ?? '').trim().toUpperCase();

  if (!name) out.push('the federation needs a name');
  else if (name.length > 200) out.push('that name is too long');

  if (!art) out.push('the martial art is needed — it decides the starting vocabulary');

  if (!email) out.push('an email address for the first administrator is needed');
  else if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email))
    out.push(`"${email}" does not look like an email address`);

  // Two letters, as on a passport. Used for the timezone default and nothing
  // that cannot be changed later.
  if (country && !/^[A-Z]{2}$/.test(country))
    out.push('the country should be a two-letter code, like NZ or GB');

  if (answers.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(answers.slug))
    out.push('the short name may only contain lowercase letters, numbers and hyphens');

  if (answers.founded && !isRealDate(answers.founded))
    out.push(`"${answers.founded}" is not a date`);

  return out;
}

/** A federation's name becomes its short name when nobody types one. */
export const slugFrom = (name) => String(name ?? '').toLowerCase().trim()
  .replace(/['']/g, '')
  .replace(/\b(the|of|and)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40) || 'federation';

// ---------------------------------------------------------------------------
// what a federation starts with
// ---------------------------------------------------------------------------

/**
 * What a school is called, by art.
 *
 * Not a taxonomy of martial arts, and not a lookup the platform depends on —
 * a first guess at the words so a kung fu federation does not read "dojo" in
 * its own register on day one. Everything here is editable from the admin the
 * moment they are in, and an art nobody listed gets neutral words rather than
 * somebody else's.
 *
 * The stored organisation type stays `club` throughout. This is only the
 * label shown to people.
 */
const VOCABULARIES = [
  [['karate', 'judo', 'aikido', 'kendo', 'iaido', 'kyudo', 'jujutsu',
    'ju-jitsu', 'jiu-jitsu', 'shorinji'],
   { club: 'Dojo', clubPlural: 'Dojos', grade: 'Grade', grading: 'Grading',
     instructor: 'Sensei' }],

  [['taekwondo', 'tae kwon do', 'hapkido', 'tang soo do', 'kuk sool'],
   { club: 'Dojang', clubPlural: 'Dojangs', grade: 'Grade', grading: 'Grading',
     instructor: 'Sabeom' }],

  [['kung fu', 'kungfu', 'wushu', 'wing chun', 'tai chi', 'taiji', 'sanda',
    'choy li fut', 'hung gar'],
   { club: 'Kwoon', clubPlural: 'Kwoons', grade: 'Level', grading: 'Assessment',
     instructor: 'Sifu' }],

  [['brazilian jiu-jitsu', 'bjj', 'grappling', 'wrestling', 'sambo', 'mma',
    'mixed martial arts'],
   { club: 'Academy', clubPlural: 'Academies', grade: 'Belt',
     grading: 'Promotion', instructor: 'Coach' }],

  [['muay thai', 'boxing', 'kickboxing', 'savate', 'lethwei'],
   { club: 'Gym', clubPlural: 'Gyms', grade: 'Level', grading: 'Assessment',
     instructor: 'Coach' }],

  [['silat', 'pencak silat', 'escrima', 'arnis', 'kali'],
   { club: 'School', clubPlural: 'Schools', grade: 'Level',
     grading: 'Assessment', instructor: 'Guro' }],

  [['hema', 'fencing', 'kendo club', 'historical european martial arts'],
   { club: 'Club', clubPlural: 'Clubs', grade: 'Rank', grading: 'Assessment',
     instructor: 'Instructor' }],

  [['capoeira'],
   { club: 'Group', clubPlural: 'Groups', grade: 'Cord', grading: 'Batizado',
     instructor: 'Mestre' }],
];

/** Neutral words, for an art nobody anticipated. Never somebody else's. */
export const NEUTRAL_VOCABULARY = Object.freeze({
  club: 'Club', clubPlural: 'Clubs', grade: 'Grade', grading: 'Grading',
  instructor: 'Instructor',
});

/**
 * Longest name wins, not first in the list.
 *
 * "Brazilian jiu-jitsu" contains "jiu-jitsu", which is in the Japanese group,
 * so scanning the lists in order told a BJJ academy it was a dojo. Ordering
 * the lists by hand would fix it until somebody adds an entry and does not
 * notice; matching the most specific name always is a rule rather than a
 * convention, and it cannot be broken by a later edit.
 */
const BY_SPECIFICITY = VOCABULARIES
  .flatMap(([names, words]) => names.map((name) => [name, words]))
  .sort((a, b) => b[0].length - a[0].length);

export function vocabularyFor(art) {
  const needle = String(art ?? '').toLowerCase().trim();
  if (!needle) return { ...NEUTRAL_VOCABULARY };
  const hit = BY_SPECIFICITY.find(([name]) => needle.includes(name));
  return hit ? { ...hit[1] } : { ...NEUTRAL_VOCABULARY };
}

/**
 * A starting ladder.
 *
 * Deliberately thin, and deliberately not a belt system. A federation's
 * grades are the most particular thing about it — the number of them, what
 * they are called, whether they are belts at all — and inventing ten kyu
 * grades for a capoeira group would be worse than giving them nothing.
 *
 * So: three levels with plain names and obvious gaps in the numbering, so a
 * federation can insert their own between them without renumbering. Enough
 * that the grading screen works on day one, little enough that nobody mistakes
 * it for a suggestion.
 */
export function startingLadder(vocabulary = NEUTRAL_VOCABULARY) {
  const word = vocabulary.grade ?? 'Grade';
  return [
    { label: `Beginner ${word.toLowerCase()}`, shortLabel: 'B', rankOrder: 10,
      isDan: false },
    { label: `Intermediate ${word.toLowerCase()}`, shortLabel: 'I', rankOrder: 50,
      isDan: false },
    { label: `Senior ${word.toLowerCase()}`, shortLabel: 'S', rankOrder: 90,
      isDan: true },
  ];
}

/**
 * Who may award what, to begin with.
 *
 * One rule: anybody with the authority may award anything, ratified by
 * nobody. That is the permissive end on purpose — a federation that has not
 * yet told the system how it grades should not find the system refusing to
 * record a grading. Tightening it is a screen they will visit; being blocked
 * on day one is a reason to stop using it.
 */
export function startingAuthority() {
  return { fromRankOrder: 1, toRankOrder: 999, awardedByType: 'club',
           ratifiedByType: null, minPanelSize: 1, minPanelRank: null };
}

/**
 * The page a new install has on its website.
 *
 * One page, saying who they are, so the site is not an empty shell before
 * anybody has written anything. Their words replace it; it exists so that
 * "look at your website" on day one shows something rather than a 404.
 */
export function startingPage(name, art) {
  return {
    slug: 'about',
    title: `About ${name}`,
    body: { blocks: [
      { type: 'paragraph', text: [{ text: `${name} is a ` },
        { text: art, marks: ['strong'] },
        { text: ' organisation. This page is a starting point — edit it from '
              + 'the admin to say who you are, when you were founded and what '
              + 'you teach.' }] },
      { type: 'clubList', heading: 'Where to train' },
      { type: 'eventList', heading: "What's coming up", limit: 5 },
    ]},
  };
}
