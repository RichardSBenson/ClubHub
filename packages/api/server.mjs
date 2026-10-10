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

import { STARTER_DECLARATION } from '../core/domain/declarations.mjs';
import { nextGrading } from '../core/domain/next-grading.mjs';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { lookups, declarations, photos, instructorRole, orgs, people, rank, competition, instructors, memberDocuments, audit, cards, checkin, family, myself, memberEvents, payments, attendance, forms, autoRenew, booking, push, apiTokens, api, platform, portal, TooMany, trials, referrals, growth, clubMailer, terms, Forbidden, NotFound, Invalid } from './data.mjs';
import * as auth from './auth.mjs';
import * as V from './views.mjs';
import { qrSvg } from '../core/domain/qr.mjs';
import { CHECKIN_REFRESH_SECONDS } from './card-token.mjs';
import { readTrialSignup, normaliseCode } from '../core/domain/growth.mjs';
import { repeatFromLast, decideQuick } from '../core/domain/repeat-entry.mjs';
import { looksLikeRobot, sameSite } from '../core/domain/enquiry.mjs';
import { paymentProviderFrom, isTestProvider } from '../infrastructure/payments/providers.mjs';
import { currentStore } from '../infrastructure/factory.mjs';
import { messengerFrom } from '../infrastructure/messaging/messengers.mjs';
import { SendSignInLink } from '../core/application/send-sign-in-link.mjs';
import { readMultipart, BadUpload } from './multipart.mjs';
import { fitFor } from '../content/image-slots.mjs';
import { isPdf, MAX_DOCUMENT_BYTES } from '../core/domain/documents.mjs';
import { identify, NotAnImage, MAX_BYTES } from '../content/images.mjs';
import { Competitor, placeEntry, priceFor, consentNeeded, problemsWithConsent } from '../core/domain/competition.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';
import { registerSettingsRoutes } from './routes-settings.mjs';
import { registerShopRoutes } from './routes-shop.mjs';
import { DEFAULT_TIMEZONE } from '../core/domain/defaults.mjs';
import { region, withRegion } from '../infrastructure/region-context.mjs';
import { sendingAddress, originOf, memberFieldsFrom, slugify, ipHash } from './route-helpers.mjs';
import { registerMediaRoutes } from './routes-media.mjs';
import { registerNewsRoutes } from './routes-news.mjs';
import { registerInstructorRoutes } from './routes-instructors.mjs';
import { registerClubPageRoutes } from './routes-club-pages.mjs';
import { registerNewClubRoutes } from './routes-new-club.mjs';
import { registerClubPaymentRoutes } from './routes-club-payments.mjs';
import { registerBookingRoutes } from './routes-bookings.mjs';
import { registerMessageRoutes } from './routes-messages.mjs';
import { mayRegisterAt, mayPublishAt, calendar, organisationFor, mayManageAt, gradesFor } from './access.mjs';
import { registerEventRoutes } from './routes-events.mjs';
import { registerGradingRoutes } from './routes-grading.mjs';
import { registerImportRoutes } from './routes-import.mjs';
import { registerInviteRoutes } from './routes-invites.mjs';
import { registerEntryListRoutes } from './routes-entry-list.mjs';
import { registerClubDetailRoutes } from './routes-club-details.mjs';
import { registerSiteMenuRoutes } from './routes-site-menu.mjs';
import { registerAuditRoutes } from './routes-audit.mjs';
import { registerSearchRoutes } from './routes-search.mjs';
import { registerNotificationRoutes } from './routes-notifications.mjs';
import { registerIntegrationRoutes } from './routes-integrations.mjs';
import { eventFor, dayOf, engineSetupFor, entryContextFor } from './event-context.mjs';
import { registerCompetitorRoutes } from './routes-competitors.mjs';
import { registerCompetitionRoutes } from './routes-competition.mjs';
import { registerWebsiteRoutes } from './routes-website.mjs';
import { registerMemberRoutes } from './routes-members.mjs';
import { registerCronRoutes } from './routes-cron.mjs';
import { registerEnquiryRoutes } from './routes-enquiries.mjs';
import { registerAppearanceRoutes } from './routes-appearance.mjs';
import { registerPaymentActionRoutes } from './routes-payment-actions.mjs';
import { registerRenewalRoutes } from './routes-renewals.mjs';
import { registerNewcomerRoutes } from './routes-newcomers.mjs';
import { registerReportRoutes } from './routes-reports.mjs';
import { registerGradingEventRoutes } from './routes-grading-events.mjs';
import { registerFormRoutes } from './routes-forms.mjs';
import { registerQualificationRoutes } from './routes-qualifications.mjs';
import { registerPublicEntryRoutes } from './routes-public-entry.mjs';

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
// The roll used to live at /roster; old bookmarks and links still land on it.
get('/o/:slug/roster', async (ctx) => ctx.redirect(`/o/${ctx.params.slug}/roll${ctx.url.search}`));

get('/o/:slug/roll', async (ctx) => {
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

registerIntegrationRoutes({ get, post, UUID_RE });

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

registerNotificationRoutes({ get, post, UUID_RE, providerNow, payView });

registerMemberRoutes({ get, post });

registerWebsiteRoutes({ get, post });

registerSearchRoutes({ get });

registerAuditRoutes({ get });

registerSiteMenuRoutes({ get, post });

registerClubDetailRoutes({ get, post });

registerMessageRoutes({ get, post, organisationFor });

// ---- classes and attendance --------------------------------------------------
//
registerBookingRoutes({ get, post, UUID_RE, mayRegisterAt, organisationFor });

registerClubPaymentRoutes({ get, post, UUID_RE, providerNow, organisationFor });

registerRenewalRoutes({ get, post, UUID_RE });

registerNewcomerRoutes({ get, post, UUID_RE, organisationFor });

registerReportRoutes({ get, organisationFor });

registerGradingEventRoutes({ get, post, UUID_RE, organisationFor });

registerFormRoutes({ get, post, UUID_RE, organisationFor, mayManageAt });

registerQualificationRoutes({ get, post, UUID_RE, organisationFor, mayManageAt });

registerPublicEntryRoutes({ SESSION_COOKIE, get, post });

registerEnquiryRoutes({ get, post, UUID_RE });

// Scheduled publishing. Same lock as the renewals door.
registerCronRoutes({ get, signInLinkFor, providerNow });

registerPaymentActionRoutes({ post, UUID_RE });


registerNewClubRoutes({ get, post, organisationFor });

registerSettingsRoutes({ get, post, organisationFor, mayPublishAt, requestRebuild });

registerAppearanceRoutes({ get, post, UUID_RE });

registerClubPageRoutes({ get, post, mayPublishAt, organisationFor });

registerInstructorRoutes({ get, post, UUID_RE, organisationFor });

registerNewsRoutes({ get, post, mayPublishAt, slugify, organisationFor });

registerMediaRoutes({ SECURITY_HEADERS, get, post, UUID_RE, organisationFor });

registerCompetitionRoutes({ get, post });

registerCompetitorRoutes({ get, post });

registerEntryListRoutes({ get, post, eventFor, entryContextFor });

registerInviteRoutes({ post });

registerImportRoutes({ get, post, memberFieldsFrom });

registerGradingRoutes({ get, post });

registerEventRoutes({ get, post });

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
