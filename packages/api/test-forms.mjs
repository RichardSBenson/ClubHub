/**
 * Forms and consent: building, publishing, signing (adults and children), who has not signed, renewals.
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
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CRON_SECRET = 'test-cron-secret';
const OUT = '/tmp/honbu-forms';
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
  await req(`/signin/${token}`);
};
const build = async () => {}; // unused here

const PAT_LINK = 'guardian_number';
const wh = await one(`select * from organisation where slug='whanganui'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });
const login = (person, email) => pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [email, person.id]);

const adult = await enrol('Hemi', 'Adult', '1990-01-01', 'hemi@example.nz'); await login(adult, 'hemi@example.nz');
const parent = await enrol('Pania', 'Parent', '1984-02-01', 'pania@example.nz'); await login(parent, 'pania@example.nz');
const kid = await enrol('Kahu', 'Parent', '2015-05-05', 'kahu@example.nz'); await login(kid, 'kahu@example.nz');
const stranger = await enrol('Sam', 'Stranger', '1980-01-01', 'sam@example.nz'); await login(stranger, 'sam@example.nz');
await pool.query(`insert into guardian_link (child_id, guardian_id, relationship) values ($1,$2,'parent')`, [kid.id, parent.id]).catch(() => {});

console.log('\nBUILDING A FORM');
let formId;
await signIn('doug@example.nz');
{
  let r = await req('/o/whanganui/forms');
  ok('the forms screen opens', r.status === 200 && /Forms and consent/.test(r.html));
  ok('starting points are offered', /Photo/i.test(r.html) && /Waiver|waiver/.test(r.html));
  r = await req('/o/whanganui/forms', { method: 'POST', form: { starter: 'waiver' } });
  ok('a starter form is created', r.status === 302 && /\/forms\/[0-9a-f-]{36}/.test(r.location));
  formId = r.location.match(/forms\/([0-9a-f-]{36})/)[1];
  r = await req(`/o/whanganui/forms/${formId}`);
  ok('the editor shows its questions', /Questions \(\d+\)/.test(r.html) && /Not published/.test(r.html));
  r = await req(`/o/whanganui/forms/${formId}/fields`, { method: 'POST', form: { label: 'Allergies?', type: 'text' } });
  ok('a question is added', /done=/.test(r.location));
  r = await req(`/o/whanganui/forms/${formId}/fields`, { method: 'POST', form: { label: '', type: 'text' } });
  ok('an empty question is refused', /error=/.test(r.location));
  r = await req('/o/whanganui/forms', { method: 'POST', form: { title: '' } });
  ok('a form needs a title', /error=/.test(r.location));
  const before = (await one('select fields from club_form where id=$1', [formId])).fields.length;
  const last = (await one('select fields from club_form where id=$1', [formId])).fields.at(-1).id;
  await req(`/o/whanganui/forms/${formId}/fields/${last}/remove`, { method: 'POST', form: {} });
  ok('a question is removed', (await one('select fields from club_form where id=$1', [formId])).fields.length === before - 1);
  r = await req(`/o/whanganui/forms/${formId}/status`, { method: 'POST', form: { status: 'published' } });
  ok('the form is published', /done=/.test(r.location) && (await one('select status from club_form where id=$1', [formId])).status === 'published');
}

console.log('\nSIGNING');
await signIn('hemi@example.nz');
{
  let r = await req('/me');
  ok('the adult is asked to sign on their home page', /Please complete/.test(r.html) || /forms\//.test(r.html));
  r = await req(`/me/forms/${adult.id}`);
  ok('their list shows the form to do', r.status === 200 && /To do/.test(r.html) && /href="\/me\/forms\/[0-9a-f-]{36}\//.test(r.html));
  r = await req(`/me/forms/${formId}/${adult.id}`);
  ok('the form opens', r.status === 200 && /Sign and submit/.test(r.html));
  const f = (await one('select fields from club_form where id=$1', [formId])).fields;
  const ticks = Object.fromEntries(f.filter((q) => q.type === 'agree').map((q) => [`q_${q.id}`, 'on']));
  r = await req(`/me/forms/${formId}/${adult.id}`, { method: 'POST', form: { signedName: 'Hemi Adult' } });
  ok('unticked required statements are refused', r.status === 422 && /Please tick/.test(r.html));
  r = await req(`/me/forms/${formId}/${adult.id}`, { method: 'POST', form: { ...ticks } });
  ok('an unsigned submission is refused', r.status === 422 && /full name/.test(r.html));
  r = await req(`/me/forms/${formId}/${adult.id}`, { method: 'POST', form: { ...ticks, signedName: 'Hemi Adult' } });
  ok('signing works', r.status === 302);
  ok('it is stored with name and version', !!(await one(`select 1 x from form_response where person_id=$1 and signed_name='Hemi Adult' and form_version=1`, [adult.id])));
  r = await req(`/me/forms/${adult.id}`);
  ok('it moves to signed', /Signed/.test(r.html) && !/href="\/me\/forms\/[0-9a-f-]{36}\/[^"]+">Waiver/.test(r.html.split('<h2>Signed</h2>')[0].split('<h2>To do</h2>')[1] ?? ''));
  r = await req(`/me/forms/${formId}/${kid.id}`);
  ok('they cannot open it for somebody else\'s child', r.status === 403 || r.status === 404);
  r = await req(`/me/forms/${formId}/${stranger.id}`, { method: 'POST', form: { signedName: 'Hemi Adult' } });
  ok('nor sign for a stranger', r.status === 403 || r.status === 404);
}
await signIn('kahu@example.nz');
{
  const f = (await one('select fields from club_form where id=$1', [formId])).fields;
  const ticks = Object.fromEntries(f.filter((q) => q.type === 'agree').map((q) => [`q_${q.id}`, 'on']));
  const r = await req(`/me/forms/${formId}/${kid.id}`, { method: 'POST', form: { ...ticks, signedName: 'Kahu Parent' } });
  ok('a child cannot sign for themselves', r.status === 422 && /parent or guardian/i.test(r.html) || r.status === 403);
}
await signIn('pania@example.nz');
{
  const f = (await one('select fields from club_form where id=$1', [formId])).fields;
  const ticks = Object.fromEntries(f.filter((q) => q.type === 'agree').map((q) => [`q_${q.id}`, 'on']));
  let r = await req('/me');
  ok('the parent is asked about the child', /Kahu/.test(r.html) && /Please complete/.test(r.html));
  r = await req(`/me/forms/${formId}/${kid.id}`, { method: 'POST', form: { ...ticks, signedName: 'Pania Parent' } });
  ok('a parent signs for their child', r.status === 302);
  ok('recorded as signed for a minor', !!(await one(`select 1 x from form_response where person_id=$1 and signed_for_minor`, [kid.id])));
}

console.log('\nWHO HAS SIGNED');
await signIn('doug@example.nz');
{
  let r = await req(`/o/whanganui/forms/${formId}/status`);
  ok('the status screen lists people and counts', r.status === 200 && /signed ·/.test(r.html) && /Adult/.test(r.html));
  ok('those who have not signed are shown', /Not signed/.test(r.html) && /Stranger/.test(r.html));
  r = await req(`/o/whanganui/forms/${formId}/status?filter=todo`);
  ok('the chase list leaves out those who have signed', !/Hemi/.test(r.html) || !/>Signed</.test(r.html));
  r = await req(`/o/whanganui/forms/${formId}/status.csv`);
  ok('a CSV can be downloaded', r.status === 200 && /text\/csv/.test(r.headers.get('content-type')) && /Not signed/.test(r.html) && /Hemi/.test(r.html));
  r = await req(`/o/whanganui/forms/${formId}/people/${adult.id}`);
  ok('an official can read the answers', r.status === 200 && /Hemi Adult/.test(r.html));
}

console.log('\nASKING AGAIN');
{
  let r = await req(`/o/whanganui/forms/${formId}/fields`, { method: 'POST', form: { label: 'Any injuries?', type: 'text' } });
  await signIn('hemi@example.nz');
  r = await req(`/me/forms/${adult.id}`);
  ok('an ordinary edit does not ask anyone again', !/<h2>To do<\/h2>\s*<ul>/.test(r.html));
  await signIn('doug@example.nz');
  r = await req(`/o/whanganui/forms/${formId}/ask-again`, { method: 'POST', form: {} });
  ok('asking again raises the version', (await one('select version from club_form where id=$1', [formId])).version === 2);
  await signIn('hemi@example.nz');
  r = await req(`/me/forms/${adult.id}`);
  ok('now the adult is asked again', /<h2>To do<\/h2>\s*<ul>/.test(r.html));
  ok('their earlier answer is kept as history', (await one(`select count(*)::int n from form_response where person_id=$1`, [adult.id])).n === 1);
}

console.log('\nKEEPING OUT');
await signIn('sam@example.nz');
{
  let r = await req('/o/whanganui/forms');
  ok('an ordinary member cannot see the builder', r.status === 403 || r.status === 404);
  r = await req(`/o/whanganui/forms/${formId}/status`);
  ok('nor who has signed', r.status === 403 || r.status === 404);
  r = await req(`/o/whanganui/forms/${formId}/status`, { method: 'POST', form: { status: 'draft' } });
  ok('nor change a form', r.status === 403 || r.status === 404);
}
await signIn('doug@example.nz');
{
  const other = await one(`select id from organisation where slug <> 'whanganui' and parent_id is not null limit 1`);
  const r = await req(`/o/${(await one('select slug from organisation where id=$1', [other.id])).slug}/forms/${formId}`);
  ok('a form is not reachable through another organisation', r.status === 404 || r.status === 403);
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
