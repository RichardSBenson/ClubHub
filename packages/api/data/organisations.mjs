/**
 * HONBU — data access: organisations
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';
import { region, setRegion, setEventTypes, setWords } from '../../infrastructure/region-context.mjs';
import { feeFor } from '../../core/domain/membership.mjs';
import { readTheme } from '../../site/theme.mjs';
import { problemsWithClubProfile, changesTheSite } from '../../core/domain/club-profile.mjs';
import { problemsWithNewClub, clubSlugFrom, hasAdministrator } from '../../core/domain/new-club.mjs';
import { destinations, problemsWithNavigation } from '../../content/navigation.mjs';
import { readinessProblems, readinessGaps, ClubPageNotReady, stateOf } from '../../core/domain/club-page.mjs';
import { cents } from '../../core/domain/csv.mjs';
import { builtInFor, builtInYears, yearToOffer, termState, mayEnrol, holidays as termHolidays, inHoliday, termPrice, readMidTerm, problemsWithMidTerm, problemsWithTerm, offersDue, CALENDARS } from '../../core/domain/terms.mjs';
import { MANAGE, REGISTER } from '../../core/domain/access.mjs';
import { resolveRegion, problemsWithRegion } from '../../core/domain/region.mjs';
import { resolveEventTypes, problemsWithEventTypes } from '../../core/domain/event-types.mjs';
import { ViewClubPage, SaveClubPage, RequestClubPage, TakeDownClubPage, DecideClubPage, ClubPagesBeneath } from '../../core/application/club-pages.mjs';
import { PostgresClubPageStore } from '../../infrastructure/postgres/club-page-store.mjs';
import { AddClub } from '../../core/application/add-club.mjs';
import { PostgresOrganisationRegister } from '../../infrastructure/postgres/organisation-register.mjs';
import { PostgresAuthorisation } from '../../infrastructure/postgres/repositories.mjs';
import { family, people } from './people.mjs';
import { speakingForThisLayer, Invalid, NotFound, PERSON_COLUMNS, WRITE_PAGES, ageOnDate, assertRole, clubMail, clubOnly, feeRows, one, q, todayAt } from './shared.mjs';

// ---------------------------------------------------------------------------
// organisations
// ---------------------------------------------------------------------------

export const orgs = {
  async bySlug(slug) {
    return one(`select * from organisation where slug = $1`, [slug]);
  },

  /**
   * What this organisation calls things.
   *
   * Settings are inherited down the tree, so the nearest ancestor that
   * declares a vocabulary wins — a federation sets it once and every club
   * under it speaks the same way, unless one of them says otherwise.
   *
   * The admin serves more than one federation from one deployment, so this
   * cannot come from a settings file. A taekwondo federation reading the word
   * "Club" in its own register is the whole problem in one word.
   */
  async vocabulary(orgId) {
    if (!orgId) return {};
    const row = await one(`
      select a.settings->'vocabulary' as vocabulary
      from organisation target
      join organisation a on target.path <@ a.path
      where target.id = $1
        and a.settings ? 'vocabulary'
      order by nlevel(a.path) desc
      limit 1`, [orgId]);
    const v = row?.vocabulary ?? {};
    return Object.fromEntries(Object.entries(v)
      .filter(([k, val]) => !k.startsWith('_') && typeof val === 'string' && val.trim()));
  },

  /** The currency, language and age of adulthood that apply here: the nearest organisation up the tree that has said. */
  async regionOf(orgId) {
    if (!orgId) return resolveRegion({});
    const row = await one(`
      select a.settings->'region' as region
      from organisation target
      join organisation a on target.path <@ a.path
      where target.id = $1 and a.settings ? 'region'
      order by nlevel(a.path) desc
      limit 1`, [orgId]);
    return resolveRegion(row?.region ?? {});
  },
  /** Make this organisation's currency, language, kinds of event and wording apply to the rest of the request. */
  async enter(orgId) {
    setRegion(await this.regionOf(orgId));
    setEventTypes(await this.eventTypesOf(orgId));
    setWords(await this.vocabulary(orgId));
  },
  /** The kinds of event this organisation runs: the nearest list up the tree, else the generic one. */
  async eventTypesOf(orgId) {
    if (!orgId) return resolveEventTypes(null);
    const row = await one(`
      select a.settings->'eventTypes' as types
      from organisation target
      join organisation a on target.path <@ a.path
      where target.id = $1 and a.settings ? 'eventTypes'
      order by nlevel(a.path) desc
      limit 1`, [orgId]);
    return resolveEventTypes(row?.types);
  },
  /** Whether this organisation has its own list (not one inherited or the generic one). */
  async hasOwnEventTypes(orgId) {
    return !!(await one(`select 1 as ok from organisation where id = $1 and settings ? 'eventTypes'`, [orgId]));
  },
  async saveEventTypes(actor, orgId, list) {
    await assertRole(actor, orgId, MANAGE);
    const problems = problemsWithEventTypes(list);
    if (problems.length) throw new Invalid(problems.join(' '));
    await pool.query(`update organisation set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{eventTypes}', $2::jsonb) where id = $1`, [orgId, JSON.stringify(list)]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id) values ($1,$2,'event_types_changed','organisation',$2)`, [actor, orgId]);
  },
  /** What this organisation itself has set (not inherited), or null. */
  async ownRegion(orgId) {
    const row = await one(`select settings->'region' as region from organisation where id = $1`, [orgId]);
    return row?.region ?? null;
  },
  async saveRegion(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    const problems = problemsWithRegion(input);
    if (problems.length) throw new Invalid(problems.join(' '));
    await pool.query(`update organisation set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{region}', $2::jsonb) where id = $1`,
      [orgId, JSON.stringify({ currency: input.currency, locale: input.locale, adultAge: input.adultAge,
        taxName: input.taxName ?? '', taxPercent: input.taxPercent ?? 0, taxNumber: input.taxNumber ?? '' })]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'region_changed','organisation',$2,$3::jsonb)`, [actor, orgId, JSON.stringify(input)]);
  },

  /**
   * Whose grading ladder applies here.
   *
   * The nearest ancestor, itself included, that defines grades. Not "the
   * federation": a multinational body and each of its national members can
   * both keep a ladder, and the one nearest the club is the one it grades on.
   * A club that defines none inherits from whoever above it does.
   */
  async ladderOwnerOf(orgId) {
    if (!orgId) return null;
    return one(`
      select a.*
      from organisation target
      join organisation a on target.path <@ a.path
      where target.id = $1
        and exists (select 1 from grade g where g.organisation_id = a.id)
      order by nlevel(a.path) desc
      limit 1`, [orgId]);
  },

  /** The whole subtree beneath (and including) an organisation. */
  async subtree(rootId) {
    return q(`
      select o.*, (select count(*) from organisation c where c.parent_id = o.id) as children
      from organisation root
      join organisation o on o.path <@ root.path
      where root.id = $1
      order by o.path`, [rootId]);
  },

  /** Every organisation this account may act on. */
  async visibleTo(actor) {
    return q(`
      select o.* from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      order by o.path`, [actor]);
  },

  /** Public club list for the website. No auth — this is the front page. */
  async publicClubs(rootSlug) {
    return q(`
      select o.id, o.name, o.slug, o.country_code,
             d.venue_name, d.city, d.suburb, d.latitude, d.longitude,
             d.phone, d.email, d.first_class_free,
             coalesce(json_agg(json_build_object(
               'label', t.label, 'weekday', t.weekday,
               'starts', t.starts, 'ends', t.ends
             ) order by t.weekday, t.starts)
               filter (where t.id is not null), '[]') as sessions
      from organisation root
      join organisation o on o.path <@ root.path and o.type = 'club'
      left join club_profile d on d.organisation_id = o.id
      left join training_session t on t.organisation_id = o.id
      where root.slug = $1 and o.status = 'active'
      group by o.id, o.name, o.slug, o.country_code, d.venue_name, d.city,
               d.suburb, d.latitude, d.longitude, d.phone, d.email,
               d.first_class_free
      order by o.name`, [rootSlug]);
  },

  async create(actor, { parentId, type, name, slug, countryCode, timezone }) {
    await assertRole(actor, parentId, MANAGE);
    const parent = await one('select path from organisation where id = $1', [parentId]);
    if (!parent) throw new NotFound('Parent organisation');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
      throw new Invalid('Slug must be lowercase letters, numbers and hyphens');
    const path = `${parent.path}.${slug.replace(/-/g, '_')}`;
    return one(`
      insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
      values ($1,$2,$3,$4,$5,$6,$7)
      returning *`,
      [parentId, type, name, slug, path, countryCode, timezone ?? DEFAULT_TIMEZONE]);
  },
};

// ---------------------------------------------------------------------------
// the site menu
//
// Stored on the organisation, because a federation's menu is the federation's.
// data/settings.json remains the fallback for a single-federation install that
// has never opened the editor — see packages/content/navigation.mjs.
// ---------------------------------------------------------------------------

export const navigation = {
  /** What this federation has stored, and everywhere its site has a page. */
  async forEditing(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    const org = await one('select settings from organisation where id=$1', [orgId]);
    const { rows: authored } = await pool.query(`
      select slug, title from page
      where organisation_id=$1 and status='published' order by title`, [orgId]);
    return { stored: org?.settings?.navigation ?? null, authored };
  },

  /**
   * Replace the menu.
   *
   * Validated against what the site will actually have a page for, so an item
   * pointing nowhere is refused here rather than disappearing during a build.
   */
  async save(actor, orgId, items, { vocabulary = {} } = {}) {
    await assertRole(actor, orgId, MANAGE);
    const { authored } = await this.forEditing(actor, orgId);
    const existing = destinations({ authored, vocabulary });

    const problems = problemsWithNavigation(items, existing);
    if (problems.length) throw new Invalid(problems.join(' '));

    const clean = items.map((i) => ({ href: i.href.trim(), label: i.label.trim() }));
    const row = await one(`
      update organisation
         set settings = jsonb_set(settings, '{navigation}', $2::jsonb, true),
             updated_at = now()
       where id = $1 returning settings`,
      [orgId, JSON.stringify({ items: clean })]);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, after)
      values ($1,$2,'navigation_save','organisation',$2,$3)`,
      [actor, orgId, JSON.stringify({ items: clean })]);

    return row?.settings?.navigation?.items ?? clean;
  },
};

// ---------------------------------------------------------------------------
// adding a club
// ---------------------------------------------------------------------------

const addClub = new AddClub({
  organisations: new PostgresOrganisationRegister(pool), auth: new PostgresAuthorisation(pool),
  enrol: (actor, fields) => people.enrol(actor, fields),
  grantAccess: (actor, personId, fields) => people.grantAccess(actor, personId, fields),
});

export const clubs = {
  /** Every club beneath this organisation, with what a federation wants to see. */
  async beneath(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select o.id, o.name, o.slug, o.status, o.created_at,
             coalesce(d.city, '') as city,
             (select count(*)::int from affiliation a
               where a.organisation_id = o.id and a.ends is null
                 and a.status = 'active') as members,
             exists (select 1 from grant_role g
                      where g.organisation_id = o.id
                        and g.role in ('owner','administrator')) as has_administrator,
             coalesce(d.published, false) as page_live
      from organisation root
      join organisation o on o.path <@ root.path and o.type = 'club'
      left join club_profile d on d.organisation_id = o.id
      where root.id = $1
      order by o.name`, [orgId]);
    return rows;
  },

  /**
   * Add a club beneath a federation or region.
   *
   * The club starts with no public page — that is the club's to ask for and
   * the federation's to approve — and, if an administrator is named, with
   * that person enrolled and able to sign in. Both happen or neither does: a
   * club with no way in is the failure this exists to prevent.
   */
  async create(actor, parentId, input) {
    return speakingForThisLayer(() => addClub.execute({ actorId: actor, parentId, input }));
  },
};

// ---------------------------------------------------------------------------
// a club's own profile
// ---------------------------------------------------------------------------

export const clubProfile = {
  /** The club, and who runs it, who trains in it, and what is coming up. */
  async get(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    // The date as text: pg hands a DATE back as a JS Date at local midnight,
    // and turning that into a string shifts it a day on a server east of UTC.
    const club = await one(`select *, to_char(founded,'YYYY-MM-DD') as founded_iso
      from organisation where id=$1 and type='club'`, [orgId]);
    if (!club) throw new NotFound('Club');

    const { rows: administrators } = await pool.query(`
      select a.email, p.first_name, p.last_name, g.role
      from grant_role g
      join account a on a.id = g.account_id
      left join person p on p.id = a.person_id
      where g.organisation_id = $1 and g.role in ('owner','administrator')
      order by g.granted_at`, [orgId]);

    const counts = await one(`
      select
        (select count(*)::int from affiliation
          where organisation_id=$1 and ends is null and status='active') as members,
        (select count(*)::int from affiliation
          where organisation_id=$1 and ends is null and status='active'
            and role in ('instructor','coach')) as instructors,
        (select count(*)::int from event
          where organisation_id=$1 and status='published'
            and starts_at > now()) as upcoming`, [orgId]);

    const page = await one(`select published, page_requested_at from club_profile
      where organisation_id=$1`, [orgId]);
    const parent = await one('select name, slug from organisation where id=$1', [club.parent_id]);
    return { club, parent, administrators, counts, page };
  },

  async save(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    const before = await one(`select *, to_char(founded,'YYYY-MM-DD') as founded_iso
      from organisation where id=$1 and type='club'`, [orgId]);
    if (!before) throw new NotFound('Club');

    const problems = problemsWithClubProfile(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    const row = await one(`
      update organisation
         set name=$2, short_name=$3, founded=$4::date, timezone=$5, status=$6,
             updated_at=now()
       where id=$1 returning *, to_char(founded,'YYYY-MM-DD') as founded_iso`,
      [orgId, input.name, input.shortName, input.founded, input.timezone, input.status]);

    const was = { name: before.name, status: before.status, timezone: before.timezone,
                  short_name: before.short_name, founded: before.founded_iso };
    const now = { name: row.name, status: row.status, timezone: row.timezone,
                  short_name: row.short_name, founded: row.founded_iso };
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before, after)
      values ($1,$2,'club_profile_saved','organisation',$2,$3,$4)`,
      [actor, orgId, JSON.stringify(was), JSON.stringify(now)]);

    return { club: row, siteChanged: changesTheSite(before, row) };
  },
};

// ---------------------------------------------------------------------------
// appearance
//
// A federation's look is stored on the organisation, like its menu, and is
// validated by the same reader the build uses, so what is saved is exactly
// what will be built. A club has no look of its own: its page is the
// federation speaking in the federation's design.
// ---------------------------------------------------------------------------

export const appearance = {
  async current(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    const org = await one('select settings from organisation where id=$1', [orgId]);
    return org?.settings?.theme ?? null;
  },

  async apply(actor, orgId, doc) {
    await assertRole(actor, orgId, MANAGE);
    const read = readTheme(doc);
    if (!read.ok) throw new Invalid(read.problems.join(' '));
    const before = (await one('select settings from organisation where id=$1', [orgId]))
      ?.settings?.theme ?? null;
    await one(`
      update organisation
         set settings = jsonb_set(settings, '{theme}', $2::jsonb, true),
             updated_at = now()
       where id = $1 returning id`, [orgId, JSON.stringify(read.theme)]);
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before, after)
      values ($1,$2,'theme_apply','organisation',$2,$3,$4)`,
      [actor, orgId, before ? JSON.stringify({ name: before.name }) : null,
       JSON.stringify({ name: read.theme.name })]);
    return read;
  },

  /** The crest: the picture used in the site header and on every event banner. null removes it. */
  async setLogo(actor, orgId, assetId) {
    await assertRole(actor, orgId, MANAGE);
    if (assetId) {
      const a = await one('select organisation_id from asset where id = $1', [assetId]);
      if (!a || a.organisation_id !== orgId) throw new Invalid('Choose one of this organisation\'s own pictures.');
    }
    await one(`update organisation set settings = case when $2::text is null then settings - 'logoAssetId'
        else jsonb_set(settings, '{logoAssetId}', to_jsonb($2::text), true) end, updated_at = now()
      where id = $1 returning id`, [orgId, assetId]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'crest_set','organisation',$2,$3)`, [actor, orgId, JSON.stringify({ assetId })]);
  },

  async logo(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    return (await one('select settings from organisation where id=$1', [orgId]))?.settings?.logoAssetId ?? null;
  },

  /** What the home page says and shows at the top. Blank words fall back to the defaults. */
  async home(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    const h = (await one('select settings from organisation where id=$1', [orgId]))?.settings?.homePage ?? {};
    return { heroAssetId: h.heroAssetId ?? null, heroHeading: h.heroHeading ?? '',
             heroText: h.heroText ?? '', heroButton: h.heroButton ?? '',
             shareAssetId: h.shareAssetId ?? null };
  },

  /**
   * Set the home-page top picture, wording and link-preview picture. `undefined` leaves a
   * field alone; null or '' clears it. Pictures must be this organisation's own.
   */
  async setHome(actor, orgId, { heroAssetId, shareAssetId, heroHeading, heroText, heroButton }) {
    await assertRole(actor, orgId, MANAGE);
    for (const [label, v] of [['heading', heroHeading], ['button', heroButton]])
      if (v != null && String(v).length > 80) throw new Invalid(`The ${label} is too long (80 characters at most).`);
    if (heroText != null && String(heroText).length > 300) throw new Invalid('The text under the heading is too long (300 characters at most).');
    for (const id of [heroAssetId, shareAssetId].filter(Boolean)) {
      const a = await one('select organisation_id from asset where id = $1', [id]);
      if (!a || a.organisation_id !== orgId) throw new Invalid('Choose one of this organisation\'s own pictures.');
    }
    const before = (await one('select settings from organisation where id=$1', [orgId]))?.settings?.homePage ?? {};
    const next = { ...before };
    const put = (k, v) => {
      if (v === undefined) return;
      const s = typeof v === 'string' ? v.trim() : v;
      if (s === null || s === '') delete next[k]; else next[k] = s;
    };
    put('heroAssetId', heroAssetId); put('shareAssetId', shareAssetId);
    put('heroHeading', heroHeading); put('heroText', heroText); put('heroButton', heroButton);
    await one(`update organisation set settings = jsonb_set(settings, '{homePage}', $2::jsonb, true),
        updated_at = now() where id = $1 returning id`, [orgId, JSON.stringify(next)]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
      values ($1,$2,'home_page_set','organisation',$2,$3,$4)`,
      [actor, orgId, JSON.stringify(before), JSON.stringify(next)]);
  },

  /** Back to the deployment's own look (settings file, then defaults). */
  async reset(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    await one(`
      update organisation set settings = settings - 'theme', updated_at = now()
       where id = $1 returning id`, [orgId]);
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, after)
      values ($1,$2,'theme_reset','organisation',$2,'{}')`, [actor, orgId]);
  },
};

const clubPageStore = new PostgresClubPageStore(pool);
const clubPageDeps = { store: clubPageStore, auth: new PostgresAuthorisation(pool) };
const viewClubPage = new ViewClubPage(clubPageDeps);
const saveClubPage = new SaveClubPage(clubPageDeps);
const requestClubPage = new RequestClubPage(clubPageDeps);
const takeDownClubPage = new TakeDownClubPage(clubPageDeps);
const decideClubPage = new DecideClubPage(clubPageDeps);
const clubPagesBeneath = new ClubPagesBeneath(clubPageDeps);

export const clubPages = {
  /** The club's profile and times, for its own screen. */
  forClub: (actor, clubId) => speakingForThisLayer(() => viewClubPage.execute({ actorId: actor, clubId })),
  async save(actor, clubId, { profile, sessions, removed = [] }) {
    await speakingForThisLayer(() => saveClubPage.execute({ actorId: actor, clubId, profile, sessions, removed }));
    return this.forClub(actor, clubId);
  },
  /** The club asks to be on the federation's website. */
  async request(actor, clubId) {
    await speakingForThisLayer(() => requestClubPage.execute({ actorId: actor, clubId }));
    return this.forClub(actor, clubId);
  },
  /** The club takes its own page down, or withdraws a request, whenever it likes. */
  async takeDown(actor, clubId) {
    await speakingForThisLayer(() => takeDownClubPage.execute({ actorId: actor, clubId }));
    return this.forClub(actor, clubId);
  },
  /** The federation answers, or switches a club on without being asked. */
  async decide(actor, clubId, approve, { decidedBy, note = null }) {
    await speakingForThisLayer(() => decideClubPage.execute({ actorId: actor, clubId, approve, decidedBy, note }));
    return this.forClub(actor, clubId);
  },
  /** Every club beneath this organisation and where its page stands. */
  beneath: (actor, orgId) => speakingForThisLayer(() => clubPagesBeneath.execute({ actorId: actor, organisationId: orgId })),
};

const termRow = `st.id, st.organisation_id, st.year, st.number, st.name, to_char(st.starts,'YYYY-MM-DD') as starts,
  to_char(st.ends,'YYYY-MM-DD') as ends, st.source`;

/** The terms that apply to this organisation for a year: its own, or the nearest ancestor's. */
async function effectiveTerms(orgId, year) {
  const rows = await q(`select ${termRow}, o.name as owner, nlevel(o.path) as depth /* security-ok: termRow is a fixed column list defined at module level */
    from school_term st join organisation o on o.id = st.organisation_id
    join organisation me on me.id = $1 and me.path <@ o.path
    where st.year = $2 order by nlevel(o.path) desc, st.number`, [orgId, year]);
  if (!rows.length) return { terms: [], owner: null };
  const top = rows[0].organisation_id;
  const terms = rows.filter((r) => r.organisation_id === top);
  return { terms, owner: { id: top, name: terms[0].owner }, inherited: top !== orgId };
}

/** The country an organisation is in: its own, or the nearest ancestor that says. */
const countryOf = async (orgId) => (await one(`select o.country_code from organisation me join organisation o on me.path <@ o.path
  where me.id = $1 and o.country_code is not null order by nlevel(o.path) desc limit 1`, [orgId]))?.country_code ?? null;

const midTermOf = (org) => { const r = org.settings?.terms?.midTerm; return r?.mode ? { mode: r.mode, fixedCents: r.fixedCents ?? 0 } : { mode: 'weeks', fixedCents: 0 }; };

export const terms = {
  /** The calendar as this organisation sees it, this year and next. */
  async overview(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    const org = await one('select * from organisation where id = $1', [orgId]);
    const today = await todayAt(org);
    const y = Number(today.slice(0, 4));
    const country = await countryOf(orgId);
    const years = [];
    for (const year of [y, y + 1]) {
      const e = await effectiveTerms(orgId, year);
      const counts = e.terms.length ? await q(`select term_id, count(*)::int as n, count(*) filter (where paid)::int as paid, coalesce(sum(fee_cents) filter (where paid),0)::int as cents
        from term_enrolment where organisation_id = $1 and status = 'enrolled' and term_id = any($2::uuid[]) group by term_id`, [orgId, e.terms.map((t) => t.id)]) : [];
      years.push({ year, ...e, terms: e.terms.map((t) => ({ ...t, state: termState(t, today), ...(counts.find((c) => c.term_id === t.id) ?? { n: 0, paid: 0, cents: 0 }) })),
        holidays: termHolidays(e.terms), builtIn: !e.terms.length || !e.inherited ? builtInFor(country, year) : null });
    }
    const here = years.flatMap((yr) => yr.terms);
    return { org, today, country, years, midTerm: midTermOf(org), isClub: org.type === 'club',
      current: here.find((t) => t.starts <= today && today <= t.ends) ?? null,
      next: here.find((t) => t.starts > today) ?? null,
      holiday: inHoliday(here, today), calendar: CALENDARS[String(country ?? '').toUpperCase()] ?? null };
  },

  /** Load the country's own calendar for a year. */
  async loadBuiltIn(actor, orgId, year, { quiet = false } = {}) {
    if (!quiet) await assertRole(actor, orgId, MANAGE);
    const country = await countryOf(orgId);
    const cal = builtInFor(country, year);
    if (!cal) throw new Invalid(`There is no built-in calendar for ${country ?? 'this country'} in ${year}. Add the terms yourself.`);
    if ((await one('select 1 as x from school_term where organisation_id = $1 and year = $2', [orgId, year])))
      throw new Invalid(`${year} already has terms here.`);
    for (const t of cal.terms)
      await pool.query(`insert into school_term (organisation_id, year, number, name, starts, ends, source) values ($1,$2,$3,$4,$5,$6,'built-in')`,
        [orgId, year, t.number, t.name, t.starts, t.ends]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'terms_loaded','organisation',$2,$3)`, [quiet ? null : actor, orgId, JSON.stringify({ year, country, source: cal.source })]);
    return cal.terms.length;
  },

  async save(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    const t = { id: input.id || null, name: String(input.name ?? '').trim().slice(0, 40), starts: String(input.starts ?? '').trim(), ends: String(input.ends ?? '').trim() };
    const year = Number(t.starts.slice(0, 4));
    const others = await q(`select id, to_char(starts,'YYYY-MM-DD') as starts, to_char(ends,'YYYY-MM-DD') as ends from school_term where organisation_id = $1`, [orgId]);
    const problems = problemsWithTerm(t, others);
    if (problems.length) throw new Invalid(problems.join(' '));
    if (t.id) {
      const row = await one(`update school_term set name=$3, starts=$4, ends=$5, year=$6, source='manual' where id=$1 and organisation_id=$2 returning id`, [t.id, orgId, t.name, t.starts, t.ends, year]);
      if (!row) throw new NotFound('Term');
    } else {
      const n = (await one('select coalesce(max(number),0)+1 as n from school_term where organisation_id=$1 and year=$2', [orgId, year])).n;
      await pool.query(`insert into school_term (organisation_id, year, number, name, starts, ends) values ($1,$2,$3,$4,$5,$6)`, [orgId, year, n, t.name, t.starts, t.ends]);
    }
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'term_saved','organisation',$2,$3)`, [actor, orgId, JSON.stringify(t)]);
  },

  async remove(actor, orgId, termId) {
    await assertRole(actor, orgId, MANAGE);
    if ((await one(`select 1 as x from term_enrolment where term_id = $1 and status = 'enrolled'`, [termId])))
      throw new Invalid('Children are enrolled in that term. Withdraw them first.');
    const row = await one('delete from school_term where id = $1 and organisation_id = $2 returning id', [termId, orgId]);
    if (!row) throw new NotFound('Term');
  },

  async setRule(actor, orgId, form) {
    await assertRole(actor, orgId, MANAGE);
    const org = await clubOnly(orgId);
    const rule = readMidTerm(form);
    const problems = problemsWithMidTerm(rule);
    if (problems.length) throw new Invalid(problems.join(' '));
    await pool.query(`update organisation set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('terms',
      coalesce(settings->'terms','{}'::jsonb) || jsonb_build_object('midTerm', $2::jsonb)), updated_at = now() where id = $1`, [org.id, JSON.stringify(rule)]);
  },

  /** Who is enrolled in one term at one club. */
  async roster(actor, orgId, termId) {
    await assertRole(actor, orgId, REGISTER);
    const term = await one(`select ${termRow} from school_term st where st.id = $1`, [termId]); /* security-ok: termRow is a fixed column list defined at module level */
    if (!term) throw new NotFound('Term');
    const rows = await q(`select e.id, e.status, e.paid, e.fee_cents, e.price_note, to_char(e.enrolled_on,'YYYY-MM-DD') as enrolled_on, p.id as person_id,
        trim(concat_ws(' ', p.first_name, p.last_name)) as name, date_part('year', age(p.date_of_birth))::int as age
      from term_enrolment e join person p on p.id = e.person_id where e.term_id = $1 and e.organisation_id = $2 order by e.status, p.last_name, p.first_name`, [termId, orgId]);
    return { term, rows };
  },

  /** The terms a child could be enrolled in now, and what each costs them. */
  async forPerson(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const person = await one(`select ${PERSON_COLUMNS} from person p where p.id = $1`, [personId]);
    const home = await one(`select o.* from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.role = 'member' and a.status in ('active') and a.ends is null limit 1`, [personId]);
    if (!home) return { how, person, club: null, items: [] };
    const today = await todayAt(home);
    const age = ageOnDate(person.date_of_birth, today);
    if (age == null || age >= region().adultAge) return { how, person, club: null, items: [] };
    const y = Number(today.slice(0, 4));
    const grade = await one('select rank_order from person_current_grade where person_id = $1', [personId]);
    const sessions = await q('select weekday, min_age, max_age, min_grade_id from training_session where organisation_id = $1', [home.id]);
    const weekdays = [...new Set(sessions.filter((s) => (s.min_age == null || age >= s.min_age) && (s.max_age == null || age <= s.max_age)).map((s) => s.weekday))];
    const schedule = await feeRows(home.id);
    const fee = feeFor(schedule, { adultAge: region().adultAge, ageYears: age, period: 'term', today });
    const rule = midTermOf(home);
    const items = [];
    for (const year of [y, y + 1]) {
      for (const t of (await effectiveTerms(home.id, year)).terms) {
        if (t.ends < today) continue;
        const enrolment = await one(`select id, status, paid, fee_cents, price_note from term_enrolment where term_id = $1 and person_id = $2`, [t.id, personId]);
        const state = termState(t, today);
        const price = fee ? termPrice({ fullCents: fee.amount_cents, term: t, today, rule, weekdays }) : { cents: 0, kind: 'free', note: 'No term fee set' };
        items.push({ term: t, state, enrolment, price, mayEnrol: mayEnrol(t, today) && !!price && (!enrolment || enrolment.status === 'withdrawn') });
      }
    }
    return { how, person, club: home.name, items, fee, rule };
  },

  async enrol(actor, personId, termId) {
    const info = await this.forPerson(actor, personId);
    const item = info.items.find((i) => i.term.id === termId);
    if (!item) throw new NotFound('Term');
    if (!item.mayEnrol) throw new Invalid(item.enrolment?.status === 'enrolled' ? 'Already enrolled.' : item.price ? 'Enrolment is not open for that term yet.' : 'The club does not take enrolments part-way through this term.');
    const home = await one(`select o.id, o.timezone from affiliation a join organisation o on o.id = a.organisation_id where a.person_id=$1 and a.role='member' and a.status='active' and a.ends is null`, [personId]);
    const today = await todayAt(home);
    const cents = item.price.cents;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [e] } = await client.query(`insert into term_enrolment (term_id, person_id, organisation_id, status, fee_cents, price_note, paid, enrolled_on, enrolled_by)
        values ($1,$2,$3,'enrolled',$4,$5,$6,$7::date,$8)
        on conflict (term_id, person_id) do update set status='enrolled', fee_cents=$4, price_note=$5, paid=$6, enrolled_on=$7::date, enrolled_by=$8 returning id`,
        [termId, personId, home.id, cents, item.price.note, cents === 0, today, actor]);
      let paymentId = null;
      if (cents > 0) {
        const { rows: [pay] } = await client.query(`insert into payment (organisation_id, person_id, amount_cents, currency, status, requested_by)
          values ($1,$2,$3,$4,'pending',$5) returning id`, [home.id, personId, cents, info.fee?.currency ?? region().currency, actor]);
        await client.query(`insert into payment_line (payment_id, kind, description, amount_cents, term_enrolment_id) values ($1,'club_fee',$2,$3,$4)`,
          [pay.id, `${item.term.name} ${item.term.year} classes — ${info.person.first_name}${item.price.kind === 'full' ? '' : ` (${item.price.note})`}`, cents, e.id]);
        paymentId = pay.id;
      }
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'term_enrolled','term_enrolment',$3,$4)`,
        [actor, home.id, e.id, JSON.stringify({ term: item.term.name, year: item.term.year, cents })]);
      await client.query('commit');
      return { paymentId };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },

  /** Withdraw before the term starts. An unpaid bill is cancelled; a paid one is left for the club to refund. */
  async withdraw(actor, personId, termId) {
    await family.assertMayActFor(actor, personId);
    const e = await one(`select e.id, e.paid, e.organisation_id, to_char(st.starts,'YYYY-MM-DD') as starts, o.timezone from term_enrolment e
      join school_term st on st.id = e.term_id join organisation o on o.id = e.organisation_id
      where e.term_id = $1 and e.person_id = $2 and e.status = 'enrolled'`, [termId, personId]);
    if (!e) throw new NotFound('Enrolment');
    if ((await todayAt(e)) >= e.starts) throw new Invalid('The term has started. Please ask the club.');
    await pool.query(`update payment set status='void', updated_at=now() where status in ('pending','failed') and id in (select payment_id from payment_line where term_enrolment_id = $1)`, [e.id]);
    await pool.query(`update term_enrolment set status='withdrawn' where id=$1`, [e.id]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'term_withdrawn','term_enrolment',$3,$4)`,
      [actor, e.organisation_id, e.id, JSON.stringify({ paid: e.paid })]);
    return { paid: e.paid };
  },

  /** Daily: load each country's next calendar where it is known, and offer the next term to families. */
  async run({ messenger, baseFrom, origin }) {
    const report = { loaded: [], offered: 0 };
    const roots = await q(`select id, name, country_code, settings from organisation where parent_id is null and status = 'active' and country_code is not null`);
    for (const r of roots) {
      if (r.settings?.terms?.auto === false) continue;
      const today = await todayAt({ timezone: (await one('select timezone from organisation where id=$1', [r.id])).timezone });
      const loaded = (await q('select distinct year from school_term where organisation_id = $1', [r.id])).map((x) => x.year);
      const year = yearToOffer(loaded, today);
      if (year && builtInYears(r.country_code).includes(year)) {
        try { await this.loadBuiltIn(null, r.id, year, { quiet: true }); report.loaded.push(`${r.name} ${year}`); } catch { /* already there */ }
      }
    }
    const clubs = await q(`select * from organisation where type = 'club' and status = 'active'`);
    for (const club of clubs) {
      const today = await todayAt(club);
      const y = Number(today.slice(0, 4));
      const all = [...(await effectiveTerms(club.id, y)).terms, ...(await effectiveTerms(club.id, y + 1)).terms];
      const due = offersDue(all, today);
      if (!due) continue;
      if (await one('select 1 as x from term_offer where term_id = $1 and organisation_id = $2', [due.next.id, club.id])) continue;
      const kids = await q(`select p.id, p.first_name, p.email::text as email,
          coalesce((select json_agg(g.email::text) from guardian_link gl join person g on g.id = gl.guardian_id where gl.child_id = p.id and gl.ended_on is null and g.email is not null and (gl.is_main_contact or gl.also_copy or not exists (select 1 from guardian_link m where m.child_id = p.id and m.ended_on is null and m.is_main_contact))), '[]'::json) as guardians
        from term_enrolment e join person p on p.id = e.person_id
        where e.term_id = $1 and e.organisation_id = $2 and e.status = 'enrolled'
          and not exists (select 1 from term_enrolment n where n.term_id = $3 and n.person_id = p.id)
          and exists (select 1 from affiliation a where a.person_id = p.id and a.organisation_id = $2 and a.status = 'active' and a.ends is null)`,
        [due.prev.id, club.id, due.next.id]);
      const byAddress = new Map();
      for (const k of kids) for (const addr of (k.guardians.length ? k.guardians : [k.email]).filter(Boolean)) byAddress.set(addr, [...(byAddress.get(addr) ?? []), k.first_name]);
      await pool.query('insert into term_offer (term_id, organisation_id) values ($1,$2) on conflict do nothing', [due.next.id, club.id]);
      for (const [to, names] of byAddress) {
        const sent = await clubMail(club, { messenger, baseFrom }, to, `${due.next.name} enrolment is open at ${club.name}`,
          `Hello,\n\nEnrolment for ${due.next.name} (${due.next.starts} to ${due.next.ends}) is open for ${names.join(' and ')}.\nEnrol online: ${origin}/me/terms\n\nSee you in class.`);
        if (sent) report.offered++;
      }
    }
    return report;
  },
};

// ---------------------------------------------------------------------------
// the platform: how this installation is doing, for the federation's owner
// ---------------------------------------------------------------------------

export const platform = {
  /** Only the owner of the federation at the top of this installation. */
  async overview(actor, { env = process.env, provider = null, pushOn = false } = {}) {
    const root = await one(`select id, slug, name from organisation where parent_id is null order by created_at limit 1`);
    if (!root) throw new NotFound('Federation');
    await assertRole(actor, root.id, ['owner']);
    const count = async (sql, a = []) => (await one(sql, a)).n;
    const orgs = await q(`select type, count(*)::int n from organisation where status='active' group by type order by type`);
    const members = await q(`select status, count(*)::int n from affiliation where ends is null and role in ('member','instructor','assistant') group by status order by status`);
    const stats = {
      people: await count('select count(*)::int n from person'),
      accounts: await count('select count(*)::int n from account'),
      upcomingEvents: await count(`select count(*)::int n from event where starts_at > now()`),
      formsPublished: await count(`select count(*)::int n from club_form where status='published'`),
      autoRenewing: await count(`select count(*)::int n from payment_agreement where status='active'`),
      autoRenewStopped: await count(`select count(*)::int n from payment_agreement where status='paused'`),
      bookingsAhead: await count(`select count(*)::int n from class_booking where status='booked' and session_date >= current_date`),
      pushDevices: await count('select count(*)::int n from push_subscription'),
      tokens: await count('select count(*)::int n from api_token where revoked_at is null'),
      webhooks: await count('select count(*)::int n from webhook_endpoint where active'),
      webhooksOff: await count('select count(*)::int n from webhook_endpoint where not active'),
      deliveriesFailed24h: await count(`select count(*)::int n from webhook_delivery where status='failed' and created_at > now() - interval '24 hours'`),
      deliveriesWaiting: await count(`select count(*)::int n from webhook_delivery where status='pending'`),
    };
    const recent = await q(`select l.at as created_at, l.action, o.name as organisation, nullif(a.email,'') as who
      from audit_log l left join organisation o on o.id = l.organisation_id left join account a on a.id = l.account_id order by l.at desc limit 15`);
    const check = (ok, good, bad) => ({ ok, text: ok ? good : bad });
    const health = [
      check(!!env.CRON_SECRET, 'The daily job is locked with a secret.', 'CRON_SECRET is not set, so the daily job (reminders, automatic renewals, webhook retries) cannot run.'),
      check(provider && provider.name !== 'test', 'Payments are live.', 'Payments are in test mode — no real money moves.'),
      check((env.MESSENGER_PROVIDER ?? 'none') !== 'none', 'Email is switched on.', 'Email is off, so messages and sign-in links are not sent.'),
      check(pushOn, 'Notifications are switched on.', 'Notifications are off (no VAPID keys set).'),
    ];
    return { root, orgs, members, stats, recent, health, store: env.HONBU_STORE ?? 'postgres' };
  },
};

// ---------------------------------------------------------------------------
// lookups
//
// Small questions the routes ask. They live here, with the rest of the SQL, so a route never talks to the
// database itself (tools/check-architecture.mjs holds it to that).
// ---------------------------------------------------------------------------
export const lookups = {
  /** The organisations this account can see, with how many active members each has. */
  async visibleOrgs(actor) {
    return q(`
      select o.id, o.name, o.slug, o.type, o.path::text as path,
             (select count(*) from affiliation a
               where a.organisation_id = o.id and a.ends is null
                 and a.role = 'member' and a.status = 'active') as members
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      order by o.type, o.name`, [actor]);
  },
  async isPlatformOwner(actor) {
    return !!(await one(`select 1 as ok from organisation o where o.parent_id is null
      and has_role_at($1::uuid, o.id, array['owner']::role_name[])`, [actor]));
  },
  /** Somebody by their member number, as typed (any case). */
  async personByNumber(number) {
    return one('select id from person where upper(display_number)=$1', [String(number).toUpperCase()]);
  },
  async activeClub(slug) {
    return one(`select name, slug from organisation where slug = $1 and status = 'active'`, [slug]);
  },
  async hasRole(actor, orgId, roles) {
    return !!(await one('select has_role_at($1,$2,$3) as ok', [actor, orgId, roles]))?.ok;
  },
  /** The top of the tree an organisation belongs to: the federation whose site and words it uses. */
  async rootOf(orgId) {
    return one(`select o.* from organisation o join organisation me on me.path <@ o.path
      where me.id = $1 and o.parent_id is null`, [orgId]);
  },
  /** The organisation that owns an event, as seen from `orgId` (the event's own or one above it). */
  async eventHost(orgId, eventSlug) {
    return one(`select o.* from event e join organisation o on o.id = e.organisation_id
      join organisation me on me.id = $1
      where e.slug = $2 and me.path <@ o.path`, [orgId, eventSlug]);
  },
  /** The flat entry fee in cents, or 0. */
  async flatEntryFeeCents(eventId) {
    return (await one(`select amount_cents from entry_price where event_id=$1 and for_count=1 and not members_only`, [eventId]))?.amount_cents ?? 0;
  },
  async aboutOf(personId) {
    return (await one('select about from person where id = $1', [personId]))?.about ?? '';
  },
  async holdsDan(personId) {
    return !!(await one('select 1 as ok from person_current_grade where person_id = $1 and is_dan', [personId]));
  },
  /** Where a moved page now lives, if it has moved. */
  async redirectFor(path) {
    return one('select to_path, permanent from redirect where from_path = $1', [path]).catch(() => null);
  },
};
