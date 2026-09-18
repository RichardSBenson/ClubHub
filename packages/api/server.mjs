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
 * Exports `handler(req, res)` for Vercel's Node runtime, and starts a listener
 * when run directly.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { pool, orgs, people, rank, events, Forbidden, NotFound, Invalid }
  from './data.mjs';
import * as auth from './auth.mjs';
import * as V from './views.mjs';

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

get('/signin', async (ctx) => ctx.send(200, V.signIn({
  sent: ctx.url.searchParams.get('sent'), csrf: ctx.csrf })));

post('/signin', async (ctx) => {
  const form = await ctx.form();
  try {
    const { token } = await auth.requestLink(form.email, { ip: ctx.ip });
    if (token && process.env.NODE_ENV !== 'production')
      console.log(`  sign-in link for ${form.email}: /signin/${token}`);
  } catch (e) {
    if (e.status === 429)
      return ctx.send(429, V.signIn({ error: e.message, csrf: ctx.csrf }));
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
  return ctx.send(200, V.dashboard({ me: ctx.me, orgs: rows, csrf: ctx.csrf }));
});

// ---- roster ---------------------------------------------------------------

get('/o/:slug/roster', async (ctx) => {
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');
  const roster = await people.roster(ctx.me.accountId, org.id,
    { subtree: org.type !== 'dojo' });
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
    { subtree: org.type !== 'dojo' });

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

get('/o/:slug/events', async (ctx) => {
  ctx.requireActor();
  const org = await orgs.bySlug(ctx.params.slug);
  if (!org) throw new NotFound('Organisation');
  const list = await events.forOrg(org.slug, { isMember: true, viewerRankOrder: 99 });
  return ctx.send(200, V.events({ me: ctx.me, org, events: list, csrf: ctx.csrf }));
});

// ---------------------------------------------------------------------------
// the request
// ---------------------------------------------------------------------------

export async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
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

export const createServer = () => http.createServer(handler);
export default handler;

if (process.argv[1]?.endsWith('server.mjs')) {
  const port = +(process.env.PORT ?? 8080);
  createServer().listen(port, () =>
    console.log(`honbu admin on http://localhost:${port}`));
}
