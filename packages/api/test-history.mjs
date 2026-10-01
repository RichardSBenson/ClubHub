/**
 * The audit log, read by somebody trying to settle an argument.
 *
 * Thirteen places in this system wrote to it and nothing read it. The tests
 * that matter here are the last two: a club administrator must not be able to
 * read the federation's history, and nothing — not the application, not the
 * connection it uses — may edit or delete what the log says.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool } from './data.mjs';
import * as auth from './auth.mjs';
import { describe, fieldsChanged, ACTIONS } from '../content/audit.mjs';

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

// ---------------------------------------------------------------------------

console.log('\nAN ENTRY READS AS A SENTENCE');
{
  ok('an enrolment',
    describe({ action: 'enrol', after: { name: 'Aroha Ngata' } })
      === 'added Aroha Ngata to the roll');

  ok('a change says which fields, not that something changed',
    describe({ action: 'update', subjectName: 'Aroha Ngata',
      before: { date_of_birth: '2011-08-04', first_name: 'Aroha' },
      after: { date_of_birth: '2011-08-05', first_name: 'Aroha' } })
      === "changed Aroha Ngata's date of birth",
    describe({ action: 'update', subjectName: 'Aroha Ngata',
      before: { date_of_birth: '2011-08-04' }, after: { date_of_birth: '2011-08-05' } }));

  ok('a save that changed nothing says so',
    describe({ action: 'update', subjectName: 'Doug',
      before: { a: 1 }, after: { a: 1 } }).includes('without changing it'));

  ok('a decline is not reported as an approval',
    describe({ action: 'article_publish_up', after: { title: 'Our view',
      publish_up_state: 'declined' } }) === 'declined "Our view"');
  ok('and an approval is',
    describe({ action: 'article_publish_up', after: { title: 'Our view',
      publish_up_state: 'approved' } }) === 'approved "Our view" for this site');

  ok('an upload names the file and its size',
    describe({ action: 'asset_upload',
      after: { filename: 'crest.png', width: 800, height: 600 } })
      === 'uploaded "crest.png" (800×600)');

  // An action nobody wrote a sentence for must still read as something.
  ok('an unknown action does not produce a blank line',
    describe({ action: 'something_new', after: {} }) === 'something new');

  ok('every listed action has a sentence',
    ACTIONS.every(([a]) => !describe({ action: a, after: {} }).includes('_')),
    ACTIONS.map(([a]) => describe({ action: a, after: {} })).join(' | '));

  ok('field names are readable, not column names',
    fieldsChanged({ date_of_birth: 1, display_number: 1 },
                  { date_of_birth: 2, display_number: 2 })
      .join(', ') === 'date of birth, member number');
}

await signIn('doug@example.nz');

console.log('\nTHE SCREEN SHOWS WHAT HAPPENED');
{
  const empty = await req('/o/moknz/history');
  ok('it renders', empty.status === 200);
  ok('and says an empty log means nothing happened, not nothing was kept',
    empty.html.includes('not that it was not kept'));
  ok('it states that the record cannot be edited',
    empty.html.replace(/\s+/g, ' ').includes('cannot be edited or deleted'));

  // Do some things worth recording.
  await req('/o/whanganui/members/new', { method: 'POST', form: {
    firstName: 'Tama', lastName: 'Rewiri', dateOfBirth: '1990-03-02',
    gender: 'm', role: 'member' } });

  const r = await req('/o/moknz/history');
  ok('the enrolment is listed', r.html.includes('Tama Rewiri'), 'not found');
  ok('with who did it', r.html.includes('Doug Holloway'));
  ok('and in words', r.html.includes('added Tama Rewiri to the roll'));
  ok('grouped under a date', /<h2>\d{4}-\d{2}-\d{2}<\/h2>/.test(r.html));
}

console.log('\nFILTERS');
{
  const byAction = await req('/o/moknz/history?action=enrol');
  ok('filtering by what happened works', byAction.status === 200
    && byAction.html.includes('added Tama Rewiri'));

  const other = await req('/o/moknz/history?action=asset_upload');
  ok('and excludes what does not match',
    !other.html.includes('added Tama Rewiri'));

  const nobody = await req(
    '/o/moknz/history?who=00000000-0000-0000-0000-000000000000');
  ok('filtering by a person with no entries is empty, not an error',
    nobody.status === 200 && !nobody.html.includes('added Tama Rewiri'));
}

console.log('\nA RECORD CARRIES ITS OWN HISTORY');
{
  const person = await one(
    `select id from person where first_name='Tama' and last_name='Rewiri'`);
  const p = await req(`/p/${person.id}`);
  ok('the person page shows changes to the record',
    p.html.includes('Changes to this record'));
  ok('naming who made them', p.html.includes('Doug Holloway'));

  // The grading history must still be there — `changes` and `history` are
  // different things and an earlier draft of this overwrote one with the other.
  const aroha = await one(`select id from person where first_name='Aroha'`);
  const a = await req(`/p/${aroha.id}`);
  ok('and the grading history is untouched',
    a.html.includes('Grading history') && a.html.includes('4th kyu'));
}

console.log('\nONE CLUB CANNOT READ ANOTHER\'S HISTORY');
{
  // Tane administers Wellington and nothing above it.
  await signIn('tane@example.nz');

  const theirs = await req('/o/moknz/history');
  ok('a club administrator cannot read the federation\'s history',
    theirs.status === 403, theirs.status);
  ok('and nothing leaked with the refusal',
    !theirs.html.includes('Tama Rewiri'));

  const other = await req('/o/whanganui/history');
  ok('nor another club\'s', other.status === 403, other.status);

  const mine = await req('/o/wellington/history');
  ok('but their own renders', mine.status === 200, mine.status);
  ok('without the other club\'s entries',
    !mine.html.includes('added Tama Rewiri'));
}

console.log('\nTHE LOG CANNOT BE TIDIED UP AFTERWARDS');
{
  const row = await one(`select id, action from audit_log order by id desc limit 1`);
  ok('there is something in it', !!row);

  let deleteFailed = null;
  try { await pool.query('delete from audit_log where id=$1', [row.id]); }
  catch (e) { deleteFailed = e; }
  ok('the application connection cannot delete an entry', !!deleteFailed);
  ok('and is told why', (deleteFailed?.message ?? '').includes('append-only'));

  let updateFailed = null;
  try {
    await pool.query(`update audit_log set action='nothing' where id=$1`, [row.id]);
  } catch (e) { updateFailed = e; }
  ok('nor change one', !!updateFailed);
  ok('with the same explanation',
    (updateFailed?.message ?? '').includes('append-only'));

  const after = await one(`select action from audit_log where id=$1`, [row.id]);
  ok('and the entry still says what it said', after?.action === row.action);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
