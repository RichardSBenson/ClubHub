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

import { problemWithDeclaration } from '../core/domain/calendar.mjs';
import { STARTER_DECLARATION } from '../core/domain/declarations.mjs';
import { nextGrading } from '../core/domain/next-grading.mjs';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { lookups, declarations, photos, instructorRole, eventDetails, orgs, people, rank, events, competition, pages, assets, instructors, memberDocuments, navigation, audit, cards, checkin, search, appearance, clubProfile, family, myself, memberEvents, messages, payments, fees, renewals, reminders, attendance, newcomers, qualifications, forms, autoRenew, booking, push, apiTokens, api, webhooks, platform, portal, enquiries, scheduledPublishing, TooMany, trials, referrals, growth, clubMailer, terms, Forbidden, NotFound, Invalid } from './data.mjs';
import * as auth from './auth.mjs';
import * as V from './views.mjs';
import { qrSvg } from '../core/domain/qr.mjs';
import { CHECKIN_REFRESH_SECONDS } from './card-token.mjs';
import { readTrialSignup, normaliseCode } from '../core/domain/growth.mjs';
import { repeatFromLast, decideQuick } from '../core/domain/repeat-entry.mjs';
import { readEnquiry, looksLikeRobot, sameSite } from '../core/domain/enquiry.mjs';
import { readSelfEdit } from '../core/domain/family.mjs';
import { readClubProfile } from '../core/domain/club-profile.mjs';
import { readPayment } from '../core/domain/payments.mjs';
import { readFee, readExemption, reminderText } from '../core/domain/membership.mjs';
import { toCsv, fileName } from '../core/domain/csv.mjs';
import { ENTRY_COLUMNS, entryRows } from '../core/domain/entry-export.mjs';
import { readScopes, readEvents } from '../core/domain/integrations.mjs';
import { paymentProviderFrom, isTestProvider } from '../infrastructure/payments/providers.mjs';
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
import { typeFor, readType, defaultTitle } from '../core/domain/event-types.mjs';
import { fitFor } from '../content/image-slots.mjs';
import { isPdf, MAX_DOCUMENT_BYTES } from '../core/domain/documents.mjs';
import { identify, NotAnImage, MAX_BYTES } from '../content/images.mjs';
import { parseTable, planImport } from '../core/domain/roll-import.mjs';
import { Competitor, Division, placeEntry, priceFor, consentNeeded,
         problemsWithConsent } from '../core/domain/competition.mjs';
import { ageOn } from '../core/domain/people.mjs';
import { looksEmpty }
  from '../content/page-form.mjs';
import { renderBlocks, excerpt } from '../content/blocks.mjs';
import * as R from '../site/render.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';
import { MANAGE, REGISTER, TEACH, WRITE } from '../core/domain/access.mjs';
import { registerSettingsRoutes } from './routes-settings.mjs';
import { registerShopRoutes } from './routes-shop.mjs';
import { DEFAULT_TIMEZONE } from '../core/domain/defaults.mjs';
import { region, eventTypes, withRegion } from '../infrastructure/region-context.mjs';
import { sendingAddress, originOf } from './request-helpers.mjs';
import { registerMediaRoutes } from './routes-media.mjs';
import { registerNewsRoutes } from './routes-news.mjs';
import { registerInstructorRoutes } from './routes-instructors.mjs';
import { registerClubPageRoutes } from './routes-club-pages.mjs';
import { registerNewClubRoutes } from './routes-new-club.mjs';
import { registerPublicEntryRoutes } from './routes-public-entry.mjs';
import { registerQualificationRoutes } from './routes-qualifications.mjs';
import { registerFormRoutes } from './routes-forms.mjs';
import { registerGradingEventRoutes } from './routes-grading-events.mjs';
import { registerNewcomerRoutes } from './routes-newcomers.mjs';
import { registerReportRoutes } from './routes-reports.mjs';
import { registerClubPaymentRoutes } from './routes-club-payments.mjs';
import { registerBookingRoutes } from './routes-bookings.mjs';
import { registerMessageRoutes } from './routes-messages.mjs';

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

// Where to go after signing in. Only a path on this site: anything with a scheme or a second
// slash could send a signed-in person somewhere else.
const safeNext = (v) => (typeof v === 'string' && /^\/[A-Za-z0-9_\-./?=&%~]*$/.test(v) && !v.startsWith('//') && v.length < 600) ? v : null;

// security-ok: public by design: the sign-in page is how anyone gets in, and next is checked by safeNext
get('/signin', async (ctx) => ctx.send(200, V.signIn({
  sent: ctx.url.searchParams.get('sent'), csrf: ctx.csrf, next: safeNext(ctx.url.searchParams.get('next')) ?? '' })));

// security-ok: public by design: anyone may ask for a sign-in link; the form is CSRF-checked and rate limited
post('/signin', async (ctx) => {
  const form = await ctx.form();
  try {
    const issue = await auth.requestLink(form.email, { ip: ctx.ip, redirectTo: safeNext(form.next) });

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

// Opening the link only shows a button. Mail scanners open every link; only a person presses a button.
get('/signin/:token', async (ctx) => {
  try {
    await auth.peekLink(ctx.params.token);
    return ctx.send(200, V.signInConfirm({ csrf: ctx.csrf, token: ctx.params.token }));
  } catch (e) {
    return ctx.send(403, V.signIn({ error: e.message, csrf: ctx.csrf }));
  }
});

// security-ok: public by design: the link is the credential, and it is single use; the form is CSRF-checked
post('/signin/:token', async (ctx) => {
  await ctx.form();
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

// security-ok: works on the caller's own session cookie only; the form is CSRF-checked
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
  const rows = await lookups.visibleOrgs(ctx.me.accountId);
  // Whoever may write to an organisation's people gets the one-tap button on its card.
  await Promise.all(rows.map(async (r) => { r.canMessage = await mayPublishAt(ctx, r.id); }));

  // Every other screen looks at one federation, so one vocabulary does. This
  // one does not: an account can span federations in different arts, and a
  // karate club and a jiu-jitsu academy can appear on the same screen. Taking
  // the home federation's words and applying them to everybody calls the
  // academies clubs, which is exactly the thing configuration-over-code is
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

  const platformOwner = await lookups.isPlatformOwner(ctx.me.accountId);
  return ctx.send(200,
    V.dashboard({ me: ctx.me, orgs: rows, parents, groups, csrf: ctx.csrf, platformOwner }));
});

// ---- the federation's declaration: written once here ------------------------------

async function declarationAdminPage(ctx, extra = {}) {
  const org = await organisationFor(ctx);
  const owner = await declarations.ownerOf(org.id);
  if (!(await mayRegisterAt(ctx, owner.id))) throw new Forbidden('Only the federation\'s officials can write its declaration.');
  const { current, signed } = await declarations.counts(org.id);
  const { code = 200, ...more } = extra;
  return ctx.send(code, V.declarationAdmin({ me: ctx.me, csrf: ctx.csrf, org, owner, current, signed,
    starter: STARTER_DECLARATION, done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...more }));
}
get('/o/:slug/declaration', async (ctx) => { ctx.requireActor(); return declarationAdminPage(ctx); });
post('/o/:slug/declaration', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');
  try {
    const out = await declarations.publish(ctx.me.accountId, org.id, { version: form.version, body: form.body });
    return ctx.redirect(`/o/${org.slug}/declaration?done=${encodeURIComponent(`Version ${out.version} is published. Everyone will be asked to sign it.`)}`);
  } catch (e) {
    if (e instanceof Invalid) return declarationAdminPage(ctx, { code: 422, error: e.message, values: form });
    throw e;
  }
});

// ---- roster ---------------------------------------------------------------

get('/o/:slug/roster', async (ctx) => {
  // organisationFor also builds the side menu — without it the roll was the one page with no menu at all.
  const org = await organisationFor(ctx);
  const q = ctx.url.searchParams;
  const filter = { grade: q.get('grade') || 'all', band: ['junior', 'senior'].includes(q.get('band')) ? q.get('band') : '',
                   show: ['instructors', 'due'].includes(q.get('show')) ? q.get('show') : '', all: q.get('all') === '1' };
  const rows = await people.roster(ctx.me.accountId, org.id, { subtree: org.type !== 'club' });
  // One line per person: the roster has a row per affiliation, and somebody who is a member and an instructor has two.
  const byId = new Map();
  for (const r of rows) {
    const have = byId.get(r.id);
    if (!have) byId.set(r.id, { ...r, isInstructor: r.role === 'instructor' });
    else {
      if (r.role === 'instructor') have.isInstructor = true;
      if (r.role === 'member' && have.role !== 'member') Object.assign(have, { role: r.role, paid_until: r.paid_until, status: r.status, club: r.club, club_slug: r.club_slug });
    }
  }
  const canManage = await mayPublishAt(ctx, org.id).catch(() => false);
  const all = [...byId.values()];
  const states = await instructors.stateFor(all.filter((r) => r.isInstructor).map((r) => r.id));
  const ladderOwner = await orgs.ladderOwnerOf(org.id);
  const ladder = ladderOwner ? await rank.ladder(ladderOwner.id) : [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: org.timezone || DEFAULT_TIMEZONE });
  for (const r of all) {
    const [held, above] = [0, 1].map((d) => r.rank_order != null ? ladder.find((g) => g.rank_order === r.rank_order + d) : null);
    r.nextGrading = r.grade ? nextGrading({ held: { awardedOn: r.graded_on, usualMonths: held?.usual_months_to_next, byInvitation: held?.next_by_invitation }, next: above ? { label: above.label } : null, today }) : null;
  }
  const shown = all.filter((r) => {
    if (filter.grade === 'dan' && !r.is_dan) return false;
    if (filter.grade !== 'all' && filter.grade !== 'dan' && r.grade_id !== filter.grade) return false;
    if (filter.band === 'junior' && !(r.age != null && r.age < region().adultAge)) return false;
    if (filter.band === 'senior' && !(r.age == null || r.age >= region().adultAge)) return false;
    if (filter.show === 'instructors' && !r.isInstructor) return false;
    if (filter.show === 'due' && !r.nextGrading?.due) return false;
    return true;
  }).map((r) => ({ ...r, instructor: states.get(r.id) ?? null }));
  const unlinked = await family.withoutGuardian(all.filter((r) => r.age != null && r.age < region().adultAge).map((r) => r.id));
  for (const r of shown) r.noGuardian = unlinked.has(r.id);
  const unsignedDecl = await declarations.unsignedAmong(org.id, all.filter((r) => r.role !== 'supporter').map((r) => r.id));
  for (const r of shown) r.noDeclaration = unsignedDecl.has(r.id);
  const waitingDocs = await memberDocuments.waiting(ctx.me.accountId, org.id).catch(() => []);
  return ctx.send(200, V.roster({
    me: ctx.me, org, roster: shown, total: all.length, unlinked: all.filter((r) => unlinked.has(r.id)), waitingDocs, csrf: ctx.csrf,
    canRegister: await mayRegisterAt(ctx, org.id), canManage, filter, declarationUnsigned: unsignedDecl.size,
    ladder, dueCount: all.filter((r) => r.nextGrading?.due).length,
    done: q.get('done'), error: q.get('error'), rebuild: q.get('rebuild'),
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
    about: await lookups.aboutOf(record.person.id),
    isInstructor: await instructorRole.is(record.person.id), canManage: mayManage,
    documents: await memberDocuments.list(ctx.me.accountId, record.person.id).then((d) => d.rows).catch(() => []),
    mayInstruct: await lookups.holdsDan(record.person.id),
    done: ctx.url.searchParams.get('done'), photoError: ctx.url.searchParams.get('error'),
    titles: await people.titlesOf(ctx.me.accountId, ctx.params.id),
    recognisable: (await rank.recognisable(ctx.me.accountId, ctx.params.id)).grades,
    instructorSite: await instructors.siteStatus(ctx.params.id),
    // Named `changes`, not `history`: this view already has a `history`, and
    // it is the grading history. Overwriting it with the audit log would have
    // replaced somebody's grades with a list of edits.
    changes: mayManage && record.at
      ? await audit.forEntity(ctx.me.accountId, record.at.id, 'person',
                              ctx.params.id, { limit: 20 })
      : [],
    training: record.at ? await attendance.forPerson(ctx.me.accountId, ctx.params.id, record.at.id)
      .catch(() => null) : null,
    access: canEdit ? await people.accessFor(ctx.me.accountId, record.person.id)
                    : null,
    guardians: canEdit ? await family.guardiansOf(ctx.me.accountId, record.person.id)
                       : null,
  }));
});

post('/p/:id/instructor', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Person');
  const on = form.instructor === 'on';
  const out = await instructorRole.set(ctx.me.accountId, ctx.params.id, on);
  if (out.changed) await requestRebuild({ reason: `instructor ${on ? 'on' : 'off'}` });
  return ctx.redirect(`/p/${ctx.params.id}?done=${encodeURIComponent(!out.changed ? 'No change.' : on ? 'Marked as an instructor.' : 'No longer marked as an instructor.')}`);
});

post('/p/:id/photo', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Person');
  let back = `/p/${ctx.params.id}`;
  // Whether this person may touch this record is settled before anything they sent is looked at.
  await photos.assertMay(ctx.me.accountId, ctx.params.id);
  try {
    const { fields, files } = await ctx.upload({ maxBytes: MAX_BYTES + 256 * 1024 });
    // Sent from "My details": go back there, not to the register view a member may not open.
    if (fields.return === 'me') back = `/me/${ctx.params.id}`;
    if (fields.remove) { await photos.clear(ctx.me.accountId, ctx.params.id); return ctx.redirect(`${back}?done=${encodeURIComponent('Photograph removed.')}`); }
    const file = files.find((f) => f.field === 'photo' && f.bytes.length);
    if (!file) return ctx.redirect(`${back}?error=${encodeURIComponent('Choose a photograph first.')}`);
    const identified = identify(file.bytes, { filename: file.filename });
    await photos.set(ctx.me.accountId, ctx.params.id, { bytes: file.bytes, identified, filename: file.filename }, { consent: fields.consent === 'on' });
    const warn = fitFor('portrait', identified)[0];
    await requestRebuild({ reason: 'photograph' });
    return ctx.redirect(`${back}?done=${encodeURIComponent('Photograph saved.' + (warn ? ' ' + warn : ''))}`);
  } catch (e) {
    if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

post('/p/:id/about', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Person');
  const form = await ctx.form();
  try {
    await photos.setAbout(ctx.me.accountId, ctx.params.id, form.about);
    await requestRebuild({ reason: 'write-up' });
    return ctx.redirect(`/p/${ctx.params.id}?done=${encodeURIComponent('Write-up saved.')}`);
  } catch (e) {
    if (e instanceof Invalid) return ctx.redirect(`/p/${ctx.params.id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

get('/p/:id/photo', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Photograph');
  const { mime, bytes } = await photos.bytes(ctx.me.accountId, ctx.params.id);
  return ctx.sendBytes(200, bytes, { type: mime, cacheControl: 'private, max-age=300' });
});

post('/p/:id/recognise-grade', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Person');
  const form = await ctx.form();
  const back = `/p/${ctx.params.id}`;
  try {
    const g = await rank.recognise(ctx.me.accountId, { personId: ctx.params.id, gradeId: form.gradeId, heldOn: form.heldOn, note: form.note });
    return ctx.redirect(`${back}?done=${encodeURIComponent(`${g.label} recorded.`)}`);
  } catch (e) {
    if (e instanceof Invalid) return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
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
      ? await lookups.personByNumber(number)
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

post('/p/:id/guardians/:linkId/contact', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  await family.setContact(ctx.me.accountId, ctx.params.linkId, { main: form.main === 'on', copy: form.copy === 'on', fees: form.fees === 'on' });
  return ctx.redirect(`/p/${ctx.params.id}`);
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
  return ctx.send(200, V.memberHome({ me: ctx.me, csrf: ctx.csrf, ...(await portal.dashboard(ctx.me.accountId)) }));
});

// The member's own inbox, timetable, record and documents. Registered before
// /me/:personId so that these words are not read as somebody's id.
// ---- forms and consent: the member's side. Before /me/:personId.
get('/me/forms/:personId', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
  return ctx.send(200, V.myForms({ me: ctx.me, csrf: ctx.csrf, ...(await forms.forPerson(ctx.me.accountId, ctx.params.personId)) }));
});
async function fillScreen(ctx, extra = {}) {
  if (!UUID_RE.test(ctx.params.formId) || !UUID_RE.test(ctx.params.personId)) throw new NotFound('Form');
  const r = await forms.open(ctx.me.accountId, ctx.params.personId, ctx.params.formId);
  return ctx.send(extra.status ?? 200, V.fillForm({ me: ctx.me, csrf: ctx.csrf, person: r.person, item: r.item, minor: r.minor, ...extra }));
}
get('/me/forms/:formId/:personId', async (ctx) => { ctx.requireActor(); return fillScreen(ctx); });
post('/me/forms/:formId/:personId', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.formId) || !UUID_RE.test(ctx.params.personId)) throw new NotFound('Form');
  const form = await ctx.form();
  try {
    await forms.submit(ctx.me.accountId, ctx.params.personId, ctx.params.formId, form, { signedName: form.signedName, ip: ctx.ip });
    return ctx.redirect('/me');
  } catch (e) { if (e instanceof Invalid) return fillScreen(ctx, { status: 422, error: e.message, values: form }); throw e; }
});

get('/me/messages', async (ctx) => {
  ctx.requireActor();
  return ctx.send(200, V.messagesInbox({ me: ctx.me, csrf: ctx.csrf, ...(await portal.inbox(ctx.me.accountId)) }));
});

get('/me/messages/:id', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Message');
  return ctx.send(200, V.messageView({ me: ctx.me, csrf: ctx.csrf, message: await portal.message(ctx.me.accountId, ctx.params.id) }));
});

// ---- school terms -------------------------------------------------------------

get('/me/terms', async (ctx) => {
  ctx.requireActor();
  const { self, dependants } = await family.mine(ctx.me.accountId);
  const groups = [];
  for (const p of [self, ...dependants].filter(Boolean)) groups.push(await terms.forPerson(ctx.me.accountId, p.id));
  return ctx.send(200, V.myTerms({ me: ctx.me, csrf: ctx.csrf, groups, done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error') }));
});

post('/me/terms/:termId/:personId', async (ctx) => {
  ctx.requireActor();
  await ctx.form();
  if (!UUID_RE.test(ctx.params.termId) || !UUID_RE.test(ctx.params.personId)) throw new NotFound('Term');
  try {
    const out = await terms.enrol(ctx.me.accountId, ctx.params.personId, ctx.params.termId);
    return ctx.redirect(out.paymentId ? `/me/payments/${out.paymentId}` : `/me/terms?done=${encodeURIComponent('Enrolled.')}`);
  } catch (e) {
    if (e instanceof Invalid) return ctx.redirect(`/me/terms?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

post('/me/terms/:termId/:personId/withdraw', async (ctx) => {
  ctx.requireActor();
  await ctx.form();
  if (!UUID_RE.test(ctx.params.termId) || !UUID_RE.test(ctx.params.personId)) throw new NotFound('Term');
  try {
    const out = await terms.withdraw(ctx.me.accountId, ctx.params.personId, ctx.params.termId);
    return ctx.redirect(`/me/terms?done=${encodeURIComponent(out.paid ? 'Withdrawn. The club will arrange any refund.' : 'Withdrawn.')}`);
  } catch (e) {
    if (e instanceof Invalid) return ctx.redirect(`/me/terms?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

async function termsScreen(ctx, org, extra = {}) {
  return ctx.send(extra.status ?? 200, V.termsScreen({ me: ctx.me, csrf: ctx.csrf, ...(await terms.overview(ctx.me.accountId, org.id)),
    canManage: await mayManageAt(ctx, org.id), done: ctx.url.searchParams.get('done'), ...extra }));
}
get('/o/:slug/terms', async (ctx) => termsScreen(ctx, await organisationFor(ctx, { toRegister: true })));
const termAction = (path, fn, okText) => post(path, async (ctx) => {
  const org = await organisationFor(ctx);
  const form = await ctx.form();
  try {
    await fn(ctx, org, form);
    return ctx.redirect(`/o/${org.slug}/terms?done=${encodeURIComponent(okText)}`);
  } catch (e) {
    if (e instanceof Invalid) return termsScreen(ctx, org, { status: 422, error: e.message });
    throw e;
  }
});
termAction('/o/:slug/terms', (ctx, org, f) => terms.save(ctx.me.accountId, org.id, f), 'Term added.');
termAction('/o/:slug/terms/load', (ctx, org, f) => terms.loadBuiltIn(ctx.me.accountId, org.id, Number(f.year)), 'Terms loaded.');
termAction('/o/:slug/terms/rule', (ctx, org, f) => terms.setRule(ctx.me.accountId, org.id, f), 'Saved.');
termAction('/o/:slug/terms/:termId/remove', (ctx, org) => { if (!UUID_RE.test(ctx.params.termId)) throw new NotFound('Term'); return terms.remove(ctx.me.accountId, org.id, ctx.params.termId); }, 'Term removed.');
get('/o/:slug/terms/:termId', async (ctx) => {
  const org = await organisationFor(ctx, { toRegister: true });
  if (!UUID_RE.test(ctx.params.termId)) throw new NotFound('Term');
  return ctx.send(200, V.termRoster({ me: ctx.me, csrf: ctx.csrf, org, ...(await terms.roster(ctx.me.accountId, org.id, ctx.params.termId)) }));
});

// ---- adult free trials and referrals ----------------------------------------

// A sign-in link that lands where the person was heading. Lives here because it needs auth.
const signInLinkFor = (origin) => async (email, redirectTo) => {
  const issue = await auth.requestLink(email, { redirectTo });
  return issue?.token ? `${origin}/signin/${issue.token}` : `${origin}/signin`;
};

get('/trial/:slug/thanks', async (ctx) => {
  const offer = await trials.offer(ctx.params.slug);
  if (!offer) throw new NotFound('Free trial');
  return ctx.send(200, V.trialThanks({ club: offer.name, days: offer.days }));
});

get('/trial/:slug', async (ctx) => {
  const offer = await trials.offer(ctx.params.slug);
  if (!offer) throw new NotFound('Free trial');
  const code = normaliseCode(ctx.url.searchParams.get('ref'));
  const hit = code ? await referrals.landing(code) : null;
  return ctx.send(200, V.trialPage({ csrf: ctx.csrf, offer, action: `/trial/${offer.slug}`,
    code: hit && hit.slug === offer.slug ? code : '', friend: hit && hit.slug === offer.slug ? hit.friend : '' }));
});

post('/trial/:slug', async (ctx) => {
  const form = await ctx.publicForm();
  const offer = await trials.offer(ctx.params.slug);
  if (!offer) throw new NotFound('Free trial');
  const done = `/trial/${offer.slug}/thanks`;
  if (looksLikeRobot(form)) return ctx.redirect(done);
  const input = readTrialSignup(form);
  let out;
  try {
    out = await trials.start({ slug: offer.slug, input, ipHash: ipHash(ctx.ip) });
  } catch (e) {
    if (e instanceof Invalid || e instanceof TooMany)
      return ctx.send(e.status ?? 422, V.trialPage({ csrf: ctx.csrf, offer, action: `/trial/${offer.slug}`, values: input, error: e.message }));
    throw e;
  }
  // The same answer whether or not we knew them. Only an address they gave us is written to.
  const origin = originOf(ctx);
  const to = out.existing ? out.email : input.email;
  if (to) {
    const link = await signInLinkFor(origin)(to, '/me');
    await clubMailer(out.org, { messenger: messengerFrom(), baseFrom: sendingAddress() }, to,
      out.existing ? `Sign in to ${offer.name}` : `Welcome to ${offer.name}`,
      out.existing ? `Hi ${input.firstName},\n\nHere is your sign-in link for ${offer.name}:\n${link}\n\nIt works once and expires in 15 minutes.`
        : `Hi ${input.firstName},\n\nYour free month at ${offer.name} has started and runs until ${out.ends}. Sign in to see the timetable and check in to classes:\n${link}\n\nThe link works once and expires in 15 minutes. Bring a drink and wear something comfortable.`);
  }
  return ctx.redirect(done);
});

get('/r/:code', async (ctx) => {
  const hit = await referrals.landing(ctx.params.code);
  if (!hit) throw new NotFound('Invitation');
  return ctx.send(200, V.referralLanding(hit));
});

get('/me/refer', async (ctx) => {
  ctx.requireActor();
  if (!ctx.me.personId) throw new NotFound('Your record');
  const r = await referrals.mine(ctx.me.accountId, ctx.me.personId);
  const link = r.eligible ? `${originOf(ctx)}/r/${r.code}` : '';
  return ctx.send(200, V.referPage({ me: ctx.me, csrf: ctx.csrf, ...r, link, svg: r.eligible ? qrSvg(link, { label: 'Your invitation code' }) : '' }));
});

async function joinScreen(ctx, extra = {}) {
  if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
  const { trial, options } = await trials.prices(ctx.me.accountId, ctx.params.personId);
  return ctx.send(extra.status ?? 200, V.joinPage({ me: ctx.me, csrf: ctx.csrf, trial, options, ...extra }));
}
get('/me/:personId/join', async (ctx) => { ctx.requireActor(); return joinScreen(ctx); });
post('/me/:personId/join', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
  try {
    const out = await trials.joinNow(ctx.me.accountId, ctx.params.personId, form.period);
    return ctx.redirect(`/me/payments/${out.paymentId}`);
  } catch (e) {
    if (e instanceof Invalid) return joinScreen(ctx, { status: 422, error: e.message });
    throw e;
  }
});

async function growthScreen(ctx, org, extra = {}) {
  const data = await growth.overview(ctx.me.accountId, org.id);
  return ctx.send(extra.status ?? 200, V.growthScreen({ me: ctx.me, csrf: ctx.csrf, ...data, org, origin: originOf(ctx),
    canManage: await mayManageAt(ctx, org.id), done: ctx.url.searchParams.get('done'), ...extra }));
}
get('/o/:slug/growth', async (ctx) => { const org = await organisationFor(ctx, { toRegister: true }); return growthScreen(ctx, org); });
post('/o/:slug/growth/settings', async (ctx) => {
  const org = await organisationFor(ctx);
  const form = await ctx.form();
  try {
    await growth.save(ctx.me.accountId, org.id, form);
    return ctx.redirect(`/o/${org.slug}/growth?done=${encodeURIComponent('Saved.')}`);
  } catch (e) {
    if (e instanceof Invalid) return growthScreen(ctx, org, { status: 422, error: e.message });
    throw e;
  }
});
post('/o/:slug/growth/rewards/:id/given', async (ctx) => {
  const org = await organisationFor(ctx, { toRegister: true });
  await ctx.form();
  if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Reward');
  await growth.markGiven(ctx.me.accountId, org.id, ctx.params.id);
  return ctx.redirect(`/o/${org.slug}/growth?done=${encodeURIComponent('Marked as given.')}`);
});

// ---- the digital card and class check-in ------------------------------------

get('/me/:personId/card', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
  const c = await cards.forPerson(ctx.me.accountId, ctx.params.personId);
  const url = c.issued ? `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}/v/${c.token}` : null;
  return ctx.send(200, V.memberCard({ me: ctx.me, csrf: ctx.csrf, ...c, url,
    svg: url ? qrSvg(url, { label: `Membership card for ${c.member.name}` }) : null }));
});

// Anybody may scan a card. What they are told depends on who they are (cards.verify).
get('/v/:token', async (ctx) => {
  const r = await cards.verify(ctx.me?.accountId ?? null, ctx.params.token);
  return ctx.send(200, V.cardVerdict({ me: ctx.me, csrf: ctx.csrf, token: ctx.params.token, ...r }));
});

get('/o/:slug/attendance/:sessionId/code', async (ctx) => {
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org || !UUID_RE.test(ctx.params.sessionId)) throw new NotFound('Class');
  try {
    const c = await checkin.code(ctx.me.accountId, org.id, ctx.params.sessionId);
    const url = `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}/checkin/${c.token}`;
    return ctx.send(200, V.checkinCode({ me: ctx.me, csrf: ctx.csrf, ...c, org, svg: qrSvg(url, { label: 'Check-in code' }),
      refresh: CHECKIN_REFRESH_SECONDS }));
  } catch (e) {
    if (e instanceof Invalid) return ctx.redirect(`/o/${org.slug}/attendance?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

const checkinScreen = async (ctx, extra = {}) => {
  if (!ctx.me) return ctx.redirect(`/signin?next=${encodeURIComponent('/checkin/' + ctx.params.token)}`);
  const plan = await checkin.plan(ctx.me.accountId, ctx.params.token);
  return ctx.send(extra.status ?? 200, V.checkinScreen({ me: ctx.me, csrf: ctx.csrf, token: ctx.params.token, ...plan, ...extra }));
};
get('/checkin/:token', async (ctx) => checkinScreen(ctx));
post('/checkin/:token', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  const ids = Object.keys(form).filter((k) => k.startsWith('here_') && form[k] === '1').map((k) => k.slice(5));
  try {
    const out = await checkin.confirm(ctx.me.accountId, ctx.params.token, ids);
    return ctx.send(200, V.checkinScreen({ me: ctx.me, csrf: ctx.csrf, token: ctx.params.token, ...out.plan, came: out.came }));
  } catch (e) {
    if (e instanceof Invalid) return checkinScreen(ctx, { error: e.message, status: 422 });
    throw e;
  }
});

get('/me/classes', async (ctx) => {
  ctx.requireActor();
  return ctx.send(200, V.myClasses({ me: ctx.me, csrf: ctx.csrf, groups: await portal.timetable(ctx.me.accountId) }));
});

get('/me/:personId/record', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
  return ctx.send(200, V.myRecord({ me: ctx.me, csrf: ctx.csrf, ...(await portal.record(ctx.me.accountId, ctx.params.personId)) }));
});

async function documentsPage(ctx, extra = {}) {
  const id = ctx.params.personId;
  if (!UUID_RE.test(id)) throw new NotFound('Person');
  return ctx.send(extra.status ?? 200, V.myDocuments({ me: ctx.me, csrf: ctx.csrf, ...(await portal.documents(ctx.me.accountId, id)),
    sent: (await memberDocuments.list(ctx.me.accountId, id)).rows, choices: await memberDocuments.choices(id),
    done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...extra }));
}
get('/me/:personId/documents', async (ctx) => { ctx.requireActor(); return documentsPage(ctx); });

// ---- the federation declaration ----------------------------------------------

const safeMeNext = (n) => safeNext(n) && /^\/me(\/|$|\?)/.test(n) ? n : null;

async function declarationPage(ctx, extra = {}) {
  const id = ctx.params.personId;
  if (!UUID_RE.test(id)) throw new NotFound('Person');
  const mine = await myself.get(ctx.me.accountId, id);
  const { code = 200, ...more } = extra;
  return ctx.send(code, V.declarationSign({ me: ctx.me, csrf: ctx.csrf, person: mine.person, how: mine.how,
    status: await declarations.statusFor(id), next: safeMeNext(ctx.url.searchParams.get('next')),
    done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...more }));
}
get('/me/:personId/declaration', async (ctx) => { ctx.requireActor(); return declarationPage(ctx); });

post('/me/:personId/declaration', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  const id = ctx.params.personId;
  if (!UUID_RE.test(id)) throw new NotFound('Person');
  const next = safeMeNext(form.next);
  try {
    await declarations.sign(ctx.me.accountId, id, { accepted: !!form.accepted, name: form.acceptedName, ip: ctx.ip });
  } catch (e) {
    if (e instanceof Invalid) return declarationPage(ctx, { code: 422, error: e.message, next });
    throw e;
  }
  return ctx.redirect(next ?? `/me/${id}/declaration?done=${encodeURIComponent('Signed. Thank you.')}`);
});

// Anybody linked to the person, at any age, may send a document to their club.
post('/me/:personId/documents', async (ctx) => {
  ctx.requireActor();
  const id = ctx.params.personId;
  if (!UUID_RE.test(id)) throw new NotFound('Person');
  await family.assertMayActFor(ctx.me.accountId, id);
  const back = `/me/${id}/documents`;
  try {
    const { fields, files } = await ctx.upload({ maxBytes: MAX_DOCUMENT_BYTES + 256 * 1024 });
    const f = files.find((x) => x.field === 'document' && x.bytes.length);
    if (!f) return ctx.redirect(`${back}?error=${encodeURIComponent('Choose the file to send.')}`);
    // What it is comes from its bytes, never from the name or type it arrived with.
    let mime;
    if (isPdf(f.bytes)) mime = 'application/pdf';
    else {
      try { mime = identify(f.bytes, { filename: f.filename }).mime; }
      catch (e) { if (e instanceof NotAnImage) throw new Invalid('Send a photograph (PNG, JPEG or WebP) or a PDF.'); throw e; }
    }
    await memberDocuments.add(ctx.me.accountId, id, { file: { bytes: f.bytes, mime, filename: f.filename },
      qualificationId: fields.qualificationId || null, title: fields.title, awardedOn: fields.awardedOn, expiresOn: fields.expiresOn, note: fields.note });
    return ctx.redirect(`${back}?done=${encodeURIComponent('Sent. Your club will look at it and record it.')}`);
  } catch (e) {
    if (e instanceof BadUpload || e instanceof Invalid) return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

get('/p/:id/document/:docId', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.id) || !UUID_RE.test(ctx.params.docId)) throw new NotFound('Document');
  const d = await memberDocuments.file(ctx.me.accountId, ctx.params.id, ctx.params.docId);
  return ctx.sendBytes(200, d.bytes, { type: d.mime, filename: d.filename ?? 'document', cacheControl: 'private, no-store' });
});

post('/p/:id/document/:docId/review', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.id) || !UUID_RE.test(ctx.params.docId)) throw new NotFound('Document');
  const form = await ctx.form();
  try {
    await memberDocuments.review(ctx.me.accountId, ctx.params.id, ctx.params.docId, { accept: form.decision === 'accept', note: form.note, awardedOn: form.awardedOn });
  } catch (e) {
    if (e instanceof Invalid) return ctx.redirect(`/p/${ctx.params.id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  return ctx.redirect(`/p/${ctx.params.id}?done=${encodeURIComponent(form.decision === 'accept' ? 'Accepted.' : 'Declined.')}`);
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
    const open = await memberEvents.openFor(person.id);
    // For each thing on offer, would it be one click? A declaration still has
    // to be read, so those open the one-click screen rather than posting.
    for (const e of open) {
      try {
        const plan = await memberEntryPlan({ me: ctx.me, params: { eventId: e.id, personId: person.id } }, {}, { fromLast: true });
        if (plan.quick.ok) {
          e.direct = !plan.event.consentVersion;
          e.sameAs = plan.setup.disciplines.length
            ? `Same as last time: ${plan.placements.map((p) => p.discipline.name).join(', ')}, ${plan.weightKg} kg` : null;
        }
      } catch { /* the plain link still works */ }
    }
    groups.push({ person, open,
                  entries: await memberEvents.entriesOf(person.id),
                  how: person.id === self?.id ? 'self' : 'guardian' });
  }
  return ctx.send(200, V.myEvents({ me: ctx.me, csrf: ctx.csrf, groups,
    done: ctx.url.searchParams.get('done') }));
});

/** Everything the form and the confirm step both need, worked out once. */
async function memberEntryPlan(ctx, form = {}, { fromLast = false } = {}) {
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

  // Somebody on no roll is entering an open event: their club and grade are what
  // they say, labelled as unverified, and the price is the non-member one.
  const outsider = open.home_org == null;
  const grades = outsider ? await gradesFor({ id: open.host_id }) : [];
  const gradeBy = (key) => grades.find((g) => String(g.rankOrder) === String(key)
    || g.label.toLowerCase() === String(key ?? '').trim().toLowerCase()) ?? null;

  // Entering again: what they said last time stands in for the form. Age,
  // grade and experience are never carried; they are worked out below.
  let last = null, repeat = null;
  if (fromLast) {
    last = await memberEvents.lastEntry(personId);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: open.host_timezone });
    repeat = repeatFromLast(last, setup.disciplines, today);
    const claimed = outsider ? gradeBy(last?.declaredGrade) : null;
    if (outsider && last && !claimed) {
      repeat = { ...repeat, oneClick: false, reasons: [...repeat.reasons, 'grade_unknown'] };
    }
    form = { ...form,
      ...(outsider ? { club: last?.clubName ?? '', grade: claimed?.rankOrder ?? '' } : {}),
      ...Object.fromEntries(repeat.chosen.map((id) => [`disc_${id}`, '1'])),
      weight: repeat.weightKg ?? '', height: repeat.heightCm ?? '',
      // Pressing the button on the one-click screen is the agreement; the
      // signed-in person is who agreed.
      accepted: '1', acceptedName: ctx.me.name };
  }
  const experience = await memberEvents.experience(personId);

  const chosen = setup.disciplines.filter((d) => form[`disc_${d.id}`]).map((d) => d.id);
  const weightKg = String(form.weight ?? '').trim() || null;
  const heightCm = String(form.height ?? '').trim() || null;

  const competitor = new Competitor({
    personId, name: `${mine.person.first_name} ${mine.person.last_name}`,
    dateOfBirth: mine.person.date_of_birth, gender: mine.person.gender,
    rankOrder: outsider ? (gradeBy(form.grade)?.rankOrder ?? null) : (mine.grade?.rank_order ?? null),
    weightKg, heightCm,
    yearsTraining: experience.yearsTraining, priorEvents: experience.priorEvents,
    clubName: outsider ? (String(form.club ?? '').trim() || null) : open.home_name, isMember: !outsider });
  const need = consentNeeded(competitor, { eventDate, guardianUnder: event.guardianUnder ?? null });

  const problems = [];
  let placements = [], amountCents = null, ready = true, reasons = [];
  if (outsider && setup.disciplines.length) {
    if (!String(form.club ?? '').trim()) problems.push('Tell us which club or school you train at ("none" is fine).');
    if (grades.length && !gradeBy(form.grade)) problems.push('Choose your grade, as best you know it.');
  }
  if (setup.disciplines.length) {
    if (!chosen.length) problems.push('Choose at least one thing to enter.');
    else {
      const placed = placeEntry({ disciplines: setup.disciplines,
        divisionsByDiscipline: setup.engineDivisions }, competitor,
        { eventDate, wanted: chosen });
      placements = placed.placements; ready = placed.ready;
      reasons = placed.placements.filter((p) => p.outcome !== 'placed')
        .map((p) => `${p.discipline.name}: ${p.reasons.join('; ')}`);
      amountCents = priceFor(chosen.length, setup.enginePrices, { isMember: !outsider }).amountCents;
    }
  }
  else {
    // No divisions: a seminar or camp has one flat entry fee, if the organiser set one.
    const flat = priceFor(1, setup.enginePrices, { isMember: !outsider }).amountCents;
    if (flat != null) amountCents = flat;
  }

  if (event.consentVersion) {
    problems.push(...problemsWithConsent({ accepted: !!form.accepted,
      acceptedName: form.acceptedName, version: event.consentVersion,
      guardianName: (how === 'guardian' || outsider) ? form.acceptedName : '',
      guardianContact: ctx.me.email }, need).map((t) => `${t[0].toUpperCase()}${t.slice(1)}.`));
    // On a roll, a parent signs in as themselves. Somebody entering from outside
    // has one sign-in, the address given, which is the parent's for a child.
    if (need.guardian && how === 'self' && !outsider)
      problems.push('Because of their age, a parent or guardian has to make this entry. '
        + 'Ask them to sign in and enter you.');
  }
  if (!ready) problems.push(...reasons);

  const plan = { how, open, event, setup, mine, eventDate, relationship, competitor, need,
           chosen, weightKg, heightCm, placements, amountCents, problems, form, last, repeat,
           experience, outsider, grades, claimedGrade: outsider ? gradeBy(form.grade) : null, currency: setup.prices[0]?.currency ?? region().currency };
  if (repeat) plan.quick = decideQuick({ repeat, last, placements, ready, problems });
  return plan;
}


/** On a roll, somebody who has not signed the federation's declaration signs it first, then comes back here. */
async function declarationGate(ctx, plan) {
  if (plan.outsider) return false;
  const st = await declarations.statusFor(ctx.params.personId);
  if (st.state !== 'unsigned') return false;
  const back = `/me/events/${ctx.params.eventId}/${ctx.params.personId}`;
  ctx.redirect(`/me/${ctx.params.personId}/declaration?next=${encodeURIComponent(back)}`);
  return true;
}

const memberEntryView = (ctx, plan, extra = {}) => V.memberEntryForm({
  me: ctx.me, csrf: ctx.csrf, ...plan, ...extra });

get('/me/events/:eventId/:personId', async (ctx) => {
  ctx.requireActor();
  const plan = await memberEntryPlan(ctx, {}, { fromLast: true });
  if (plan.open.already_entered)
    return ctx.redirect(`/me/events?done=${encodeURIComponent('Already entered.')}`);
  if (await declarationGate(ctx, plan)) return;
  // Nothing different from last time: one button. Otherwise the form, with
  // last time's answers in it and the reason it is being shown.
  if (plan.quick.ok && ctx.url.searchParams.get('edit') !== '1')
    return ctx.send(200, V.memberQuickEntry({ me: ctx.me, csrf: ctx.csrf, ...plan }));
  const values = { weight: plan.weightKg ?? '', height: plan.heightCm ?? '',
    club: plan.form.club ?? '', grade: plan.form.grade ?? '',
    ...Object.fromEntries(plan.chosen.map((id) => [`disc_${id}`, '1'])) };
  return ctx.send(200, memberEntryView(ctx, plan,
    { problems: [], values, reasons: plan.quick.reasons, changed: plan.quick.changed }));
});

/** One press. Refuses, and sends them to the form, if anything is different from last time. */
post('/me/events/:eventId/:personId/quick', async (ctx) => {
  ctx.requireActor();
  await ctx.form();
  const plan = await memberEntryPlan(ctx, {}, { fromLast: true });
  if (plan.open.already_entered)
    return ctx.redirect(`/me/events?done=${encodeURIComponent('Already entered.')}`);
  if (await declarationGate(ctx, plan)) return;
  if (!plan.quick.ok)
    return ctx.redirect(`/me/events/${ctx.params.eventId}/${ctx.params.personId}?edit=1`);
  return commitMemberEntry(ctx, plan);
});

post('/me/events/:eventId/:personId', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  const plan = await memberEntryPlan(ctx, form);

  if (plan.open.already_entered)
    return ctx.redirect(`/me/events?done=${encodeURIComponent('Already entered.')}`);
  if (await declarationGate(ctx, plan)) return;
  if (plan.problems.length)
    return ctx.send(422, memberEntryView(ctx, plan, { values: form }));

  if (form.confirm !== 'yes')
    return ctx.send(200, V.memberEntryPreview({ me: ctx.me, csrf: ctx.csrf, ...plan,
      text: Object.fromEntries(Object.entries(form).filter(([k]) => k !== '_csrf' && k !== 'confirm')) }));

  return commitMemberEntry(ctx, plan, form);
});

/** Writes the entry the plan describes, then goes to pay for it if it has a fee. */
async function commitMemberEntry(ctx, plan, form = plan.form) {
  try {
    await competition.enterCompetitor(ctx.me.accountId, plan.event.id, {
      personId: ctx.params.personId, byFamily: true,
      allowNoPlacements: !plan.setup.disciplines.length,
      weightKg: plan.weightKg, heightCm: plan.heightCm,
      clubName: plan.outsider ? (String(form.club ?? '').trim() || null) : plan.open.home_name,
      declaredGrade: plan.claimedGrade?.label ?? null,
      yearsTraining: plan.experience.yearsTraining, priorEvents: plan.experience.priorEvents,
      amountCents: plan.amountCents, currency: plan.currency,
      placements: plan.placements.map((p) => ({
        disciplineId: p.discipline.id, divisionId: p.division?.id ?? null,
        placedBy: 'calculated', options: p.division?.options ?? {} })),
      consent: plan.event.consentVersion ? {
        version: plan.event.consentVersion, acceptedName: form.acceptedName, ip: ctx.ip,
        guardian: plan.need.guardian
          ? { name: form.acceptedName, relationship: plan.relationship ?? (plan.outsider ? 'declared guardian' : 'guardian'),
              contact: ctx.me.email }
          : null } : null,
    });
  } catch (e) {
    if (e instanceof Invalid)
      return ctx.send(422, memberEntryView(ctx, { ...plan, problems: [e.message] }, { values: form }));
    throw e;
  }
  // An entry with a fee goes straight to paying for it.
  if (plan.amountCents > 0) {
    const owed = (await payments.owedBy(ctx.me.accountId)).find((p) =>
      p.person_id === ctx.params.personId && p.lines.some((l) => l.kind === 'tournament_entry'
        && l.description.endsWith(plan.event.title)));
    if (owed) return ctx.redirect(`/me/payments/${owed.id}`);
  }
  return ctx.redirect(`/me/events?done=${encodeURIComponent(
    `${plan.mine.person.first_name} is entered in ${plan.event.title}.`)}`);
}

// ---- paying ------------------------------------------------------------------
//
// Registered before /me/:personId. Who may pay is decided in payments.get, by
// family.mayActFor: the person, or a guardian of a minor.

const providerNow = () => paymentProviderFrom();

get('/me/payments', async (ctx) => {
  ctx.requireActor();
  const { self, dependants } = await family.mine(ctx.me.accountId);
  const groups = [];
  for (const person of [self, ...dependants].filter(Boolean))
    if (await family.mayPayFor(ctx.me.accountId, person.id))
      groups.push({ person, rows: await payments.forPerson(ctx.me.accountId, person.id) });
  return ctx.send(200, V.myPayments({ me: ctx.me, csrf: ctx.csrf, groups,
    test: isTestProvider(providerNow()), done: ctx.url.searchParams.get('done') }));
});

async function payView(ctx, extra = {}) {
  if (!UUID_RE.test(ctx.params.paymentId)) throw new NotFound('Payment');
  return ctx.send(extra.status ?? 200, V.payScreen({ me: ctx.me, csrf: ctx.csrf,
    payment: await payments.get(ctx.me.accountId, ctx.params.paymentId),
    test: isTestProvider(providerNow()), done: ctx.url.searchParams.get('done'), ...extra }));
}

// ---- automatic renewal: the member's side
async function autoScreen(ctx, extra = {}) {
  if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
  return ctx.send(extra.status ?? 200, V.autoRenewScreen({ me: ctx.me, csrf: ctx.csrf, ...(await autoRenew.forPerson(ctx.me.accountId, ctx.params.personId)),
    test: isTestProvider(providerNow()), done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...extra }));
}
get('/me/:personId/auto-renew', async (ctx) => { ctx.requireActor(); return autoScreen(ctx); });
post('/me/:personId/auto-renew', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
  const f = await ctx.form();
  await family.assertMayActFor(ctx.me.accountId, ctx.params.personId);
  try {
    if (!UUID_RE.test(String(f.affiliationId))) throw new Invalid('Choose a membership.');
    await autoRenew.start(ctx.me.accountId, ctx.params.personId, f.affiliationId,
      { method: f.method, period: f.period, card: f.card, agreed: f.agreed === 'on' }, { provider: providerNow() });
    return ctx.redirect(`/me/${ctx.params.personId}/auto-renew?done=${encodeURIComponent('Automatic renewal is on.')}`);
  } catch (e) { if (e instanceof Invalid) return ctx.redirect(`/me/${ctx.params.personId}/auto-renew?error=${encodeURIComponent(e.message)}`); throw e; }
});
post('/me/:personId/auto-renew/:agreementId/stop', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.personId) || !UUID_RE.test(ctx.params.agreementId)) throw new NotFound('Automatic renewal');
  await ctx.form();
  await autoRenew.cancel(ctx.me.accountId, ctx.params.personId, ctx.params.agreementId);
  return ctx.redirect(`/me/${ctx.params.personId}/auto-renew?done=${encodeURIComponent('Automatic renewal is off. Nothing more will be charged.')}`);
});

// ---- the read-only API. No session: a bearer token stands for one organisation and what is beneath it.
async function apiCall(ctx, scope, run) {
  const m = /^Bearer (\S+)$/.exec(String(ctx.req.headers.authorization ?? ''));
  const a = await apiTokens.authenticate(m?.[1]);
  if (!a) return ctx.json(401, { error: 'invalid_token', message: 'Send a valid token as "Authorization: Bearer <token>".' });
  if (!a.scopes.includes(scope)) return ctx.json(403, { error: 'insufficient_scope', message: `This token cannot do that. It needs "${scope}".` });
  const q = Object.fromEntries(ctx.url.searchParams);
  return ctx.json(200, await run(a, q));
}
get('/api/v1/organisations', (ctx) => apiCall(ctx, 'organisations:read', async (a) => ({ data: await api.organisations(a) })));
get('/api/v1/members', (ctx) => apiCall(ctx, 'members:read', (a, q) => api.members(a, q)));
get('/api/v1/events', (ctx) => apiCall(ctx, 'events:read', (a, q) => api.events(a, q)));

// ---- integrations: tokens and webhooks (owner or administrator)
async function integrationsScreen(ctx, org, extra = {}) {
  return ctx.send(extra.status ?? 200, V.integrationsScreen({ me: ctx.me, csrf: ctx.csrf, org,
    tokens: await apiTokens.list(ctx.me.accountId, org.id), ...(await webhooks.list(ctx.me.accountId, org.id)),
    scopes: apiTokens.SCOPES, events: webhooks.EVENTS, origin: originOf(ctx),
    done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...extra }));
}
const integrationsBack = (org, k, t) => `/o/${org.slug}/integrations?${k}=${encodeURIComponent(t)}`;
get('/o/:slug/integrations', async (ctx) => integrationsScreen(ctx, await organisationFor(ctx)));
post('/o/:slug/integrations/tokens', async (ctx) => {
  const org = await organisationFor(ctx);
  const f = await ctx.form();
  try {
    const made = await apiTokens.create(ctx.me.accountId, org.id, { name: f.name, scopes: readScopes(f) });
    return integrationsScreen(ctx, org, { newToken: made.token });
  } catch (e) { if (e instanceof Invalid) return ctx.redirect(integrationsBack(org, 'error', e.message)); throw e; }
});
post('/o/:slug/integrations/tokens/:tokenId/revoke', async (ctx) => {
  const org = await organisationFor(ctx);
  if (!UUID_RE.test(ctx.params.tokenId)) throw new NotFound('Token');
  await ctx.form();
  await apiTokens.revoke(ctx.me.accountId, org.id, ctx.params.tokenId);
  return ctx.redirect(integrationsBack(org, 'done', 'Token revoked. It stops working at once.'));
});
post('/o/:slug/integrations/webhooks', async (ctx) => {
  const org = await organisationFor(ctx);
  const f = await ctx.form();
  try {
    const made = await webhooks.create(ctx.me.accountId, org.id, { url: f.url, events: readEvents(f) });
    return integrationsScreen(ctx, org, { newSecret: made.secret });
  } catch (e) { if (e instanceof Invalid) return ctx.redirect(integrationsBack(org, 'error', e.message)); throw e; }
});
const hookAction = (path, run, text) => post(`/o/:slug/integrations/webhooks/:hookId${path}`, async (ctx) => {
  const org = await organisationFor(ctx);
  if (!UUID_RE.test(ctx.params.hookId)) throw new NotFound('Webhook');
  const f = await ctx.form();
  const out = await run(ctx, org, f);
  return ctx.redirect(integrationsBack(org, 'done', typeof text === 'function' ? text(out) : text));
});
hookAction('/test', (ctx, org) => webhooks.sendTest(ctx.me.accountId, org.id, ctx.params.hookId),
  (r) => r?.status === 'delivered' ? 'The test message was delivered.' : `The test message was not delivered: ${r?.last_error ?? 'no answer'}`);
hookAction('/on', (ctx, org) => webhooks.setActive(ctx.me.accountId, org.id, ctx.params.hookId, true), 'Switched on.');
hookAction('/off', (ctx, org) => webhooks.setActive(ctx.me.accountId, org.id, ctx.params.hookId, false), 'Switched off.');
hookAction('/remove', (ctx, org) => webhooks.remove(ctx.me.accountId, org.id, ctx.params.hookId), 'Removed.');

// ---- the platform: how this installation is doing
get('/platform', async (ctx) => {
  ctx.requireActor();
  const p = push.provider();
  return ctx.send(200, V.platformScreen({ me: ctx.me, csrf: ctx.csrf, ...(await platform.overview(ctx.me.accountId, { provider: providerNow(), pushOn: !!p })) }));
});

// ---- booking a class: the member's side
async function bookScreen(ctx, extra = {}) {
  if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
  return ctx.send(extra.status ?? 200, V.bookScreen({ me: ctx.me, csrf: ctx.csrf, ...(await booking.forPerson(ctx.me.accountId, ctx.params.personId)),
    done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error'), ...extra }));
}
get('/me/:personId/book', async (ctx) => { ctx.requireActor(); return bookScreen(ctx); });
post('/me/:personId/book', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.personId)) throw new NotFound('Person');
  const f = await ctx.form();
  await family.assertMayActFor(ctx.me.accountId, ctx.params.personId);
  const back = (k, t) => ctx.redirect(`/me/${ctx.params.personId}/book?${k}=${encodeURIComponent(t)}`);
  try {
    if (!UUID_RE.test(String(f.sessionId)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(f.date))) throw new Invalid('Choose a class.');
    const r = await booking.book(ctx.me.accountId, ctx.params.personId, f.sessionId, f.date);
    return back('done', r.already ? 'Already booked.' : r.status === 'booked' ? 'You are booked in.' : 'The class is full, so you are on the waiting list. We will tell you if a place opens.');
  } catch (e) { if (e instanceof Invalid) return back('error', e.message); throw e; }
});
post('/me/:personId/book/:bookingId/cancel', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.personId) || !UUID_RE.test(ctx.params.bookingId)) throw new NotFound('Booking');
  await ctx.form();
  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : originOf(ctx);
  await booking.cancel(ctx.me.accountId, ctx.params.personId, ctx.params.bookingId, { notify: { messenger: messengerFrom(), origin, baseFrom: sendingAddress() } });
  return ctx.redirect(`/me/${ctx.params.personId}/book?done=${encodeURIComponent('Cancelled. Thank you for letting us know.')}`);
});

registerShopRoutes({ get, post, organisationFor, UUID_RE });

// ---- notifications on this device
get('/me/notifications', async (ctx) => {
  ctx.requireActor();
  return ctx.send(200, V.notificationsScreen({ me: ctx.me, csrf: ctx.csrf, ...(await push.status(ctx.me.accountId)),
    done: ctx.url.searchParams.get('done') }));
});
post('/push/subscribe', async (ctx) => {
  ctx.requireActor();
  const f = await ctx.form();
  try {
    await push.subscribe(ctx.me.accountId, { endpoint: f.endpoint, p256dh: f.p256dh, auth: f.auth }, ctx.req.headers['user-agent']);
    return ctx.send(200, 'ok');
  } catch (e) { if (e instanceof Invalid) return ctx.send(422, e.message); throw e; }
});
post('/push/unsubscribe', async (ctx) => {
  ctx.requireActor();
  const f = await ctx.form();
  await push.unsubscribe(ctx.me.accountId, f.endpoint);
  return ctx.send(200, 'ok');
});
post('/me/notifications/:deviceId/remove', async (ctx) => {
  ctx.requireActor();
  if (!UUID_RE.test(ctx.params.deviceId)) throw new NotFound('Device');
  await ctx.form();
  await push.removeDevice(ctx.me.accountId, ctx.params.deviceId);
  return ctx.redirect(`/me/notifications?done=${encodeURIComponent('Removed.')}`);
});

get('/me/payments/:paymentId', async (ctx) => { ctx.requireActor(); return payView(ctx); });

post('/me/payments/:paymentId', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  if (!UUID_RE.test(ctx.params.paymentId)) throw new NotFound('Payment');
  try {
    await payments.pay(ctx.me.accountId, ctx.params.paymentId, readPayment(form),
      { provider: providerNow() });
  } catch (e) {
    if (e instanceof Invalid) return payView(ctx, { status: 422, error: e.message });
    throw e;
  }
  return ctx.redirect(`/me/payments/${ctx.params.paymentId}`);
});

post('/me/payments/:paymentId/complete', async (ctx) => {
  ctx.requireActor();
  const form = await ctx.form();
  if (!UUID_RE.test(ctx.params.paymentId)) throw new NotFound('Payment');
  await payments.completeTest(ctx.me.accountId, ctx.params.paymentId, form.ok === '1',
    { provider: providerNow() });
  return ctx.redirect(`/me/payments/${ctx.params.paymentId}`);
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
const MAY_REGISTER = REGISTER;

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
const MAY_PUBLISH = MANAGE;

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

  const render = async (extra = {}) => ctx.send(extra.status ?? 200, V.pageEditor({
    me: ctx.me, org, page, csrf: ctx.csrf, canPublish, images,
    scheduledFor: page ? await pages.scheduledFor(page.id) : null,
    today: new Date().toISOString().slice(0, 10),
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

    if (op === 'schedule' || op === 'unschedule') {
      if (!canPublish) return render({ status: 403, page: saved,
        error: 'Your changes are saved. Scheduling needs an owner or administrator.' });
      if (op === 'schedule') await pages.schedule(ctx.me.accountId, saved.id, String(form.publishOn ?? ''));
      else await pages.unschedule(ctx.me.accountId, saved.id);
      return ctx.redirect(`/o/${org.slug}/pages/${saved.id}?done=`
        + encodeURIComponent(op === 'schedule' ? `Scheduled for ${String(form.publishOn)}.` : 'No longer scheduled.'));
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
    scheduledFor: await pages.scheduledFor(pg.id), today: new Date().toISOString().slice(0, 10),
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
  // things — a taekwondo club's preview must not say "club".
  const root = await lookups.rootOf(org.id);
  const federation = root ?? org;

  const [brand, clubRows, evs] = await Promise.all([
    site.brand(federation.id),
    site.clubs(federation.slug),
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

  const html = renderBlocks(pg.body, { clubs: clubRows, events: evs, assets: previewAssets, enquiryAction: `/enquire/${org.slug}` },
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
  // One person and nothing else matches: that is who was meant, so open them rather than listing one row.
  if (results.length === 1 && results[0].kind === 'person' && ctx.url.searchParams.get('list') !== '1')
    return ctx.redirect(`/p/${results[0].id}`);
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

registerMessageRoutes({ get, post, organisationFor });

// ---- classes and attendance --------------------------------------------------
//
registerBookingRoutes({ get, post, UUID_RE, mayRegisterAt, organisationFor });

registerClubPaymentRoutes({ get, post, UUID_RE, providerNow, organisationFor });

// ---- renewals: the club's own prices, who is due, who is not charged -----------

async function renewalsScreen(ctx, org, extra = {}) {
  const actor = ctx.me.accountId;
  const { today, rows } = await renewals.roster(actor, org.id);
  const canSetPrices = await mayManageAt(ctx, org.id);
  return ctx.send(extra.status ?? 200, V.renewalsScreen({
    me: ctx.me, org, csrf: ctx.csrf, today, rows, prices: await fees.list(actor, org.id),
    auto: await autoRenew.forClub(actor, org.id),
    canSetPrices, canExempt: canSetPrices, reminderText: reminderText('due'),
    autoReminders: await renewals.reminderSetting(org.id),
    done: ctx.url.searchParams.get('done'), ...extra }));
}

get('/o/:slug/renewals', async (ctx) => {
  const org = await organisationFor(ctx);
  if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/clubs`);
  return renewalsScreen(ctx, org);
});

post('/o/:slug/renewals', async (ctx) => {
  const org = await organisationFor(ctx);
  const form = await ctx.form();
  const ids = Object.keys(form).filter((k) => k.startsWith('pick_') && form[k] === '1')
    .map((k) => k.slice(5)).filter((id) => UUID_RE.test(id));
  if (form.action === 'remind') {
    try {
      const made = await renewals.remind(ctx.me.accountId, org.id,
        { affiliationIds: ids, subject: form.subject, body: form.body }, { baseFrom: sendingAddress() });
      await messages.sendBatch(ctx.me.accountId, org.id, made.message.id,
        { messenger: messengerFrom(), origin: originOf(ctx), trusted: true });
      return ctx.redirect(`/o/${org.slug}/messages/${made.message.id}`);
    } catch (e) {
      if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message });
      throw e;
    }
  }
  try {
    const out = await renewals.ask(ctx.me.accountId, org.id,
      { affiliationIds: ids, period: form.period, received: form.received });
    const notes = out.skipped.map((s) => `${s.name}: ${s.reason}`);
    return renewalsScreen(ctx, org, { done: `${out.asked} renewal${out.asked === 1 ? '' : 's'} ${
      form.received ? 'recorded' : 'asked for'}.`, notes });
  } catch (e) {
    if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message });
    throw e;
  }
});

post('/o/:slug/renewals/reminders', async (ctx) => {
  const org = await organisationFor(ctx);
  const form = await ctx.form();
  await renewals.setReminders(ctx.me.accountId, org.id, form.enabled === '1');
  return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent(
    form.enabled === '1' ? 'Automatic reminders are on.' : 'Automatic reminders are off.')}`);
});

registerNewcomerRoutes({ get, post, UUID_RE, organisationFor });

registerReportRoutes({ get, organisationFor });

registerGradingEventRoutes({ get, post, UUID_RE, organisationFor });

registerFormRoutes({ get, post, UUID_RE, organisationFor, mayManageAt });

registerQualificationRoutes({ get, post, UUID_RE, organisationFor, mayManageAt });

registerPublicEntryRoutes({ SESSION_COOKIE, get, post });

// ---- website enquiries -----------------------------------------------------------
//
// The public door is /enquire/:slug. Anybody may post to it; it is protected
// by a same-site check, a hidden honeypot box, rate limits and length limits.

const ipHash = (ip) => crypto.createHmac('sha256', process.env.ENQUIRY_SALT ?? process.env.CRON_SECRET ?? 'honbu')
  .update(String(ip ?? '')).digest('hex').slice(0, 32);

async function enquiryClub(slug) {
  const org = await lookups.activeClub(slug);
  if (!org) throw new NotFound('Organisation');
  return org;
}

get('/enquire/:slug/thanks', async (ctx) => {
  const org = await enquiryClub(ctx.params.slug);
  return ctx.send(200, V.enquiryPage({ csrf: ctx.csrf, club: org.name, sent: true }));
});

get('/enquire/:slug', async (ctx) => {
  const org = await enquiryClub(ctx.params.slug);
  const kind = ctx.url.searchParams.get('kind') === 'trial' ? 'trial' : 'contact';
  return ctx.send(200, V.enquiryPage({ csrf: ctx.csrf, club: org.name, kind, action: `/enquire/${org.slug}` }));
});

post('/enquire/:slug', async (ctx) => {
  const form = await ctx.publicForm();
  const org = await enquiryClub(ctx.params.slug);
  // A robot filled the hidden box. Say thank you and keep nothing.
  if (looksLikeRobot(form)) return ctx.redirect(`/enquire/${org.slug}/thanks`);
  const input = readEnquiry(form);
  try {
    await enquiries.submit({ slug: org.slug, input, ipHash: ipHash(ctx.ip),
      messenger: messengerFrom(), baseFrom: sendingAddress() });
    return ctx.redirect(`/enquire/${org.slug}/thanks`);
  } catch (e) {
    if (e instanceof Invalid || e instanceof TooMany)
      return ctx.send(e.status ?? 422, V.enquiryPage({ csrf: ctx.csrf, club: org.name, kind: input.kind,
        action: `/enquire/${org.slug}`, values: input, error: e.message }));
    throw e;
  }
});

async function enquiriesScreen(ctx, org, extra = {}) {
  return ctx.send(extra.status ?? 200, V.enquiriesScreen({ me: ctx.me, org, csrf: ctx.csrf,
    ...(await enquiries.inbox(ctx.me.accountId, org.id)),
    done: ctx.url.searchParams.get('done'), ...extra }));
}

get('/o/:slug/enquiries', async (ctx) => {
  const org = await organisationFor(ctx, { toRegister: true });
  return enquiriesScreen(ctx, org);
});

post('/o/:slug/enquiries/:id/handled', async (ctx) => {
  const org = await organisationFor(ctx, { toRegister: true });
  const form = await ctx.form();
  if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Enquiry');
  await enquiries.mark(ctx.me.accountId, org.id, ctx.params.id, form.handled === '1');
  return ctx.redirect(`/o/${org.slug}/enquiries`);
});

post('/o/:slug/enquiries/:id/delete', async (ctx) => {
  const org = await organisationFor(ctx, { toRegister: true });
  await ctx.form();
  if (!UUID_RE.test(ctx.params.id)) throw new NotFound('Enquiry');
  await enquiries.remove(ctx.me.accountId, org.id, ctx.params.id);
  return ctx.redirect(`/o/${org.slug}/enquiries?done=${encodeURIComponent('Deleted.')}`);
});

// Scheduled publishing. Same lock as the renewals door.
get('/cron/publish', async (ctx) => {
  const secret = process.env.CRON_SECRET;
  const given = String(ctx.req.headers.authorization ?? '').replace(/^Bearer /, '');
  const a = Buffer.from(given), b = Buffer.from(secret ?? '');
  if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw new Forbidden('Not permitted');
  const made = await scheduledPublishing.run();
  const rebuild = made.length ? await requestRebuild({ reason: `scheduled: ${made.length} item(s)` }) : null;
  return ctx.send(200, `<pre>${JSON.stringify({ published: made, rebuild: rebuild?.detail ?? null }, null, 1).replace(/</g, '&lt;')}</pre>`);
});

// The scheduler's door. Open to nobody without the shared secret, and shut
// entirely when none is configured — "no secret set" must never mean "no lock".
get('/cron/renewals', async (ctx) => {
  const secret = process.env.CRON_SECRET;
  const given = String(ctx.req.headers.authorization ?? '').replace(/^Bearer /, '');
  const a = Buffer.from(given), b = Buffer.from(secret ?? '');
  if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw new Forbidden('Not permitted');
  const autoReport = await autoRenew.run({ provider: providerNow(), messenger: messengerFrom(), baseFrom: sendingAddress(),
    origin: process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : originOf(ctx) });
  const forgotten = await newcomers.purgeStale();
  const enquiriesDeleted = await enquiries.tidy();
  const qualReport = await qualifications.remind({ messenger: messengerFrom(), baseFrom: sendingAddress(),
    origin: process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : originOf(ctx) });
  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : originOf(ctx);
  const report = await reminders.run({ messenger: messengerFrom(), baseFrom: sendingAddress(), origin });
  const termsReport = await terms.run({ messenger: messengerFrom(), baseFrom: sendingAddress(), origin });
  const growthReport = await growth.run({ messenger: messengerFrom(), baseFrom: sendingAddress(), origin, signInLink: signInLinkFor(origin) });
  return ctx.send(200, `<pre>${JSON.stringify({ report, autoRenew: autoReport, qualifications: qualReport, newcomersForgotten: forgotten, enquiriesDeleted, growth: growthReport, terms: termsReport }, null, 1).replace(/</g, '&lt;')}</pre>`);
});

post('/o/:slug/renewals/fees', async (ctx) => {
  const org = await organisationFor(ctx);
  const form = await ctx.form();
  const input = readFee(form);
  try {
    await fees.save(ctx.me.accountId, org.id, input);
    return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent('Price saved.')}`);
  } catch (e) {
    if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message, values: input });
    throw e;
  }
});

post('/o/:slug/renewals/fees/:feeId/remove', async (ctx) => {
  const org = await organisationFor(ctx);
  await ctx.form();
  if (!UUID_RE.test(ctx.params.feeId)) throw new NotFound('Price');
  await fees.remove(ctx.me.accountId, org.id, ctx.params.feeId);
  return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent('Price removed.')}`);
});

post('/o/:slug/renewals/:affiliationId/exempt', async (ctx) => {
  const org = await organisationFor(ctx);
  const form = await ctx.form();
  if (!UUID_RE.test(ctx.params.affiliationId)) throw new NotFound('Member');
  try {
    await renewals.setExemption(ctx.me.accountId, org.id, ctx.params.affiliationId, readExemption(form));
    return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent('Saved.')}`);
  } catch (e) {
    if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message });
    throw e;
  }
});

post('/o/:slug/renewals/:affiliationId/carry-on', async (ctx) => {
  const org = await organisationFor(ctx);
  await ctx.form();
  if (!UUID_RE.test(ctx.params.affiliationId)) throw new NotFound('Member');
  try {
    const until = await renewals.carryOn(ctx.me.accountId, org.id, ctx.params.affiliationId);
    return ctx.redirect(`/o/${org.slug}/renewals?done=${encodeURIComponent(`Carried on to ${until}.`)}`);
  } catch (e) {
    if (e instanceof Invalid) return renewalsScreen(ctx, org, { status: 422, error: e.message });
    throw e;
  }
});

post('/o/:slug/payments/:paymentId/cancel', async (ctx) => {
  const org = await organisationFor(ctx);
  await ctx.form();
  if (!UUID_RE.test(ctx.params.paymentId)) throw new NotFound('Payment');
  await payments.cancel(ctx.me.accountId, org.id, ctx.params.paymentId);
  return ctx.redirect(`/o/${org.slug}/payments?done=${encodeURIComponent('Cancelled.')}`);
});

registerNewClubRoutes({ get, post, organisationFor });

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
    home: await appearance.home(ctx.me.accountId, org.id),
    current: stored ? (readTheme(stored).theme ?? null) : null,
    done: q.get('done'), error: q.get('error'), rebuild: q.get('rebuild'),
    ...extra,
  }));
}

registerSettingsRoutes({ get, post, organisationFor, mayPublishAt, requestRebuild });

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

/**
 * The crest. One picture, set by the federation, used in the site header and on every
 * event banner. It comes from the federation's own image library, or is added here.
 */
post('/o/:slug/appearance/logo', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  if (org.type === 'club') throw new Forbidden('A club uses its federation\'s crest.');
  const { fields, files } = await ctx.upload({ maxBytes: MAX_BYTES + 256 * 1024 });
  const back = `/o/${org.slug}/appearance`;
  try {
    if (!await mayManageAt(ctx, org.id)) throw new Forbidden('Only an owner or administrator can set the crest.');
    let assetId = UUID_RE.test(fields.assetId ?? '') ? fields.assetId : null;
    const file = files.find((f) => f.field === 'logoFile' && f.bytes.length);
    if (file) {
      const created = await assets.create(ctx.me.accountId, org.id, {
        bytes: file.bytes, identified: identify(file.bytes, { filename: file.filename }),
        filename: file.filename, altText: `${org.name} crest` });
      assetId = created.id;
    }
    if (fields.remove) assetId = null;
    else if (!assetId) return ctx.redirect(`${back}?error=${encodeURIComponent('Choose a picture or add one.')}`);
    await appearance.setLogo(ctx.me.accountId, org.id, assetId);
    const rebuild = await requestRebuild({ reason: `crest ${org.slug}` });
    return ctx.redirect(`${back}?done=${encodeURIComponent(assetId ? 'Crest set.' : 'Crest removed.')}&rebuild=${encodeURIComponent(rebuild.detail)}`);
  } catch (e) {
    if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

/**
 * The top of the home page: the big picture, the three lines of words, and the picture that
 * shows when the site is shared. Federation screens only; a club uses its federation's.
 * The permission check comes before the upload is read.
 */
post('/o/:slug/appearance/home', async (ctx) => {
  const org = await organisationFor(ctx, { toWrite: true });
  if (org.type === 'club') throw new Forbidden('A club uses its federation\'s home page.');
  if (!await mayManageAt(ctx, org.id)) throw new Forbidden('Only an owner or administrator can change the home page.');
  const { fields, files } = await ctx.upload({ maxBytes: MAX_BYTES + 256 * 1024 });
  const back = `/o/${org.slug}/appearance`;
  try {
    const change = {
      heroHeading: fields.heroHeading ?? '', heroText: fields.heroText ?? '', heroButton: fields.heroButton ?? '',
    };
    const add = async (field, alt) => {
      const file = files.find((f) => f.field === field && f.bytes.length);
      if (!file) return undefined;
      const identified = identify(file.bytes, { filename: file.filename });
      const created = await assets.create(ctx.me.accountId, org.id, {
        bytes: file.bytes, identified, filename: file.filename, altText: alt });
      return { id: created.id, identified };
    };
    const warnings = [];
    const hero = await add('heroFile', `${org.name} home page`);
    if (hero) { change.heroAssetId = hero.id; warnings.push(...fitFor('hero', hero.identified)); }
    else if (fields.removeHero) change.heroAssetId = null;
    const share = await add('shareFile', `${org.name} link preview`);
    if (share) { change.shareAssetId = share.id; warnings.push(...fitFor('share', share.identified)); }
    else if (fields.removeShare) change.shareAssetId = null;
    await appearance.setHome(ctx.me.accountId, org.id, change);
    const rebuild = await requestRebuild({ reason: `home page ${org.slug}` });
    return ctx.redirect(`${back}?done=${encodeURIComponent(['Home page saved.', ...warnings].join(' '))}&rebuild=${encodeURIComponent(rebuild.detail)}`);
  } catch (e) {
    if (e instanceof NotAnImage || e instanceof BadUpload || e instanceof Invalid)
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
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

registerClubPageRoutes({ get, post, mayPublishAt, organisationFor });

registerInstructorRoutes({ get, post, UUID_RE, organisationFor });

registerNewsRoutes({ get, post, mayPublishAt, slugify, organisationFor });

registerMediaRoutes({ SECURITY_HEADERS, get, post, UUID_RE, organisationFor });

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
 * A club enters its people in the federation's tournament, and it has no role
 * at the federation. So the organisation in the path is the CLUB doing the
 * entering — checked for the registrar role there — and the event is found by
 * looking up the tree from it. Requiring a grant at the host would mean only
 * the federation could ever enter anybody.
 */
async function entryContextFor(ctx) {
  const org = await organisationFor(ctx, { toRegister: true });
  const host = await lookups.eventHost(org.id, ctx.params.eventSlug);
  if (!host) throw new NotFound('Event');

  const { repo } = await calendar();
  const event = await repo.bySlug(host.id, ctx.params.eventSlug);
  if (!event) throw new NotFound('Event');
  return { org, host, event };
}


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
      currency: setup.prices[0]?.currency ?? region().currency }));
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
        currency: setup.prices[0]?.currency ?? region().currency,
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
    entryFeeCents: setup.prices.find((p) => p.for_count === 1 && !p.members_only)?.amount_cents ?? 0,
    canAssign: await mayScheduleAt(ctx, host.id),
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
  }));
});

// Every entry as a spreadsheet: who, how heavy, how old on the day, what grade, which club.
// The same people who may see the list may download it (entriesFor checks the role).
get('/o/:slug/events/:eventSlug/entries.csv', async (ctx) => {
  const { host, event } = await entryContextFor(ctx);
  const entries = await competition.entriesFor(ctx.me.accountId, event.id);
  const start = event.startsAt ?? event.starts_at;
  const zone = host.timezone || DEFAULT_TIMEZONE;
  const eventDay = start
    ? new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(start))
    : null;
  return ctx.download(fileName(event.slug, 'entries', eventDay ?? new Date().toISOString().slice(0, 10)),
    'text/csv', toCsv(ENTRY_COLUMNS, entryRows(entries, eventDay)));
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
  await orgs.enter(org.id);

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
  const [vocabulary, register, write, manage, teach] = await Promise.all([
    orgs.vocabulary(org.id),
    mayRegisterAt(ctx, org.id),
    mayWriteAt(ctx, org.id),
    mayPublishAt(ctx, org.id),
    lookups.hasRole(ctx.me.accountId, org.id, TEACH),
  ]);
  ctx.rail = { org, vocabulary, path: ctx.url.pathname,
               can: { register, write, manage, teach } };
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
const MAY_WRITE = WRITE;

async function mayWriteAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MAY_WRITE);
}

async function mayManageAt(ctx, orgId) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, orgId, MANAGE);
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
  const type = typeFor(readType(form.eventType, eventTypes()), eventTypes());
  return {
    title: form.title?.trim() || (type ? defaultTitle(type.key, eventTypes()) : ''),
    kind: type ? type.kind : form.kind,
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

/** Dollars typed in the form → cents. Blank is free. Returns { cents } or { problem }. */
function readEntryFee(form) {
  const raw = String(form.entryFee ?? '').replace(/[$,\s]/g, '');
  if (!raw) return { cents: 0 };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return { problem: 'The entry fee must be an amount like 0 or 25.00.' };
  return { cents: Math.round(n * 100) };
}
/** Competitions are priced by division, so only the other kinds of event take one flat fee. */
const takesFlatFee = (kind) => !['tournament', 'fight_night'].includes(kind);
const flatFeeOf = async (eventId) =>
  ((await lookups.flatEntryFeeCents(eventId)) / 100).toFixed(2).replace(/\.00$/, '');

const detailAsForm = (d) => d ? { eventType: d.type_key ?? '', contactName: d.contact_name ?? '', contactEmail: d.contact_email ?? '',
  contactPhone: d.contact_phone ?? '', costNote: d.cost_note ?? '', infoUrl: d.info_url ?? '', description: d.description ?? '',
  latitude: d.latitude ?? '', longitude: d.longitude ?? '' } : {};

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
    values: { kind: 'training', visibility: 'public', publishDown: org.type !== 'club' },
  }));
});

post('/o/:slug/events/new', async (ctx) => {
  const org = await organisationFor(ctx, { toSchedule: true });
  const form = await ctx.form();
  const { schedule } = await calendar();

  try {
    const detail = eventDetails.read(form);
    if (detail.problems.length) throw Object.assign(new Error(detail.problems.join(' ')), { status: 422 });
    const declared = problemWithDeclaration(eventFieldsFrom(form, org.timezone).kind, form.consentVersion?.trim());
    if (declared) throw Object.assign(new Error(declared), { status: 422 });
    const fee = readEntryFee(form);
    if (fee.problem) throw Object.assign(new Error(fee.problem), { status: 422 });
    const saved = await schedule.execute({
      actorId: ctx.me.accountId, organisationId: org.id,
      ...eventFieldsFrom(form, org.timezone),
      status: form.status === 'published' ? 'published' : 'draft',
    });
    await eventDetails.save(saved.id, detail.d);
    if (takesFlatFee(saved.kind)) await competition.setPrice(ctx.me.accountId, saved.id, { forCount: 1, amountCents: fee.cents, label: 'Entry fee' });
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
    values: { ...eventAsForm(event, org.timezone), ...detailAsForm(await eventDetails.forEvent(event.id)), entryFee: await flatFeeOf(event.id) },
  }));
});

post('/o/:slug/events/:eventSlug/edit', async (ctx) => {
  const org = await organisationFor(ctx, { toSchedule: true });
  const form = await ctx.form();
  const { repo, revise } = await calendar();

  const existing = await repo.bySlug(org.id, ctx.params.eventSlug);
  if (!existing) throw new NotFound('Event');

  try {
    const detail = eventDetails.read(form);
    if (detail.problems.length) throw Object.assign(new Error(detail.problems.join(' ')), { status: 422 });
    const declared = problemWithDeclaration(eventFieldsFrom(form, org.timezone).kind, form.consentVersion?.trim());
    if (declared) throw Object.assign(new Error(declared), { status: 422 });
    const fee = readEntryFee(form);
    if (fee.problem) throw Object.assign(new Error(fee.problem), { status: 422 });
    const saved = await revise.execute({
      actorId: ctx.me.accountId, eventId: existing.id,
      ...eventFieldsFrom(form, org.timezone),
      status: form.status,
    });
    await eventDetails.save(existing.id, detail.d);
    if (takesFlatFee(saved.kind)) await competition.setPrice(ctx.me.accountId, existing.id, { forCount: 1, amountCents: fee.cents, label: 'Entry fee' });
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

/** Each request carries its own region (currency, language, age of adulthood), so two at once never mix. */
export const handler = (req, res) => withRegion(() => handle(req, res));

async function handle(req, res) {
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
     * A form anybody on the web may post — the website's contact form.
     * There is no session to forge, so no CSRF token; what stands in for it
     * is that the post must come from this site's own pages.
     */
    async publicForm() {
      if (!sameSite(req.headers)) throw new Forbidden('That form must be sent from this site.');
      return readForm(req);
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
      if (typeof html === 'string' && html.includes(V.MENU_BUTTON_MARKER))
        html = html.replace(V.MENU_BUTTON_MARKER, () => this.rail ? V.menuButton(this.rail) : '');
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        // Pages answered here are about the person looking at them. No shared cache keeps one, and the
        // service worker reads this to know what it may and may not store (vendor/honbu/sw.js).
        'cache-control': 'private, no-store',
        ...SECURITY_HEADERS,
        ...(setCookies.length ? { 'set-cookie': setCookies } : {}),
      });
      res.end(html);
    },

    /** JSON for programs, not people: never cached, and the same security headers as everything else. */
    json(status, body) {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS });
      res.end(JSON.stringify(body));
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
  if (ctx.me?.home?.id) await orgs.enter(ctx.me.home.id);

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
    // a club slug does not break every link that points at it.
    const moved = await lookups.redirectFor(url.pathname);
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
