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
import { pool, orgs, people, rank, events, Forbidden, NotFound, Invalid }
  from './data.mjs';
import * as auth from './auth.mjs';
import * as V from './views.mjs';
import { currentStore } from '../infrastructure/factory.mjs';
import { messengerFrom } from '../infrastructure/messaging/messengers.mjs';
import { SendSignInLink } from '../core/application/send-sign-in-link.mjs';
import { ScheduleEvent, ReviseEvent, CancelEvent, MAY_SCHEDULE }
  from '../core/application/schedule-event.mjs';
import { repositories } from '../infrastructure/factory.mjs';
import { toInstant, toLocalInput } from './zones.mjs';

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

const routes = [];
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
  const { rows } = await pool.query(`
    select o.id, o.name, o.slug, o.type,
           (select count(*) from affiliation a
             where a.organisation_id = o.id and a.ends is null
               and a.role = 'member' and a.status = 'active') as members
    from visible_orgs($1) v
    join organisation o on o.id = v.organisation_id
    order by o.type, o.name`, [ctx.me.accountId]);
  const vocabulary = await orgs.vocabulary(ctx.me.home?.id ?? rows[0]?.id);
  return ctx.send(200,
    V.dashboard({ me: ctx.me, orgs: rows, csrf: ctx.csrf, vocabulary }));
});

// ---- roster ---------------------------------------------------------------

get('/o/:slug/roster', async (ctx) => {
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');
  const roster = await people.roster(ctx.me.accountId, org.id,
    { subtree: !(org.type === 'club' || org.type === 'dojo') });
  return ctx.send(200, V.roster({ me: ctx.me, org, roster, csrf: ctx.csrf }));
});

// ---- one person -----------------------------------------------------------

get('/p/:id', async (ctx) => {
  ctx.requireActor();
  const record = await people.record(ctx.me.accountId, ctx.params.id);
  const fed = await orgs.bySlug('moknz');
  const eligibility = await rank.eligibility(ctx.params.id, fed.id);
  return ctx.send(200, V.person({ me: ctx.me, ...record, eligibility, csrf: ctx.csrf }));
});

// ---- grading --------------------------------------------------------------

get('/o/:slug/grading', async (ctx) => {
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');
  const fed = await orgs.bySlug('moknz');
  const roster = await people.roster(ctx.me.accountId, org.id,
    { subtree: !(org.type === 'club' || org.type === 'dojo') });

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
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');
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
async function organisationFor(ctx, { toSchedule = false } = {}) {
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');

  if (!ctx.me.scope?.some((o) => o.id === org.id))
    throw new Forbidden(`You do not have access to ${org.name}.`);

  if (toSchedule && !await mayScheduleAt(ctx, org)) {
    throw new Forbidden(
      `You can see ${org.name}'s calendar but not change it. `
      + 'Adding and editing events needs an owner, administrator or '
      + 'registrar role there.');
  }
  return org;
}

/** Whether this actor may put something on that calendar. */
async function mayScheduleAt(ctx, org) {
  const { authz } = await calendar();
  return authz.hasRoleAt(ctx.me.accountId, org.id, MAY_SCHEDULE);
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
    publishUp: !!form.publishUp,
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
    canSchedule: await mayScheduleAt(ctx, org),
    done: ctx.url.searchParams.get('done'),
    error: ctx.url.searchParams.get('error'),
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
    return ctx.redirect(`/o/${org.slug}/events?done=`
      + encodeURIComponent(`"${saved.title}" saved.`));
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
    return ctx.redirect(`/o/${org.slug}/events?done=`
      + encodeURIComponent(`"${saved.title}" updated.`));
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
  return ctx.redirect(`/o/${org.slug}/events?done=`
    + encodeURIComponent(`"${existing.title}" is cancelled.`));
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

    send(status, html) {
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        ...SECURITY_HEADERS,
        ...(setCookies.length ? { 'set-cookie': setCookies } : {}),
      });
      res.end(html);
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
