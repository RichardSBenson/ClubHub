/**
 * A club's page on the federation's website.
 *
 * Richard: "the theme we have already is specifically designed for MOKNZ, its
 * main organisation and the dojos that belong to it — we should have a
 * mechanism to enable a dojo page based on the design of the main page."
 *
 * Three things are being proved, in the order they matter:
 *
 *   1. A club is on the website because it asked and was agreed to, and not
 *      because it exists. It used to be every club, including ones that had
 *      told the federation nothing.
 *   2. The two decisions are separate. The club says what the page says; the
 *      federation says whether it goes up. A club cannot approve itself.
 *   3. What goes up is the federation's design, from the same renderer the
 *      rest of the site uses — not a second template that drifts.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
const OUT = '/tmp/honbu-club-pages';

const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
};
async function req(p, { method = 'GET', form } = {}) {
  const headers = {};
  if (cookie()) headers.cookie = cookie();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + p, { method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
               : undefined });
  keep(res);
  return { status: res.status, location: res.headers.get('location'),
           headers: res.headers, html: await res.text() };
}

/** The club page form is multipart, because a picture can be attached to it. */
async function postPage(p, form = {}, file = null) {
  const b = '----HonbuClubPageBoundary';
  const parts = [];
  const push = (x) => parts.push(Buffer.isBuffer(x) ? x : Buffer.from(x));
  for (const [k, v] of Object.entries({ _csrf: jar.honbu_csrf ?? '', ...form }))
    push(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  if (file) {
    push(`--${b}\r\nContent-Disposition: form-data; name="heroFile"; `
       + `filename="${file.filename}"\r\nContent-Type: image/png\r\n\r\n`);
    push(file.bytes); push('\r\n');
  }
  push(`--${b}--\r\n`);
  const res = await fetch(base + p, { method: 'POST', redirect: 'manual',
    headers: { cookie: cookie(), 'content-type': `multipart/form-data; boundary=${b}` },
    body: Buffer.concat(parts) });
  keep(res);
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}

const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`, { method: 'POST', form: {} });
};
// Asynchronous on purpose. A synchronous child process blocks this process's
// event loop for the length of the build, the server's idle sockets time out
// meanwhile, and the next request is sent down one that is already closed.
const build = async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await run(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..') });
};
const site = (rel) => fs.existsSync(path.join(OUT, rel))
  ? fs.readFileSync(path.join(OUT, rel), 'utf8') : null;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  + 'IQAAAABJRU5ErkJggg==', 'base64');

const club = await one(`select * from organisation where slug='wellington'`);
const federation = await one(`select * from organisation where parent_id is null`);
const profile = () => one(`select * from dojo_profile where organisation_id=$1`, [club.id]);

// The picture select is part of the form, so it is posted every time. Posting
// without it means "no picture", which is what a save used to do here.
let hero = '';

/** A complete form, the way the screen posts it. */
const complete = (over = {}) => ({
  hero_asset_id: hero,
  venue_name: 'Te Aro Hall', address_line: '12 Cuba Street', suburb: 'Te Aro',
  city: 'Wellington', postcode: '6011', directions: 'Side door.',
  phone: '04 000 0000', email: 'wellington@example.nz',
  blurb: 'A friendly club in the middle of town.',
  who_trains: 'Families and office workers.',
  accepts_beginners: 'on', first_class_free: 'on',
  session_label_0: 'Juniors', session_day_0: '2', session_starts_0: '17:00',
  session_ends_0: '18:00', session_min_0: '6', session_max_0: '12',
  session_label_1: 'Adults', session_day_1: '4', session_starts_1: '18:30',
  session_ends_1: '20:00',
  ...over,
});

await signIn('tane@example.nz');

// ---------------------------------------------------------------------------

console.log('\nA CLUB STARTS WITH NO PAGE ON THE WEBSITE');
{
  ok('Wellington has no profile at all', (await profile()) === null);

  const screen = await req('/o/wellington/club-page');
  ok('its page screen opens', screen.status === 200, String(screen.status));
  ok('and says plainly it is not on the website', /Not on the website yet/.test(screen.html));
  ok('and says what is missing, as things to do',
    /Add at least one training time/.test(screen.html)
    && /Where do you train/.test(screen.html));

  const early = await req('/o/wellington/club-page/request', { method: 'POST', form: {} });
  ok('asking before it is ready is refused, with the reasons',
    early.status === 302 && /error=/.test(early.location ?? ''), early.location);
  ok('and nothing was recorded', (await profile())?.page_requested_at == null);
}

console.log('\nWRITING IT');
{
  const saved = await postPage('/o/wellington/club-page', complete());
  ok('saving works', saved.status === 302 && /done=/.test(saved.location ?? ''),
    `${saved.status} ${saved.location}`);

  const row = await profile();
  ok('the details are stored', row?.venue_name === 'Te Aro Hall' && row.city === 'Wellington');
  ok('ticked boxes are true', row.accepts_beginners === true && row.first_class_free === true);
  const times = (await pool.query(
    `select * from training_session where organisation_id=$1 order by sort_order`,
    [club.id])).rows;
  ok('both training times are stored', times.length === 2, String(times.length));
  ok('with their ages', times[0].min_age === 6 && times[0].max_age === 12);

  const unticked = await postPage('/o/wellington/club-page', complete({
    accepts_beginners: undefined, first_class_free: undefined,
    session_id_0: times[0].id, session_id_1: times[1].id }));
  ok('unticking is respected — the website will not promise it',
    unticked.status === 302 && (await profile()).first_class_free === false);

  // Edited in place. Attendance points at a session; deleting and recreating
  // would silently detach every attendance record from its class.
  const edited = await postPage('/o/wellington/club-page', complete({
    session_id_0: times[0].id, session_id_1: times[1].id,
    session_starts_0: '16:30' }));
  const after = (await pool.query(
    `select id::text, to_char(starts,'HH24:MI') as starts from training_session
     where organisation_id=$1 order by sort_order`, [club.id])).rows;
  ok('editing a time keeps the same session', edited.status === 302
    && after[0].id === times[0].id && after[0].starts === '16:30',
    JSON.stringify(after));

  const dropped = await postPage('/o/wellington/club-page', complete({
    session_id_0: times[0].id, session_id_1: times[1].id,
    session_label_1: '', session_day_1: '', session_starts_1: '', session_ends_1: '' }));
  const left = (await pool.query(
    `select id::text from training_session where organisation_id=$1`, [club.id])).rows;
  ok('emptying a row removes that time and only that one',
    dropped.status === 302 && left.length === 1 && left[0].id === times[0].id,
    String(left.length));
  await postPage('/o/wellington/club-page', complete({ session_id_0: times[0].id }));

  const badTime = await postPage('/o/wellington/club-page', complete({
    session_ends_0: '15:00' }));
  ok('a time that ends before it starts is refused, naming the row',
    badTime.status === 422 && /Training time 1 ends before it starts/.test(badTime.html),
    `${badTime.status}`);
  ok('and what they typed is still in the form',
    /value="Te Aro Hall"/.test(badTime.html));

  const badEmail = await postPage('/o/wellington/club-page', complete({ email: 'nope' }));
  ok('an email that is not one is refused', badEmail.status === 422);

  const none = await postPage('/o/wellington/club-page', complete({
    session_day_0: '', session_label_0: 'Juniors' }));
  ok('a time with no day is refused', none.status === 422 && /needs a day/.test(none.html));
}

console.log('\nTHE PICTURE AT THE TOP');
{
  const theirs = await one(`select * from organisation where slug='whanganui'`);
  const foreign = await one(`
    insert into asset (organisation_id, kind, filename, mime, width, height, bytes)
    values ($1,'image','theirs.png','image/png',1,1,70) returning id`, [theirs.id]);

  const stolen = await postPage('/o/wellington/club-page',
    complete({ hero_asset_id: foreign.id }));
  ok('another club\'s picture cannot be used', stolen.status === 422
    && /not in this club/.test(stolen.html), String(stolen.status));

  const up = await postPage('/o/wellington/club-page',
    complete({ heroAlt: 'The hall' }), { filename: 'hall.png', bytes: PNG });
  ok('a picture can be added from the same screen', up.status === 302, String(up.status));
  const row = await profile();
  ok('and becomes the one at the top', !!row.hero_asset_id);
  hero = row.hero_asset_id;
  const asset = await one(`select * from asset where id=$1`, [row.hero_asset_id]);
  ok('belonging to this club, so it can be used again',
    asset?.organisation_id === club.id && asset.filename === 'hall.png');

  const lorry = await postPage('/o/wellington/club-page', complete(),
    { filename: 'not-a-picture.png', bytes: Buffer.from('MZ this is an exe') });
  ok('something that is not a picture is refused', lorry.status === 422, String(lorry.status));
}

console.log('\nTHE PLACEHOLDER IS NOT A DESCRIPTION');
{
  await postPage('/o/wellington/club-page', complete({
    blurb: '[Two or three sentences from the dojo operator, in their own words.]',
    session_id_0: (await one(`select id from training_session where organisation_id=$1`,
      [club.id])).id }));
  const r = await req('/o/wellington/club-page/request', { method: 'POST', form: {} });
  ok('template text left in cannot be put in front of the public',
    /error=/.test(r.location ?? '') && /placeholder/.test(decodeURIComponent(r.location ?? '')),
    r.location);
  await postPage('/o/wellington/club-page', complete({
    session_id_0: (await one(`select id from training_session where organisation_id=$1`,
      [club.id])).id }));
}

console.log('\nASKING, AND NOT BEING ABLE TO ANSWER YOURSELF');
{
  const asked = await req('/o/wellington/club-page/request', { method: 'POST', form: {} });
  ok('a finished page can be requested', asked.status === 302 && /done=/.test(asked.location ?? ''),
    asked.location);
  const row = await profile();
  ok('which records the request and does not publish', !!row.page_requested_at && !row.published);

  const screen = await req('/o/wellington/club-page');
  ok('the screen says it is waiting', /Waiting for the federation/.test(screen.html));

  const self = await req(`/o/wellington/club-pages/${club.id}/decide`,
    { method: 'POST', form: { answer: 'approve' } });
  ok('the club cannot approve itself', (await profile()).published === false,
    `${self.status} ${self.location}`);

  const theirs = await one(`select * from organisation where slug='whanganui'`);
  const before = await one(`select published from dojo_profile where organisation_id=$1`, [theirs.id]);
  await req(`/o/wellington/club-pages/${theirs.id}/decide`,
    { method: 'POST', form: { answer: 'approve' } });
  await req(`/o/whanganui/club-page/takedown`, { method: 'POST', form: {} });
  const after = await one(`select published from dojo_profile where organisation_id=$1`, [theirs.id]);
  ok('nor anybody else\'s, and it cannot take another club down',
    after.published === before.published, `${before.published} → ${after.published}`);

  const asFed = await req('/o/moknz/club-pages');
  ok('a club has no way into the federation\'s overview', asFed.status === 403, String(asFed.status));
}

console.log('\nTHE FEDERATION ANSWERS');
{
  await signIn('doug@example.nz');
  const list = await req('/o/moknz/club-pages');
  ok('the federation sees the request', list.status === 200
    && /Asking to go on the website/.test(list.html) && /Wellington/.test(list.html));
  ok('with a way to see it first',
    list.html.includes('/o/wellington/club-page/preview'));
  ok('in the federation\'s own word for a club',
    /<h1>Dojo pages<\/h1>/.test(list.html), list.html.match(/<h1>[^<]*/)?.[0]);

  const preview = await req('/o/wellington/club-page/preview');
  ok('the preview renders', preview.status === 200 && /Te Aro Hall/.test(preview.html));
  ok('says it is a preview', /Preview/.test(preview.html));
  ok('and keeps itself out of search engines',
    /noindex/.test(preview.headers.get('x-robots-tag') ?? ''));
  ok('in the federation\'s theme, not a second one',
    preview.html.includes('href="/theme.css"'));

  const yes = await req(`/o/moknz/club-pages/${club.id}/decide`,
    { method: 'POST', form: { answer: 'approve' } });
  ok('approving works', yes.status === 302 && /done=/.test(yes.location ?? ''),
    `${yes.status} ${yes.location}`);
  const row = await profile();
  ok('the page is live and says who put it there', row.published
    && !row.page_requested_at && !!row.published_by && !!row.published_at);

  const log = await one(`
    select * from audit_log where entity='club_page' and action='club_page_approved'`);
  ok('and the audit log has it, at the federation', log?.organisation_id === federation.id);

  const fedPage = await req('/o/moknz/club-page');
  ok('a federation has no page of its own — it is sent to its list',
    fedPage.status === 302 && /club-pages/.test(fedPage.location ?? ''), fedPage.location);
}

console.log('\nWHAT THE PUBLIC SEES');
{
  await build();
  const page = site('wellington/index.html');
  ok('the club\'s page exists', !!page);
  ok('says what the club said', /Te Aro Hall/.test(page) && /Cuba Street/.test(page)
    && /friendly club/.test(page));
  ok('and only the promises it ticked', /first class is free/i.test(page));
  ok('with its picture at the top', /class="hero photo"/.test(page)
    && /\/images\/[0-9a-f-]{36}\.png/.test(page));

  // The point of the whole feature. If the club page had its own template it
  // could look like anything; this is the federation's.
  const home = site('index.html');
  const sheet = (h) => h.match(/<link rel="stylesheet" href="([^"]*theme\.css)"/)?.[1];
  ok('it uses the federation\'s stylesheet', sheet(page) === sheet(home) && !!sheet(home));
  const bar = (h) => h.match(/<header class="site">[\s\S]*?<\/header>/)?.[0];
  ok('the same header as the home page', !!bar(page) && bar(page) === bar(home));
  const foot = (h) => h.match(/<footer class="site">[\s\S]*?<\/footer>/)?.[0];
  ok('and the same footer', !!foot(page) && foot(page) === foot(home));

  const find = site('find-a-dojo/index.html');
  ok('it is listed in Find a dojo', /Wellington/.test(find));
  ok('and a club that never asked has no page',
    site('christchurch/index.html') === null);
  ok('nor a place in the list', !/Christchurch/.test(find));
}

console.log('\nWHAT A CLUB WRITES CANNOT BREAK THE PAGE');
{
  await signIn('tane@example.nz');
  const id = (await one(`select id from training_session where organisation_id=$1`, [club.id])).id;
  const nasty = '<script>alert(1)</script> & "quotes"';
  const r = await postPage('/o/wellington/club-page', complete({
    blurb: nasty, venue_name: '<img src=x onerror=alert(1)>', session_id_0: id }));
  ok('saves', r.status === 302, String(r.status));
  await build();
  const page = site('wellington/index.html');
  ok('nothing it typed becomes markup',
    !page.includes('<script>alert(1)') && !page.includes('<img src=x'));
  ok('it is shown as typed', page.includes('&lt;script&gt;alert(1)'));
}

console.log('\nA LIVE PAGE STAYS FINISHED');
{
  const id = (await one(`select id from training_session where organisation_id=$1`, [club.id])).id;
  const blank = await postPage('/o/wellington/club-page',
    complete({ venue_name: '', session_id_0: id }));
  ok('an edit that would leave a live page unfinished is refused',
    blank.status === 422 && /live/.test(blank.html), String(blank.status));
  ok('and nothing was lost', (await profile()).venue_name !== null);
}

console.log('\nTAKING IT DOWN');
{
  const down = await req('/o/wellington/club-page/takedown', { method: 'POST', form: {} });
  ok('the club can take its own page down without asking',
    down.status === 302 && (await profile()).published === false);
  await build();
  ok('and it is gone from the website', site('wellington/index.html') === null);
  ok('and from the list', !/Wellington/.test(site('find-a-dojo/index.html') ?? ''));
  ok('without losing what it wrote', (await profile()).venue_name !== null);
}

console.log('\nDECLINING');
{
  await req('/o/wellington/club-page/request', { method: 'POST', form: {} });
  await signIn('doug@example.nz');
  const no = await req(`/o/moknz/club-pages/${club.id}/decide`, { method: 'POST',
    form: { answer: 'decline', note: 'Please add a photo of the hall.' } });
  ok('declining works', no.status === 302 && /done=/.test(no.location ?? ''));
  const row = await profile();
  ok('the request is closed and not published',
    !row.published && !row.page_requested_at);

  await signIn('tane@example.nz');
  const screen = await req('/o/wellington/club-page');
  ok('the club is told why', /Please add a photo of the hall/.test(screen.html));
  ok('and can try again', /Ask to go on the website/.test(screen.html));
}

console.log('\nTHE FEDERATION CAN SWITCH A CLUB ON WITHOUT BEING ASKED');
{
  await signIn('doug@example.nz');
  const list = await req('/o/moknz/club-pages');
  ok('a finished club with no request offers a switch', /Switch on/.test(list.html));
  const on = await req(`/o/moknz/club-pages/${club.id}/decide`,
    { method: 'POST', form: { answer: 'approve' } });
  ok('and switching it on works', on.status === 302 && (await profile()).published === true);
}

console.log('\nTHE SIDE RAIL');
{
  const screen = await req('/o/moknz/club-pages');
  ok('the federation sees it', /<aside class="rail">/.test(screen.html));
  ok('in its own word for a club', /Dojo pages/.test(screen.html));
  ok('with the current screen marked',
    /aria-current="page">Dojo pages/.test(screen.html));
  ok('and a way back to everything', /Everything I look after/.test(screen.html));

  const dash = await req('/dashboard');
  ok('the dashboard has no rail — it is not about one organisation',
    !/<aside class="rail">/.test(dash.html));
  ok('and no leftover marker', !dash.html.includes('honbu:rail'));

  await signIn('tane@example.nz');
  const own = await req('/o/wellington/club-page');
  ok('a club\'s rail offers its own page', /Dojo page/.test(own.html));
  ok('and not the federation\'s list of clubs', !/Dojo pages/.test(own.html));
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
await pool.end();
process.exit(fail ? 1 : 0);
