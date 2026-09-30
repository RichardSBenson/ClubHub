/**
 * The media library, end to end, through real HTTP.
 *
 * The two that matter most are at the bottom: bytes come back out of the
 * database byte-identical to the ones that went in, and one federation cannot
 * read another's images by knowing an id.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';
import { identify } from '../content/images.mjs';

process.env.HONBU_STORE = 'postgres';

const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const jar = {};
const cookieHeader = () =>
  Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const take = (res) => {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
};

async function req(path, { method = 'GET', form } = {}) {
  const headers = {};
  if (cookieHeader()) headers.cookie = cookieHeader();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + path, { method, headers, redirect: 'manual',
    body: form
      ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
      : undefined });
  take(res);
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}

/** A real multipart upload, built as bytes the way a browser builds one. */
async function upload(path, { file, filename = 'crest.png',
                              type = 'image/png', ...fields } = {}) {
  const b = '----HonbuTestBoundary';
  const parts = [];
  const push = (s) => parts.push(Buffer.isBuffer(s) ? s : Buffer.from(s));

  for (const [k, v] of Object.entries({ _csrf: jar.honbu_csrf ?? '', ...fields })) {
    push(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  }
  if (file !== undefined) {
    push(`--${b}\r\nContent-Disposition: form-data; name="file"; `
       + `filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
    push(file);
    push('\r\n');
  }
  push(`--${b}--\r\n`);

  const res = await fetch(base + path, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: cookieHeader(),
               'content-type': `multipart/form-data; boundary=${b}` },
    body: Buffer.concat(parts) });
  take(res);
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}

/** Raw bytes, for checking what comes back out of /a/:id. */
async function raw(path) {
  const res = await fetch(base + path, {
    headers: { cookie: cookieHeader() }, redirect: 'manual' });
  take(res);
  return { status: res.status, type: res.headers.get('content-type'),
           cache: res.headers.get('cache-control'),
           bytes: Buffer.from(await res.arrayBuffer()) };
}

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  + 'IQAAAABJRU5ErkJggg==', 'base64');

/** A PNG big enough that a truncation or a mangling would be obvious. */
const PNG_BIG = (() => {
  const b = Buffer.alloc(40000);
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(800, 16); b.writeUInt32BE(600, 20);
  // Fill with every byte value, so any string round-trip destroys it.
  for (let i = 24; i < b.length; i++) b[i] = i % 256;
  return b;
})();

const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`);
};

// ---------------------------------------------------------------------------

console.log('\nTHE LIBRARY IS BEHIND SIGN-IN');
{
  const r = await req('/o/moknz/media');
  ok('signed out, it redirects', r.status === 302 && r.location === '/signin');
}

await signIn('doug@example.nz');

console.log('\nAN EMPTY LIBRARY SAYS SO');
{
  const r = await req('/o/moknz/media');
  ok('it renders', r.status === 200);
  ok('and says there is nothing yet', r.html.includes('No images yet'));
  ok('the form posts as multipart',
    r.html.includes('enctype="multipart/form-data"'));
  ok('and it warns about SVG rather than failing silently later',
    r.html.includes('an SVG can carry'));
}

let assetId = null;

console.log('\nUPLOADING');
{
  const r = await upload('/o/moknz/media', {
    file: PNG_1x1, filename: 'crest.png',
    alt_text: 'The MOKNZ crest', credit: 'MOKNZ',
    consent_ref: '2026 folder p1' });
  ok('redirects back with a confirmation',
    r.status === 302 && r.location.includes('done='), r.location);

  const list = await req('/o/moknz/media');
  ok('the image is listed', list.html.includes('crest.png'));
  ok('with its real dimensions', list.html.includes('1×1'));
  assetId = (list.html.match(/\/a\/([0-9a-f-]{36})/) ?? [])[1];
  ok('and an id to reference it by', !!assetId);

  const { rows } = await pool.query(
    `select mime, width, height, alt_text, consent_ref from asset`);
  ok('the mime stored is the sniffed one', rows[0].mime === 'image/png');
  ok('the description was kept', rows[0].alt_text === 'The MOKNZ crest');
  ok('and so was where consent is recorded',
    rows[0].consent_ref === '2026 folder p1');
}

console.log('\nWHAT GOES IN COMES BACK OUT');
{
  const r = await upload('/o/moknz/media', {
    file: PNG_BIG, filename: 'big.png', alt_text: 'A large test image' });
  ok('a 40KB image uploads', r.status === 302 && r.location.includes('done='));

  const list = await req('/o/moknz/media');
  const ids = [...list.html.matchAll(/\/a\/([0-9a-f-]{36})/g)].map((m) => m[1]);
  let match = null;
  for (const id of ids) {
    const got = await raw(`/a/${id}`);
    if (got.bytes.length === PNG_BIG.length) { match = got; break; }
  }
  ok('one of them is exactly the right length', !!match);
  ok('and every byte is the byte that was uploaded',
    match && match.bytes.equals(PNG_BIG));
  ok('served as the type read from its bytes',
    match && match.type === 'image/png', match?.type);
  ok('and cached privately, because it is behind a sign-in',
    match && /private/.test(match.cache ?? ''), match?.cache);
  ok('it is still a valid PNG at 800x600',
    match && identify(match.bytes).width === 800);
}

console.log('\nWHAT IS REFUSED, AND WHETHER IT SAYS WHY');
{
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"'
    + ' onload="fetch(\'/o/moknz/roster\')"/>');
  const r = await upload('/o/moknz/media', { file: svg, filename: 'logo.svg',
    type: 'image/svg+xml' });
  ok('an svg is refused', r.location.includes('error='));
  ok('and the reason names script',
    decodeURIComponent(r.location).includes('carry script'),
    decodeURIComponent(r.location ?? ''));

  // The important one: a file that lies about what it is.
  const php = Buffer.from('<?php system($_GET["c"]); ?>');
  const r2 = await upload('/o/moknz/media', { file: php,
    filename: 'innocent.png', type: 'image/png' });
  ok('a script claiming to be a png is refused',
    r2.location.includes('error='));
  ok('because the bytes were read, not the claim',
    decodeURIComponent(r2.location).includes('not a PNG'));

  const r3 = await upload('/o/moknz/media', { file: Buffer.alloc(0) });
  ok('and submitting with no file says to choose one',
    decodeURIComponent(r3.location ?? '').includes('Choose a file'));

  const { rows: [n] } = await pool.query(`select count(*)::int n from asset`);
  ok('none of them were stored', n.n === 2, n.n);
}

console.log('\nAN IMAGE IN USE CANNOT BE DELETED OUT FROM UNDER A PAGE');
{
  const { rows: [org] } = await pool.query(
    `select id from organisation where slug='moknz'`);
  await pool.query(`
    insert into page (organisation_id, slug, title, body, status)
    values ($1,'about-us','About us',$2,'published')`,
    [org.id, JSON.stringify({ blocks: [
      { type: 'image', assetId, alt: 'The crest' }] })]);

  const r = await upload('/o/moknz/media', {}); // no file; just to get csrf
  const del = await req(`/o/moknz/media/${assetId}/delete`, { method: 'POST', form: {} });
  ok('deleting it is refused', del.location?.includes('error='));
  ok('and the refusal names the page',
    decodeURIComponent(del.location ?? '').includes('About us'),
    decodeURIComponent(del.location ?? ''));

  const { rows: [n] } = await pool.query(
    `select count(*)::int n from asset where id=$1`, [assetId]);
  ok('so it is still there', n.n === 1);

  await pool.query(`delete from page where slug='about-us'`);
  const again = await req(`/o/moknz/media/${assetId}/delete`,
    { method: 'POST', form: {} });
  ok('once nothing points at it, it deletes',
    again.location?.includes('done='), again.location);

  const { rows: [after] } = await pool.query(
    `select count(*)::int n from asset_blob where asset_id=$1`, [assetId]);
  ok('and the bytes go with it', after.n === 0);
}

console.log('\nONE FEDERATION CANNOT READ ANOTHER\'S IMAGES');
{
  // Doug's remaining image, and its id.
  const { rows: [mine] } = await pool.query(`select id from asset limit 1`);

  // A federation in another art, with an administrator of its own.
  await pool.query(`
    insert into organisation (type, name, slug, path, country_code)
    values ('country','Kaimai Taekwondo','kaimai','kaimai','NZ')
    on conflict do nothing`);
  const { rows: [acct] } = await pool.query(`
    insert into account (email) values ('stranger@kaimai.nz')
    on conflict (email) do update set email = excluded.email returning id`);
  await pool.query(`
    insert into grant_role (account_id, organisation_id, role)
    select $1, id, 'owner' from organisation where slug='kaimai'
    on conflict do nothing`, [acct.id]);

  await signIn('stranger@kaimai.nz');

  const theirs = await req('/o/kaimai/media');
  ok('they can reach their own library', theirs.status === 200);

  const peek = await raw(`/a/${mine.id}`);
  ok('but not an image belonging to MOKNZ', peek.status === 403, peek.status);
  ok('and nothing came back with it', peek.bytes.length === 0
    || !peek.bytes.subarray(0, 8).equals(
         Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A])));

  const list = await req('/o/moknz/media');
  ok('nor MOKNZ\'s library', list.status === 403, list.status);

  const push = await upload('/o/moknz/media', { file: PNG_1x1 });
  ok('nor can they upload into it', push.status === 403, push.status);

  await pool.query(`delete from grant_role where account_id=$1`, [acct.id]);
  await pool.query(`delete from account where id=$1`, [acct.id]);
  await pool.query(`delete from organisation where slug='kaimai'`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
