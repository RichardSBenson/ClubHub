/**
 * HONBU — authentication
 *
 * Emailed sign-in links, no passwords.
 *
 * Volunteer organisations forget passwords, and a reset flow is a support
 * burden nobody signed up for. The same mechanism handles a dojo operator
 * logging in once a month and a member checking their grade once a year.
 *
 * Security notes that matter:
 *  - Tokens are stored hashed. A database dump does not let anyone in.
 *  - Requesting a link tells you nothing about whether the address exists.
 *  - Links are single use and short lived.
 *  - Comparison is constant time.
 */

import crypto from 'node:crypto';
import { pool, NotFound, Forbidden } from './data.mjs';

const q = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await q(t, p))[0] ?? null;

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const LINK_TTL_MINUTES = 15;
export const SESSION_TTL_DAYS = 30;
const MAX_LINKS_PER_HOUR = 5;

export class RateLimited extends Error {
  constructor(msg = 'Too many sign-in attempts. Try again shortly.') {
    super(msg); this.status = 429;
  }
}

// ---------------------------------------------------------------------------
// signing in
// ---------------------------------------------------------------------------

/**
 * Always reports success, whether or not the address is known. An endpoint that
 * says "no such account" is a membership list anyone can enumerate — and for a
 * federation whose members include children, that list matters.
 *
 * Returns the raw token ONLY when a link was actually created, for the caller
 * to email. Never log it.
 */
export async function requestLink(email, { ip = null, redirectTo = null } = {}) {
  const recent = await one(`
    select count(*)::int as n from login_attempt
    where email = $1 and at > now() - interval '1 hour'`, [email]);

  if (recent.n >= MAX_LINKS_PER_HOUR) {
    await pool.query(
      `insert into login_attempt (email, ip, outcome) values ($1,$2,'rate_limited')`,
      [email, ip]);
    throw new RateLimited();
  }

  const account = await one('select id from account where email = $1', [email]);

  if (!account) {
    await pool.query(
      `insert into login_attempt (email, ip, outcome) values ($1,$2,'unknown_email')`,
      [email, ip]);
    return { sent: true, token: null };      // deliberately indistinguishable
  }

  const raw = token();
  await pool.query(`
    insert into login_link (account_id, token_hash, expires_at, requested_ip, redirect_to)
    values ($1,$2, now() + ($3 || ' minutes')::interval, $4, $5)`,
    [account.id, hash(raw), String(LINK_TTL_MINUTES), ip, redirectTo]);

  await pool.query(
    `insert into login_attempt (email, ip, outcome) values ($1,$2,'sent')`,
    [email, ip]);

  return { sent: true, token: raw, expiresInMinutes: LINK_TTL_MINUTES };
}

/** Exchanges a link for a session. Single use. */
export async function redeemLink(raw, { userAgent = null, ip = null } = {}) {
  const link = await one(`
    select * from login_link where token_hash = $1`, [hash(String(raw))]);

  if (!link) throw new Forbidden('That sign-in link is not valid');
  if (link.used_at) throw new Forbidden('That sign-in link has already been used');
  if (new Date(link.expires_at) < new Date())
    throw new Forbidden('That sign-in link has expired. Request another.');

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('update login_link set used_at = now() where id = $1', [link.id]);

    const raw2 = token(48);
    const { rows: [session] } = await client.query(`
      insert into session (account_id, token_hash, expires_at, user_agent, ip, kind)
      values ($1,$2, now() + ($3 || ' days')::interval, $4,$5,'normal')
      returning id, account_id, expires_at`,
      [link.account_id, hash(raw2), String(SESSION_TTL_DAYS), userAgent, ip]);

    await client.query('update account set last_seen_at = now() where id = $1',
      [link.account_id]);
    await client.query('commit');

    return { token: raw2, session, redirectTo: link.redirect_to };
  } catch (e) { await client.query('rollback'); throw e; }
  finally { client.release(); }
}

// ---------------------------------------------------------------------------
// using a session
// ---------------------------------------------------------------------------

/**
 * Resolves a session token into an actor, with everything a request needs:
 * who they are, and what they may act on.
 */
export async function currentActor(raw) {
  if (!raw) return null;

  const row = await one(`
    select s.id as session_id, s.account_id, s.expires_at, s.revoked_at, s.kind,
           a.email, p.id as person_id, p.first_name, p.last_name, p.display_number
    from session s
    join account a on a.id = s.account_id
    left join person p on p.id = a.person_id
    where s.token_hash = $1`, [hash(String(raw))]);

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // Cheap enough to do on every request, and it powers "last seen".
  await pool.query('update session set last_seen_at = now() where id = $1',
    [row.session_id]);

  const grants = await q(`
    select gr.role, o.id, o.name, o.slug, o.type
    from grant_role gr join organisation o on o.id = gr.organisation_id
    where gr.account_id = $1`, [row.account_id]);

  const scope = await q(`
    select o.id, o.name, o.slug, o.type
    from visible_orgs($1) v join organisation o on o.id = v.organisation_id
    order by o.path`, [row.account_id]);

  return {
    accountId: row.account_id,
    sessionId: row.session_id,
    kind: row.kind ?? 'normal',
    isDemo: row.kind === 'demo',
    personId: row.person_id,
    email: row.email,
    name: row.first_name ? `${row.first_name} ${row.last_name}` : row.email,
    memberNumber: row.display_number,
    grants,
    scope,
    /** Sugar for the UI: the highest thing they can act on. */
    home: scope[0] ?? null,
    can(role, orgId) {
      return grants.some((g) => g.role === role && g.id === orgId);
    },
  };
}

export async function signOut(raw) {
  const r = await pool.query(
    `update session set revoked_at = now()
     where token_hash = $1 and revoked_at is null returning id`, [hash(String(raw))]);
  return r.rowCount > 0;
}

/** Sign out everywhere — the "I lost my phone" button. */
export async function signOutAll(accountId) {
  const r = await pool.query(
    `update session set revoked_at = now()
     where account_id = $1 and revoked_at is null returning id`, [accountId]);
  return r.rowCount;
}

export async function sessionsFor(accountId) {
  return q(`
    select id, created_at, last_seen_at, expires_at, user_agent, ip,
           revoked_at is not null as revoked
    from session where account_id = $1 order by created_at desc`, [accountId]);
}

/** Housekeeping. Run nightly. */
export async function purgeExpired() {
  const a = await pool.query(`delete from login_link
    where expires_at < now() - interval '1 day' returning id`);
  const b = await pool.query(`delete from session
    where expires_at < now() - interval '30 days' returning id`);
  const c = await pool.query(`delete from login_attempt
    where at < now() - interval '30 days' returning id`);
  return { links: a.rowCount, sessions: b.rowCount, attempts: c.rowCount };
}

// ---------------------------------------------------------------------------
// the email
// ---------------------------------------------------------------------------

export function signInEmail({ name, link, federation, minutes = LINK_TTL_MINUTES }) {
  const subject = `Sign in to ${federation}`;
  const text = [
    name ? `Kia ora ${name},` : 'Kia ora,', '',
    `Here is your sign-in link for ${federation}:`, '',
    link, '',
    `It works once, and expires in ${minutes} minutes.`, '',
    `If you did not ask for this, you can ignore it — nobody can sign in`,
    `without the link.`,
  ].join('\n');
  return { subject, text };
}

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

/**
 * A way in before email works.
 *
 * Sign-in normally means emailing a link. Until a mail provider is wired up
 * nobody can get in at all — including whoever is setting the system up. This
 * closes that gap and nothing else.
 *
 * Deliberately narrow:
 *  - Off unless HONBU_BOOTSTRAP is set, and refused if the value is short.
 *  - Compared in constant time.
 *  - Only ever signs in an account that already holds a role. It creates
 *    nothing, and grants nothing.
 *  - Every use is recorded, and the session is short.
 *
 * Delete the environment variable once email is working. The code can stay —
 * with no variable set, the route does not exist.
 */

const BOOTSTRAP_TTL_DAYS = 2;
const MIN_SECRET_LENGTH = 24;

export function bootstrapEnabled() {
  const s = process.env.HONBU_BOOTSTRAP;
  return typeof s === 'string' && s.length >= MIN_SECRET_LENGTH;
}

export async function bootstrapSignIn(supplied, { userAgent = null, ip = null } = {}) {
  const secret = process.env.HONBU_BOOTSTRAP;

  if (!bootstrapEnabled()) {
    if (typeof secret === 'string' && secret.length)
      throw new Forbidden(
        `HONBU_BOOTSTRAP must be at least ${MIN_SECRET_LENGTH} characters. ` +
        'A short one is worse than none.');
    throw new Forbidden('Not available');
  }

  const a = Buffer.from(String(supplied ?? ''));
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await pool.query(
      `insert into login_attempt (email, ip, outcome) values ($1,$2,'unknown_email')`,
      ['bootstrap', ip]);
    throw new Forbidden('Not available');
  }

  // The most senior account that already has a role. Never creates one, so a
  // leaked secret cannot mint an administrator out of nothing.
  const account = await one(`
    select a.id, a.email, p.first_name, p.last_name
    from grant_role gr
    join account a on a.id = gr.account_id
    left join person p on p.id = a.person_id
    join organisation o on o.id = gr.organisation_id
    order by case gr.role when 'owner' then 0 when 'administrator' then 1 else 2 end,
             nlevel(o.path)
    limit 1`);

  if (!account)
    throw new Forbidden(
      'No account holds a role yet. Load the seed data, or grant a role in SQL, ' +
      'before using bootstrap.');

  const raw = token(48);
  await pool.query(`
    insert into session (account_id, token_hash, expires_at, user_agent, ip, kind)
    values ($1,$2, now() + ($3 || ' days')::interval, $4, $5, 'bootstrap')`,
    [account.id, hash(raw), String(BOOTSTRAP_TTL_DAYS),
     `bootstrap: ${userAgent ?? 'unknown'}`, ip]);

  await pool.query(
    `insert into login_attempt (email, ip, outcome) values ($1,$2,'sent')`,
    [`bootstrap:${account.email}`, ip]);

  console.warn(`BOOTSTRAP SIGN-IN used for ${account.email} from ${ip ?? 'unknown'}`);

  return { token: raw, account, expiresInDays: BOOTSTRAP_TTL_DAYS };
}

// ---------------------------------------------------------------------------
// demonstration access
// ---------------------------------------------------------------------------

/**
 * A way into a demonstration federation's register with no account at all.
 *
 * A federation on the other side of the world should be able to open a link
 * and look around without booking a call. What they get is a real session
 * against real code — the same routes, the same queries — scoped to a
 * federation that exists only to be looked at.
 *
 * Three things keep it safe, and the first two are the ones that matter:
 *
 *  - Only a federation whose own record says demo:true can be opened this
 *    way. MOKNZ is not one, so no URL reaches it.
 *  - The session is marked 'demo', and the server refuses every write on a
 *    demo session regardless of role. A route added next year inherits that.
 *  - Visibility is by grant, and the grant is at the demo federation, so the
 *    subtree query cannot reach anybody else's records.
 *
 * Short-lived, because a demo session left open in a hotel lobby should not
 * still work tomorrow.
 */
const DEMO_TTL_HOURS = 8;

export async function demoSignIn(slug, { userAgent = null, ip = null } = {}) {
  const federation = await one(`
    select id, name, slug
    from organisation
    where slug = $1
      and parent_id is null
      and coalesce((settings->>'demo')::boolean, false)`, [String(slug ?? '')]);

  if (!federation)
    throw new NotFound('There is no demonstration at that address.');

  // The account that the demo signs in as. Created on first use so that
  // seeding a demo federation is all anyone has to do.
  const email = `demo+${federation.slug}@example.invalid`;

  const account = await one(`
    insert into account (email)
    values ($1)
    on conflict (email) do update set email = excluded.email
    returning id, email`, [email]);

  // Instructor, not administrator: even with the write block lifted by
  // accident, an instructor cannot award a grade or publish a page.
  await pool.query(`
    insert into grant_role (account_id, organisation_id, role)
    values ($1, $2, 'instructor')
    on conflict (account_id, organisation_id, role) do nothing`,
    [account.id, federation.id]);

  const raw = token(48);
  await pool.query(`
    insert into session (account_id, token_hash, expires_at, user_agent, ip, kind)
    values ($1, $2, now() + ($3 || ' hours')::interval, $4, $5, 'demo')`,
    [account.id, hash(raw), String(DEMO_TTL_HOURS),
     `demo: ${userAgent ?? 'unknown'}`, ip]);

  return { token: raw, federation, expiresInHours: DEMO_TTL_HOURS };
}
