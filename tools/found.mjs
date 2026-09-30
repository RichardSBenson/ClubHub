/**
 * Found a federation.
 *
 *   node tools/found.mjs --name "British Kung Fu Association" \
 *                        --art "Kung Fu" --country GB \
 *                        --email secretary@bkfa.org.uk
 *
 * Point DATABASE_URL at an empty database with db/install/schema.sql loaded,
 * run this, and that database is somebody's register. One install is one
 * federation: its own database, its own domain, its own country if its law
 * requires it.
 *
 * It refuses to run on a database that already has a federation in it. An
 * install script that can be run twice is an install script that will be, and
 * the second run is somebody's live register.
 *
 * Everything it creates is a starting point the federation edits from the
 * admin. It creates no belts anybody has to keep, no titles, no vocabulary
 * that assumes an art — it asks which art and uses that art's words.
 */

import { pool } from '../packages/infrastructure/postgres/pool.mjs';
import { problemsWithFounding, slugFrom, vocabularyFor, startingLadder,
         startingAuthority, startingPage }
  from '../packages/core/domain/founding.mjs';

// ---------------------------------------------------------------------------

function parseArguments(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const USAGE = `
Found a federation on an empty Honbu database.

  node tools/found.mjs --name "British Kung Fu Association" \\
                       --art "Kung Fu" --country GB \\
                       --email secretary@bkfa.org.uk

  --name      What the federation is called.                      required
  --art       The martial art. Decides the starting vocabulary.    required
  --email     The first administrator. They own the install.       required
  --country   Two-letter code, for the timezone default.           default NZ
  --slug      Short name, used in web addresses.       default: from the name
  --timezone  IANA zone.                            default: from the country
  --founded   YYYY-MM-DD, if you know it.

Load db/install/schema.sql into the database first.
`;

/**
 * A default only. A federation spanning several zones sets its clubs' own,
 * and every one of these is one field in the admin afterwards.
 */
const ZONES = {
  NZ: 'Pacific/Auckland', AU: 'Australia/Sydney', GB: 'Europe/London',
  IE: 'Europe/Dublin', US: 'America/New_York', CA: 'America/Toronto',
  ZA: 'Africa/Johannesburg', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
  CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', SG: 'Asia/Singapore',
  IN: 'Asia/Kolkata', BR: 'America/Sao_Paulo', FR: 'Europe/Paris',
  DE: 'Europe/Berlin', NL: 'Europe/Amsterdam', ES: 'Europe/Madrid',
  IT: 'Europe/Rome', PL: 'Europe/Warsaw', SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo', TH: 'Asia/Bangkok', MY: 'Asia/Kuala_Lumpur',
  ID: 'Asia/Jakarta', PH: 'Asia/Manila', MX: 'America/Mexico_City',
};

// ---------------------------------------------------------------------------

export async function found(answers, { quiet = false } = {}) {
  const say = (...a) => { if (!quiet) console.log(...a); };

  const problems = problemsWithFounding(answers);
  if (problems.length) {
    const error = new Error(problems.join('; '));
    error.problems = problems;
    throw error;
  }

  const name = answers.name.trim();
  const art = answers.art.trim();
  const email = answers.email.trim().toLowerCase();
  const country = (answers.country ?? 'NZ').toUpperCase();
  const slug = answers.slug || slugFrom(name);
  const timezone = answers.timezone || ZONES[country] || 'UTC';
  const vocabulary = vocabularyFor(art);

  const client = await pool.connect();
  try {
    await client.query('begin');

    // Refused rather than added to. A database with a federation in it is
    // somebody's register, and a second founding would put two federations in
    // a place built to hold one.
    const { rows: [existing] } = await client.query(
      `select name, slug from organisation where parent_id is null limit 1`);
    if (existing) {
      throw new Error(
        `This database already holds ${existing.name} (${existing.slug}). `
        + 'One install is one federation — point DATABASE_URL at an empty '
        + 'database, or use the admin to add clubs beneath the federation '
        + 'that is already here.');
    }

    // --- the federation ----------------------------------------------------
    const { rows: [org] } = await client.query(`
      insert into organisation (parent_id, type, name, short_name, slug, path,
                                country_code, timezone, founded, settings)
      values (null, 'country', $1, $2, $3, $4::ltree, $5, $6, $7, $8::jsonb)
      returning *`,
      [name, initialsOf(name), slug, slug.replace(/-/g, '_'), country, timezone,
       answers.founded || null,
       JSON.stringify({ vocabulary, art })]);
    say(`  ${org.name}  /${org.slug}  ${country}  ${timezone}`);

    // --- a ladder to grade on ----------------------------------------------
    const ladder = startingLadder(vocabulary);
    for (const g of ladder) {
      await client.query(`
        insert into grade (organisation_id, label, short_label, rank_order, is_dan)
        values ($1,$2,$3,$4,$5)`,
        [org.id, g.label, g.shortLabel, g.rankOrder, g.isDan]);
    }
    const authority = startingAuthority();
    await client.query(`
      insert into grade_authority (organisation_id, from_rank_order,
        to_rank_order, awarded_by_type, ratified_by_type, min_panel_size,
        min_panel_rank)
      values ($1,$2,$3,$4,$5,$6,$7)`,
      [org.id, authority.fromRankOrder, authority.toRankOrder,
       authority.awardedByType, authority.ratifiedByType,
       authority.minPanelSize, authority.minPanelRank]);
    say(`  ${ladder.length} starting grades, anybody may award them — `
      + 'tighten that in the admin');

    // --- the person who owns this install ----------------------------------
    // An account with no person attached. They are the administrator, not
    // necessarily a member: a federation secretary need never have trained.
    const { rows: [account] } = await client.query(`
      insert into account (email) values ($1) returning *`, [email]);
    await client.query(`
      insert into grant_role (account_id, organisation_id, role)
      values ($1,$2,'owner')`, [account.id, org.id]);
    say(`  ${email} is the owner`);

    // --- something to look at ----------------------------------------------
    const page = startingPage(name, art);
    await client.query(`
      insert into page (organisation_id, slug, title, body, status)
      values ($1,$2,$3,$4::jsonb,'draft')`,
      [org.id, page.slug, page.title, JSON.stringify(page.body)]);

    await client.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, after)
      values ($1,$2,'found','organisation',$2,$3::jsonb)`,
      [account.id, org.id, JSON.stringify({ name, art, country, slug })]);

    await client.query('commit');
    return { organisation: org, account, vocabulary, ladder };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** MOKNZ from Mas Oyama Karate New Zealand. Editable afterwards. */
const initialsOf = (name) => String(name).split(/\s+/)
  .filter((w) => /^[A-Za-z]/.test(w))
  .filter((w) => !['the', 'of', 'and', 'for'].includes(w.toLowerCase()))
  .map((w) => w[0].toUpperCase()).join('').slice(0, 8) || null;

// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArguments(process.argv.slice(2));
  if (args.help || !args.name || !args.art || !args.email) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  console.log('\nFounding:\n');
  try {
    const { organisation, vocabulary } = await found(args);
    console.log(`
Done. ${organisation.name} is on this database and nobody else is.

  Their clubs are called ${vocabulary.clubPlural.toLowerCase()}.
  Their instructors are ${vocabulary.instructor.toLowerCase()}.

Next:
  1. Deploy with FEDERATION=${organisation.slug} and this DATABASE_URL.
  2. Sign in as ${args.email} — the sign-in link is emailed, so set a mail
     provider first, or use HONBU_BOOTSTRAP for the first way in.
  3. Add clubs, import the roll, and edit the grades to match how they
     actually grade. Nothing created here is meant to be kept as-is.
`);
  } catch (e) {
    console.error(`\nNot founded: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
