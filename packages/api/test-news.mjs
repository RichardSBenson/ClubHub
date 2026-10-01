/**
 * Writing news, and who decides where it appears.
 *
 * The rule being proved is Richard's: a dojo may say what it likes on its own
 * site, and cannot put it in the federation's voice by itself. People write
 * strange things, sincerely held and not factual, and a federation's name on a
 * page reads as an endorsement whether or not it was meant as one.
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
  const res = await fetch(base + path, { method, headers, redirect: 'manual',
    body: form
      ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
      : undefined });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
  return { status: res.status, location: res.headers.get('location'),
           html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`);
};

/** A whole article in one post, the way the form submits it. */
const compose = (over = {}) => ({
  title: 'Eleven grade to 8th kyu', slug: '', summary: 'A good morning.',
  blockCount: '1', b0_type: 'paragraph',
  b0_text: 'Saturday was the largest grading since 2019.',
  tags: 'grading, whanganui', heroAssetId: '', op: 'save', ...over,
});

await signIn('doug@example.nz');

// ---------------------------------------------------------------------------

console.log('\nWRITING ONE');
{
  const empty = await req('/o/moknz/news');
  ok('the news screen renders', empty.status === 200);

  const made = await req('/o/moknz/news/new', { method: 'POST', form: compose() });
  ok('creating one redirects to its editor',
    made.status === 302 && /\/o\/moknz\/news\/[0-9a-f-]{36}/.test(made.location ?? ''),
    made.location);

  const row = await one(`select * from article where slug='eleven-grade-to-8th-kyu'`);
  ok('the slug came from the headline', !!row);
  ok('it starts as a draft', row?.status === 'draft');
  ok('the body was kept', JSON.stringify(row?.body).includes('largest grading'));
  ok('and the tags were split and tidied',
    JSON.stringify(row?.tags) === JSON.stringify(['grading', 'whanganui']),
    JSON.stringify(row?.tags));

  const list = await req('/o/moknz/news');
  ok('it is listed', list.html.includes('Eleven grade to 8th kyu'));
  ok('as a draft', list.html.includes('Draft'));
}

console.log('\nWHAT IS REFUSED');
{
  const noTitle = await req('/o/moknz/news/new',
    { method: 'POST', form: compose({ title: '' }) });
  ok('an article with no headline is refused',
    noTitle.status === 422 && noTitle.html.includes('needs a headline'));

  const noBody = await req('/o/moknz/news/new',
    { method: 'POST', form: compose({ b0_text: '', slug: 'empty-one' }) });
  ok('and one with nothing in it',
    noBody.status === 422 && noBody.html.includes('nothing in this article'),
    noBody.status);
  ok('neither was written',
    !(await one(`select 1 from article where slug='empty-one'`)));

  // A hero image belonging to somebody else would be copied onto this site by
  // the build, so it is refused at the point of saving.
  const { rows: [kaimai] } = await pool.query(`
    insert into organisation (type, name, slug, path, country_code)
    values ('country','Kaimai Taekwondo','kaimai','kaimai','NZ')
    on conflict (parent_id, slug) do update set name=excluded.name returning id`);
  const theirs = await one(`
    insert into asset (organisation_id, kind, filename, mime, width, height, bytes)
    values ($1,'image','theirs.png','image/png',1,1,70) returning id`, [kaimai.id]);

  const stolen = await req('/o/moknz/news/new', { method: 'POST',
    form: compose({ slug: 'stolen-hero', heroAssetId: theirs.id }) });
  ok('a hero image from another federation is refused',
    stolen.status === 422 && stolen.html.includes('does not belong'),
    stolen.status);
}

console.log('\nA DOJO ASKS; THE FEDERATION DECIDES');
{
  const wh = await one(`select id from organisation where slug='whanganui'`);
  const made = await req('/o/whanganui/news/new', { method: 'POST',
    form: compose({ title: 'Our own view of things', slug: 'our-view' }) });
  ok('a dojo can write its own', made.status === 302, made.status);

  const id = (made.location.match(/news\/([0-9a-f-]{36})/) ?? [])[1];

  const tooEarly = await req(`/o/whanganui/news/${id}/ask`,
    { method: 'POST', form: {} });
  ok('it cannot ask before it is published on its own site',
    decodeURIComponent(tooEarly.location ?? '').includes('Publish it on your own site'),
    decodeURIComponent(tooEarly.location ?? ''));

  await req(`/o/whanganui/news/${id}`, { method: 'POST',
    form: compose({ title: 'Our own view of things', slug: 'our-view',
                    op: 'publish' }) });
  const published = await one(`select * from article where id=$1`, [id]);
  ok('published on the dojo site', published.status === 'published');
  ok('and nobody has asked for it to go further',
    published.publish_up_state === 'none' && published.publish_up === false);

  await req(`/o/whanganui/news/${id}/ask`, { method: 'POST', form: {} });
  ok('after asking it is waiting',
    (await one(`select publish_up_state s from article where id=$1`, [id])).s
      === 'requested');

  // The dojo must not be able to answer its own request.
  const selfApprove = await req(`/o/whanganui/news/${id}/decide`,
    { method: 'POST', form: { answer: 'approve' } });
  ok('the dojo cannot approve itself',
    decodeURIComponent(selfApprove.location ?? '').includes('does not sit beneath'),
    `${selfApprove.status} ${decodeURIComponent(selfApprove.location ?? '')}`);
  ok('so it is still only requested',
    (await one(`select publish_up_state s from article where id=$1`, [id])).s
      === 'requested');

  const fed = await req('/o/moknz/news');
  ok('the federation sees it waiting', fed.html.includes('Our own view of things'));
  ok('and is told whose it is', fed.html.includes('Whanganui'));

  const declined = await req(`/o/moknz/news/${id}/decide`,
    { method: 'POST', form: { answer: 'decline' } });
  ok('the federation can decline', declined.status === 302);
  const after = await one(`select * from article where id=$1`, [id]);
  ok('which is recorded as a decision, not a deletion',
    after.publish_up_state === 'declined' && after.publish_up === false);
  ok('and the article is still published on the dojo\'s own site',
    after.status === 'published');

  const log = await one(`
    select * from audit_log where entity='article' and action='article_publish_up'
    order by at desc limit 1`);
  ok('the decision is in the audit log', !!log);
  ok('with what it was before', log.before?.publish_up_state === 'requested');

  // And approving puts it on the federation's site.
  await req(`/o/whanganui/news/${id}/ask`, { method: 'POST', form: {} });
  await req(`/o/moknz/news/${id}/decide`,
    { method: 'POST', form: { answer: 'approve' } });
  const yes = await one(`select * from article where id=$1`, [id]);
  ok('approving sets both the flag and the state',
    yes.publish_up === true && yes.publish_up_state === 'approved');
}

console.log('\nTHE SITE ONLY CARRIES WHAT WAS AGREED');
{
  const { PostgresSiteContent } = await import(
    '../infrastructure/postgres/repositories.mjs');
  const site = new PostgresSiteContent(pool);
  const moknz = await one(`select id from organisation where slug='moknz'`);

  const withApproval = await site.articles(moknz.id);
  ok('an approved dojo article reaches the federation site',
    withApproval.some((a) => a.slug === 'our-view'));

  await pool.query(
    `update article set publish_up_state='declined', publish_up=false
     where slug='our-view'`);
  const without = await site.articles(moknz.id);
  ok('once declined it does not',
    !without.some((a) => a.slug === 'our-view'));
  ok('but the federation\'s own are unaffected',
    without.some((a) => a.slug === 'eleven-students-grade-to-8th-kyu'));

  ok('and the body is selected, which it was not for months',
    without.every((a) => a.body !== undefined));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
