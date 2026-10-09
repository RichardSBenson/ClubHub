/**
 * Recording a grade somebody already holds: kyu by their club, dan by the federation, never awarded.
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
const OUT = '/tmp/honbu-recognise';
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


const pat = await enrol('3rd dan', 'Sam', '1975-05-05', 'sam.sandan@example.nz');
await login(pat, 'sam.sandan@example.nz');
const plain = await enrol('Pat', 'Plain', '1990-04-04', 'pat.plain@example.nz');
await login(plain, 'pat.plain@example.nz');
const grade = async (label) => (await one(`select id, rank_order from grade g where label=$1 and organisation_id=$2`, [label, root.id]));
const records = async () => (await pool.query(`select g.label, r.notes, r.awarded_on::text d, r.certificate_no, r.panel, r.awarded_by_org from grading_record r join grade g on g.id=r.grade_id where r.person_id=$1 order by g.rank_order`, [pat.id])).rows;
const sandan = await grade('3rd dan'), shodan = await grade('1st dan'), fiveKyu = await grade('5th kyu');
const today = new Date().toISOString().slice(0, 10);

console.log('\nA DOJO OFFICIAL');
const regAcc = (await pool.query(`insert into account (email) values ('dojo.registrar@example.nz') on conflict (email) do update set email=excluded.email returning id`)).rows[0];
await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,'registrar')`, [regAcc.id, wh.id]);
await signIn('dojo.registrar@example.nz');
{
  let r = await req(`/p/${pat.id}`);
  ok('the profile offers to record a grade held already', /action="\/p\/[^"]+\/recognise-grade"/.test(r.html));
  const menu = r.html.slice(r.html.indexOf('name="gradeId"'), r.html.indexOf('</select>', r.html.indexOf('name="gradeId"')));
  ok('kyu grades are on offer', menu.includes('5th kyu'));
  ok('black belts are not, to a dojo', !menu.includes('3rd dan') && !menu.includes('1st dan'));
  r = await req(`/p/${pat.id}/recognise-grade`, { method: 'POST', form: { gradeId: sandan.id, heldOn: '2019-06-01' } });
  ok('a dojo cannot type in a black belt', (r.status === 403 || r.status === 404) && (await records()).length === 0);
  r = await req(`/p/${pat.id}/recognise-grade`, { method: 'POST', form: { gradeId: fiveKyu.id, heldOn: '2015-03-02', note: 'Awarded in Tokyo' } });
  ok('a kyu grade is recorded', r.status === 302 && /done=/.test(r.location) && (await records()).length === 1);
  const k = (await records())[0];
  ok('as held already: no panel, no certificate', k.panel.length === 0 && !k.certificate_no && /Recognised: held before joining/.test(k.notes) && /Tokyo/.test(k.notes) && k.d === '2015-03-02');
  r = await req(`/p/${pat.id}/recognise-grade`, { method: 'POST', form: { gradeId: fiveKyu.id } });
  ok('the same grade twice is refused', /error=/.test(r.location) && (await records()).length === 1);
  r = await req(`/p/${pat.id}/recognise-grade`, { method: 'POST', form: { gradeId: (await grade('4th kyu')).id, heldOn: '2999-01-01' } });
  ok('a date in the future is refused', /error=/.test(r.location));
  ok('the action is in the audit log', !!(await one(`select 1 x from audit_log where action='grade_recognised' and entity_id=$1`, [pat.id])));
  await signIn('pat.plain@example.nz');
  r = await req(`/p/${pat.id}/recognise-grade`, { method: 'POST', form: { gradeId: (await grade('3rd kyu')).id } });
  ok('an ordinary member cannot', (r.status === 403 || r.status === 404));
}

console.log('\nA FEDERATION OFFICIAL');
{
  await signIn('doug@example.nz');
  let r = await req(`/p/${pat.id}`);
  ok('a federation owner can open the profile', r.status === 200, String(r.status));
  const menu = r.html.slice(r.html.indexOf('name="gradeId"'), r.html.indexOf('</select>', r.html.indexOf('name="gradeId"')));
  ok('and is offered black belts', menu.includes('3rd dan') && menu.includes('1st dan'));
  r = await req(`/p/${pat.id}/recognise-grade`, { method: 'POST', form: { gradeId: sandan.id, heldOn: '2019-06-01', note: 'Shihan Smith' } });
  ok('3rd dan is recorded', r.status === 302 && /done=3rd(\s|%20)dan/.test(r.location));
  const rec = (await records()).find((x) => x.label === '3rd dan');
  ok('against the federation, with no panel or certificate', rec && rec.awarded_by_org === root.id && !rec.certificate_no && rec.panel.length === 0);
  const cur = await one(`select g.label from person_current_grade cg join grade g on g.id = cg.grade_id where cg.person_id=$1`, [pat.id]);
  ok('it becomes their current grade', cur?.label === '3rd dan', JSON.stringify(cur));
  r = await req(`/p/${pat.id}`);
  const menu2 = r.html.slice(r.html.indexOf('name="gradeId"'), r.html.indexOf('</select>', r.html.indexOf('name="gradeId"')));
  ok('and only higher grades are offered after that', !menu2.includes('1st dan') && !menu2.includes('3rd dan') && menu2.includes('4th dan'));
  r = await req(`/p/${pat.id}/recognise-grade`, { method: 'POST', form: { gradeId: shodan.id } });
  ok('a lower grade cannot be added behind it', /error=/.test(r.location));
}

server.close();
await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
