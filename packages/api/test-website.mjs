/**
 * Can somebody who runs a dojo write a page and put it on their website?
 *
 * Driven the way a browser with JavaScript switched off drives it: every
 * button is a form post of the whole page, and nothing here runs a script.
 * That is the actual constraint — these get used in halls with bad reception
 * — so a test that poked an API would prove the wrong thing.
 */

import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
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
           headers: res.headers, html: await res.text() };
}

const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const count = async (sql, a = []) => (await pool.query(sql, a)).rows[0].n;
const said = (loc) => decodeURIComponent(
  new URL(loc ?? '/', base).searchParams.get('done') ?? '');

/** Everything the editor form would send, as a browser sends it. */
// Written the way somebody types into the box, because that is now the only
// way a page is written.
const PAGE = {
  title: 'About our dojo', slug: 'about',
  metaDescription: 'Kyokushin karate in Whanganui since 1965.',
  body: [
    '## Who we are',
    '',
    'Founded by **Hanshi Doug** in 1965. See [our classes](/classes).',
    '',
    '- Tuesdays 6pm',
    '- Thursdays 6pm',
  ].join('\n'),
};

// ---------------------------------------------------------------------------

console.log('\nTHE WEBSITE IS BEHIND SIGN-IN');
{
  ok('the page list redirects when signed out',
    (await req('/o/whanganui/pages')).status === 302);
  ok('so does the editor', (await req('/o/whanganui/pages/new')).status === 302);
}

console.log('\nSIGNED IN');
{
  await req('/signin');
  const { token } = await auth.requestLink('doug@example.nz');
  ok('the session is live', (await req(`/signin/${token}`)).status === 302);

  const list = await req('/o/whanganui/pages');
  ok('the website page opens', list.status === 200);
  ok('with somewhere to start', list.html.includes('/pages/new'));
}

console.log('\nTHE EDITOR STILL WORKS WITH NO JAVASCRIPT');
{
  // This used to assert that the admin contained no script tag at all. That
  // was a proxy for the property that matters — the editor works in a hall
  // with no signal — and the proxy stopped being right when the writing box
  // gained an optional toolbar.
  //
  // So the property is checked directly, and more strictly than the proxy
  // was: the thing you type into is a plain textarea that is already in the
  // HTML, nothing is rendered by script, no handler is inline, and any script
  // comes from this origin and is deferred. The test two blocks down posts
  // this form without running a line of JavaScript and expects it to save,
  // which is the real proof.
  const f = await req('/o/whanganui/pages/new');
  ok('it renders', f.status === 200);

  ok('what you type into is a plain textarea, present in the HTML',
    /<textarea[^>]*name="body"/.test(f.html), 'no textarea named body');

  ok('no inline event handler',
    !/\son(click|change|input|submit|load)=/i.test(f.html),
    'inline handler present');

  const srcs = [...f.html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)]
    .map((m) => m[1]);
  ok('every script is served from this origin, never a CDN',
    srcs.every((src) => src.startsWith('/')), srcs.join(', '));
  ok('and deferred, so it cannot block the page',
    [...f.html.matchAll(/<script\b[^>]*>/gi)]
      .filter((m) => /\ssrc=/.test(m[0]))
      .every((m) => /\sdefer\b/.test(m[0])),
    [...f.html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]).join(' '));

  ok('the live blocks are explained rather than hidden in a menu',
    f.html.includes('{{clubs}}'), 'no mention of the live blocks');
  ok('and the shorthand is explained rather than being a secret',
    f.html.includes('**bold**'), 'no shorthand help');
}

console.log('\nWRITING A PAGE');
{
  const r = await req('/o/whanganui/pages/new',
    { method: 'POST', form: { ...PAGE, op: 'save' } });
  ok('it saves and goes to the editor',
    r.status === 302 && /\/pages\/[0-9a-f-]{36}/.test(r.location ?? ''),
    r.location);
  ok('saying what happened', said(r.location).includes('draft'), said(r.location));

  const pg = await one(`select p.* from page p join organisation o
    on o.id = p.organisation_id where o.slug='whanganui' and p.slug='about'`);
  ok('the row is there', !!pg);
  ok('as a draft, not live', pg?.status === 'draft');
  ok('with its title', pg?.title === 'About our dojo');

  ok('the blocks are stored as structure, never as HTML',
    Array.isArray(pg.body.blocks) && pg.body.blocks.length === 3,
    JSON.stringify(pg.body).slice(0, 120));
  ok('the bold is a mark on a run, not a tag',
    pg.body.blocks[1].text.some((r) => r.marks?.includes('strong')),
    JSON.stringify(pg.body.blocks[1].text));
  ok('the link carries its address',
    pg.body.blocks[1].text.some((r) => r.href === '/classes'));
  ok('and both list items came through',
    pg.body.blocks[2].items.length === 2);

  ok('the first save left a revision',
    await count(`select count(*)::int n from page_revision where page_id=$1`,
      [pg.id]) === 1);

  globalThis.__id = pg.id;
}

console.log('\nOPENING IT AGAIN SHOWS WHAT WAS TYPED');
{
  const r = await req(`/o/whanganui/pages/${globalThis.__id}`);
  ok('the editor fills in', r.status === 200);
  ok('the title', r.html.includes('value="About our dojo"'));
  ok('the address', r.html.includes('value="about"'));
  ok('and the shorthand comes back exactly as it was typed, not as HTML',
    r.html.includes('Founded by **Hanshi Doug** in 1965.')
    && r.html.includes('[our classes](/classes)'),
    'shorthand did not round-trip');
  ok('the list comes back as the lines that were typed',
    r.html.includes('- Tuesdays 6pm') && r.html.includes('- Thursdays 6pm'),
    'list did not round-trip');
  ok('and the heading as a heading',
    r.html.includes('## Who we are'), 'heading did not round-trip');
}

console.log('\nREORDERING IS EDITING THE TEXT');
{
  // The up, down, add and remove buttons are gone with the block-by-block
  // editor. In one box you move a block by moving its lines, which is both
  // simpler and the thing people already know how to do.
  const before = await count(
    `select count(*)::int n from page_revision where page_id=$1`,
    [globalThis.__id]);

  const swapped = [
    'Founded by **Hanshi Doug** in 1965. See [our classes](/classes).',
    '',
    '## Who we are',
    '',
    '- Tuesdays 6pm',
    '- Thursdays 6pm',
  ].join('\n');

  const r = await req(`/o/whanganui/pages/${globalThis.__id}`,
    { method: 'POST', form: { ...PAGE, body: swapped, op: 'save' } });
  ok('saving the reordered text works', r.status === 302, r.status);

  const stored = await one('select body from page where id=$1', [globalThis.__id]);
  ok('and the stored blocks are in the new order',
    stored.body.blocks[0].type === 'paragraph'
    && stored.body.blocks[1].type === 'heading',
    stored.body.blocks.map((b) => b.type).join());
  ok('a save was recorded, because this time something was saved',
    await count(`select count(*)::int n from page_revision where page_id=$1`,
      [globalThis.__id]) > before);

  // Put it back the way the rest of the file expects.
  await req(`/o/whanganui/pages/${globalThis.__id}`,
    { method: 'POST', form: { ...PAGE, op: 'save' } });
}

console.log('\nTHE LIVE BLOCKS CAN BE TYPED');
{
  const withClubs = await req(`/o/whanganui/pages/${globalThis.__id}`,
    { method: 'POST', form: { ...PAGE, op: 'save',
      body: `${PAGE.body}\n\n{{clubs heading=Where_we_train}}` } });
  ok('a page with a live clubs block saves', withClubs.status === 302,
    withClubs.status);

  const stored = await one('select body from page where id=$1', [globalThis.__id]);
  const live = stored.body.blocks.find((b) => b.type === 'dojoList');
  ok('the block is stored as a live list, not as text', !!live,
    stored.body.blocks.map((b) => b.type).join());
  ok('with the heading that was typed', live?.heading === 'Where we train',
    live?.heading);

  // Back to the plain version for the rest of the file.
  await req(`/o/whanganui/pages/${globalThis.__id}`,
    { method: 'POST', form: { ...PAGE, op: 'save' } });
}

console.log('\nWHAT THE EDITOR WILL NOT SAVE');
{
  const noTitle = await req('/o/whanganui/pages/new',
    { method: 'POST', form: { ...PAGE, title: '', slug: '', op: 'save' } });
  ok('a page with no title is refused', noTitle.status === 422);
  ok('and says so', noTitle.html.includes('needs a title'));

  const empty = await req('/o/whanganui/pages/new', { method: 'POST', form: {
    title: 'Nothing here', blockCount: '1',
    b0_type: 'heading', b0_text: '', b0_level: '2', op: 'save' } });
  ok('a page with nothing typed on it is refused', empty.status === 422);
  ok('before the database refuses it, so the form comes back filled in',
    empty.html.includes('value="Nothing here"'), 'title lost');

  const clash = await req('/o/whanganui/pages/new',
    { method: 'POST', form: { ...PAGE, op: 'save' } });
  ok('two pages cannot share an address', clash.status === 422);
  ok('and it says which one', clash.html.includes('already has a page at'),
    'no clash message');
}

console.log('\nPREVIEW IS THE REAL PAGE, RENDERED BY THE REAL RENDERER');
{
  const r = await req(`/o/whanganui/pages/${globalThis.__id}/preview`);
  ok('it renders', r.status === 200);
  ok('as a whole page, not a fragment', r.html.includes('<!DOCTYPE html>'));

  ok('the heading is there', r.html.includes('Who we are'));
  ok('the bold rendered as emphasis, not as asterisks',
    r.html.includes('<strong>Hanshi Doug</strong>') && !r.html.includes('**Hanshi'),
    'shorthand not rendered');
  ok('the link is a link', r.html.includes('href="/classes"'));
  ok('and the list is a list', r.html.includes('Tuesdays 6pm'));

  ok('it says plainly that it is a preview', r.html.includes('Preview'));
  ok('and that this one is not live yet',
    r.html.includes('draft'), 'does not say it is a draft');

  ok('search engines are told to stay away',
    r.headers.get('x-robots-tag')?.includes('noindex'),
    r.headers.get('x-robots-tag'));
  ok('and nothing caches it', r.headers.get('cache-control') === 'no-store');
}

console.log('\nPUBLISHING');
{
  const r = await req(`/o/whanganui/pages/${globalThis.__id}`,
    { method: 'POST', form: { ...PAGE, op: 'publish' } });
  ok('it redirects to the website list', r.status === 302, String(r.status));
  ok('saying the page is published',
    said(r.location).includes('published'), said(r.location));

  const pg = await one('select * from page where id=$1', [globalThis.__id]);
  ok('the page is live', pg.status === 'published');
  ok('and stamped with when', !!pg.published_at);

  // No rebuild hook is set here, and the one thing this must never do is
  // claim the site changed when it did not.
  const rebuild = decodeURIComponent(
    new URL(r.location, base).searchParams.get('rebuild') ?? '');
  ok('it does NOT claim the live site updated',
    !/is rebuilding/.test(rebuild), rebuild);
  ok('it says the change is saved but not yet visible',
    rebuild.includes('will not show it'), rebuild);
  ok('and names what would fix it', rebuild.includes('REBUILD_HOOK_URL'), rebuild);

  const list = await req('/o/whanganui/pages');
  ok('the list shows it as live', list.html.includes('Live'));
}

console.log('\nTAKING IT DOWN KEEPS IT');
{
  const r = await req(`/o/whanganui/pages/${globalThis.__id}`,
    { method: 'POST', form: { ...PAGE, op: 'unpublish' } });
  ok('it comes off', r.status === 302 && said(r.location).includes('off the site'),
    said(r.location));

  const pg = await one('select * from page where id=$1', [globalThis.__id]);
  ok('back to a draft, not deleted', pg.status === 'draft');
  ok('with the words still there', pg.body.blocks.length === 3);
  ok('and its address kept', pg.slug === 'about');
}

console.log('\nEVERY SAVE KEEPS A VERSION, AND ANY OF THEM CAN COME BACK');
{
  await req(`/o/whanganui/pages/${globalThis.__id}`, { method: 'POST',
    form: { ...PAGE, title: 'About us', b0_text: 'Changed', op: 'save' } });

  const editor = await req(`/o/whanganui/pages/${globalThis.__id}`);
  ok('earlier versions are listed', editor.html.includes('Earlier versions'));
  ok('with who saved them', editor.html.includes('Doug Holloway'));

  const revisions = (await pool.query(
    `select id, title from page_revision where page_id=$1 order by saved_at`,
    [globalThis.__id])).rows;
  ok('there is more than one', revisions.length >= 2, String(revisions.length));

  const r = await req(`/o/whanganui/pages/${globalThis.__id}/restore`,
    { method: 'POST', form: { revisionId: revisions[0].id } });
  ok('an older one can be restored', r.status === 302);

  const pg = await one('select * from page where id=$1', [globalThis.__id]);
  ok('the page is as it was', pg.title === 'About our dojo', pg.title);
  ok('and it is a draft again until somebody publishes it',
    pg.status === 'draft');
}

console.log('\nRENAMING A PAGE RATHER THAN REWRITING IT');
{
  const r = await req(`/o/whanganui/pages/${globalThis.__id}`, { method: 'POST',
    form: { ...PAGE, slug: 'about-us', op: 'save' } });
  ok('it saves', r.status === 302, String(r.status));
  const pg = await one('select * from page where id=$1', [globalThis.__id]);
  ok('the address changed', pg.slug === 'about-us', pg.slug);
  ok('and the revisions came with it', await count(
    `select count(*)::int n from page_revision where page_id=$1`,
    [globalThis.__id]) >= 3);
}

console.log('\nNOTHING PASTED IN CAN BECOME MARKUP ON THE LIVE SITE');
{
  // Through the writing box, which is where somebody pasting from a website
  // or a Word document actually puts things. The box takes text and only
  // text; none of this can reach a page as markup.
  const r = await req('/o/whanganui/pages/new', { method: 'POST', form: {
    title: 'Pasted', slug: 'pasted', op: 'save',
    body: [
      '## <img src=x onerror=alert(1)>',
      '',
      'Click [here](javascript:alert(1)) <script>alert(1)</script>',
      '',
      '!> <iframe src="https://evil.example"></iframe>',
      '',
      '![<svg onload=alert(1)>](not-a-real-asset)',
    ].join('\n') } });
  ok('it saves without complaint', r.status === 302, String(r.status));

  const pg = await one(`select p.* from page p join organisation o
    on o.id=p.organisation_id where o.slug='whanganui' and p.slug='pasted'`);
  const preview = await req(`/o/whanganui/pages/${pg.id}/preview`);

  ok('the image tag is escaped, not rendered',
    !preview.html.includes('<img src=x') && preview.html.includes('&lt;img'),
    'img not escaped');
  ok('the script tag too',
    !preview.html.includes('<script>alert'), 'script rendered');
  ok('and the javascript: address never became a link',
    !preview.html.includes('href="javascript:'), 'javascript href present');
  ok('nor did an iframe survive the callout',
    !preview.html.includes('<iframe'), 'iframe rendered');
  ok('nor an svg in an image description',
    !preview.html.includes('<svg'), 'svg rendered');

  // And the stored document is still blocks, never markup.
  ok('what was stored is structure, not HTML',
    pg.body.blocks.every((b) => typeof b === 'object' && b.type),
    JSON.stringify(pg.body).slice(0, 120));
}

console.log('\nWRITING SOMEBODY ELSE\'S WEBSITE');
{
  const saved = { ...jar };
  for (const k of Object.keys(jar)) delete jar[k];
  await req('/signin');
  const { token } = await auth.requestLink('tane@example.nz');
  await req(`/signin/${token}`);

  ok('another club\'s website is refused',
    (await req('/o/whanganui/pages')).status === 403);
  ok('so is its editor',
    (await req(`/o/whanganui/pages/${globalThis.__id}`)).status === 403);
  ok('and so is its preview — a draft is not public',
    (await req(`/o/whanganui/pages/${globalThis.__id}/preview`)).status === 403);

  const before = await count(
    `select count(*)::int n from page_revision where page_id=$1`,
    [globalThis.__id]);
  const p = await req(`/o/whanganui/pages/${globalThis.__id}`,
    { method: 'POST', form: { ...PAGE, title: 'Snuck in', op: 'save' } });
  ok('posting to it writes nothing', p.status === 403 && await count(
    `select count(*)::int n from page_revision where page_id=$1`,
    [globalThis.__id]) === before, String(p.status));

  for (const k of Object.keys(jar)) delete jar[k];
  Object.assign(jar, saved);
}

// ---------------------------------------------------------------------------

console.log('\nTHE MENU');
{
  const r = await req('/o/moknz/menu');
  ok('the menu editor renders', r.status === 200);
  ok('it offers only pages this site has',
    r.html.includes('/find-a-dojo') && r.html.includes('/instructors'),
    'built-in destinations missing');
  const flat = (h) => h.replace(/\s+/g, ' ');
  ok('and says the menu is limited to five',
    flat(r.html).includes('5 items, and that is the limit'));
  ok('it says the site is still following the settings file',
    flat(r.html).includes("stops following the deployment's settings file"));

  // The failure this screen exists to end: an item pointing at a page nobody
  // wrote, which the build used to drop with only a line in a log.
  const dangling = await req('/o/moknz/menu', { method: 'POST',
    form: { href0: '/classes', label0: 'Classes' } });
  const why = decodeURIComponent((dangling.location ?? '').split('error=')[1] ?? '');
  ok('an item pointing nowhere is refused', !!why, dangling.location);
  ok('by name and destination',
    why.includes('Classes') && why.includes('/classes'), why);
  ok('with what to do about it', why.includes('Write that page first'));
  ok('and nothing was stored',
    !(await pool.query(`select settings->'navigation' n from organisation
                        where slug='moknz'`)).rows[0].n);

  const saved = await req('/o/moknz/menu', { method: 'POST',
    form: { href0: '/events', label0: 'What is on',
            href1: '/find-a-dojo', label1: '' } });
  ok('a good menu saves', saved.status === 302
    && !saved.location.includes('error='), saved.location);

  const after = await req('/o/moknz/menu');
  ok('the typed label came back', after.html.includes('What is on'));
  ok('and it no longer says it is following the file',
    !flat(after.html).includes("stops following the deployment's settings file"));

  const { rows: [org] } = await pool.query(
    `select settings->'navigation'->'items' as items from organisation
     where slug='moknz'`);
  ok('two items stored on the federation', org.items.length === 2);
  ok('a blank label was left blank rather than invented',
    org.items[1].label === '', JSON.stringify(org.items));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
await pool.end();
process.exit(fail ? 1 : 0);
