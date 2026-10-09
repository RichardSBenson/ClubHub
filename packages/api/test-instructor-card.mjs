/**
 * Instructors.
 *
 *   1. One profile for everybody; "instructor" is a tick, and only somebody above them can make it.
 *   2. One photograph on the person's record, with consent, used on the card and the website.
 *   3. One instructor card, the same on a dojo's page and the Instructors page.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people } from './data.mjs';
import { identify } from '../content/images.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CRON_SECRET = 'test-cron-secret';
const OUT = '/tmp/honbu-instructors';
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
async function multi(p, fields = {}, file = null) {
  const fd = new FormData();
  fd.append('_csrf', jar.honbu_csrf ?? '');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append(file.field, new Blob([file.bytes], { type: 'image/png' }), file.name);
  const res = await fetch(base + p, { method: 'POST', headers: { cookie: cookie() }, redirect: 'manual', body: fd });
  keep(res);
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`, { method: 'POST', form: {} });
};
const build = async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await run(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..') });
};



const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const wh = await one(`select * from organisation where slug='whanganui'`);
const root = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });
const login = async (person, email) => {
  await pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [email, person.id]);
};

const sensei = await enrol('Hana', 'Sensei', '1980-03-03', 'hana.sensei@example.nz');
const plain = await enrol('Pat', 'Plain', '1990-04-04', 'pat.plain@example.nz');
await login(sensei, 'hana.sensei@example.nz'); await login(plain, 'pat.plain@example.nz');
{
  const g = await one(`select g.id from grade g join organisation o on o.id = g.organisation_id where g.label = '1st dan' and o.parent_id is null limit 1`);
  await pool.query(`insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result, panel) values ($1,$2,'2015-01-01',$3,'pass','[]')`, [sensei.id, g.id, root.id]);
}
const instructorRows = async () => (await one(`select count(*)::int as n from affiliation where person_id=$1 and role='instructor' and ends is null`, [sensei.id])).n;

console.log('\nONE PROFILE, ONE TICK');
await signIn('doug@example.nz');
{
  let r = await req(`/p/${sensei.id}`);
  ok('the profile opens with a name and no badge', r.status === 200 && /Hana Sensei/.test(r.html) && !/class="idchip">Instructor/.test(r.html));
  ok('the owner sees the tick', /name="instructor"/.test(r.html));
  r = await req(`/p/${plain.id}`);
  ok('somebody who is not a black belt is not offered the tick at all', !/name="instructor"/.test(r.html));
  r = await req(`/p/${sensei.id}/instructor`, { method: 'POST', form: { instructor: 'on' } });
  ok('ticking records the role', r.status === 302 && await instructorRows() === 1);
  r = await req(`/p/${sensei.id}`);
  ok('and the same profile now carries the badge', /class="idchip">Instructor/.test(r.html) && /checked/.test(r.html.slice(r.html.indexOf('name="instructor"'), r.html.indexOf('name="instructor"') + 120)));
  ok('the profile says the website does not show them yet, with the way to change it', /Not shown yet/.test(r.html) && new RegExp(`href="/o/whanganui/instructors"[^>]*>Show them on the website`).test(r.html));
  await signIn('hana.sensei@example.nz');
  r = await req(`/me/${sensei.id}`);
  ok('the instructor sees the same on their own page, without a switch they cannot use', /You are an instructor at/.test(r.html) && /Not on the club website yet/.test(r.html) && !/Show them on the website/.test(r.html));
  await signIn('doug@example.nz');
  await req(`/p/${sensei.id}/instructor`, { method: 'POST', form: { instructor: 'on' } });
  ok('ticking twice changes nothing', await instructorRows() === 1);

  await signIn('pat.plain@example.nz');
  r = await req(`/p/${sensei.id}/instructor`, { method: 'POST', form: { instructor: '' } });
  ok('an ordinary member cannot untick somebody', (r.status === 403 || r.status === 404) && await instructorRows() === 1);
  r = await req(`/p/${plain.id}/instructor`, { method: 'POST', form: { instructor: 'on' } });
  ok('nor tick themselves', (r.status === 403 || r.status === 404) && !(await one(`select 1 as x from affiliation where person_id=$1 and role='instructor'`, [plain.id])));
}

console.log('\nTHE PHOTOGRAPH');
await signIn('doug@example.nz');
{
  let r = await multi(`/p/${sensei.id}/photo`, {}, { field: 'photo', bytes: PNG, name: 'hana.png' });
  ok('an adult needs nobody\'s agreement for their photograph', r.status === 302 && /done=Photograph/.test(r.location), r.location);
  r = await multi(`/p/${sensei.id}/photo`, { consent: 'on' }, { field: 'photo', bytes: PNG, name: 'hana.png' });
  ok('and ticking it does no harm, it is saved', r.status === 302 && /done=Photograph/.test(r.location));
  const p = await one(`select p.photo_asset_id, a.consent_ref from person p join asset a on a.id = p.photo_asset_id where p.id=$1`, [sensei.id]);
  ok('on the person\'s record, with the consent noted', !!p && /agreement/.test(p.consent_ref));
  r = await req(`/p/${sensei.id}/photo`);
  ok('an official can see it', r.status === 200 && /image\/png/.test(r.headers.get('content-type')));
  ok('the profile shows it', /class="idphoto"/.test((await req(`/p/${sensei.id}`)).html));
  await signIn('pat.plain@example.nz');
  r = await req(`/p/${sensei.id}/photo`);
  ok('a stranger cannot fetch it', r.status === 403 || r.status === 404);
  // The member's own page: that is where they look for it.
  r = await req(`/me/${plain.id}`);
  ok('a member finds the photograph form on their own details page', r.status === 200 && new RegExp(`action="/p/${plain.id}/photo"`).test(r.html) && /name="return" value="me"/.test(r.html));
  r = await multi(`/p/${plain.id}/photo`, { consent: 'on', return: 'me' }, { field: 'photo', bytes: PNG, name: 'pat.png' });
  ok('saving it brings them back to their own page', r.status === 302 && r.location.startsWith(`/me/${plain.id}?done=Photograph`), r.location);
  ok('where they can see it', new RegExp(`class="idphoto" src="/p/${plain.id}/photo"`).test((await req(`/me/${plain.id}`)).html));
  await signIn('doug@example.nz');
}

console.log('\nWHAT THE WEBSITE SAYS');
let year = new Date().getFullYear() - 25;
{
  let r = await req('/o/whanganui/instructors');
  ok('there is no per-person card form: the roll is where instructors are chosen', r.status === 302 && /roster\?show=instructors/.test(r.location));
  const form = { teaches: 'Juniors, Tuesday and Thursday', bio: 'Hana has taught children for twenty years.\n\nShe grades regularly.', sortOrder: '0', startedYear: String(year), published: 'on', showChecks: 'on' };
  r = await req(`/o/whanganui/instructors/${sensei.id}`, { method: 'POST', form: { ...form, startedYear: '1850' } });
  ok('a silly year is refused', /error=/.test(r.location) && /year/.test(decodeURIComponent(r.location)));
  await pool.query(`delete from qualification_award where qualification_id in (select id from qualification where organisation_id=$1)`, [root.id]);
  await pool.query(`delete from qualification where organisation_id=$1 and code in ('police-vet','first-aid')`, [root.id]);
  const q1 = (await one(`insert into qualification (organisation_id, code, label, category, valid_months) values ($1,'police-vet','Police vetting','safeguarding',36) returning id`, [root.id])).id;
  const q2 = (await one(`insert into qualification (organisation_id, code, label, category, valid_months) values ($1,'first-aid','First aid','medical',12) returning id`, [root.id])).id;
  await pool.query(`insert into qualification_award (person_id, qualification_id, awarded_on) values ($1,$2,current_date - 100)`, [sensei.id, q1]);
  await pool.query(`insert into qualification_award (person_id, qualification_id, awarded_on, expires_on) values ($1,$2,current_date - 800, current_date - 400)`, [sensei.id, q2]);
  r = await req(`/o/whanganui/instructors/${sensei.id}`, { method: 'POST', form });
  ok('saved and published', r.status === 302 && /done=Saved%20and%20on/.test(r.location));
  const row = await one(`select published, started_year, show_checks from instructor_profile where person_id=$1`, [sensei.id]);
  ok('with the year and the checks choice kept', row.published && row.started_year === year && row.show_checks === true);

  await build();
  const dojo = fs.readFileSync(path.join(OUT, 'whanganui/index.html'), 'utf8');
  fs.copyFileSync(path.join(OUT, 'whanganui/index.html'), '/tmp/dbg-dojo.html'); fs.copyFileSync(path.join(OUT, 'instructors/index.html'), '/tmp/dbg-inst.html');
  ok('the dojo page has "Your instructor"', /Your instructor<\/h2>/.test(dojo) && /Hana Sensei/.test(dojo));
  ok('in the fixed format', ['class="icard"', 'class="iphoto"', 'Teaches</b> Juniors', `Training since</b> ${year}`, 'Hana has taught children'].every((t) => dojo.includes(t)));
  ok('with her photograph from her record', /<img class="iphoto" src="\/images\/[^"]+"/.test(dojo));
  ok('and only the checks that are current', /<li>Police vetting<\/li>/.test(dojo) && !/First aid/.test(dojo));
  const all = fs.readFileSync(path.join(OUT, 'instructors/index.html'), 'utf8');
  ok('the Instructors page uses the same card', /class="icard"/.test(all) && /Hana Sensei/.test(all) && /She grades regularly/.test(all));
  ok('and says where she teaches', /href="\/whanganui"/.test(all));

  await req(`/o/whanganui/instructors/${sensei.id}`, { method: 'POST', form: { ...form, showChecks: '' } });
  await build();
  ok('checks are shown only if she chose to', !/Police vetting/.test(fs.readFileSync(path.join(OUT, 'whanganui/index.html'), 'utf8')));

  await signIn('doug@example.nz');
  await req(`/p/${sensei.id}/instructor`, { method: 'POST', form: {} });
  ok('unticking ends the role', await instructorRows() === 0);
  ok('and takes her off the website', (await one(`select published from instructor_profile where person_id=$1`, [sensei.id])).published === false);
  await build();
  { const h = fs.readFileSync(path.join(OUT, 'whanganui/index.html'), 'utf8');
    ok('so the dojo page shows the placeholder, not a person', /class="icard waiting"/.test(h) && /Introductions coming soon/.test(h) && !/class="icard"/.test(h)); }
  ok('and the history is kept', (await one(`select count(*)::int as n from affiliation where person_id=$1 and role='instructor'`, [sensei.id])).n === 1);
}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
