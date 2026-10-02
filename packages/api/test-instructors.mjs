/**
 * Instructors on the public site, through real HTTP.
 *
 * The rule worth the most here is the one about minors. A teenager assisting
 * in a children's class is ordinary and good; their name, photograph and grade
 * on a page anybody can read, indefinitely, is not a decision to make on their
 * behalf because somebody ticked a box in an admin screen. The platform
 * refuses, and the refusal lives in the domain so a second route cannot route
 * around it.
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
const reason = (r) => decodeURIComponent((r.location ?? '').split('error=')[1] ?? '');

await (async () => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink('doug@example.nz');
  await req(`/signin/${token}`);
})();

const wh = await one(`select id, slug from organisation where slug='whanganui'`);

// ---------------------------------------------------------------------------

console.log('\nTHE WEBSITE FOLLOWS THE ROLL');
{
  const r = await req('/o/whanganui/instructors');
  ok('the screen renders', r.status === 200);
  ok('it lists people who hold the instructor role',
    /instructor role here/.test(r.html));

  // Somebody who is only a member cannot be put on the website.
  const member = await one(`
    select p.id from affiliation a join person p on p.id = a.person_id
    where a.organisation_id = $1 and a.role = 'member' and a.ends is null
    limit 1`, [wh.id]);
  if (member) {
    const r2 = await req(`/o/whanganui/instructors/${member.id}`,
      { method: 'POST', form: { published: 'on', teaches: 'Anything' } });
    ok('a member cannot be published as an instructor',
      reason(r2).includes('not recorded as an instructor'), reason(r2));
    ok('and is told to fix the roll first',
      reason(r2).includes('follows the register'));
  } else {
    ok('a member cannot be published as an instructor', true, '(no member here)');
    ok('and is told to fix the roll first', true, '(no member here)');
  }
}

console.log('\nNOBODY UNDER EIGHTEEN GOES ON A PUBLIC WEBSITE');
{
  // A sixteen-year-old assistant instructor — an ordinary thing to be.
  const teen = await one(`
    insert into person (first_name, last_name, date_of_birth, gender)
    values ('Mere','Tahana', (current_date - interval '16 years 3 months')::date, 'F')
    returning id`);
  await pool.query(`
    insert into affiliation (person_id, organisation_id, role, status, starts)
    values ($1,$2,'instructor','active', current_date)`, [teen.id, wh.id]);

  const screen = await req('/o/whanganui/instructors');
  ok('they are listed as an instructor', screen.html.includes('Mere'));
  ok('with a note explaining why they cannot be published',
    screen.html.includes('Under 18'));
  ok('and no checkbox offering to do it anyway',
    !new RegExp(`${teen.id}[\\s\\S]{0,2000}name="published"`).test(screen.html));

  // The checkbox being absent is not the protection. Posting it directly is.
  const forced = await req(`/o/whanganui/instructors/${teen.id}`,
    { method: 'POST', form: { published: 'on', teaches: 'Children\'s classes' } });
  ok('posting the form directly is still refused',
    reason(forced).includes('under 18'), reason(forced));
  ok('the refusal names their age', reason(forced).includes('They are 16'));
  ok('and says they can still hold the role',
    reason(forced).includes('without being on the website'));
  ok('nothing was published',
    !(await one(`select 1 from instructor_profile
                 where person_id=$1 and published`, [teen.id])));

  // They can still have a profile saved, just not a published one.
  const saved = await req(`/o/whanganui/instructors/${teen.id}`,
    { method: 'POST', form: { teaches: 'Children\'s classes' } });
  ok('an unpublished profile is allowed', saved.status === 302
    && !saved.location.includes('error='), saved.location);
  ok('and it is not on the website',
    (await one(`select published from instructor_profile
                where person_id=$1`, [teen.id]))?.published === false);
}

console.log('\nAN UNKNOWN AGE IS NOT AN ADULT');
{
  const unknown = await one(`
    insert into person (first_name, last_name, gender)
    values ('Pat','Nobody',null) returning id`);
  await pool.query(`
    insert into affiliation (person_id, organisation_id, role, status, starts)
    values ($1,$2,'instructor','active', current_date)`, [unknown.id, wh.id]);

  const r = await req(`/o/whanganui/instructors/${unknown.id}`,
    { method: 'POST', form: { published: 'on' } });
  ok('somebody with no date of birth cannot be published',
    reason(r).includes('date of birth is not recorded'), reason(r));
}

console.log('\nPUBLISHING AN ADULT, AND TAKING THEM BACK OFF');
{
  const doug = '22222222-0000-0000-0000-000000000001';
  const r = await req(`/o/whanganui/instructors/${doug}`, { method: 'POST',
    form: { published: 'on', teaches: 'Tuesday and Thursday evenings',
            bio: 'Teaching since 1998.\n\nStudent of Mas Oyama.' } });
  ok('an adult instructor publishes', r.status === 302
    && !r.location.includes('error='), r.location);

  const row = await one(`select * from instructor_profile
    where person_id=$1 and organisation_id=$2`, [doug, wh.id]);
  ok('the profile is published', row.published === true);
  ok('and records who agreed and when', !!row.published_by && !!row.published_at);
  ok('the bio became blocks, not a lump of text',
    (row.bio?.blocks ?? []).length === 2, JSON.stringify(row.bio));

  const first = row.published_at;
  await req(`/o/whanganui/instructors/${doug}`, { method: 'POST',
    form: { published: 'on', teaches: 'Tuesday, Thursday' } });
  const again = await one(`select published_at from instructor_profile
    where person_id=$1 and organisation_id=$2`, [doug, wh.id]);
  ok('editing later does not rewrite who first agreed',
    String(again.published_at) === String(first));

  const off = await req(`/o/whanganui/instructors/${doug}`,
    { method: 'POST', form: { op: 'remove' } });
  ok('taking them off the website works', off.status === 302);
  ok('and says they are still on the roll',
    decodeURIComponent(off.location ?? '').includes('still on the roll'));
  ok('the profile is gone rather than hidden',
    !(await one(`select 1 from instructor_profile where person_id=$1
                 and organisation_id=$2`, [doug, wh.id])));
  ok('but they are still an instructor',
    !!(await one(`select 1 from affiliation where person_id=$1
                  and organisation_id=$2 and role='instructor'
                  and ends is null`, [doug, wh.id])));
}

console.log('\nTHE SITE CARRIES ONLY THE PUBLISHED ONES');
{
  const { PostgresSiteContent } = await import(
    '../infrastructure/postgres/repositories.mjs');
  const site = new PostgresSiteContent(pool);

  ok('nobody published means an empty list',
    (await site.instructors('moknz')).length === 0);

  const doug = '22222222-0000-0000-0000-000000000001';
  await req(`/o/whanganui/instructors/${doug}`, { method: 'POST',
    form: { published: 'on', teaches: 'Tuesdays' } });

  const listed = await site.instructors('moknz');
  ok('a published instructor reaches the federation site', listed.length === 1);
  ok('carrying their grade from the register', !!listed[0].grade);
  ok('and their title', !!listed[0].title);
  ok('and which club they teach at',
    listed[0].organisationSlug === 'whanganui');

  // The teenager must not be reachable through the site reader either.
  ok('no unpublished profile appears',
    !listed.some((i) => i.firstName === 'Mere'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
