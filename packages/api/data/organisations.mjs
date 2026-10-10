/**
 * HONBU — data access: organisations
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';
import { region, setRegion, setEventTypes, setWords } from '../../infrastructure/region-context.mjs';
import { readTheme } from '../../site/theme.mjs';
import { destinations, problemsWithNavigation } from '../../content/navigation.mjs';
import { midTermOf, builtInFor, termState, holidays as termHolidays, inHoliday, CALENDARS } from '../../core/domain/terms.mjs';
import { MANAGE, REGISTER } from '../../core/domain/access.mjs';
import { resolveRegion, problemsWithRegion } from '../../core/domain/region.mjs';
import { resolveEventTypes, problemsWithEventTypes } from '../../core/domain/event-types.mjs';
import { LoadBuiltInTerms, SaveTerm, RemoveTerm, SetMidTermRule, OfferedTerms, RunDailyTermWork, EnrolInTerm, WithdrawFromTerm } from '../../core/application/terms.mjs';
import { PostgresTermStore } from '../../infrastructure/postgres/term-store.mjs';
import { ViewClubPage, SaveClubPage, RequestClubPage, TakeDownClubPage, DecideClubPage, ClubPagesBeneath } from '../../core/application/club-pages.mjs';
import { PostgresClubPageStore } from '../../infrastructure/postgres/club-page-store.mjs';
import { ReadSiteSettings, SaveNavigation, ApplyTheme, ResetTheme, SetCrest, SetHomePage, ViewClubProfile, SaveClubProfile } from '../../core/application/site-settings.mjs';
import { PostgresSettingsStore } from '../../infrastructure/postgres/settings-store.mjs';
import { AddClub } from '../../core/application/add-club.mjs';
import { PostgresOrganisationRegister } from '../../infrastructure/postgres/organisation-register.mjs';
import { PostgresAuthorisation } from '../../infrastructure/postgres/repositories.mjs';
import { family, people } from './people.mjs';
import { speakingForThisLayer, Invalid, NotFound, assertRole, clubMail, feeRows, one, q, todayAt } from './shared.mjs';

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

const settingsDeps = { store: new PostgresSettingsStore(pool), auth: new PostgresAuthorisation(pool), destinations, problemsWithNavigation, readTheme };
const readSiteSettings = new ReadSiteSettings(settingsDeps);
const saveNavigation = new SaveNavigation(settingsDeps);
const applyTheme = new ApplyTheme(settingsDeps);
const resetTheme = new ResetTheme(settingsDeps);
const setCrest = new SetCrest(settingsDeps);
const setHomePage = new SetHomePage(settingsDeps);
const viewClubProfile = new ViewClubProfile(settingsDeps);
const saveClubProfile = new SaveClubProfile(settingsDeps);

export const navigation = {
  /** What this federation has stored, and everywhere its site has a page. */
  forEditing: (actor, orgId) => speakingForThisLayer(() => readSiteSettings.navigation({ actorId: actor, organisationId: orgId })),
  save: (actor, orgId, items, { vocabulary = {} } = {}) =>
    speakingForThisLayer(() => saveNavigation.execute({ actorId: actor, organisationId: orgId, items, vocabulary })),
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
  get: (actor, orgId) => speakingForThisLayer(async () => {
    const r = await viewClubProfile.execute({ actorId: actor, organisationId: orgId });
    return { club: r.club, parent: r.parent, administrators: r.administrators, counts: r.counts, page: r.page };
  }),
  save: (actor, orgId, input) => speakingForThisLayer(() => saveClubProfile.execute({ actorId: actor, organisationId: orgId, input })),
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
  current: (actor, orgId) => speakingForThisLayer(() => readSiteSettings.theme({ actorId: actor, organisationId: orgId })),
  apply: (actor, orgId, doc) => speakingForThisLayer(() => applyTheme.execute({ actorId: actor, organisationId: orgId, doc })),
  setLogo: (actor, orgId, assetId) => speakingForThisLayer(() => setCrest.execute({ actorId: actor, organisationId: orgId, assetId })),
  logo: (actor, orgId) => speakingForThisLayer(() => readSiteSettings.crest({ actorId: actor, organisationId: orgId })),
  home: (actor, orgId) => speakingForThisLayer(() => readSiteSettings.home({ actorId: actor, organisationId: orgId })),
  setHome: (actor, orgId, fields) => speakingForThisLayer(() => setHomePage.execute({ actorId: actor, organisationId: orgId, ...fields })),
  reset: (actor, orgId) => speakingForThisLayer(() => resetTheme.execute({ actorId: actor, organisationId: orgId })),
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

const termDeps = { store: new PostgresTermStore(pool, pool, { feeScheduleFor: (clubId) => feeRows(clubId) }), auth: new PostgresAuthorisation(pool),
  howMayActFor: (accountId, personId) => family.mayActFor(accountId, personId), adultAge: () => region().adultAge, currency: () => region().currency };
const loadBuiltInTerms = new LoadBuiltInTerms(termDeps);
const saveTerm = new SaveTerm(termDeps);
const removeTerm = new RemoveTerm(termDeps);
const setMidTermRule = new SetMidTermRule(termDeps);
const runDailyTermWork = new RunDailyTermWork({ store: termDeps.store, loadBuiltIn: (orgId, year) => loadBuiltInTerms.execute({ actorId: null, organisationId: orgId, year, system: true }) });
const offeredTerms = new OfferedTerms(termDeps);
const enrolInTerm = new EnrolInTerm(termDeps);
const withdrawFromTerm = new WithdrawFromTerm(termDeps);

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

  /** Load the country's own calendar for a year. `quiet` is the daily run, acting for nobody. */
  loadBuiltIn: (actor, orgId, year, { quiet = false } = {}) =>
    speakingForThisLayer(() => loadBuiltInTerms.execute({ actorId: actor, organisationId: orgId, year, system: quiet })),
  save: (actor, orgId, input) => speakingForThisLayer(() => saveTerm.execute({ actorId: actor, organisationId: orgId, input })),
  remove: (actor, orgId, termId) => speakingForThisLayer(() => removeTerm.execute({ actorId: actor, organisationId: orgId, termId })),
  setRule: (actor, orgId, form) => speakingForThisLayer(() => setMidTermRule.execute({ actorId: actor, organisationId: orgId, form })),

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
  forPerson: (actor, personId) => speakingForThisLayer(() => offeredTerms.execute({ actorId: actor, personId })),
  enrol: (actor, personId, termId) => speakingForThisLayer(() => enrolInTerm.execute({ actorId: actor, personId, termId })),
  /** Withdraw before the term starts. An unpaid bill is cancelled; a paid one is left for the club to refund. */
  withdraw: (actor, personId, termId) => speakingForThisLayer(() => withdrawFromTerm.execute({ actorId: actor, personId, termId })),

  /** Daily: load each country's next calendar where it is known, and offer the next term to families. */
  run: ({ messenger, baseFrom, origin }) => runDailyTermWork.execute({ origin, mailClub: (club, to, subject, text) => clubMail(club, { messenger, baseFrom }, to, subject, text) }),
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
