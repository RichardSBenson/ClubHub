/**
 * Can somebody who runs a dojo put their club on this system?
 *
 * Real HTTP, real forms, real database. Written as the sequence a club
 * actually goes through: sign in, paste the spreadsheet you already have,
 * look at what it says it will do, fix what is wrong, import it, then add the
 * person who turned up this week and correct the one whose number changed.
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
           html: await res.text() };
}

const count = async (sql, args = []) =>
  (await pool.query(sql, args)).rows[0].n;

const onRoll = () => count(`
  select count(*)::int n from affiliation a
  join organisation o on o.id = a.organisation_id
  where o.slug = 'whanganui' and a.ends is null`);

// A roll the way one actually arrives: headings nobody agreed on, dates
// written three ways, a belt spelled loosely, somebody already on the system,
// the same person entered twice, and one row that is simply wrong.
const SPREADSHEET = [
  'Given Name\tSurname\tD.O.B.\tEmail\tMobile\tGrade\tExpiry\tEmergency Contact\tLocker',
  'Ngaio\tHarrison\t14/08/2009\tngaio@example.nz\t0211234567\t2nd kyu\t31/12/2026\tKiri Harrison\t14',
  'Tomas\tRiu\t3 June 1988\ttomas@example.nz\t\t1st dan\t2026-12-31\t\t7',
  'Ana\tSolomona\t25/12/2001\tana@example.nz\t\tPurple belt\t\t\t',
  'Tomas\tRiu\t3 June 1988\ttomas@example.nz\t\t1st dan\t\t\t',
  '\tNobody\t03/04/2015\tnot-an-email\t\t\t\t\t',
].join('\n');

// ---------------------------------------------------------------------------

console.log('\nTHE ROLL IS BEHIND SIGN-IN');
{
  ok('adding someone redirects when signed out',
    (await req('/o/whanganui/members/new')).status === 302);
  ok('so does importing', (await req('/o/whanganui/members/import')).status === 302);
}

console.log('\nSIGNED IN AS THE REGISTRAR');
{
  await req('/signin');
  const { token } = await auth.requestLink('doug@example.nz');
  ok('the session is live', (await req(`/signin/${token}`, { method: 'POST', form: {} })).status === 302);

  const roll = await req('/o/whanganui/roster');
  ok('the roll opens', roll.status === 200);
  ok('and offers both ways in',
    roll.html.includes('/members/new') && roll.html.includes('/members/import'));
}

console.log('\nPASTING THE SPREADSHEET SHOWS WHAT WOULD HAPPEN');
{
  const before = await onRoll();
  const r = await req('/o/whanganui/members/import',
    { method: 'POST', form: { text: SPREADSHEET } });
  ok('the preview renders', r.status === 200);

  ok('it understood the headings whatever they were called',
    r.html.includes('first name') && r.html.includes('date of birth')
    && r.html.includes('emergency contact'), 'columns not reported');
  ok('and says which column it ignored', r.html.includes('Locker'));

  ok('three would be added', r.html.includes('3 to add'),
    (r.html.match(/<strong>[^<]*to add[^<]*/) ?? [''])[0]);
  ok('one is a repeat of an earlier line',
    r.html.includes('already on the roll'));
  ok('and one cannot go in', r.html.includes('cannot go in'));

  ok('the ambiguous date is named, not guessed',
    r.html.includes('could be'), 'no ambiguity warning');
  ok('the missing first name is reported', r.html.includes('first name is required'));
  ok('the bad email too', r.html.includes('does not look like an email'));
  ok('the belt that is not in the syllabus is called out',
    r.html.includes('not a grade'));
  ok('and the belts that are say they will be recorded',
    r.html.includes('already held'));

  ok('NOTHING HAS BEEN WRITTEN', await onRoll() === before,
    `${before} → ${await onRoll()}`);
  ok('and it says so', r.html.includes('Nothing has been saved yet'));
}

console.log('\nCONFIRMING WRITES IT, ONCE');
{
  const before = await onRoll();
  const r = await req('/o/whanganui/members/import',
    { method: 'POST', form: { text: SPREADSHEET, confirm: 'yes' } });
  ok('it redirects to the roll',
    r.status === 302 && r.location.startsWith('/o/whanganui/roster'), r.location);
  ok('saying how many went in',
    decodeURIComponent(r.location).includes('3 added'),
    decodeURIComponent(r.location ?? ''));

  ok('three people are on the roll', await onRoll() === before + 3,
    `${before} → ${await onRoll()}`);

  const { rows: [ngaio] } = await pool.query(
    `select * from person where email = 'ngaio@example.nz'`);
  ok('the date of birth is the day they were born, not a day either side',
    ngaio?.date_of_birth === '2009-08-14', String(ngaio?.date_of_birth));
  ok('they were given a member number', /^[A-Z]+-\d{4}$/.test(ngaio?.display_number),
    ngaio?.display_number);
  ok('the phone came across', ngaio?.phone === '0211234567');

  ok('the emergency contact was stored', await count(
    `select count(*)::int n from person_private
     where person_id = $1 and emergency_name = 'Kiri Harrison'`, [ngaio.id]) === 1);

  ok('the one entered twice was only created once', await count(
    `select count(*)::int n from person where email = 'tomas@example.nz'`) === 1);
  ok('and the row that was wrong was not created at all', await count(
    `select count(*)::int n from person where last_name = 'Nobody'`) === 0);
}

console.log('\nA GRADE ALREADY HELD IS RECORDED, NOT AWARDED');
{
  const { rows } = await pool.query(`
    select g.label, gr.notes, gr.panel, gr.ratified_on, gr.result
    from grading_record gr
    join grade g on g.id = gr.grade_id
    join person p on p.id = gr.person_id
    where p.email = 'ngaio@example.nz'`);
  ok('the grade is on their record', rows.length === 1, `${rows.length} records`);
  ok('matched to the federation\'s own label', rows[0]?.label === '2nd kyu',
    rows[0]?.label);
  ok('with no panel, because there was none',
    JSON.stringify(rows[0]?.panel) === '[]', JSON.stringify(rows[0]?.panel));
  ok('not ratified, because this system did not ratify it',
    rows[0]?.ratified_on === null);
  ok('and the record says where it came from',
    rows[0]?.notes?.includes('not\n              graded through this system')
    || rows[0]?.notes?.includes('not graded through this system'), rows[0]?.notes);

  ok('the person whose belt was not in the syllabus has no grade', await count(`
    select count(*)::int n from grading_record gr
    join person p on p.id = gr.person_id where p.email = 'ana@example.nz'`) === 0);
}

console.log('\nIMPORTING THE SAME SPREADSHEET AGAIN DOES NOTHING');
{
  const before = await onRoll();
  const r = await req('/o/whanganui/members/import',
    { method: 'POST', form: { text: SPREADSHEET } });
  ok('everybody is now a duplicate', r.html.includes('0 to add'),
    (r.html.match(/<strong>[^<]*to add[^<]*/) ?? [''])[0]);
  ok('and there is no button to press', !r.html.includes('name="confirm"'));

  const forced = await req('/o/whanganui/members/import',
    { method: 'POST', form: { text: SPREADSHEET, confirm: 'yes' } });
  ok('forcing it anyway is refused', forced.status === 422, String(forced.status));
  ok('with nothing written', await onRoll() === before,
    `${before} → ${await onRoll()}`);
}

console.log('\nA ROLL THAT WOULD HALF-WORK IS NOT HALF-WRITTEN');
{
  // The whole spreadsheet goes in together or not at all: a club cannot tell
  // which eighty of their hundred made it, and re-running duplicates them.
  const before = await onRoll();
  const r = await req('/o/whanganui/members/import', { method: 'POST',
    form: { text: 'First Name\tLast Name\nPat\tKeen\n\tBroken\n',
            confirm: 'yes' } });
  ok('the good row went in', r.status === 302);
  ok('and only the good row', await onRoll() === before + 1,
    `${before} → ${await onRoll()}`);
  ok('the broken one is not there',
    await count(`select count(*)::int n from person where last_name='Broken'`) === 0);
}

console.log('\nNOTHING PASTED IN');
{
  const r = await req('/o/whanganui/members/import',
    { method: 'POST', form: { text: '   ' } });
  ok('says so plainly', r.status === 422 && r.html.includes('nothing pasted in'));
}

console.log('\nA SPREADSHEET WITH NO NAME COLUMN');
{
  const r = await req('/o/whanganui/members/import', { method: 'POST',
    form: { text: 'Email\tPhone\nx@example.nz\t021\n' } });
  ok('it says which column is missing',
    r.html.includes('missing a column'), 'no missing-column warning');
  ok('and offers nothing to confirm', !r.html.includes('name="confirm"'));
}

console.log('\nADDING THE PERSON WHO TURNED UP THIS WEEK');
{
  const f = await req('/o/whanganui/members/new');
  ok('the form opens', f.status === 200 && f.html.includes('name="firstName"'));
  ok('with the roles this federation uses', f.html.includes('value="instructor"'));

  const before = await onRoll();
  const r = await req('/o/whanganui/members/new', { method: 'POST', form: {
    firstName: 'Wiremu', lastName: 'Kaa', dateOfBirth: '2012-05-04',
    email: 'wiremu@example.nz', phone: '0277654321', role: 'member',
    emergencyName: 'Hine Kaa', emergencyPhone: '0279999999',
    paidUntil: '2026-12-31' } });
  ok('it lands on their new record',
    r.status === 302 && /^\/p\/[0-9a-f-]{36}$/.test(r.location ?? ''), r.location);
  ok('they are on the roll', await onRoll() === before + 1);

  const page = await req(r.location);
  ok('the record renders', page.status === 200 && page.html.includes('Wiremu'));
  ok('with a member number', /[A-Z]+-\d{4}/.test(page.html));
  ok('and no grading history, because they have not graded',
    page.html.includes('No gradings on file'));
}

console.log('\nWHAT THE FORM WILL NOT ACCEPT');
{
  const before = await onRoll();
  const r = await req('/o/whanganui/members/new', { method: 'POST', form: {
    firstName: '', lastName: 'Ngata', dateOfBirth: '2030-01-01',
    email: 'not an email', role: 'member' } });
  ok('it is refused', r.status === 422, String(r.status));
  ok('every problem at once, not the first one',
    r.html.includes('first name is required') && r.html.includes('future')
    && r.html.includes('does not look like an email'),
    'not all three reported');
  ok('with what they typed still in the form', r.html.includes('value="Ngata"'));
  ok('and nobody created', await onRoll() === before);
}

console.log('\nCORRECTING A RECORD');
{
  const { rows: [p] } = await pool.query(
    `select id from person where email = 'wiremu@example.nz'`);

  const f = await req(`/p/${p.id}/edit`);
  ok('the form opens filled in', f.status === 200
    && f.html.includes('value="Wiremu"'));
  ok('the date of birth reads back as the day they were born',
    f.html.includes('value="2012-05-04"'),
    (f.html.match(/name="dateOfBirth"[^>]*/) ?? [''])[0]);
  ok('the emergency contact is there to correct',
    f.html.includes('value="Hine Kaa"'));
  ok('and grade is nowhere on it', !f.html.includes('name="gradeId"')
    && f.html.includes('Grade is not on this form'));

  const r = await req(`/p/${p.id}/edit`, { method: 'POST', form: {
    firstName: 'Wiremu', lastName: 'Kaa-Smith', dateOfBirth: '2012-05-04',
    email: 'wiremu@example.nz', phone: '0277654321',
    emergencyName: 'Hine Kaa', emergencyPhone: '0270000000',
    status: 'active', paidUntil: '2027-12-31' } });
  ok('it saves', r.status === 302, String(r.status) + r.html.slice(0, 200));

  const { rows: [after] } = await pool.query(
    'select * from person where id = $1', [p.id]);
  ok('the surname changed', after.last_name === 'Kaa-Smith');
  ok('and the date of birth did not shift a day',
    after.date_of_birth === '2012-05-04', String(after.date_of_birth));

  ok('the emergency phone was corrected — it used to be unchangeable',
    await count(`select count(*)::int n from person_private
      where person_id = $1 and emergency_phone = '0270000000'`, [p.id]) === 1);

  ok('and the paid-until date moved', await count(`
    select count(*)::int n from affiliation
    where person_id = $1 and ends is null and paid_until = '2027-12-31'`,
    [p.id]) === 1);
}

console.log('\nAN EDIT CANNOT SNEAK PAST THE RULES THE FORM ENFORCES');
{
  const { rows: [p] } = await pool.query(
    `select id, date_of_birth from person where email = 'wiremu@example.nz'`);
  const r = await req(`/p/${p.id}/edit`, { method: 'POST', form: {
    firstName: 'Wiremu', lastName: 'Kaa-Smith', dateOfBirth: '2099-01-01',
    email: 'wiremu@example.nz' } });
  ok('a date of birth in the future is refused on edit too',
    r.status === 422 && r.html.includes('future'), String(r.status));

  const { rows: [after] } = await pool.query(
    'select date_of_birth from person where id = $1', [p.id]);
  ok('and the record is untouched',
    String(after.date_of_birth) === String(p.date_of_birth));
}

console.log('\nSEEING THE ROLL IS NOT PERMISSION TO CHANGE IT');
{
  const saved = { ...jar };
  for (const k of Object.keys(jar)) delete jar[k];
  await req('/signin');
  const { token } = await auth.requestLink('tane@example.nz');
  await req(`/signin/${token}`, { method: 'POST', form: {} });

  ok('another club\'s roll is refused',
    (await req('/o/whanganui/roster')).status === 403);
  ok('so is its import page',
    (await req('/o/whanganui/members/import')).status === 403);

  const before = await onRoll();
  const p = await req('/o/whanganui/members/import', { method: 'POST',
    form: { text: 'First Name\tLast Name\nSnuck\tIn\n', confirm: 'yes' } });
  ok('and posting to it writes nothing',
    p.status === 403 && await onRoll() === before, String(p.status));

  for (const k of Object.keys(jar)) delete jar[k];
  Object.assign(jar, saved);
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
await pool.end();
process.exit(fail ? 1 : 0);
