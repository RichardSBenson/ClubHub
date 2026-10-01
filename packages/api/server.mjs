/**
 * HONBU — admin server
 *
 * Constraints this is built around, and they are not negotiable:
 *
 *  - Deployed from a phone, through GitHub's web editor, to Vercel. So: no
 *    build step, no bundler, no framework, and files small enough to edit on a
 *    screen that size.
 *  - One dependency (pg). Nothing else in node_modules to break on update.
 *  - Server-rendered HTML. Every screen works with JavaScript off, because
 *    these get used in halls with bad reception.
 *
 * Exports `handler(req, res)` for Vercel's Node runtime — and nothing else.
 *
 * This module does not import node:http, does not call createServer, and does
 * not call listen. Vercel's builder inspects a function's module graph and,
 * on finding an HTTP server being constructed, treats the function as a
 * captured Node server that will bind a port at startup. This one never binds,
 * so there was nothing to route to: every admin route 404'd in production
 * while the build stayed green and every local test passed. Anything that
 * needs a real listening server — dev.mjs, the tests — builds one itself
 * around this handler.
 *
 * Nothing in this file calls listen(). That is deliberate and it is not a
 * style preference. Vercel's builder treats a listen() anywhere in a
 * function's module graph as a captured Node server and expects the process
 * to bind a port at startup. This file's listener used to sit behind a
 * `process.argv[1]` guard, which is false on Vercel — so nothing ever bound,
 * and every route through this module returned 404 while the build stayed
 * green. The local listener lives in dev.mjs now. Keep it there.
 */

import crypto from 'node:crypto';
import { URL } from 'node:url';
import { pool, orgs, people, rank, events, competition, pages, assets, news,
         instructors, navigation, audit, search, clubPages, appearance, clubs, clubProfile, family, myself, memberEvents,
         Forbidden, NotFound, Invalid } from './data.mjs';
import * as auth from './auth.mjs';
import * as V from './views.mjs';
import { readSelfEdit } from '../core/domain/family.mjs';
import { readClubProfile } from '../core/domain/club-profile.mjs';
import { readNewClub } from '../core/domain/new-club.mjs';
import { BUILT_IN } from '../site/builtin-themes.mjs';
import { readTheme, serialise } from '../site/theme.mjs';
import { currentStore } from '../infrastructure/factory.mjs';
import { messengerFrom } from '../infrastructure/messaging/messengers.mjs';
import { SendSignInLink } from '../core/application/send-sign-in-link.mjs';
import { ScheduleEvent, ReviseEvent, CancelEvent, MAY_SCHEDULE }
  from '../core/application/schedule-event.mjs';
import { repositories } from '../infrastructure/factory.mjs';
import { toInstant, toLocalInput } from './zones.mjs';
import { readMultipart, BadUpload } from './multipart.mjs';
import { destinations, menuFor, MAX_ITEMS } from '../content/navigation.mjs';
import { ACTIONS as AUDIT_ACTIONS } from '../content/audit.mjs';
import { documentFromText, textFromDocument }
  from '../content/document-text.mjs';
import { identify, NotAnImage, ACCEPTED, MAX_BYTES }
  from '../content/images.mjs';
import { parseTable, planImport } from '../core/domain/roll-import.mjs';
import { Competitor, Division, placeEntry, priceFor, consentNeeded,
         problemsWithConsent } from '../core/domain/competition.mjs';
import { ageOn } from '../core/domain/people.mjs';
import { looksEmpty }
  from '../content/page-form.mjs';
import { renderBlocks, excerpt } from '../content/blocks.mjs';
import { readClubPage, problemsWithClubPage, ClubPageNotReady }
  from '../core/domain/club-page.mjs';
import * as R from '../site/render.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';

const SESSION_COOKIE = 'honbu_session';
const CSRF_COOKIE = 'honbu_csrf';

// ---------------------------------------------------------------------------
// cookies, bodies, CSRF
// ---------------------------------------------------------------------------

const parseCookies = (header = '') => Object.fromEntries(
  header.split(';').map((c) => c.trim().split('='))
    .filter((p) => p.length === 2)
    .map(([k, v]) => [k, decodeURIComponent(v)]));

async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 512 * 1024) throw new Invalid('That submission is too large');
    chunks.push(c);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
}

const newCsrf = () => crypto.randomBytes(18).toString('base64url');

/**
 * Double-submit cookie. SameSite=Lax stops most cross-site posting but not a
 * top-level form POST, and every state change here writes to a federation's
 * register.
 */
function assertCsrf(cookieValue, formValue) {
  if (!cookieValue || !formValue)
    throw new Forbidden('That form is missing its token. Reload and try again.');
  const a = Buffer.from(String(cookieValue));
  const b = Buffer.from(String(formValue));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw new Forbidden('That form has expired. Reload and try again.');
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

/**
 * Every route, exported so it can be enumerated.
 *
 * Exported for one reason: the tenant-isolation test walks this table and
 * probes every entry as somebody with no business at the organisation in the
 * path. A test that listed routes by hand would prove only that the routes
 * somebody remembered are safe, and the hole it found — /o/:slug/events,
 * readable by any signed-in member of any club — was in a route nobody
 * thought to check.
 *
 * Walking the real table means a route added next year is probed the day it
 * is written, and the test fails on any route that is in neither the public
 * list nor the protected one, so nobody can add one without deciding which.
 */
export const routes = [];
const get = (pattern, handler) => routes.push({ method: 'GET', pattern, handler });
const post = (pattern, handler) => routes.push({ method: 'POST', pattern, handler });

function match(pattern, path) {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

// ---- sign in --------------------------------------------------------------

get('/', async (ctx) => ctx.redirect(ctx.me ? '/dashboard' : '/signin'));

// The static site owns /, so / above is only reachable in local development.
// /admin is the door people will actually type.
get('/admin', async (ctx) => ctx.redirect(ctx.me ? '/dashboard' : '/signin'));

get('/signin', async (ctx) => ctx.send(200, V.signIn({
  sent: ctx.url.searchParams.get('sent'), csrf: ctx.csrf })));

post('/signin', async (ctx) => {
  const form = await ctx.form();
  try {
    const issue = await auth.requestLink(form.email, { ip: ctx.ip });

    const send = new SendSignInLink({
      messenger: messengerFrom(),
      clock: { today: () => new Date().toISOString().slice(0, 10) },
    });

    // Awaited. Responding before the message is away is how sign-in links
    // vanish while the logs stay clean.
    await send.execute({
      email: form.email,
      issue,
      origin: `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`,
      federation: process.env.FEDERATION_NAME ?? 'your organisation',
    });
  } catch (e) {
    if (e.status === 429)
      return ctx.send(429, V.signIn({ error: e.message, csrf: ctx.csrf }));
    // A messenger failure must not look like success — the person would wait
    // forever for a link that was never sent.
    if (e.name === 'MessengerError') {
      console.error('sign-in link not sent:', e.message);
      return ctx.send(503, V.signIn({ csrf: ctx.csrf,
        error: 'We could not send the sign-in link just now. Try again shortly.' }));
    }
    throw e;
  }
  return ctx.redirect('/signin?sent=1');
});

get('/signin/:token', async (ctx) => {
  try {
    const { token, redirectTo } = await auth.redeemLink(ctx.params.token, {
      userAgent: ctx.req.headers['user-agent'], ip: ctx.ip,
    });
    ctx.cookie(`${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; ` +
      `Max-Age=${auth.SESSION_TTL_DAYS * 86400}${ctx.secure ? '; Secure' : ''}`);
    return ctx.redirect(redirectTo ?? '/dashboard');
  } catch (e) {
    return ctx.send(403, V.signIn({ error: e.message, csrf: ctx.csrf }));
  }
});

/**
 * The way in before email works. Exists only while HONBU_BOOTSTRAP is set.
 */
get('/bootstrap/:secret', async (ctx) => {
  try {
    const { token, account, expiresInDays } =
      await auth.bootstrapSignIn(ctx.params.secret, {
        userAgent: ctx.req.headers['user-agent'], ip: ctx.ip });
    ctx.cookie(`${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; ` +
      `Max-Age=${expiresInDays * 86400}${ctx.secure ? '; Secure' : ''}`);
    return ctx.redirect('/dashboard');
  } catch (e) {
    // A wrong secret and a disabled route look identical from outside.
    return ctx.send(403, V.error({ me: null, status: 403, csrf: ctx.csrf,
      message: e.message }));
  }
});

/**
 * Open a demonstration federation's register. No account, no sign-in.
 *
 *   /try/demo-tkd   the taekwondo federation
 *   /try/demo-bjj   the jiu-jitsu academies
 *
 * Refuses any federation that is not marked as a demonstration, so this is
 * not a second door into a real register.
 */
get('/try/:slug', async (ctx) => {
  const { token, federation, expiresInHours } =
    await auth.demoSignIn(ctx.params.slug, {
      userAgent: ctx.req.headers['user-agent'], ip: ctx.ip });

  ctx.cookie(`${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; `
    + `Max-Age=${expiresInHours * 3600}${ctx.secure ? '; Secure' : ''}`);
  return ctx.redirect('/dashboard');
});

post('/signout', async (ctx) => {
  await ctx.form();
  if (ctx.sessionToken) await auth.signOut(ctx.sessionToken);
  ctx.cookie(`${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  return ctx.redirect('/signin');
});

// ---- dashboard ------------------------------------------------------------

get('/dashboard', async (ctx) => {
  ctx.requireActor();
  // Somebody whose only role is "member" has no organisation to run. Their
  // home is their own details, not an empty list of organisations.
  if (ctx.me.grants.length && ctx.me.grants.every((g) => g.role === 'member') && ctx.me.personId)
    return ctx.redirect('/me');
  const { rows } = await pool.query(`
    select o.id, o.name, o.slug, o.type, o.path::text as path,
           (select count(*) from affiliation a
             where a.organisation_id = o.id and a.ends is null
               and a.role = 'member' and a.status = 'active') as members
    from visible_orgs($1) v
    join organisation o on o.id = v.organisation_id
    order by o.type, o.name`, [ctx.me.accountId]);

  // Every other screen looks at one federation, so one vocabulary does. This
  // one does not: an account can span federations in different arts, and a
  // karate dojo and a jiu-jitsu academy can appear on the same screen. Taking
  // the home federation's words and applying them to everybody calls the
  // academies dojos, which is exactly the thing configuration-over-code is
  // supposed to make impossible.
  const clubs = rows.filter((o) => o.type === 'club');
  const parents = rows.filter((o) => o.type !== 'club');
  const rootOf = (o) => o.path.split('.')[0];

  const groups = [];
  for (const club of clubs) {
    const key = rootOf(club);
    let group = groups.find((g) => g.key === key);
    if (!group) groups.push(group = {
      key, clubs: [], federation: parents.find((p) => p.path === key) ?? null });
    group.clubs.push(club);
  }

  // Resolved from a club rather than from its federation, because the
  // federation that defines the words is not always one this account can see.
  for (const group of groups) {
    group.vocabulary = await orgs.vocabulary(group.clubs[0].id);
  }
  groups.sort((a, b) =>
    (a.federation?.name ?? a.key).localeCompare(b.federation?.name ?? b.key));

  return ctx.send(200,
    V.dashboard({ me: ctx.me, orgs: rows, parents, groups, csrf: ctx.csrf }));
});

// ---- roster ---------------------------------------------------------------

get('/o/:slug/roster', async (ctx) => {
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');
  const roster = await people.roster(ctx.me.accountId, org.id,
    { subtree: org.type !== 'club' });
  return ctx.send(200, V.roster({
    me: ctx.me, org, roster, csrf: ctx.csrf,
    canRegister: await mayRegisterAt(ctx, org.id),
    done: ctx.url.searchParams.get('done'),
  }));
});

// ---- one person -----------------------------------------------------------

get('/p/:id', async (ctx) => {
  ctx.requireActor();
  const record = await people.record(ctx.me.accountId, ctx.params.id);

  // Was orgs.bySlug('moknz'): one federation's slug, hard-coded, on a
  // deployment that now serves three. Somebody in the taekwondo demo was
  // being measured against a karate syllabus. Whose ladder applies is a
  // question about where this person trains.
  const owner = await orgs.ladderOwnerOf(record.at?.id);
  const eligibility = owner
    ? await rank.eligibility(ctx.params.id, owner.id)
    : null;

  const canEdit = record.at ? await mayRegisterAt(ctx, record.at.id) : false;
  // Only for somebody who may manage the organisation — the history of a
  // record says who changed what about a person, and that is not for everyone
  // who can see the record itself.
  const mayManage = record.at
    ? await mayPublishAt(ctx, record.at.id).catch(() => false) : false;

  return ctx.send(200, V.person({
    me: ctx.me, ...record, eligibility, csrf: ctx.csrf, canEdit,
    titles: await people.titlesOf(ctx.me.accountId, ctx.params.id),
    // Named `changes`, not `history`: this view already has a `history`, and
    // it is the grading history. Overwriting it with the audit log would have
    // replaced somebody's grades with a list of edits.
    changes: mayManage && record.at
      ? await audit.forEntity(ctx.me.accountId, record.at.id, 'person',
                              ctx.params.id, { limit: 20 })
      : [],
    access: canEdit ? await people.accessFor(ctx.me.accountId, record.person.id)
                    : null,
    guardians: canEdit ? await family.guardiansOf(ctx.me.accountId, record.person.id)
                       : null,
  }));
});

post('/p/:id/guardians', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  const back = `/p/${ctx.params.id}`;
  const number = String(form.guardian_number ?? '').trim().toUpperCase();
  try {
    // Authority first. Looking a member number up before checking the right to
    // act would let anybody learn which numbers exist by being refused
    // differently.
    await family.guardiansOf(ctx.me.accountId, ctx.params.id);
    const guardian = number
      ? (await pool.query('select id from person where upper(display_number)=$1', [number])).rows[0]
      : null;
    if (!guardian) throw new Invalid(`There is nobody with the member number "${number}". `
      + 'Add them to the register first.');
    await family.link(ctx.me.accountId, { guardianId: guardian.id,
      childId: ctx.params.id, relationship: form.relationship });
  } catch (e) {
    if (e instanceof Invalid) {
      const record = await people.record(ctx.me.accountId, ctx.params.id);
      return ctx.send(422, V.person({
        me: ctx.me, ...record, eligibility: null, csrf: ctx.csrf, canEdit: true,
        titles: [], changes: [], error: e.message,
        access: await people.accessFor(ctx.me.accountId, ctx.params.id),
        guardians: await family.guardiansOf(ctx.me.accountId, ctx.params.id),
      }));
    }
    throw e;
  }
  return ctx.redirect(back);
});

post('/p/:id/guardians/:linkId/end', async (ctx) => {
  ctx.requireActor();
  await ctx.form();
  await family.unlink(ctx.me.accountId, ctx.params.linkId);
  return ctx.redirect(`/p/${ctx.params.id}`);
});

// ---- a member's own screens ------------------------------------------------
//
// Everything here goes through family.mayActFor first: a member sees
// themselves and the minors they are a guardian of, and nobody else.

get('/me', async (ctx) => {
  ctx.requireActor();
  const { self, dependants } = await family.mine(ctx.me.accountId);
  return ctx.send(200, V.myHome({ me: ctx.me, csrf: ctx.csrf, self, dependants }));
});

// ---- entering events as a member or a parent ------------------------------
//
// Registered before /me/:personId so that "events" is not read as somebody's id.
// The authority is family.mayActFor (self, or a guardian of a minor), and the
// event must be one memberEvents says is open to that person — the same query
// is used to offer it and to accept it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

get('/me/events', async (ctx) => {
  ctx.requireActor();
  const { self, dependants } = await family.mine(ctx.me.accountId);
  const groups = [];
  for (const person of [self, ...dependants].filter(Boolean)) {
    groups.push({ person, open: await memberEvents.openFor(person.id),
                  entries: await memberEvents.entriesOf(person.id),
                  how: person.id === self?.id ? 'self' : 'guardian' });
  }
  return ctx.send(200, V.myEvents({ me: ctx.me, csrf: ctx.csrf, groups,
    done: ctx.url.searchParams.get('done') }));
});

/** Everything the form and the confirm step both need, worked out once. */
async function memberEntryPlan(ctx, form = {}) {
  const { eventId, personId } = ctx.params;
  if (!UUID_RE.test(eventId) || !UUID_RE.test(personId)) throw new NotFound('Event');
  const how = await family.assertMayActFor(ctx.me.accountId, personId);
  const open = await memberEvents.get(personId, eventId);
  if (!open) throw new NotFound('Event');

  const { repo } = await calendar();
  const event = await repo.byId(eventId);
  if (!event) throw new NotFound('Event');
  const setup = await engineSetupFor(eventId);
  const mine = await myself.get(ctx.me.accountId, personId);
  const eventDate = dayOf(event, open.host_timezone);
  const { dependants } = await family.mine(ctx.me.accountId);
  const relationship = dependants.find((d) => d.id === personId)?.relationship ?? null;

  const chosen = setup.disciplines.filter((d) => form[`disc_${d.id}`]).map((d) => d.id);
  const weightKg = String(form.weight ?? '').trim() || null;
  const heightCm = String(form.height ?? '').trim() || null;

  const competitor = new Competitor({
    personId, name: `${mine.person.first_name} ${mine.person.last_name}`,
    dateOfBirth: mine.person.date_of_birth, gender: mine.person.gender,
    rankOrder: mine.grade?.rank_order ?? null, weightKg, heightCm,
    clubName: open.home_name, isMember: true });
  const need = consentNeeded(competitor, { eventDate, guardianUnder: event.guardianUnder ?? null });

  const problems = [];
  let placements = [], amountCents = null, ready = true, reasons = [];
  if (setup.disciplines.length) {
    if (!chosen.length) problems.push('Choose at least one thing to enter.');
    else {
      const placed = placeEntry({ disciplines: setup.disciplines,
        divisionsByDiscipline: setup.engineDivisions }, competitor,
        { eventDate, wanted: chosen });
      placements = placed.placements; ready = placed.ready;
      reasons = placed.placements.filter((p) => p.outcome !== 'placed')
        .map((p) => `${p.discipline.name}: ${p.reasons.join('; ')}`);
      amountCents = priceFor(chosen.length, setup.enginePrices, { isMember: true }).amountCents;
    }
  }

  if (event.consentVersion) {
    problems.push(...problemsWithConsent({ accepted: !!form.accepted,
      acceptedName: form.acceptedName, version: event.consentVersion,
      guardianName: how === 'guardian' ? form.acceptedName : '',
      guardianContact: ctx.me.email }, need).map((t) => `${t[0].toUpperCase()}${t.slice(1)}.`));
    if (need.guardian && how === 'self')
      problems.push('Because of their age, a parent or guardian has to make this entry. '
        + 'Ask them to sign in and enter you.');
  }
  if (!ready) problems.push(...reasons);

  return { how, open, event, setup, mine, eventDate, relationship, competitor, need,
           chosen, weightKg, heightCm, placements, amountCents, problems,
           currency: setup.prices[0]?.currency ?? 'NZD' };
}

const memberEntryView = (ctx, plan, extra = {}) => V.memberEntryForm({
  me: ctx.me, csrf: ctx.csrf, ...plan, ...extra });

get('/me/events/:eventId/:personId', async (ctx) => {
  ctx.requireActor();
  const plan = await memberEntryPlan(ctx, {});
  return ctx.send(200, memberEntryView(ctx, plan, { problems: [] }));
});

post('/me/events/:eventId/:personId', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  const plan = await memberEntryPlan(ctx, form);

  if (plan.open.already_entered)
    return ctx.redirect(`/me/events?done=${encodeURIComponent('Already entered.')}`);
  if (plan.problems.length)
    return ctx.send(422, memberEntryView(ctx, plan, { values: form }));

  if (form.confirm !== 'yes')
    return ctx.send(200, V.memberEntryPreview({ me: ctx.me, csrf: ctx.csrf, ...plan,
      text: Object.fromEntries(Object.entries(form).filter(([k]) => k !== '_csrf' && k !== 'confirm')) }));

  try {
    await competition.enterCompetitor(ctx.me.accountId, plan.event.id, {
      personId: ctx.params.personId, byFamily: true,
      allowNoPlacements: !plan.setup.disciplines.length,
      weightKg: plan.weightKg, heightCm: plan.heightCm, clubName: plan.open.home_name,
      amountCents: plan.amountCents, currency: plan.currency,
      placements: plan.placements.map((p) => ({
        disciplineId: p.discipline.id, divisionId: p.division?.id ?? null,
        placedBy: 'calculated', options: p.division?.options ?? {} })),
      consent: plan.event.consentVersion ? {
        version: plan.event.consentVersion, acceptedName: form.acceptedName, ip: ctx.ip,
        guardian: plan.need.guardian
          ? { name: form.acceptedName, relationship: plan.relationship ?? 'guardian',
              contact: ctx.me.email }
          : null } : null,
    });
  } catch (e) {
    if (e instanceof Invalid)
      return ctx.send(422, memberEntryView(ctx, { ...plan, problems: [e.message] }, { values: form }));
    throw e;
  }
  return ctx.redirect(`/me/events?done=${encodeURIComponent(
    `${plan.mine.person.first_name} is entered in ${plan.event.title}.`)}`);
});

get('/me/:personId', async (ctx) => {
  ctx.requireActor();
  const record = await myself.get(ctx.me.accountId, ctx.params.personId);
  return ctx.send(200, V.myPerson({ me: ctx.me, csrf: ctx.csrf, ...record,
    done: ctx.url.searchParams.get('done') }));
});

post('/me/:personId', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  try {
    await myself.update(ctx.me.accountId, ctx.params.personId, readSelfEdit(form));
    return ctx.redirect(`/me/${ctx.params.personId}?done=${encodeURIComponent('Saved.')}`);
  } catch (e) {
    if (e instanceof Invalid) {
      const record = await myself.get(ctx.me.accountId, ctx.params.personId);
      return ctx.send(422, V.myPerson({ me: ctx.me, csrf: ctx.csrf, ...record,
        values: form, error: e.message }));
    }
    throw e;
  }
});

// ---- adding and correcting a member ---------------------------------------

/**
 * Who may write to the register.
 *
 * Teaching and registering are different jobs. An instructor sees the roll
 * because they need to know who is in the hall; adding somebody to it, or
 * changing what it says, is the registrar's.
 */
const MAY_REGISTER = ['owner', 'administrator', 'registrar'];

async function mayRegisterAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MAY_REGISTER);
}

/** Fields shared by the add and edit forms, read out of a submitted form. */
const memberFieldsFrom = (form) => ({
  firstName: form.firstName?.trim() ?? '',
  lastName: form.lastName?.trim() ?? '',
  preferredName: form.preferredName?.trim() || null,
  dateOfBirth: form.dateOfBirth?.trim() || null,
  gender: form.gender?.trim() || null,
  email: form.email?.trim() || null,
  phone: form.phone?.trim() || null,
  emergencyName: form.emergencyName?.trim() || null,
  emergencyPhone: form.emergencyPhone?.trim() || null,
  paidUntil: form.paidUntil?.trim() || null,
});

get('/o/:slug/members/new', async (ctx) => {
  const org = await organisationFor(ctx, { toRegister: true });
  return ctx.send(200, V.memberForm({
    me: ctx.me, org, csrf: ctx.csrf, isNew: true,
    vocabulary: await orgs.vocabulary(org.id),
    values: { role: 'member' },
  }));
});

post('/o/:slug/members/new', async (ctx) => {
  const org = await organisationFor(ctx, { toRegister: true });
  const form = await ctx.form();

  try {
    const person = await people.enrol(ctx.me.accountId, {
      organisationId: org.id,
      ...memberFieldsFrom(form),
      role: form.role || 'member',
      starts: form.starts?.trim() || null,
    });
    return ctx.redirect(`/p/${person.id}`);
  } catch (e) {
    return ctx.send(e.status ?? 422, V.memberForm({
      me: ctx.me, org, csrf: ctx.csrf, isNew: true, error: e.message,
      vocabulary: await orgs.vocabulary(org.id), values: form,
    }));
  }
});

// ---- the website ----------------------------------------------------------

/**
 * Who may put a page in front of the public.
 *
 * Writing and publishing are separate on purpose. A contributor is somebody
 * trusted to write and correct; deciding what the organisation says publicly
 * is the organisation's.
 */
const MAY_PUBLISH = ['owner', 'administrator'];

const mayPublishAt = async (ctx, orgId) => {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MAY_PUBLISH);
};

/** A title becomes a web address when nobody typed one. */
const slugify = (text) => String(text ?? '').toLowerCase().trim()
  .replace(/['']/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120);

get('/o/:slug/pages', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  return ctx.send(200, V.pageList({
    me: ctx.me, org, csrf: ctx.csrf,
    pages: await pages.list(ctx.me.accountId, org.id),
    canPublish: await mayPublishAt(ctx, org.id),
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
    rebuild: ctx.url.searchParams.get('rebuild'),
  }));
});

get('/o/:slug/pages/new', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  return ctx.send(200, V.pageEditor({
    me: ctx.me, org, csrf: ctx.csrf,
    images: await assets.list(ctx.me.accountId, org.id),
    values: { body: '' },
    canPublish: await mayPublishAt(ctx, org.id),
  }));
});

/**
 * One handler for every button on the editor.
 *
 * Moving a block, removing one, adding one, saving, publishing — all of them
 * post the whole form, because the page has no JavaScript to do it any other
 * way. The structural operations re-render without touching the database;
 * only save, publish and unpublish write.
 */
async function editorPost(ctx, { org, page = null }) {
  const form = await ctx.form();
  const op = String(form.op ?? 'save');
  const canPublish = await mayPublishAt(ctx, org.id);

  // One box of text, parsed into blocks. What comes back out still goes
  // through the whitelist in pages.save, so the editor is not a way past it.
  const images = await assets.list(ctx.me.accountId, org.id);
  const body = String(form.body ?? '');
  // Pictures are referred to by filename in the box and by id in the
  // document, so the list is needed on the way in as well as out.
  const doc = documentFromText(body, { images });

  const title = String(form.title ?? '').trim();
  const slug = slugify(form.slug || title);

  const render = (extra = {}) => ctx.send(extra.status ?? 200, V.pageEditor({
    me: ctx.me, org, page, csrf: ctx.csrf, canPublish, images,
    values: { body, title, slug,
              metaDescription: form.metaDescription ?? '' },
    ...extra,
  }));

  if (!title) return render({ status: 422, error: 'The page needs a title.' });
  if (!slug) return render({ status: 422,
    error: 'The page needs a web address. Give it a title with some letters '
      + 'in it, or type one.' });

  // Said before the save rather than after, so a half-written page comes back
  // with everything still in it instead of being refused by the database.
  if (looksEmpty(doc)) {
    return render({ status: 422,
      error: 'There is nothing on this page yet. Add something and type into '
        + 'it before saving.' });
  }

  try {
    const { page: saved, dropped } = await pages.save(ctx.me.accountId, {
      pageId: page?.id ?? null,
      organisationId: page ? null : org.id,
      slug, title, body: doc,
      metaTitle: null,
      metaDescription: form.metaDescription?.trim() || null,
      note: page ? null : 'Created',
    });

    if (op === 'publish' || op === 'unpublish') {
      if (!canPublish) {
        return render({ status: 403, page: saved,
          error: 'Your changes are saved. Putting a page in front of the '
            + 'public needs an owner or administrator.' });
      }
      if (op === 'publish') await pages.publish(ctx.me.accountId, saved.id);
      else await pages.unpublish(ctx.me.accountId, saved.id);

      // Saved first, rebuild asked for second, and the answer is passed on
      // whatever it is. Reporting "published" while the site is unchanged is
      // worse than not publishing at all.
      const rebuild = await requestRebuild({
        reason: `${op} ${org.slug}/${slug}` });

      return ctx.redirect(`/o/${org.slug}/pages?done=`
        + encodeURIComponent(op === 'publish'
          ? `"${saved.title}" is published.` : `"${saved.title}" is off the site.`)
        + '&rebuild=' + encodeURIComponent(rebuild.detail));
    }

    if (dropped.length) {
      return render({ page: saved, dropped,
        done: 'Saved as a draft.' });
    }
    return ctx.redirect(`/o/${org.slug}/pages/${saved.id}?done=`
      + encodeURIComponent('Saved as a draft.'));
  } catch (e) {
    return render({ status: e.status ?? 422, error: e.message });
  }
}

post('/o/:slug/pages/new', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  return editorPost(ctx, { org });
});

get('/o/:slug/pages/:pageId', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const pg = await pages.byId(ctx.me.accountId, ctx.params.pageId);
  const doc = pg.body ?? { blocks: [] };

  const images = await assets.list(ctx.me.accountId, org.id);
  return ctx.send(200, V.pageEditor({
    me: ctx.me, org, page: pg, csrf: ctx.csrf, images,
    values: { body: textFromDocument(doc, { images }),
              title: pg.title, slug: pg.slug,
              metaDescription: pg.meta_description ?? '' },
    revisions: await pages.revisions(ctx.me.accountId, pg.id),
    canPublish: await mayPublishAt(ctx, org.id),
    done: ctx.url.searchParams.get('done'),
  }));
});

post('/o/:slug/pages/:pageId', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const pg = await pages.byId(ctx.me.accountId, ctx.params.pageId);
  return editorPost(ctx, { org, page: pg });
});

post('/o/:slug/pages/:pageId/restore', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const form = await ctx.form();
  const back = `/o/${org.slug}/pages/${ctx.params.pageId}`;
  try {
    await pages.restore(ctx.me.accountId, form.revisionId);
    return ctx.redirect(`${back}?done=`
      + encodeURIComponent('Put back to that version. It is a draft until you '
        + 'publish it again.'));
  } catch (e) {
    return ctx.redirect(`${back}?done=${encodeURIComponent(e.message)}`);
  }
});

/**
 * The page as a visitor will see it.
 *
 * Rendered by the SAME function the published site uses, with the same blocks,
 * the same layout, the same live data pulled in. A preview that renders a
 * second way is a preview of something nobody will ever see, and it drifts —
 * the only question is when somebody notices.
 *
 * This is also what makes a static site bearable to edit: the published page
 * takes a minute to rebuild, and nobody waits on it, because this is exact.
 */
get('/o/:slug/pages/:pageId/preview', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const pg = await pages.byId(ctx.me.accountId, ctx.params.pageId);

  const { repositories } = await import('../infrastructure/factory.mjs');
  const { site } = await repositories();

  // The federation whose site this page belongs to, and its own words for
  // things — a taekwondo club's preview must not say "dojo".
  const root = await one_(`
    select o.* from organisation o join organisation me on me.path <@ o.path
    where me.id = $1 and o.parent_id is null`, [org.id]);
  const federation = root ?? org;

  const [brand, dojos, evs] = await Promise.all([
    site.brand(federation.id),
    site.dojos(federation.slug),
    site.eventsFor(federation.slug),
  ]);

  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;

  // The preview points at /a/:id, which serves from the database behind a
  // sign-in. The build writes the same images out as files and points at
  // those. Different addresses, same bytes — and the preview has to resolve
  // them at all, or somebody checks a page, sees no image, and assumes the
  // block is broken rather than the preview.
  const previewAssets = Object.fromEntries(
    (await assets.list(ctx.me.accountId, org.id)).map((a) => [a.id, `/a/${a.id}`]));

  const html = renderBlocks(pg.body, { dojos, events: evs, assets: previewAssets },
    { origin });

  const body = R.authoredPage({
    page: pg, html, federation,
    origin, base: '',
    fonts: brand?.fonts ?? { display: 'Bitter', body: 'Source Sans 3' },
    nav: [],
    vocabulary: await orgs.vocabulary(org.id),
    description: excerpt(pg.body),
  });

  // The preview is the real page, so it must never be mistaken for the real
  // page by anything that indexes or caches.
  ctx.res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-robots-tag': 'noindex, nofollow',
    'cache-control': 'no-store',
    'x-frame-options': 'SAMEORIGIN',
  });
  return ctx.res.end(previewBanner(org, pg) + body);
});

/**
 * A strip across the top saying this is a preview.
 *
 * Added after the page rather than inside the renderer, because the renderer
 * must produce exactly what gets published and nothing else. Somebody looking
 * at a draft that is indistinguishable from the live site will eventually
 * tell their club a page is up when it is not.
 */
const previewBanner = (org, pg) => `
<div style="position:sticky;top:0;z-index:99;background:#161617;color:#F5F5F5;
  font:14px/1.5 system-ui,sans-serif;padding:10px 18px;display:flex;
  gap:16px;align-items:center;flex-wrap:wrap">
  <strong>Preview</strong>
  <span style="color:#BDBDBF">${pg.status === 'published'
    ? 'This page is live. You are seeing your unsaved draft of it.'
    : 'This page is a draft. Nobody else can see it.'}</span>
  <a href="/o/${org.slug}/pages/${pg.id}"
    style="margin-left:auto;color:#F0CE41">Back to editing</a>
</div>`;

// ---- search ----------------------------------------------------------------

/**
 * Finding things.
 *
 * Not scoped to an organisation in the path, because the question "where is
 * Aroha" is asked by somebody who does not know which club she is at. The
 * scoping is in the query — every branch starts from visible_orgs — so this
 * returns exactly what this account may already see and nothing else.
 */
get('/search', async (ctx) => {
  ctx.requireActor();
  const raw = ctx.url.searchParams.get('q') ?? '';
  const { query, results } = await search.everything(ctx.me.accountId, raw);
  return ctx.send(200, V.searchResults({
    me: ctx.me, csrf: ctx.csrf, query, results,
    vocabulary: await orgs.vocabulary(ctx.me.home?.id ?? null),
  }));
});

// ---- the audit log ---------------------------------------------------------

/**
 * What has happened here.
 *
 * MANAGE only, and scoped to the subtree by the query: this screen says who
 * did what to whom, which is the most sensitive reading in the system. A club
 * administrator sees their own club's history and not the federation's.
 */
get('/o/:slug/history', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const q = ctx.url.searchParams;

  const since = {
    week: () => new Date(Date.now() - 7 * 864e5).toISOString(),
    month: () => new Date(Date.now() - 30 * 864e5).toISOString(),
    year: () => new Date(Date.now() - 365 * 864e5).toISOString(),
  }[q.get('since')]?.() ?? null;

  const entries = await audit.forOrganisation(ctx.me.accountId, org.id, {
    action: q.get('action') || null,
    accountId: q.get('who') || null,
    since,
    before: q.get('before') || null,
    limit: 100,
  });

  return ctx.send(200, V.history({
    me: ctx.me, org, csrf: ctx.csrf, entries,
    actors: await audit.actorsAt(ctx.me.accountId, org.id),
    actions: AUDIT_ACTIONS,
    filters: { action: q.get('action') ?? '', who: q.get('who') ?? '',
               since: q.get('since') ?? '' },
  }));
});

// ---- the site menu ---------------------------------------------------------

get('/o/:slug/menu', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const vocabulary = await orgs.vocabulary(org.id);
  const { stored, authored } = await navigation.forEditing(ctx.me.accountId, org.id);
  return ctx.send(200, V.menuEditor({
    me: ctx.me, org, csrf: ctx.csrf, vocabulary,
    items: menuFor({ stored, authored, vocabulary }),
    destinations: destinations({ authored, vocabulary }),
    max: MAX_ITEMS,
    stored: !!stored,
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
    rebuild: ctx.url.searchParams.get('rebuild'),
  }));
});

post('/o/:slug/menu', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const form = await ctx.form();
  const vocabulary = await orgs.vocabulary(org.id);
  const back = `/o/${org.slug}/menu`;

  // The form posts a fixed number of rows; blank ones are not items.
  const items = [];
  for (let i = 0; i < MAX_ITEMS; i++) {
    const href = String(form[`href${i}`] ?? '').trim();
    if (!href) continue;
    items.push({ href, label: String(form[`label${i}`] ?? '').trim() });
  }

  try {
    await navigation.save(ctx.me.accountId, org.id, items, { vocabulary });
    const rebuild = await requestRebuild({ reason: `menu ${org.slug}` });
    return ctx.redirect(`${back}?done=${encodeURIComponent('Menu saved.')}`
      + '&rebuild=' + encodeURIComponent(rebuild.detail));
  } catch (e) {
    if (e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

// ---- a club's own details --------------------------------------------------
//
// What the club is as an organisation. Address, phone and training times are
// its PAGE (/club-page) and live there once.

async function profileScreen(ctx, org, extra = {}) {
  return ctx.send(extra.status ?? 200, V.clubProfileScreen({
    me: ctx.me, org, csrf: ctx.csrf,
    ...(await clubProfile.get(ctx.me.accountId, org.id)),
    done: ctx.url.searchParams.get('done'),
    rebuild: ctx.url.searchParams.get('rebuild'),
    ...extra,
  }));
}

get('/o/:slug/profile', async (ctx) => {
  const org = await organisationFor(ctx);
  if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/clubs`);
  return profileScreen(ctx, org);
});

post('/o/:slug/profile', async (ctx) => {
  const org = await organisationFor(ctx);
  if (org.type !== 'club') throw new Forbidden('Only a club has these details.');
  const form = await ctx.form();
  const input = readClubProfile(form);
  try {
    const { siteChanged } = await clubProfile.save(ctx.me.accountId, org.id, input);
    const rebuild = siteChanged
      ? await requestRebuild({ reason: `club ${org.slug}` })
      : { detail: 'Nothing on the website changed.' };
    return ctx.redirect(`/o/${org.slug}/profile?done=${
      encodeURIComponent('Saved.')}&rebuild=${encodeURIComponent(rebuild.detail)}`);
  } catch (e) {
    if (e instanceof Invalid)
      return profileScreen(ctx, org, { status: 422, error: e.message, values: form });
    throw e;
  }
});

// ---- adding a club ---------------------------------------------------------

async function clubsScreen(ctx, org, extra = {}) {
  return ctx.send(extra.status ?? 200, V.clubsScreen({
    me: ctx.me, org, csrf: ctx.csrf,
    clubs: await clubs.beneath(ctx.me.accountId, org.id),
    done: ctx.url.searchParams.get('done'),
    ...extra,
  }));
}

get('/o/:slug/clubs', async (ctx) => {
  const org = await organisationFor(ctx);
  if (org.type === 'club') return ctx.redirect(`/o/${org.slug}/club-page`);
  return clubsScreen(ctx, org);
});

post('/o/:slug/clubs/new', async (ctx) => {
  const org = await organisationFor(ctx);
  if (org.type === 'club') throw new Forbidden('A club cannot have clubs beneath it.');
  const form = await ctx.form();
  const values = readNewClub(form);
  try {
    const { club, admin } = await clubs.create(ctx.me.accountId, org.id, values);
    // Issued the ordinary way, and shown once: the same fifteen minutes and
    // single use as any sign-in link, for an administrator who may not have
    // working email yet.
    let link = null, linkExpires = null;
    if (admin) {
      const issued = await auth.requestLink(values.adminEmail, { ip: ctx.ip });
      const origin = `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;
      link = issued.token ? `${origin}/signin/${issued.token}` : null;
      linkExpires = issued.expiresInMinutes;
    }
    return clubsScreen(ctx, org, { added: club, adminName:
      admin ? `${values.adminFirst} ${values.adminLast}` : null, link, linkExpires });
  } catch (e) {
    if (e instanceof Invalid)
      return clubsScreen(ctx, org, { status: 422, error: e.message, values: form,
        added: e.club ?? null });
    throw e;
  }
});

// ---- appearance ------------------------------------------------------------
//
// The federation's look: a built-in theme, an imported one, or the default.
// A club has no look of its own, so these are federation screens only.

const builtInList = () => Object.entries(BUILT_IN)
  .map(([key, t]) => ({ key, ...t }));

async function appearanceScreen(ctx, org, extra = {}) {
  const stored = await appearance.current(ctx.me.accountId, org.id);
  const q = ctx.url.searchParams;
  return ctx.send(extra.status ?? 200, V.appearanceEditor({
    me: ctx.me, org, csrf: ctx.csrf, builtIn: builtInList(),
    current: stored ? (readTheme(stored).theme ?? null) : null,
    done: q.get('done'), error: q.get('error'), rebuild: q.get('rebuild'),
    ...extra,
  }));
}

get('/o/:slug/appearance', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  if (org.type === 'club') return ctx.redirect(`/o/${org.slug}/club-page`);
  return appearanceScreen(ctx, org);
});

post('/o/:slug/appearance', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  if (org.type === 'club') throw new Forbidden('A club uses its federation\'s look.');
  const form = await ctx.form();
  const pasted = String(form.theme_json ?? '');
  const doc = form.builtin ? BUILT_IN[form.builtin] : pasted;
  if (!doc) return appearanceScreen(ctx, org, { status: 422, pasted,
    error: 'Choose a theme or paste a theme file.' });
  const read = readTheme(doc);
  if (!read.ok) return appearanceScreen(ctx, org, { status: 422, pasted,
    problems: read.problems });
  try {
    await appearance.apply(ctx.me.accountId, org.id, read.theme);
  } catch (e) {
    if (e instanceof Invalid)
      return appearanceScreen(ctx, org, { status: 422, pasted, error: e.message });
    throw e;
  }
  const rebuild = await requestRebuild({ reason: `appearance ${org.slug}` });
  return ctx.redirect(`/o/${org.slug}/appearance?done=${
    encodeURIComponent(`Now using "${read.theme.name}".`)}`
    + '&rebuild=' + encodeURIComponent(rebuild.detail));
});

post('/o/:slug/appearance/reset', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  if (org.type === 'club') throw new Forbidden('A club uses its federation\'s look.');
  await ctx.form();
  await appearance.reset(ctx.me.accountId, org.id);
  const rebuild = await requestRebuild({ reason: `appearance reset ${org.slug}` });
  return ctx.redirect(`/o/${org.slug}/appearance?done=${
    encodeURIComponent('Back to the default look.')}`
    + '&rebuild=' + encodeURIComponent(rebuild.detail));
});

get('/o/:slug/appearance/export', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  if (org.type === 'club') return ctx.redirect(`/o/${org.slug}/club-page`);
  const stored = await appearance.current(ctx.me.accountId, org.id);
  const read = stored ? readTheme(stored) : null;
  if (!read?.ok) return ctx.redirect(`/o/${org.slug}/appearance?error=${
    encodeURIComponent('There is no theme chosen here to download yet.')}`);
  return ctx.download(`${org.slug}-theme.json`, 'application/json', serialise(read.theme));
});

// ---- a club's page on the federation's website -----------------------------
//
// The club writes what the page says. The federation decides whether it goes
// up under the federation's name, in the federation's design. Two screens, two
// sets of permissions: /club-page is the club's, /club-pages is the
// federation's overview of every club beneath it.

async function clubPageScreen(ctx, org, extra = {}) {
  const { club, profile, sessions, state, problems } =
    await clubPages.forClub(ctx.me.accountId, org.id);
  return ctx.send(extra.status ?? 200, V.clubPageEditor({
    me: ctx.me, org: club, csrf: ctx.csrf, profile, sessions, state, problems,
    images: await assets.list(ctx.me.accountId, org.id),
    canAsk: await mayPublishAt(ctx, org.id),
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
    rebuild: ctx.url.searchParams.get('rebuild'),
    ...extra,
  }));
}

get('/o/:slug/club-page', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  // A federation has no page of this kind; what it has is the list of its clubs.
  if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/club-pages`);
  return clubPageScreen(ctx, org);
});

post('/o/:slug/club-page', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const { fields: form, files } = await ctx.upload({
    maxBytes: MAX_BYTES + 256 * 1024 });
  const read = readClubPage(form);

  // A picture chosen here is uploaded here, as the article editor does it:
  // nobody should have to leave a half-filled form to go and find one.
  const hero = files.find((f) => f.field === 'heroFile' && f.bytes.length);
  if (hero) {
    try {
      const created = await assets.create(ctx.me.accountId, org.id, {
        bytes: hero.bytes, identified: identify(hero.bytes, { filename: hero.filename }),
        filename: hero.filename, altText: form.heroAlt,
      });
      read.profile.hero_asset_id = created.id;
    } catch (e) {
      if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid)
        return clubPageScreen(ctx, org, { status: 422, error: e.message,
          values: read });
      throw e;
    }
  }

  const problems = problemsWithClubPage(read);
  if (problems.length)
    return clubPageScreen(ctx, org, { status: 422, values: read,
      error: problems.join(' ') });

  try {
    const after = await clubPages.save(ctx.me.accountId, org.id, read);
    // A live page that was edited has to be rebuilt to show it.
    const rebuild = after.state === 'live'
      ? await requestRebuild({ reason: `club page ${org.slug}` }) : null;
    return ctx.redirect(`/o/${org.slug}/club-page?done=${
      encodeURIComponent('Saved.')}${rebuild
      ? '&rebuild=' + encodeURIComponent(rebuild.detail) : ''}`);
  } catch (e) {
    if (e instanceof ClubPageNotReady || e instanceof Invalid)
      return clubPageScreen(ctx, org, { status: 422, values: read, error: e.message });
    throw e;
  }
});

post('/o/:slug/club-page/request', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  await ctx.form();
  const back = `/o/${org.slug}/club-page`;
  try {
    await clubPages.request(ctx.me.accountId, org.id);
    return ctx.redirect(`${back}?done=${encodeURIComponent(
      'Asked. The federation will look at your page and answer here.')}`);
  } catch (e) {
    if (e instanceof ClubPageNotReady || e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

post('/o/:slug/club-page/takedown', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  await ctx.form();
  const before = await clubPages.forClub(ctx.me.accountId, org.id);
  await clubPages.takeDown(ctx.me.accountId, org.id);
  const rebuild = before.state === 'live'
    ? await requestRebuild({ reason: `club page down ${org.slug}` }) : null;
  return ctx.redirect(`/o/${org.slug}/club-page?done=${encodeURIComponent(
    before.state === 'live' ? 'Your page is off the website.'
      : 'Request withdrawn.')}${rebuild
    ? '&rebuild=' + encodeURIComponent(rebuild.detail) : ''}`);
});

/**
 * The page as the federation's site will show it, in the federation's design.
 * The same renderer the build uses, for the reason the page preview does.
 */
get('/o/:slug/club-page/preview', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const { club, profile, sessions } = await clubPages.forClub(ctx.me.accountId, org.id);

  const { repositories } = await import('../infrastructure/factory.mjs');
  const { site } = await repositories();
  const federation = await one_(`
    select o.* from organisation o join organisation me on me.path <@ o.path
    where me.id = $1 and o.parent_id is null`, [club.id]) ?? club;
  const brand = await site.brand(federation.id);
  const vocabulary = await orgs.vocabulary(club.id);

  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;

  const dojo = {
    ...club, ...profile, sessions: sessions.map((t) => ({ ...t,
      starts: t.starts, ends: t.ends })),
    venue_name: profile.venue_name ?? null,
    hero_url: profile.hero_asset_id ? `/a/${profile.hero_asset_id}` : null,
  };
  const html = R.dojoPage({
    dojo, federation, events: await site.eventsFor(club.slug), origin,
    fonts: brand?.fonts ?? { display: 'Bitter', body: 'Source Sans 3' },
    nav: [], base: '', vocabulary,
  });

  ctx.res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-robots-tag': 'noindex, nofollow',
    'cache-control': 'no-store',
    'x-frame-options': 'SAMEORIGIN',
  });
  return ctx.res.end(`<div style="position:sticky;top:0;z-index:99;background:#161617;
    color:#F5F5F5;font:14px/1.5 system-ui,sans-serif;padding:10px 18px;display:flex;
    gap:16px;align-items:center;flex-wrap:wrap"><strong>Preview</strong>
    <span style="color:#BDBDBF">How ${esc_(federation.name)}'s website will show
    ${esc_(club.name)} — ${profile.published
      ? 'this page is live.' : 'nobody else can see this yet.'}</span>
    <a href="/o/${esc_(club.slug)}/club-page"
      style="margin-left:auto;color:#F0CE41">Back to editing</a></div>` + html);
});

get('/o/:slug/club-pages', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  return ctx.send(200, V.clubPageList({
    me: ctx.me, org, csrf: ctx.csrf,
    clubs: await clubPages.beneath(ctx.me.accountId, org.id),
    vocabulary: await orgs.vocabulary(org.id),
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
    rebuild: ctx.url.searchParams.get('rebuild'),
  }));
});

post('/o/:slug/club-pages/:clubId/decide', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const form = await ctx.form();
  const approve = form.answer === 'approve';
  const back = `/o/${org.slug}/club-pages`;
  try {
    const after = await clubPages.decide(ctx.me.accountId, ctx.params.clubId,
      approve, { decidedBy: org.id, note: form.note });
    const rebuild = approve
      ? await requestRebuild({ reason: `club page approved ${after.club.slug}` })
      : null;
    return ctx.redirect(`${back}?done=${encodeURIComponent(approve
      ? `${after.club.name} is on the website.`
      : `${after.club.name}'s request was declined.`)}${rebuild
      ? '&rebuild=' + encodeURIComponent(rebuild.detail) : ''}`);
  } catch (e) {
    if (e instanceof ClubPageNotReady || e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

// ---- instructors -----------------------------------------------------------

get('/o/:slug/instructors', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  return ctx.send(200, V.instructorList({
    me: ctx.me, org, csrf: ctx.csrf,
    instructors: await instructors.listFor(ctx.me.accountId, org.id),
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
    rebuild: ctx.url.searchParams.get('rebuild'),
  }));
});

post('/o/:slug/instructors/:personId', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const form = await ctx.form();
  const back = `/o/${org.slug}/instructors`;

  try {
    if (form.op === 'remove') {
      await instructors.remove(ctx.me.accountId, org.id, ctx.params.personId);
      const rebuild = await requestRebuild({ reason: `instructor off ${org.slug}` });
      return ctx.redirect(`${back}?done=`
        + encodeURIComponent('Taken off the website. They are still on the roll.')
        + '&rebuild=' + encodeURIComponent(rebuild.detail));
    }

    const published = form.published === 'on';
    const row = await instructors.save(ctx.me.accountId, org.id,
      ctx.params.personId, {
        bio: { blocks: String(form.bio ?? '').split(/\n{2,}/)
          .map((t) => t.trim()).filter(Boolean)
          .map((text) => ({ type: 'paragraph', text })) },
        teaches: form.teaches,
        published,
        sortOrder: Number(form.sortOrder) || 0,
      });

    const rebuild = row.published
      ? await requestRebuild({ reason: `instructor on ${org.slug}` })
      : { detail: 'Not on the site, so nothing to rebuild.' };
    return ctx.redirect(`${back}?done=` + encodeURIComponent(row.published
      ? 'Saved and on the website.' : 'Saved. Not on the website.')
      + '&rebuild=' + encodeURIComponent(rebuild.detail));
  } catch (e) {
    // A DomainError here is the minimum-age rule or the register rule, and its
    // message is written to be read by a person, so it is shown as it is.
    if (e.name === 'DomainError' || e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

// ---- news ------------------------------------------------------------------

get('/o/:slug/news', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const canDecide = await mayPublishAt(ctx, org.id);
  return ctx.send(200, V.newsList({
    me: ctx.me, org, csrf: ctx.csrf,
    articles: await news.list(ctx.me.accountId, org.id),
    // Only shown to somebody who can actually decide, and only containing
    // what sits beneath them.
    waiting: canDecide ? await news.awaitingDecision(ctx.me.accountId, org.id) : [],
    canPublish: canDecide,
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
    rebuild: ctx.url.searchParams.get('rebuild'),
  }));
});

get('/o/:slug/news/new', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  return ctx.send(200, V.articleEditor({
    me: ctx.me, org, csrf: ctx.csrf,
    values: { body: '' },
    images: await assets.list(ctx.me.accountId, org.id),
    canPublish: await mayPublishAt(ctx, org.id),
  }));
});

post('/o/:slug/news/new', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  return articlePost(ctx, { org });
});

get('/o/:slug/news/:articleId', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const a = await news.byId(ctx.me.accountId, ctx.params.articleId);
  const doc = a.body ?? { blocks: [] };
  const images = await assets.list(ctx.me.accountId, org.id);
  return ctx.send(200, V.articleEditor({
    me: ctx.me, org, article: a, csrf: ctx.csrf, images,
    values: { body: textFromDocument(doc, { images }),
              title: a.title, slug: a.slug,
              summary: a.summary ?? '', heroAssetId: a.hero_asset_id ?? '',
              tags: (a.tags ?? []).join(', ') },
    canPublish: await mayPublishAt(ctx, org.id),
    done: ctx.url.searchParams.get('done'),
  }));
});

post('/o/:slug/news/:articleId', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const a = await news.byId(ctx.me.accountId, ctx.params.articleId);
  return articlePost(ctx, { org, article: a });
});

post('/o/:slug/news/:articleId/ask', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  await ctx.form();
  const back = `/o/${org.slug}/news`;
  try {
    const a = await news.requestPublishUp(ctx.me.accountId, ctx.params.articleId);
    return ctx.redirect(`${back}?done=` + encodeURIComponent(
      `Asked for "${a.title}" to appear on the federation's site.`));
  } catch (e) {
    if (e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

/**
 * The federation's answer.
 *
 * Posted at the deciding organisation, not at the article's own, because the
 * right to decide belongs to whoever's site it would appear on.
 */
post('/o/:slug/news/:articleId/decide', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const form = await ctx.form();
  const approve = form.answer === 'approve';
  const back = `/o/${org.slug}/news`;
  try {
    const a = await news.decidePublishUp(ctx.me.accountId, ctx.params.articleId,
      approve, { decidedBy: org.id });
    const rebuild = approve
      ? await requestRebuild({ reason: `approve ${a.slug}` })
      : { detail: 'Nothing to rebuild — it was not on the site.' };
    return ctx.redirect(`${back}?done=` + encodeURIComponent(approve
      ? `"${a.title}" now appears on this site.`
      : `"${a.title}" was declined. It stays on their own site.`)
      + '&rebuild=' + encodeURIComponent(rebuild.detail));
  } catch (e) {
    if (e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

/** Shared by both article posts, the way editorPost is shared by pages. */
async function articlePost(ctx, { org, article = null }) {
  // Multipart, because a picture can be chosen here rather than on another
  // screen. Leaving a half-written article to go and upload one, then coming
  // back to a blank form, is how somebody loses what they wrote.
  const { fields: form, files } = await ctx.upload({
    maxBytes: MAX_BYTES + 256 * 1024 });
  const op = String(form.op ?? 'save');
  const canPublish = await mayPublishAt(ctx, org.id);

  let images = await assets.list(ctx.me.accountId, org.id);
  const body = String(form.body ?? '');

  const title = String(form.title ?? '').trim();
  const slug = slugify(form.slug || title);
  const summary = String(form.summary ?? '').trim();
  let heroAssetId = String(form.heroAssetId ?? '').trim() || null;
  const tags = String(form.tags ?? '').split(',');

  // A picture attached here is uploaded as part of saving and becomes the
  // one at the top. It also joins the organisation's images, so it can be
  // used again — a hero picture is not a different kind of thing.
  const hero = files.find((f) => f.field === 'heroFile' && f.bytes.length);
  if (hero) {
    try {
      const identified = identify(hero.bytes, { filename: hero.filename });
      const created = await assets.create(ctx.me.accountId, org.id, {
        bytes: hero.bytes, identified, filename: hero.filename,
        altText: form.heroAlt,
      });
      heroAssetId = created.id;
      images = await assets.list(ctx.me.accountId, org.id);
    } catch (e) {
      if (e instanceof NotAnImage || e instanceof BadUpload
          || e instanceof Invalid) {
        return ctx.send(422, V.articleEditor({
          me: ctx.me, org, article, csrf: ctx.csrf, canPublish, images,
          values: { body, title, slug, summary, heroAssetId: heroAssetId ?? '',
                    heroAlt: form.heroAlt ?? '', tags: form.tags ?? '' },
          error: e.message,
        }));
      }
      throw e;
    }
  }

  const doc = documentFromText(body, { images });

  const render = async (extra = {}) => ctx.send(extra.status ?? 200,
    V.articleEditor({
      me: ctx.me, org, article, csrf: ctx.csrf, canPublish, images,
      values: { body, title, slug, summary,
                heroAssetId: heroAssetId ?? '', heroAlt: form.heroAlt ?? '',
                tags: form.tags ?? '' },
      ...extra,
    }));

  if (!title) return render({ status: 422, error: 'The article needs a headline.' });
  if (!slug) return render({ status: 422,
    error: 'The article needs a web address. Give it a headline with some '
      + 'letters in it, or type one.' });
  if (looksEmpty(doc)) return render({ status: 422,
    error: 'There is nothing in this article yet. Add something and type into '
      + 'it before saving.' });

  try {
    const { article: saved, dropped } = await news.save(ctx.me.accountId, {
      articleId: article?.id ?? null,
      organisationId: article ? null : org.id,
      slug, title, summary: summary || null, body: doc,
      heroAssetId, tags,
    });

    if (op === 'publish' || op === 'unpublish') {
      if (!canPublish) return render({ status: 403, article: saved,
        error: 'Your changes are saved. Putting news in front of the public '
          + 'needs an owner or administrator.' });
      if (op === 'publish') await news.publish(ctx.me.accountId, saved.id);
      else await news.unpublish(ctx.me.accountId, saved.id);

      const rebuild = await requestRebuild({ reason: `${op} ${org.slug}/${slug}` });
      return ctx.redirect(`/o/${org.slug}/news?done=`
        + encodeURIComponent(op === 'publish'
          ? `"${saved.title}" is published.` : `"${saved.title}" is off the site.`)
        + '&rebuild=' + encodeURIComponent(rebuild.detail));
    }

    if (dropped.length) return render({ article: saved, dropped,
      done: 'Saved as a draft.' });
    return ctx.redirect(`/o/${org.slug}/news/${saved.id}?done=`
      + encodeURIComponent('Saved as a draft.'));
  } catch (e) {
    return render({ status: e.status ?? 422, error: e.message });
  }
}

// ---- media ------------------------------------------------------------------

get('/o/:slug/media', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  return ctx.send(200, V.mediaLibrary({
    me: ctx.me, org, csrf: ctx.csrf,
    assets: await assets.list(ctx.me.accountId, org.id),
    accepted: ACCEPTED, maxBytes: MAX_BYTES,
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
  }));
});

post('/o/:slug/media', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const back = `/o/${org.slug}/media`;

  try {
    // Room for the image plus the form around it. The image's own limit is
    // the one that produces a sensible message; this one only stops a body
    // large enough to be a problem before anything has looked at it.
    const { fields, files } = await ctx.upload({ maxBytes: MAX_BYTES + 256 * 1024 });
    const file = files.find((f) => f.field === 'file');

    if (!file || !file.bytes.length)
      return ctx.redirect(`${back}?error=${encodeURIComponent('Choose a file first.')}`);

    // From the bytes. What the browser called it is not consulted.
    const identified = identify(file.bytes, { filename: file.filename });

    await assets.create(ctx.me.accountId, org.id, {
      bytes: file.bytes, identified, filename: file.filename,
      altText: fields.alt_text, credit: fields.credit,
      consentRef: fields.consent_ref,
    });

    return ctx.redirect(`${back}?done=${encodeURIComponent(`${file.filename} uploaded`)}`);
  } catch (e) {
    // A refused upload goes back to the screen with the reason, rather than an
    // error page — the person is mid-task and the fix is usually obvious.
    if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

post('/o/:slug/media/:assetId/describe', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const form = await ctx.form();
  await assets.describe(ctx.me.accountId, ctx.params.assetId, {
    altText: form.alt_text, credit: form.credit, consentRef: form.consent_ref,
  });
  return ctx.redirect(`/o/${org.slug}/media?done=${encodeURIComponent('Saved')}`);
});

post('/o/:slug/media/:assetId/delete', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  const back = `/o/${org.slug}/media`;
  try {
    const { filename } = await assets.remove(ctx.me.accountId, ctx.params.assetId);
    return ctx.redirect(`${back}?done=${encodeURIComponent(`${filename} deleted`)}`);
  } catch (e) {
    if (e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

/**
 * Serve an image to the admin.
 *
 * The public site does not come through here — it is built at deploy, with
 * these written out as files. This exists so the media library and the page
 * preview can show what they are talking about.
 *
 * The permission check lives in assets.forViewing, which is the only way to
 * reach an asset's bytes at all.
 */
get('/a/:assetId', async (ctx) => {
  ctx.requireActor();
  // Fetching and authorising are one call, so there is no version of this
  // route that reads the bytes without having checked.
  const { asset, bytes } = await assets.forViewing(ctx.me.accountId,
                                                   ctx.params.assetId);

  return ctx.sendBytes(200, bytes, {
    type: asset.mime,
    filename: asset.filename,
    // Private, because this is behind a sign-in. The public site's copies are
    // static files and get cached properly by whatever serves them.
    cacheControl: 'private, max-age=300',
  });
});

// ---- competition ----------------------------------------------------------

/** The event named in the path, on an organisation the actor may be at. */
async function eventFor(ctx, { toSchedule = false } = {}) {
  const org = await organisationFor(ctx, { toSchedule });
  const { repo } = await calendar();
  const event = await repo.bySlug(org.id, ctx.params.eventSlug);
  if (!event) throw new NotFound('Event');
  return { org, event };
}

/** The day the event runs, as a calendar day in the organisation's zone. */
const dayOf = (event, zone) => toLocalInput(event.startsAt, zone).slice(0, 10);

/** The organiser's configuration, turned into what the engine takes. */
async function engineSetupFor(eventId) {
  const setup = await competition.setupFor(eventId);
  const byDiscipline = {};
  for (const [id, rows] of Object.entries(setup.byDiscipline)) {
    byDiscipline[id] = rows.map((d) => new Division({
      id: d.id, disciplineId: d.discipline_id, label: d.label, summary: d.summary,
      minRankOrder: d.min_rank_order, maxRankOrder: d.max_rank_order,
      minAge: d.min_age, maxAge: d.max_age,
      minWeightKg: d.min_weight_kg, maxWeightKg: d.max_weight_kg,
      gender: d.gender,
      minYearsTraining: d.min_years_training, maxYearsTraining: d.max_years_training,
      minPriorEvents: d.min_prior_events, maxPriorEvents: d.max_prior_events,
      options: d.options, sortOrder: d.sort_order, capacity: d.capacity,
    }));
  }
  const prices = setup.prices.map((p) => ({ forCount: p.for_count,
    amountCents: p.amount_cents, membersOnly: p.members_only,
    currency: p.currency }));
  return { ...setup, engineDivisions: byDiscipline, enginePrices: prices };
}

get('/o/:slug/events/:eventSlug/setup', async (ctx) => {
  const { org, event } = await eventFor(ctx, { toSchedule: true });
  const setup = await competition.setupFor(event.id);
  return ctx.send(200, V.eventSetup({
    me: ctx.me, org, event, csrf: ctx.csrf,
    disciplines: setup.disciplines, byDiscipline: setup.byDiscipline,
    prices: setup.prices, grades: await gradesFor(org),
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
  }));
});

post('/o/:slug/events/:eventSlug/setup/discipline', async (ctx) => {
  const { org, event } = await eventFor(ctx, { toSchedule: true });
  const form = await ctx.form();
  const back = `/o/${org.slug}/events/${event.slug}/setup`;
  try {
    const d = await competition.addDiscipline(ctx.me.accountId, event.id, {
      name: form.name, summary: form.summary?.trim() || null,
      sortOrder: +(form.sortOrder ?? 0) || 0 });
    return ctx.redirect(`${back}?done=${encodeURIComponent(`${d.name} added.`)}`);
  } catch (e) {
    return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
  }
});

post('/o/:slug/events/:eventSlug/setup/division', async (ctx) => {
  const { org, event } = await eventFor(ctx, { toSchedule: true });
  const form = await ctx.form();
  const back = `/o/${org.slug}/events/${event.slug}/setup`;
  try {
    const d = await competition.addDivision(ctx.me.accountId, form.disciplineId, {
      label: form.label, summary: form.summary?.trim() || null,
      minRankOrder: form.minRankOrder, maxRankOrder: form.maxRankOrder,
      minAge: form.minAge, maxAge: form.maxAge,
      minWeightKg: form.minWeightKg, maxWeightKg: form.maxWeightKg,
      gender: form.gender?.trim() || null,
      sortOrder: +(form.sortOrder ?? 0) || 0 });
    return ctx.redirect(`${back}?done=${encodeURIComponent(`${d.label} added.`)}`);
  } catch (e) {
    return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
  }
});

post('/o/:slug/events/:eventSlug/setup/price', async (ctx) => {
  const { org, event } = await eventFor(ctx, { toSchedule: true });
  const form = await ctx.form();
  const back = `/o/${org.slug}/events/${event.slug}/setup`;
  try {
    // Typed in dollars because that is what the form says; stored in cents
    // because money in a float is how a total comes out a penny wrong.
    const amountCents = Math.round(Number(form.amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 0)
      throw new Invalid('That is not a price');
    await competition.setPrice(ctx.me.accountId, event.id, {
      forCount: +form.forCount, amountCents, membersOnly: !!form.membersOnly });
    return ctx.redirect(`${back}?done=${encodeURIComponent('Price set.')}`);
  } catch (e) {
    return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
  }
});

// ---- entering a club's own competitors -------------------------------------

/**
 * The event may belong to somebody else.
 *
 * A dojo enters its people in the federation's tournament, and it has no role
 * at the federation. So the organisation in the path is the CLUB doing the
 * entering — checked for the registrar role there — and the event is found by
 * looking up the tree from it. Requiring a grant at the host would mean only
 * the federation could ever enter anybody.
 */
async function entryContextFor(ctx) {
  const org = await organisationFor(ctx, { toRegister: true });
  const host = await one_(`
    select o.* from event e join organisation o on o.id = e.organisation_id
    join organisation me on me.id = $1
    where e.slug = $2 and me.path <@ o.path`, [org.id, ctx.params.eventSlug]);
  if (!host) throw new NotFound('Event');

  const { repo } = await calendar();
  const event = await repo.bySlug(host.id, ctx.params.eventSlug);
  if (!event) throw new NotFound('Event');
  return { org, host, event };
}

const esc_ = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const one_ = async (text, params) => (await pool.query(text, params)).rows[0] ?? null;

get('/o/:slug/events/:eventSlug/enter', async (ctx) => {
  const { org, host, event } = await entryContextFor(ctx);
  const setup = await competition.setupFor(event.id);
  const eventDate = dayOf(event, host.timezone);

  const roster = (await people.roster(ctx.me.accountId, org.id, {
    subtree: org.type !== 'club' }))
    .filter((p) => p.status === 'active')
    .map((p) => ({ ...p, ageOnDay: ageOn(p.date_of_birth, eventDate) }));

  return ctx.send(200, V.enterCompetitors({
    me: ctx.me, org, host, event, csrf: ctx.csrf,
    disciplines: setup.disciplines, roster, eventDate,
    consent: { version: event.consentVersion ?? null,
               text: event.consentText ?? null,
               guardianUnder: event.guardianUnder ?? null },
  }));
});

post('/o/:slug/events/:eventSlug/enter', async (ctx) => {
  const { org, host, event } = await entryContextFor(ctx);
  const form = await ctx.form();
  const setup = await engineSetupFor(event.id);
  const eventDate = dayOf(event, host.timezone);

  const roster = await people.roster(ctx.me.accountId, org.id, {
    subtree: org.type !== 'club' });
  const byId = new Map(roster.map((p) => [p.id, p]));

  // Which boxes were ticked, per person. A person with none ticked is simply
  // not competing, which is the normal case for most of a roll.
  const wanted = new Map();
  for (const key of Object.keys(form)) {
    const m = key.match(/^enter_([0-9a-f-]{36})_([0-9a-f-]{36})$/);
    if (m && byId.has(m[1])) {
      if (!wanted.has(m[1])) wanted.set(m[1], []);
      wanted.get(m[1]).push(m[2]);
    }
  }

  const backToForm = (error) => ctx.send(422, V.enterCompetitors({
    me: ctx.me, org, host, event, csrf: ctx.csrf,
    disciplines: setup.disciplines, eventDate, error, values: form,
    roster: roster.map((p) => ({ ...p, ageOnDay: ageOn(p.date_of_birth, eventDate) })),
    consent: { version: event.consentVersion ?? null,
               text: event.consentText ?? null,
               guardianUnder: event.guardianUnder ?? null },
  }));

  if (!wanted.size) return backToForm('Nobody has been ticked to enter.');

  const consentProblems = event.consentVersion
    ? problemsWithConsent({ accepted: !!form.accepted,
        acceptedName: form.acceptedName, version: event.consentVersion }, {})
    : [];
  if (consentProblems.length) return backToForm(consentProblems.join('; '));

  // Worked out, not written. Nothing is saved until somebody has read it.
  const rows = [];
  for (const [personId, disciplineIds] of wanted) {
    const p = byId.get(personId);
    const weightKg = form[`weight_${personId}`]?.trim() || null;
    const heightCm = form[`height_${personId}`]?.trim() || null;

    const competitor = new Competitor({
      personId, name: `${p.first_name} ${p.last_name}`,
      dateOfBirth: p.date_of_birth, gender: p.gender ?? p.person_gender,
      rankOrder: p.rank_order, weightKg, heightCm, clubName: org.name,
      isMember: true,
    });

    const placed = placeEntry({ disciplines: setup.disciplines,
      divisionsByDiscipline: setup.engineDivisions }, competitor,
      { eventDate, wanted: disciplineIds });

    const price = priceFor(disciplineIds.length, setup.enginePrices,
      { isMember: true });

    rows.push({ personId, name: competitor.name, weightKg, heightCm,
      ready: placed.ready, placements: placed.placements,
      amountCents: price.amountCents,
      needsGuardian: consentNeeded(competitor,
        { eventDate, guardianUnder: event.guardianUnder ?? null }).guardian });
  }

  const ready = rows.filter((r) => r.ready);
  const total = ready.reduce((n, r) => n + (r.amountCents ?? 0), 0);

  if (form.confirm !== 'yes') {
    // Everything needed to repeat this decision, so the confirm step is the
    // same calculation rather than a stored one.
    const text = Object.fromEntries(Object.entries(form)
      .filter(([k]) => k !== '_csrf' && k !== 'confirm'));
    return ctx.send(200, V.entryPreview({
      me: ctx.me, org, event, csrf: ctx.csrf, rows, text, total,
      currency: setup.prices[0]?.currency ?? 'NZD' }));
  }

  if (!ready.length) return backToForm('Nobody is ready to enter yet.');

  let entered = 0;
  const failures = [];
  for (const r of ready) {
    try {
      await competition.enterCompetitor(ctx.me.accountId, event.id, {
        personId: r.personId, enteredForOrg: org.id,
        weightKg: r.weightKg, heightCm: r.heightCm, clubName: org.name,
        amountCents: r.amountCents,
        currency: setup.prices[0]?.currency ?? 'NZD',
        placements: r.placements.map((p) => ({
          disciplineId: p.discipline.id, divisionId: p.division?.id ?? null,
          placedBy: 'calculated',
          options: p.division?.options ?? {} })),
        consent: event.consentVersion ? {
          version: event.consentVersion, acceptedName: form.acceptedName,
          ip: ctx.ip,
          guardian: r.needsGuardian
            ? { name: form.acceptedName, relationship: 'entered by club',
                contact: ctx.me.email }
            : null,
        } : null,
      });
      entered += 1;
    } catch (e) {
      // One competitor already entered must not lose the other nineteen.
      failures.push(`${r.name}: ${e.message}`);
    }
  }

  const done = `${entered} entered`
    + (failures.length ? `. Not entered — ${failures.join('; ')}` : '.');
  return ctx.redirect(`/o/${org.slug}/events/${event.slug}/entries?`
    + (failures.length ? 'error=' : 'done=') + encodeURIComponent(done));
});

// ---- the entry list --------------------------------------------------------

get('/o/:slug/events/:eventSlug/entries', async (ctx) => {
  const { org, host, event } = await entryContextFor(ctx);
  const setup = await competition.setupFor(event.id);
  return ctx.send(200, V.entryList({
    me: ctx.me, org: host, event, csrf: ctx.csrf,
    entries: await competition.entriesFor(ctx.me.accountId, event.id),
    divisions: setup.divisions,
    canAssign: await mayScheduleAt(ctx, host.id),
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
  }));
});

post('/o/:slug/events/:eventSlug/entries/assign', async (ctx) => {
  const { org, event } = await eventFor(ctx, { toSchedule: true });
  const form = await ctx.form();
  const back = `/o/${org.slug}/events/${event.slug}/entries`;
  try {
    await competition.assignDivision(ctx.me.accountId, form.selectionId,
      form.divisionId || null, 'Placed by the organiser');
    return ctx.redirect(`${back}?done=${encodeURIComponent('Placed.')}`);
  } catch (e) {
    return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
  }
});

// ---- giving somebody a way in ---------------------------------------------

/**
 * Create an account for somebody on the roll and hand back a sign-in link.
 *
 * Shown on screen rather than emailed. Sign-in is normally a link in an
 * email, which is right, and which means nobody can get in until that
 * federation's mail is configured — a wall in front of the very first thing a
 * new install has to do, which is add a second administrator.
 *
 * It stays useful afterwards. A member with no address, one that bounces, or
 * somebody standing in the hall right now: a registrar has to be able to get
 * them in. This is what "resend the invitation" is in every other system.
 */
post('/p/:id/access', async (ctx) => {
  ctx.requireActor();
  const { person, at } = await people.record(ctx.me.accountId, ctx.params.id);
  if (!at) throw new NotFound('Person has no current affiliation');
  const form = await ctx.form();

  try {
    const { account } = await people.grantAccess(ctx.me.accountId, person.id, {
      role: form.role || 'member',
      email: form.email?.trim() || null,
    });

    // Issued through the ordinary path: the same fifteen minutes, the same
    // single use, the same row in login_link. A link made here is not a
    // different kind of link, and nothing about it is weaker.
    const { token, expiresInMinutes } = await auth.requestLink(account.email,
      { ip: ctx.ip });

    const origin = `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;
    return ctx.send(200, V.person({
      me: ctx.me, person, at,
      ...(await people.record(ctx.me.accountId, person.id)),
      eligibility: null, canEdit: true,
      access: await people.accessFor(ctx.me.accountId, person.id),
      // Held in memory for this one response and never written anywhere we
      // could show it again. If it is lost, another is one click away.
      link: token ? `${origin}/signin/${token}` : null,
      linkExpires: expiresInMinutes,
      csrf: ctx.csrf,
    }));
  } catch (e) {
    const record = await people.record(ctx.me.accountId, person.id);
    return ctx.send(e.status ?? 422, V.person({
      me: ctx.me, ...record, eligibility: null, canEdit: true,
      access: await people.accessFor(ctx.me.accountId, person.id),
      error: e.message, csrf: ctx.csrf,
    }));
  }
});

// ---- bringing an existing roll in -----------------------------------------

/**
 * Plan the import from the pasted text.
 *
 * Re-planned on the confirm step rather than held between requests. The
 * planning is pure and deterministic, so the same text gives the same plan,
 * and a serverless instance that never sees the second request cannot lose
 * somebody's half-finished import. It also means the rules are applied again
 * at the moment of writing rather than trusted from a previous one.
 */
async function planFor(ctx, org, text) {
  const grades = (await rank.ladder((await orgs.ladderOwnerOf(org.id))?.id ?? org.id))
    .map((g) => ({ id: g.id, label: g.label, shortLabel: g.short_label,
                   rankOrder: g.rank_order }));
  const existing = await people.rollFor(ctx.me.accountId, org.id);
  return planImport(parseTable(text), { existing, grades });
}

get('/o/:slug/members/import', async (ctx) => {
  const org = await organisationFor(ctx, { toRegister: true });
  return ctx.send(200, V.importRoll({
    me: ctx.me, org, csrf: ctx.csrf,
    vocabulary: await orgs.vocabulary(org.id),
  }));
});

post('/o/:slug/members/import', async (ctx) => {
  const org = await organisationFor(ctx, { toRegister: true });
  const form = await ctx.form();
  const text = form.text ?? '';
  const vocabulary = await orgs.vocabulary(org.id);

  if (!text.trim()) {
    return ctx.send(422, V.importRoll({
      me: ctx.me, org, csrf: ctx.csrf, vocabulary,
      error: 'There is nothing pasted in yet.' }));
  }

  const preview = await planFor(ctx, org, text);

  // Two buttons, one route. Without the confirm flag this only ever shows what
  // would happen — the preview is not a formality to click through, it is the
  // only thing that runs until somebody says go.
  if (form.confirm !== 'yes') {
    return ctx.send(200, V.importRoll({
      me: ctx.me, org, csrf: ctx.csrf, text, preview, vocabulary }));
  }

  try {
    const result = await people.importRoll(ctx.me.accountId, org.id, preview.plan);
    return ctx.redirect(`/o/${org.slug}/roster?done=` + encodeURIComponent(
      `${result.added} added to the roll`
      + (result.graded ? `, ${result.graded} with the grade they already held` : '')
      + '.'));
  } catch (e) {
    return ctx.send(e.status ?? 422, V.importRoll({
      me: ctx.me, org, csrf: ctx.csrf, text, preview, vocabulary,
      error: e.message }));
  }
});

get('/p/:id/edit', async (ctx) => {
  ctx.requireActor();
  const { person, at } = await people.record(ctx.me.accountId, ctx.params.id);
  if (!at) throw new NotFound('Person has no current affiliation');
  if (!await mayRegisterAt(ctx, at.id))
    throw new Forbidden(`You can see this record but not change it. `
      + 'Correcting the register needs an owner, administrator or registrar role.');

  const priv = await people.privateDetail(ctx.me.accountId, person.id);
  const current = await people.currentAffiliation(person.id);

  return ctx.send(200, V.memberForm({
    me: ctx.me, org: at, person, csrf: ctx.csrf, isNew: false,
    vocabulary: await orgs.vocabulary(at.id),
    values: {
      firstName: person.first_name, lastName: person.last_name,
      preferredName: person.preferred_name ?? '',
      dateOfBirth: person.date_of_birth ?? '',
      gender: person.gender ?? '', email: person.email ?? '',
      phone: person.phone ?? '',
      emergencyName: priv?.emergency_name ?? '',
      emergencyPhone: priv?.emergency_phone ?? '',
      status: current?.status ?? 'active',
      paidUntil: current?.paid_until ?? '',
    },
  }));
});

post('/p/:id/edit', async (ctx) => {
  ctx.requireActor();
  const { person, at } = await people.record(ctx.me.accountId, ctx.params.id);
  if (!at) throw new NotFound('Person has no current affiliation');
  const form = await ctx.form();

  try {
    await people.update(ctx.me.accountId, person.id, {
      ...memberFieldsFrom(form),
      status: form.status || undefined,
    });
    return ctx.redirect(`/p/${person.id}`);
  } catch (e) {
    return ctx.send(e.status ?? 422, V.memberForm({
      me: ctx.me, org: at, person, csrf: ctx.csrf, isNew: false,
      error: e.message, vocabulary: await orgs.vocabulary(at.id), values: form,
    }));
  }
});

// ---- grading --------------------------------------------------------------

get('/o/:slug/grading', async (ctx) => {
  // The same role the submission needs. Showing somebody a grading sheet
  // they will not be allowed to submit is the form-you-cannot-send problem,
  // and it was relying on people.roster to refuse rather than saying so.
  const org = await organisationFor(ctx, { toRegister: true });
  // Whose syllabus this club grades on, rather than one federation's slug.
  const fed = await orgs.ladderOwnerOf(org.id) ?? org;
  const roster = await people.roster(ctx.me.accountId, org.id,
    { subtree: org.type !== 'club' });

  const candidates = [];
  for (const p of roster) {
    if (p.role !== 'member') continue;
    candidates.push({ ...p, eligibility: await rank.eligibility(p.id, fed.id) });
  }
  return ctx.send(200, V.grading({
    me: ctx.me, org, candidates, ladder: await rank.ladder(fed.id),
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
    csrf: ctx.csrf,
  }));
});

post('/o/:slug/grading', async (ctx) => {
  // Checked HERE, not left to rank.award.
  //
  // This route used to rely entirely on award() refusing, which it does —
  // but only when it is called. Submitted with nobody ticked, the loop never
  // ran, nothing refused anything, and a stranger got back "done=0" as though
  // their grading had been recorded. And a real attempt came back as a 302
  // with an error in the query string rather than a refusal, so the route
  // could not tell the difference between "not allowed" and "did not work".
  //
  // Exactly the shape of the /o/:slug/events hole: a route trusting a lower
  // layer that is not always reached.
  const org = await organisationFor(ctx, { toRegister: true });
  const form = await ctx.form();
  const panel = (form.panel ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const passed = Object.keys(form).filter((k) => k.startsWith('pass_'))
    .map((k) => k.slice(5));

  // All or nothing. A half-recorded grading is worse than none.
  try {
    for (const personId of passed) {
      await rank.award(ctx.me.accountId, {
        personId, gradeId: form[`grade_${personId}`], awardedByOrg: org.id,
        awardedOn: form.awarded_on, panel,
      });
    }
  } catch (e) {
    return ctx.redirect(
      `/o/${org.slug}/grading?error=${encodeURIComponent(e.message)}`);
  }
  return ctx.redirect(`/o/${org.slug}/grading?done=${passed.length}`);
});

// ---- events ---------------------------------------------------------------

/**
 * The calendar use cases, built once.
 *
 * Assembled from the factory rather than reached for directly, so this route
 * file does not name a database. `repositories()` caches its imports, and the
 * use cases hold no request state, so one set serves every request in this
 * instance.
 */
let _calendar = null;
async function calendar() {
  if (_calendar) return _calendar;
  const r = await repositories();
  const deps = { events: r.events, organisations: r.organisations,
                 auth: r.auth, clock: r.clock };
  _calendar = {
    repo: r.events,
    authz: r.auth,
    schedule: new ScheduleEvent(deps),
    revise: new ReviseEvent(deps),
    cancel: new CancelEvent({ events: r.events, auth: r.auth }),
  };
  return _calendar;
}

/**
 * The organisation named in the path — after checking the person may be there.
 *
 * Reading is checked as well as writing. The use cases stop unauthorised
 * WRITES, which is the part that matters most, but without this a signed-in
 * member of one club could fetch any other club's calendar by typing its slug,
 * including its unpublished drafts. `me.scope` is the subtree their grants
 * reach and is already computed on every request.
 *
 * `toSchedule` additionally asks whether they may change it, so a form is never
 * rendered for somebody whose submission will be refused. The answer comes from
 * the same list the use case uses, not a copy of it.
 */
async function organisationFor(ctx, { toSchedule = false,
                                      toRegister = false,
                                      toWrite = false } = {}) {
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');

  if (!ctx.me.scope?.some((o) => o.id === org.id))
    throw new Forbidden(`You do not have access to ${org.name}.`);

  if (toSchedule && !await mayScheduleAt(ctx, org.id)) {
    throw new Forbidden(
      `You can see ${org.name}'s calendar but not change it. `
      + 'Adding and editing events needs an owner, administrator or '
      + 'registrar role there.');
  }

  if (toWrite && !await mayWriteAt(ctx, org.id)) {
    throw new Forbidden(
      `You do not have permission to write ${org.name}'s website. `
      + 'That needs an owner, administrator or contributor role there.');
  }

  if (toRegister && !await mayRegisterAt(ctx, org.id)) {
    throw new Forbidden(
      `You can see ${org.name}'s roll but not change it. `
      + 'Adding and editing members needs an owner, administrator or '
      + 'registrar role there.');
  }

  // What the side rail shows: this organisation, in its own words, and only
  // the parts this person may use.
  const [vocabulary, register, write, manage] = await Promise.all([
    orgs.vocabulary(org.id),
    mayRegisterAt(ctx, org.id),
    mayWriteAt(ctx, org.id),
    mayPublishAt(ctx, org.id),
  ]);
  ctx.rail = { org, vocabulary, path: ctx.url.pathname,
               can: { register, write, manage } };
  return org;
}

/**
 * Whether this actor may put something on that calendar.
 *
 * Takes an organisation ID, exactly as mayRegisterAt does. It used to take an
 * organisation OBJECT, and its sibling took an id — so a call that passed an
 * id read `org.id` off a string, got undefined, and quietly answered "no".
 * That is how the entry list stopped offering the organiser any way to place
 * an unplaced competitor, with no error anywhere. Two helpers this alike need
 * the same signature.
 */
/** Who may write the website. Publishing is a separate question. */
const MAY_WRITE = ['owner', 'administrator', 'contributor'];

async function mayWriteAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MAY_WRITE);
}

async function mayManageAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, ['owner', 'administrator']);
}

async function mayScheduleAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MAY_SCHEDULE);
}

/**
 * The grade dropdowns, from whoever above this club keeps the ladder.
 *
 * Not a fixed list. A karate federation's 10th kyu to 8th dan and a taekwondo
 * federation's gup-and-dan are different ladders with different names, and the
 * form must offer the one the person filling it in actually uses.
 */
async function gradesFor(org) {
  const owner = await orgs.ladderOwnerOf(org.id);
  if (!owner) return [];
  const rows = await rank.ladder(owner.id);
  return rows.map((g) => ({ rankOrder: g.rank_order, label: g.label }));
}

/**
 * A submitted form becomes the fields the entity expects.
 *
 * Every empty text input arrives as '' rather than absent, and '' is not the
 * same as "no value" for a number or a date — `capacity: ''` would become 0.
 * A checkbox that is not ticked does not arrive at all.
 */
function eventFieldsFrom(form, zone) {
  const text = (k) => (form[k]?.trim() ? form[k].trim() : null);
  const number = (k) => (form[k]?.trim() ? form[k].trim() : null);
  return {
    title: form.title ?? '',
    kind: form.kind,
    slug: text('slug'),
    summary: text('summary'),
    startsAt: toInstant(text('startsAt'), zone),
    endsAt: toInstant(text('endsAt'), zone),
    allDay: !!form.allDay,
    venueName: text('venueName'),
    addressLine: text('addressLine'),
    visibility: form.visibility ?? 'public',
    minRankOrder: number('minRankOrder'),
    maxRankOrder: number('maxRankOrder'),
    minAge: number('minAge'),
    maxAge: number('maxAge'),
    entriesOpen: toInstant(text('entriesOpen'), zone),
    entriesClose: toInstant(text('entriesClose'), zone),
    capacity: number('capacity'),
    publishDown: !!form.publishDown,
    guardianUnder: number('guardianUnder'),
    consentVersion: text('consentVersion'),
    consentText: text('consentText'),
    guestsAllowed: !!form.guestsAllowed,
  };
}

/** An Event back into what the form wants: local wall-clock strings. */
const eventAsForm = (e, zone) => ({
  ...e.toJSON(),
  slug: String(e.slug),
  startsAt: toLocalInput(e.startsAt, zone),
  endsAt: toLocalInput(e.endsAt, zone),
  entriesOpen: toLocalInput(e.entriesOpen, zone),
  entriesClose: toLocalInput(e.entriesClose, zone),
  minRankOrder: e.minRankOrder == null ? '' : String(e.minRankOrder),
  maxRankOrder: e.maxRankOrder == null ? '' : String(e.maxRankOrder),
  minAge: e.minAge == null ? '' : String(e.minAge),
  maxAge: e.maxAge == null ? '' : String(e.maxAge),
  capacity: e.capacity == null ? '' : String(e.capacity),
  guardianUnder: e.guardianUnder == null ? '' : String(e.guardianUnder),
  consentVersion: e.consentVersion ?? '',
  consentText: e.consentText ?? '',
});

get('/o/:slug/events', async (ctx) => {
  const org = await organisationFor(ctx);
  const { repo } = await calendar();

  const own = await repo.listFor(org.id);
  // What the old read-only view showed: everything visible here, including
  // events published down from above. Those are read-only, so they are listed
  // separately and the org's own ones are dropped from the inherited list.
  const visible = await events.forOrg(org.slug,
    { isMember: true, viewerRankOrder: 99 });
  const inherited = visible.filter((e) => !e.is_own);

  return ctx.send(200, V.events({
    me: ctx.me, org, own, inherited, zone: org.timezone, csrf: ctx.csrf,
    canSchedule: await mayScheduleAt(ctx, org.id),
    // Asking is for somebody who can speak for the organisation, and only
    // makes sense where there is a federation above to ask.
    canAsk: !!org.parent_id && await mayManageAt(ctx, org.id),
    waiting: await mayManageAt(ctx, org.id)
      ? await events.awaitingDecision(ctx.me.accountId, org.id) : [],
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
    rebuild: ctx.url.searchParams.get('rebuild'),
  }));
});

get('/o/:slug/events/new', async (ctx) => {
  const org = await organisationFor(ctx, { toSchedule: true });
  return ctx.send(200, V.eventForm({
    me: ctx.me, org, csrf: ctx.csrf, isNew: true,
    zone: org.timezone, grades: await gradesFor(org),
    values: { kind: 'training', visibility: 'public' },
  }));
});

post('/o/:slug/events/new', async (ctx) => {
  const org = await organisationFor(ctx, { toSchedule: true });
  const form = await ctx.form();
  const { schedule } = await calendar();

  try {
    const saved = await schedule.execute({
      actorId: ctx.me.accountId, organisationId: org.id,
      ...eventFieldsFrom(form, org.timezone),
      status: form.status === 'published' ? 'published' : 'draft',
    });
    const rebuild = await requestRebuild({ reason: `event ${org.slug}` });
    return ctx.redirect(`/o/${org.slug}/events?done=`
      + encodeURIComponent(`"${saved.title}" saved.`)
      + '&rebuild=' + encodeURIComponent(rebuild.detail));
  } catch (e) {
    // Back to the form with what they typed still in it. Re-rendering an empty
    // form after a refusal is how somebody loses fifteen fields to a typo in
    // one of them.
    return ctx.send(e.status ?? 422, V.eventForm({
      me: ctx.me, org, csrf: ctx.csrf, isNew: true, error: e.message,
      zone: org.timezone, grades: await gradesFor(org), values: form,
    }));
  }
});

get('/o/:slug/events/:eventSlug/edit', async (ctx) => {
  const org = await organisationFor(ctx, { toSchedule: true });
  const { repo } = await calendar();
  const event = await repo.bySlug(org.id, ctx.params.eventSlug);
  if (!event) throw new NotFound('Event');

  return ctx.send(200, V.eventForm({
    me: ctx.me, org, csrf: ctx.csrf, isNew: false, status: event.status,
    zone: org.timezone, grades: await gradesFor(org),
    values: eventAsForm(event, org.timezone),
  }));
});

post('/o/:slug/events/:eventSlug/edit', async (ctx) => {
  const org = await organisationFor(ctx, { toSchedule: true });
  const form = await ctx.form();
  const { repo, revise } = await calendar();

  const existing = await repo.bySlug(org.id, ctx.params.eventSlug);
  if (!existing) throw new NotFound('Event');

  try {
    const saved = await revise.execute({
      actorId: ctx.me.accountId, eventId: existing.id,
      ...eventFieldsFrom(form, org.timezone),
      status: form.status,
    });
    const rebuild = await requestRebuild({ reason: `event ${org.slug}` });
    return ctx.redirect(`/o/${org.slug}/events?done=`
      + encodeURIComponent(`"${saved.title}" updated.`)
      + '&rebuild=' + encodeURIComponent(rebuild.detail));
  } catch (e) {
    return ctx.send(e.status ?? 422, V.eventForm({
      me: ctx.me, org, csrf: ctx.csrf, isNew: false, status: existing.status,
      error: e.message, zone: org.timezone, grades: await gradesFor(org),
      values: { ...form, slug: String(existing.slug) },
    }));
  }
});

post('/o/:slug/events/:eventSlug/cancel', async (ctx) => {
  const org = await organisationFor(ctx, { toSchedule: true });
  await ctx.form();
  const { repo, cancel } = await calendar();

  const existing = await repo.bySlug(org.id, ctx.params.eventSlug);
  if (!existing) throw new NotFound('Event');

  try {
    await cancel.execute({ actorId: ctx.me.accountId, eventId: existing.id });
  } catch (e) {
    return ctx.redirect(
      `/o/${org.slug}/events?error=${encodeURIComponent(e.message)}`);
  }
  const rebuild = await requestRebuild({ reason: `event ${org.slug}` });
  return ctx.redirect(`/o/${org.slug}/events?done=`
    + encodeURIComponent(`"${existing.title}" is cancelled.`)
    + '&rebuild=' + encodeURIComponent(rebuild.detail));
});

// The club asks; the federation answers. Same shape as an article, and for the
// same reason: a club may put what it likes on its own page, but the
// federation's calendar carries the federation's name.
post('/o/:slug/events/:eventSlug/ask', async (ctx) => {
  const org = await organisationFor(ctx, { toSchedule: true });
  await ctx.form();
  const { repo } = await calendar();
  const back = `/o/${org.slug}/events`;
  const existing = await repo.bySlug(org.id, ctx.params.eventSlug);
  if (!existing) throw new NotFound('Event');
  try {
    const ev = await events.requestPublishUp(ctx.me.accountId, existing.id);
    return ctx.redirect(`${back}?done=` + encodeURIComponent(
      `Asked for "${ev.title}" to appear on the federation's calendar.`));
  } catch (e) {
    if (e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

/** Posted at the deciding organisation, whose calendar it would appear on. */
post('/o/:slug/event-requests/:eventId/decide', async (ctx) => {
  const org = await organisationFor(ctx, { toSchedule: true });
  const form = await ctx.form();
  const approve = form.answer === 'approve';
  const back = `/o/${org.slug}/events`;
  try {
    const ev = await events.decidePublishUp(ctx.me.accountId, ctx.params.eventId,
      approve, { decidedBy: org.id });
    const rebuild = approve
      ? await requestRebuild({ reason: `approve event ${ev.slug}` })
      : { detail: 'Nothing to rebuild — it was not on the site.' };
    return ctx.redirect(`${back}?done=` + encodeURIComponent(approve
      ? `"${ev.title}" now appears on this calendar.`
      : `"${ev.title}" was declined. It stays on their own calendar.`)
      + '&rebuild=' + encodeURIComponent(rebuild.detail));
  } catch (e) {
    if (e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

// ---------------------------------------------------------------------------
// the request
// ---------------------------------------------------------------------------

export async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  // The admin needs to read and write member data. Running from files it can do
  // neither, so say so plainly rather than failing with a socket error three
  // layers down. The public site is unaffected — it is static.
  if (currentStore() === 'files') {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8',
      ...SECURITY_HEADERS });
    return res.end(V.error({ me: null, status: 503, csrf: null,
      message: 'The admin is not available on this deployment. It is running ' +
        'from files, which are read-only. Set DATABASE_URL to enable sign-in, ' +
        'the register and grading.' }));
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE];
  const secure = (req.headers['x-forwarded-proto'] ?? '') === 'https';

  const setCookies = [];
  let csrf = cookies[CSRF_COOKIE];
  if (!csrf) {
    csrf = newCsrf();
    setCookies.push(`${CSRF_COOKIE}=${csrf}; HttpOnly; SameSite=Lax; Path=/` +
      (secure ? '; Secure' : ''));
  }

  const ctx = {
    req, res, url, cookies, sessionToken, csrf, secure,
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        ?? req.socket?.remoteAddress ?? null,
    me: await auth.currentActor(sessionToken),
    params: {},

    cookie(value) { setCookies.push(value); },

    /** Reads the body AND checks the CSRF token. One call, nothing to forget. */
    async form() {
      const f = await readForm(req);
      assertCsrf(cookies[CSRF_COOKIE], f._csrf);
      return f;
    },

    /**
     * The same for a form carrying files. Separate from form() because the
     * body is read differently, but it checks CSRF identically — an upload
     * route must not be the one place the token is not looked at.
     */
    async upload(options) {
      const { fields, files } = await readMultipart(req, options);
      assertCsrf(cookies[CSRF_COOKIE], fields._csrf);
      return { fields, files };
    },

    /**
     * Bytes rather than a page.
     *
     * The type given here is the one sniffed from the bytes, never the one an
     * uploader declared, and nosniff comes along with the rest of the security
     * headers so a browser cannot decide it knows better either.
     */
    sendBytes(status, buffer, { type = 'application/octet-stream',
                                cacheControl = 'private, max-age=0',
                                filename = null } = {}) {
      res.writeHead(status, {
        'content-type': type,
        'content-length': buffer.length,
        'cache-control': cacheControl,
        // Shown inline, but named — so a browser that will not render it
        // offers a sensible filename rather than the bare id.
        ...(filename
          ? { 'content-disposition': `inline; filename="${filename.replace(/["\\]/g, '')}"` }
          : {}),
        ...SECURITY_HEADERS,
        ...(setCookies.length ? { 'set-cookie': setCookies } : {}),
      });
      res.end(buffer);
    },

    send(status, html) {
      // The side rail depends on what this person may do here, which only the
      // server knows. Screens leave a marker; this fills it, or removes it.
      if (typeof html === 'string' && html.includes(V.RAIL_MARKER))
        html = html.replace(V.RAIL_MARKER, () => this.rail ? V.rail(this.rail) : '');
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        ...SECURITY_HEADERS,
        ...(setCookies.length ? { 'set-cookie': setCookies } : {}),
      });
      res.end(html);
    },

    download(filename, type, text) {
      res.writeHead(200, {
        'content-type': `${type}; charset=utf-8`,
        'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
        ...SECURITY_HEADERS,
      });
      res.end(text);
    },

    redirect(to) {
      res.writeHead(302, {
        location: to,
        ...(setCookies.length ? { 'set-cookie': setCookies } : {}),
      });
      res.end();
    },

    requireActor() {
      if (!this.me) {
        const e = new Forbidden('Sign in first');
        e.redirect = '/signin';
        throw e;
      }
    },
  };

  // A demonstration session may look at anything it can see and change
  // nothing. Enforced here rather than in each route, so a route written next
  // year is safe without anybody remembering this rule. Signing out is the one
  // write allowed — a visitor must be able to leave.
  if (ctx.me?.isDemo && req.method !== 'GET' && url.pathname !== '/signout') {
    return ctx.send(403, V.error({ me: ctx.me, status: 403, csrf,
      message: 'This is a demonstration. You can look at everything here and '
        + 'change nothing — the records belong to a federation that exists '
        + 'only to be looked at.' }));
  }

  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const params = match(r.pattern, url.pathname);
      if (!params) continue;
      ctx.params = params;
      return await r.handler(ctx);
    }

    // A moved page is a redirect, not a 404. Held in the register, so renaming
    // a dojo slug does not break every link that points at it.
    const { rows: [moved] } = await pool.query(
      `select to_path, permanent from redirect where from_path = $1`,
      [url.pathname]).catch(() => ({ rows: [] }));
    if (moved) {
      res.writeHead(moved.permanent ? 301 : 302, { location: moved.to_path });
      return res.end();
    }

    return ctx.send(404, V.error({ me: ctx.me, status: 404, csrf,
      message: 'That page does not exist.' }));
  } catch (e) {
    if (e.redirect) return ctx.redirect(e.redirect);
    const status = e.status ?? 500;
    if (status >= 500) console.error(e);
    return ctx.send(status, V.error({ me: ctx.me, status, csrf,
      message: status >= 500 ? 'Something went wrong.' : e.message }));
  }
}

export default handler;
