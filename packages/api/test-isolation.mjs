/**
 * ORGANISATION ISOLATION — proved, not hoped for
 *
 * Section 1, item 2 of the build list. The tree scopes everything: a grant at
 * an organisation reaches its subtree and nowhere else, enforced by
 * has_role_at and visible_orgs. That is a good design and it is enforced
 * PER QUERY, by each route remembering to scope itself — which works right up
 * until one forgets, and then fails silently rather than loudly.
 *
 * It has already forgotten once. GET /o/:slug/events had no permission check
 * at all: any signed-in member of any club could read any other club's
 * calendar, drafts included, by typing its slug. The writes were protected;
 * the read was wide open. It was found by accident, because a test happened
 * to sign in as the wrong person.
 *
 * So this walks the server's OWN route table and probes every entry as
 * somebody with no business at the organisation in the path. Three
 * properties, in order of how much they matter:
 *
 *   1. Nothing is readable.   A refusal, never somebody else's data.
 *   2. Nothing is writable.   The row counts do not move.
 *   3. Nothing is unclassified. A route in neither list fails the test, so
 *      a route added next year cannot slip in without somebody deciding
 *      whether it is public.
 *
 * The third is what makes this a guard rather than a snapshot.
 */

import './reset.mjs';
import http from 'node:http';
import handler, { routes } from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';

const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const jar = {};
async function req(path, { method = 'GET', form } = {}) {
  const headers = {};
  const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (c) headers.cookie = c;
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + path, {
    method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
               : undefined,
  });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}

const q = async (sql, a = []) => (await pool.query(sql, a)).rows;
const one = async (sql, a = []) => (await q(sql, a))[0] ?? null;

// ---------------------------------------------------------------------------
// which routes are open to anybody, and why
// ---------------------------------------------------------------------------

/**
 * Deliberately public. Every one of these is a door somebody has to be able
 * to reach without already being inside, and each is listed with the reason
 * so that adding to this list is a decision rather than a shortcut.
 */
const PUBLIC = new Map([
  ['GET /', 'sends you to sign in or to your dashboard'],
  ['GET /admin', 'the same'],
  ['GET /signin', 'the way in'],
  ['POST /signin', 'asking for a link; reveals nothing about who is registered'],
  ['GET /signin/:token', 'redeeming a link; the token is the authorisation'],
  ['GET /bootstrap/:secret', 'the temporary way in before email works'],
  ['GET /try/:slug', 'the demonstration; refuses any federation not marked demo'],
  ['POST /signout', 'leaving must always work'],
  ['GET /dashboard', 'shows only what the signer-in may see'],
  ['GET /cron/renewals', 'the scheduler; refuses without the shared secret and when none is configured'],
  ['GET /unsubscribe/:token', 'the link in an email; the token is the authorisation and it shows only a setting'],
  ['POST /unsubscribe/:token', 'turning off announcements; the token is the authorisation'],
]);

// ---------------------------------------------------------------------------
// the actor, and what is not theirs
// ---------------------------------------------------------------------------

console.log('\nSETTING UP: SOMEBODY WITH A GRANT AT EXACTLY ONE CLUB');

const mine = await one(`select * from organisation where slug = 'wellington'`);
const theirs = await one(`select * from organisation where slug = 'whanganui'`);
const federation = await one(`select * from organisation where parent_id is null`);

const theirEvent = await one(`
  select e.* from event e where e.organisation_id = $1 limit 1`, [theirs.id]);
const theirPage = await one(`
  select p.* from page p where p.organisation_id = $1 limit 1`, [theirs.id])
  ?? await one(`
  insert into page (organisation_id, slug, title, body, status)
  values ($1,'private-notes','Private notes',
    '{"blocks":[{"type":"paragraph","text":"Committee only."}]}'::jsonb,'draft')
  returning *`, [theirs.id]);
const theirMessage = await one(`
  insert into message (organisation_id, kind, audience, subject, body, sender_name, sender_address, reply_to)
  values ($1,'announcement','members','Private committee notice','Not for anyone else.',
          'Whanganui','whanganui@example.nz','w@example.nz') returning *`, [theirs.id]);
const theirPerson = await one(`
  select p.* from affiliation a join person p on p.id = a.person_id
  where a.organisation_id = $1 and a.ends is null limit 1`, [theirs.id]);

// A real guardian link of theirs, so the probe on ending one asks for something
// that exists.
const theirGuardian = await one(`
  select p.* from affiliation a join person p on p.id = a.person_id
  where a.organisation_id = $1 and a.ends is null and p.id <> $2 limit 1`,
  [theirs.id, theirPerson.id]);
const theirLink = await one(`
  insert into guardian_link (guardian_id, child_id) values ($1,$2) returning *`,
  [theirGuardian.id, theirPerson.id]);

// A real article of theirs, so the probe asks for something that exists.
const theirArticle = await one(`
  insert into article (organisation_id, slug, title, summary, body, status)
  values ($1,'committee-only','Committee only','Not for the federation',
    '{"blocks":[{"type":"paragraph","text":"Internal."}]}'::jsonb,'draft')
  returning *`, [theirs.id]);

// A real image belonging to them, with real bytes behind it. Probing /a/ with
// a made-up id proves only that the route 404s on nonsense.
const theirAsset = await one(`
  insert into asset (organisation_id, kind, filename, mime, width, height,
                     bytes, alt_text)
  values ($1,'image','committee-photo.png','image/png',1,1,70,
          'The Whanganui committee')
  returning *`, [theirs.id]);
await pool.query(`insert into asset_blob (asset_id, bytes) values ($1,$2)`,
  [theirAsset.id, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
    + 'IQAAAABJRU5ErkJggg==', 'base64')]);

ok('the actor administers Wellington', !!mine);
ok('Whanganui is a different club, not beneath it',
  !!theirs && theirs.id !== mine.id);
ok('with a page of their own', !!theirPage);
ok('somebody on their roll', !!theirPerson, 'no person at whanganui');
ok('and an event on their calendar', !!theirEvent, 'no event at whanganui');

{
  await req('/signin');
  const { token } = await auth.requestLink('tane@example.nz');
  const r = await req(`/signin/${token}`);
  ok('they are signed in', r.status === 302 && !!jar.honbu_session);

  const dash = await req('/dashboard');
  ok('their dashboard shows their own club', dash.html.includes('Wellington'));
  ok('and nobody else\'s', !dash.html.includes('Whanganui'),
    'another club is on their dashboard');
}

const theirAffiliation = await one(`select * from affiliation where organisation_id=$1 and ends is null limit 1`, [theirs.id]);
const theirSession = await one(`select * from training_session where organisation_id=$1 limit 1`, [theirs.id])
  ?? await one(`insert into training_session (organisation_id, label, weekday, starts, ends)
       values ($1,'Private grading squad',2,'18:00','19:00') returning *`, [theirs.id]);
const theirFee = await one(`insert into fee_schedule (organisation_id, label, amount_cents, period, applies_to, effective_from)
  values ($1,'Private committee price',9900,'annual','adult','2026-01-01') returning *`, [theirs.id]);
const theirPayment = await one(`
  insert into payment (organisation_id, person_id, amount_cents, status)
  values ($1,$2,5000,'pending') returning *`, [theirs.id, theirPerson.id]);
await pool.query(`insert into payment_line (payment_id, kind, description, amount_cents)
  values ($1,'uniform','Private uniform order',5000)`, [theirPayment.id]);

// ---------------------------------------------------------------------------
// every route, walked
// ---------------------------------------------------------------------------

/**
 * A path pointing at the other club's things.
 *
 * Every parameter is filled with something real that belongs to somebody
 * else, because a route that 404s on a made-up id proves nothing at all.
 */
function pathFor(pattern) {
  const values = {
    slug: theirs.slug,
    eventSlug: theirEvent ? String(theirEvent.slug) : 'nothing',
    pageId: theirPage.id,
    pageSlug: theirPage.slug,
    id: theirPerson ? theirPerson.id : '00000000-0000-0000-0000-000000000000',
    personId: theirPerson ? theirPerson.id : '00000000-0000-0000-0000-000000000000',
    linkId: theirLink.id,
    eventId: theirEvent ? theirEvent.id : '00000000-0000-0000-0000-000000000000',
    // /p/:id/access — creating an account for somebody else's member is
    // exactly the kind of thing this probe exists to refuse.
    assetId: theirAsset.id,
    articleId: theirArticle.id,
    messageId: theirMessage.id,
    paymentId: theirPayment.id,
    affiliationId: theirAffiliation.id,
    sessionId: theirSession.id,
    feeId: theirFee.id,
    name: 'members',
    clubId: theirs.id,
    token: 'not-a-real-token',
    secret: 'not-a-real-secret',
  };
  const unknown = [];
  const path = pattern.replace(/:([a-zA-Z]+)\*?/g, (_, name) => {
    if (values[name] === undefined) unknown.push(name);
    return values[name] ?? name;
  });
  return { path, unknown };
}

/**
 * Words that only appear if somebody else's data came back.
 *
 * The organisation's own NAME is deliberately not on this list. Clubs are
 * listed on the public website — anybody can read them at /find-a-dojo —
 * so a refusal saying "You do not have access to Whanganui" discloses
 * nothing that is not already published, and it is far more use to whoever
 * is reading it than a bare "no".
 *
 * Everything below is the opposite: a member's name, a draft page's title,
 * an event that may not be announced yet. None of that is public, and none
 * of it may appear in a refusal.
 */
const THEIR_WORDS = [
  theirPage.title,
  theirPerson && `${theirPerson.first_name} ${theirPerson.last_name}`,
  theirEvent && theirEvent.title,
  theirMessage.subject,
  'Private uniform order',
  'Private committee price',
].filter(Boolean);

/**
 * Routes that answer anybody signed in, and must simply contain nothing of
 * theirs.
 *
 * A third category, and search forced it. Refusing a search would be wrong —
 * everybody may search — so the protection is not a 403, it is that the
 * results are scoped in the query. That is a weaker-looking guarantee and a
 * more dangerous one to get wrong, so it is probed harder below: with their
 * words as the query, rather than with no query at all.
 */
const SCOPED = new Map([
  ['GET /search', 'everybody may search; the scoping is in the query'],
  ['GET /me', 'a person sees themselves and their own children; scoped by family.mayActFor'],
  ['GET /me/payments', 'what the signed-in person and their children owe; scoped by payments.forPerson'],
  ['GET /me/events', 'what is open to the signed-in person and their children; scoped by memberEvents'],
]);

console.log('\nEVERY ROUTE IS EITHER PUBLIC ON PURPOSE OR PROTECTED');
{
  const unclassified = routes
    .map((r) => `${r.method} ${r.pattern}`)
    .filter((key) => !PUBLIC.has(key) && !SCOPED.has(key))
    // Scoped by path, and every one of them is probed below. /a/ is not
    // scoped by path — an asset id carries its own federation — but it is
    // probed too, and the probe below is what proves it refuses.
    .filter((key) => !key.includes('/o/:slug') && !key.includes('/p/:id') && !key.includes('/me/payments/:')
                  && !key.includes('/a/:') && !key.includes('/me/:') && !key.includes('/me/events/:'));

  ok(`all ${routes.length} routes are accounted for`,
    unclassified.length === 0,
    `not classified: ${unclassified.join(', ')}`);
}

console.log('\nNOTHING OF THEIRS IS READABLE');
{
  for (const route of routes.filter((r) => r.method === 'GET')) {
    const key = `GET ${route.pattern}`;
    if (PUBLIC.has(key)) continue;

    const { path, unknown } = pathFor(route.pattern);
    if (unknown.length) {
      ok(`${route.pattern} — parameter ${unknown.join(', ')} not in the fixture`,
        false, 'add it, or the route is untested');
      continue;
    }

    if (SCOPED.has(key)) continue;   // probed on its own terms below

    const r = await req(path);
    const refused = r.status === 403 || r.status === 404;
    const leaked = THEIR_WORDS.filter((w) => r.html.includes(w));

    ok(`${route.pattern}`, refused && leaked.length === 0,
      refused ? `${r.status} but leaked: ${leaked.join(', ')}`
              : `returned ${r.status}${r.location ? ' → ' + r.location : ''}`);
  }
}

console.log('\nSEARCHING FOR THEIRS FINDS NOTHING');
{
  // The point of probing this separately. Fetching /search with no query
  // proves only that an empty search is empty. Every word that identifies
  // their data is typed into it in turn, and none of it may come back.
  for (const word of THEIR_WORDS) {
    const r = await req(`/search?q=${encodeURIComponent(word)}`);
    const leaked = THEIR_WORDS.filter((w) => {
      // The page echoes the query in its heading and keeps it in the box, so
      // the searched-for word is present either way. Only the OTHER words
      // appearing would mean a result came back — and for the word itself,
      // the check is that no result card was rendered.
      if (w === word) return false;
      return r.html.includes(w);
    });
    const foundSomething = /<h2>(People|Organisations|Events|Pages|News|Images)<\/h2>/
      .test(r.html);

    ok(`searching "${word}" returns nothing of theirs`,
      r.status === 200 && !leaked.length && !foundSomething,
      `${r.status}${leaked.length ? ` leaked: ${leaked.join(', ')}` : ''}`
      + `${foundSomething ? ' — a result was rendered' : ''}`);
  }

  // And their member number, which is the most precise thing somebody could
  // guess at.
  if (theirPerson?.display_number) {
    const r = await req(
      `/search?q=${encodeURIComponent(theirPerson.display_number)}`);
    ok('nor does their exact member number',
      !r.html.includes(theirPerson.last_name), 'LEAKED by member number');
  }
}

console.log('\nTHEIR OWN HOME SHOWS NOTHING OF THEIRS');
{
  for (const path of ['/me', '/me/events', '/me/payments']) {
    const r = await req(path);
    const leaked = THEIR_WORDS.filter((w) => r.html.includes(w));
    ok(`${path} answers them, and contains nothing of theirs`,
      (r.status === 200 || r.status === 302) && !leaked.length,
      `${r.status}${leaked.length ? ' leaked: ' + leaked.join(', ') : ''}`);
  }
}

console.log('\nAND NOTHING OF THEIRS CAN BE CHANGED');
{
  const census = async () => {
    const rows = await q(`
      select
        (select count(*)::int from page where organisation_id = $1) as pages,
        (select count(*)::int from event where organisation_id = $1) as events,
        (select count(*)::int from affiliation
          where organisation_id = $1 and ends is null) as members,
        (select count(*)::int from grading_record gr
          join affiliation a on a.person_id = gr.person_id
          where a.organisation_id = $1) as gradings,
        (select count(*)::int from page_revision r
          join page p on p.id = r.page_id where p.organisation_id = $1) as revisions,
        (select count(*)::int from guardian_link
          where ended_on is null and child_id in
            (select person_id from affiliation where organisation_id = $1)) as guardian_links,
        (select count(*)::int from dojo_profile
          where organisation_id = $1
            and (published or page_requested_at is not null)) as club_pages
      `, [theirs.id]);
    return rows[0];
  };

  const before = await census();

  for (const route of routes.filter((r) => r.method === 'POST')) {
    const key = `POST ${route.pattern}`;
    if (PUBLIC.has(key)) continue;

    const { path, unknown } = pathFor(route.pattern);
    if (unknown.length) continue;

    // A plausible submission for whatever this route takes. Wrong fields are
    // fine: the point is that it is refused before anything is read.
    const r = await req(path, { method: 'POST', form: {
      title: 'Snuck in', slug: 'snuck-in', name: 'Snuck in', label: 'Snuck in',
      firstName: 'Snuck', lastName: 'In', role: 'member',
      kind: 'training', startsAt: '2027-01-01T10:00', status: 'draft',
      op: 'save', blockCount: '1', b0_type: 'paragraph', b0_text: 'Snuck in.',
      text: 'First Name\tLast Name\nSnuck\tIn\n', confirm: 'yes',
      amount: '1', forCount: '1', acceptedName: 'Snuck In', accepted: '1',
      awarded_on: '2027-01-01', revisionId: theirPage.id,
      disciplineId: '00000000-0000-0000-0000-000000000000',
      selectionId: '00000000-0000-0000-0000-000000000000',
    }});

    ok(`${route.pattern}`, r.status === 403 || r.status === 404,
      `returned ${r.status}${r.location ? ' → ' + r.location : ''}`);
  }

  const after = await census();
  for (const [what, n] of Object.entries(before)) {
    ok(`their ${what} are untouched`, after[what] === n, `${n} → ${after[what]}`);
  }
  ok('nothing called "Snuck in" exists anywhere', await one(`
    select 1 from page where title = 'Snuck in'
    union all select 1 from event where title = 'Snuck in'
    union all select 1 from person where first_name = 'Snuck'
    union all select 1 from organisation where name = 'Snuck in'
    limit 1`) === null);
}

console.log('\nNOR CAN THEY REACH UP THE TREE');
{
  // A club administrator is not a federation administrator. Their grant
  // reaches down from Wellington, and the national body is above it.
  const up = await req(`/o/${federation.slug}/roster`);
  ok('the national roll is refused', up.status === 403, String(up.status));

  const pages = await req(`/o/${federation.slug}/pages`);
  ok('so is the national website', pages.status === 403, String(pages.status));
}

console.log('\nWHAT THEY *CAN* DO STILL WORKS');
{
  // An isolation test that passes because everything is broken proves
  // nothing. Their own club must still be entirely theirs.
  const own = await req(`/o/${mine.slug}/roster`);
  ok('their own roll opens', own.status === 200, String(own.status));

  const ownPages = await req(`/o/${mine.slug}/pages`);
  ok('their own website opens', ownPages.status === 200, String(ownPages.status));

  const ownEvents = await req(`/o/${mine.slug}/events`);
  ok('their own calendar opens', ownEvents.status === 200, String(ownEvents.status));

  const made = await req(`/o/${mine.slug}/events/new`, { method: 'POST', form: {
    title: 'Wellington grading', kind: 'grading',
    startsAt: '2027-03-01T10:00', status: 'draft' } });
  ok('and they can put something on it',
    made.status === 302, String(made.status));
  ok('which really was written', !!await one(`
    select 1 from event where organisation_id = $1 and title = 'Wellington grading'`,
    [mine.id]));
}

console.log('\nSIGNED OUT, EVERYTHING PROTECTED IS SHUT');
{
  await req('/signout', { method: 'POST', form: {} });
  for (const k of Object.keys(jar)) delete jar[k];
  await req('/signin');

  let open = [];
  for (const route of routes.filter((r) => r.method === 'GET')) {
    const key = `GET ${route.pattern}`;
    if (PUBLIC.has(key)) continue;
    const { path, unknown } = pathFor(route.pattern);
    if (unknown.length) continue;
    const r = await req(path);
    if (r.status === 200) open.push(`${route.pattern} (${r.status})`);
  }
  ok('no protected page renders to a stranger', open.length === 0,
    open.join(', '));
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
await pool.end();
process.exit(fail ? 1 : 0);
