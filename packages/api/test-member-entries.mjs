/**
 * Members and parents entering events.
 *
 *   1. A member is offered what their own club and the federation have opened,
 *      and nothing else: not another club's, not closed, not a draft.
 *   2. A parent enters a child; the consent is signed by the guardian, and a
 *      young person cannot enter themselves where a guardian must sign.
 *   3. Nothing is saved until confirmed; the same rules the club's entry uses
 *      decide the division, the fee and who is eligible.
 *   4. The club sees the entry on its own list.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people, competition } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
const OUT = '/tmp/honbu-member-entries';
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
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`);
};
const build = async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await run(`HONBU_STORE=postgres OUT=${OUT} node packages/site/build.mjs`,
    { cwd: path.join(import.meta.dirname, '../..') });
};
const wh = await one(`select * from organisation where slug='whanganui'`);
const wellington = await one(`select * from organisation where slug='wellington'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, {
  organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });

const parent = await enrol('Pania', 'Parent', '1984-02-01', 'pania@example.nz');
const kid = await enrol('Kahu', 'Parent', '2015-05-05');
const other = await enrol('Tama', 'Stranger', '2014-01-01');
const teen = await enrol('Ana', 'Young', '2010-01-01', 'ana@example.nz');

const addEvent = async (org, over = {}) => one(`
  insert into event (organisation_id, kind, title, slug, starts_at, visibility, status,
    entries_open, entries_close, guardian_under, consent_version, consent_text)
  values ($1,$2,$3,$4, now() + interval '40 days', $5, $6,
    now() - interval '1 day', $7, $8, $9, $10) returning *`,
  [org.id, over.kind ?? 'grading', over.title, over.slug, over.visibility ?? 'public',
   over.status ?? 'published',
   over.close ?? new Date(Date.now() + 30 * 864e5).toISOString(),
   over.guardianUnder ?? 16, over.consent === null ? null : 'v1',
   over.consent === null ? null : 'I accept the risks of training.']);

const grading = await addEvent(wh, { title: 'Whanganui Grading', slug: 'wh-grading' });
const closed = await addEvent(wh, { title: 'Closed Grading', slug: 'wh-closed',
  close: new Date(Date.now() - 864e5).toISOString() });
const draft = await addEvent(wh, { title: 'Draft Grading', slug: 'wh-draft', status: 'draft' });
const training = await addEvent(wh, { title: 'Weekly Training', slug: 'wh-training', kind: 'training' });
const theirs = await addEvent(wellington, { title: 'Wellington Grading', slug: 'wl-grading' });
const theirsOwn = await addEvent(wellington, { title: 'Wellington Club Only', slug: 'wl-own',
  visibility: 'own_org' });
const tournament = await addEvent(wh, { title: 'Whanganui Open', slug: 'wh-open',
  kind: 'tournament', guardianUnder: 18 });

// Anybody may SEE this one; only a 1st dan and above may enter it.
const blackBelt = await addEvent(wh, { title: 'Whanganui Black Belt Day', slug: 'wh-black-belt', kind: 'seminar' });
await pool.query('update event set min_rank_order = 11 where id = $1', [blackBelt.id]);

const disc = await competition.addDiscipline(doug.id, tournament.id, { name: 'Kumite' });
await competition.addDivision(doug.id, disc.id, { label: 'Juniors under 40kg',
  minAge: 6, maxAge: 17, maxWeightKg: 40 });
await competition.setPrice(doug.id, tournament.id, { forCount: 1, amountCents: 3000 });

await signIn('doug@example.nz');
await req(`/p/${kid.id}/guardians`, { method: 'POST',
  form: { guardian_number: parent.display_number, relationship: 'parent' } });
for (const who of [parent, teen]) {
  const access = await req(`/p/${who.id}/access`, { method: 'POST',
    form: { role: 'member', email: who.email ?? `${who.first_name.toLowerCase()}@example.nz` } });
  who.link = access.html.match(/\/signin\/[A-Za-z0-9_-]+/)?.[0];
}
const asLink = async (url) => { delete jar.honbu_session; await req('/signin'); await req(url); };

const entries = (personId) => pool.query(`select * from event_entry where person_id=$1`, [personId])
  .then((r) => r.rows);

await asLink(parent.link);

console.log('\nWHAT A MEMBER IS OFFERED');
{
  const r = await req('/me/events');
  ok('the screen opens', r.status === 200, String(r.status));
  ok('her club\'s grading is offered', /Whanganui Grading/.test(r.html));
  ok('and the tournament', /Whanganui Open/.test(r.html));
  ok('one offer per person who could enter',
    (r.html.match(/Whanganui Grading/g) ?? []).length === 2);
  ok('not a closed one', !/Closed Grading/.test(r.html));
  ok('not a draft', !/Draft Grading/.test(r.html));
  ok('not a training session', !/Weekly Training/.test(r.html));
  ok('not another club\'s', !/Wellington Grading/.test(r.html));
  ok('nor another club\'s club-only event', !/Wellington Club Only/.test(r.html));
  ok('and not a black belt event to people who are not black belts, though it is public', !/Black Belt Day/.test(r.html));
}

console.log('\nA PARENT ENTERS A CHILD IN A GRADING');
{
  const form = await req(`/me/events/${grading.id}/${kid.id}`);
  ok('the form opens', form.status === 200 && /Kahu/.test(form.html));
  ok('with the declaration', /accept the risks/.test(form.html));

  const base = { };
  const unsigned = await req(`/me/events/${grading.id}/${kid.id}`, { method: 'POST', form: base });
  ok('unsigned is refused', unsigned.status === 422 && /declaration has not been agreed/.test(unsigned.html));
  ok('and nothing is saved', (await entries(kid.id)).length === 0);

  const signed = { accepted: '1', acceptedName: 'Pania Parent' };
  const preview = await req(`/me/events/${grading.id}/${kid.id}`, { method: 'POST', form: signed });
  ok('signed, she is shown a check page', preview.status === 200 && /Nothing is saved until you confirm/.test(preview.html));
  ok('which still has not saved anything', (await entries(kid.id)).length === 0);

  const done = await req(`/me/events/${grading.id}/${kid.id}`, { method: 'POST',
    form: { ...signed, confirm: 'yes' } });
  ok('confirming enters him', done.status === 302 && /done=/.test(done.location ?? ''), `${done.status} ${done.location}`);
  const [entry] = await entries(kid.id);
  ok('one entry', !!entry && entry.status === 'entered');
  const parentAccount = await one(`select id from account where email='pania@example.nz'`);
  ok('entered by her', entry.entered_by === parentAccount.id);
  ok('for his own club', entry.entered_for_org === wh.id);
  const consent = await one(`select * from entry_consent where entry_id=$1`, [entry.id]);
  ok('the consent is recorded against the version', consent?.version === 'v1');
  ok('signed by the guardian, as his parent', consent?.guardian?.relationship === 'parent'
    && consent.guardian.name === 'Pania Parent');

  const again = await req('/me/events');
  ok('and it now shows as entered, not offered', /Already entered/.test(again.html)
    && (again.html.match(/Whanganui Grading/g) ?? []).length === 2 /* offer for her + the entered list */);
  const twice = await req(`/me/events/${grading.id}/${kid.id}`, { method: 'POST',
    form: { ...signed, confirm: 'yes' } });
  ok('entering twice does not duplicate', (await entries(kid.id)).length === 1);
}

console.log('\nTHE TOURNAMENT USES THE SAME RULES AS A CLUB ENTRY');
{
  const f = { [`disc_${disc.id}`]: '1', accepted: '1', acceptedName: 'Pania Parent' };
  const none = await req(`/me/events/${tournament.id}/${kid.id}`, { method: 'POST',
    form: { accepted: '1', acceptedName: 'Pania Parent' } });
  ok('choosing nothing is refused', none.status === 422 && /Choose at least one/.test(none.html));

  const heavy = await req(`/me/events/${tournament.id}/${kid.id}`, { method: 'POST',
    form: { ...f, weight: '55' } });
  ok('too heavy for the only division is refused, with the reason',
    heavy.status === 422, String(heavy.status));
  ok('nothing saved', (await entries(kid.id)).length === 1);

  const good = await req(`/me/events/${tournament.id}/${kid.id}`, { method: 'POST',
    form: { ...f, weight: '32', height: '140' } });
  ok('the right weight reaches the check page', good.status === 200
    && /Juniors under 40kg/.test(good.html), String(good.status));
  ok('with the fee', /\$30\.00|30\.00/.test(good.html));
  const hidden = Object.fromEntries([...good.html.matchAll(/name="([^"]+)" value="([^"]*)"/g)]
    .filter(([, k]) => k !== '_csrf').map(([, k, v]) => [k, v]));
  const saved = await req(`/me/events/${tournament.id}/${kid.id}`, { method: 'POST', form: hidden });
  ok('confirming saves it', saved.status === 302, String(saved.status));
  const row = await one(`select * from event_entry where person_id=$1 and event_id=$2`, [kid.id, tournament.id]);
  ok('at the quoted fee', row?.amount_cents === 3000);
  const sel = await one(`select d.label from entry_selection s join event_division d on d.id=s.division_id
    where s.entry_id=$1`, [row.id]);
  ok('in the division the rules chose', sel?.label === 'Juniors under 40kg');
}

console.log('\nWHAT SHE MAY NOT DO');
{
  const refused = async (name, path, method = 'GET', form) => {
    const r = await req(path, { method, form });
    ok(name, [403, 404].includes(r.status), `${r.status}`);
    return r;
  };
  await refused('enter another family\'s child', `/me/events/${grading.id}/${other.id}`);
  const before = (await pool.query('select count(*)::int n from event_entry')).rows[0].n;
  await refused('and not by posting', `/me/events/${grading.id}/${other.id}`, 'POST',
    { accepted: '1', acceptedName: 'Pania Parent', confirm: 'yes' });
  ok('nothing was entered', (await pool.query('select count(*)::int n from event_entry')).rows[0].n === before);
  await refused('enter in another club\'s grading', `/me/events/${theirs.id}/${parent.id}`);
  await refused('enter in a closed event', `/me/events/${closed.id}/${parent.id}`);
  await refused('enter in a draft', `/me/events/${draft.id}/${parent.id}`);
  await refused('enter in a training session', `/me/events/${training.id}/${parent.id}`);
  await refused('use an id that is not one', `/me/events/nonsense/${parent.id}`);
}

console.log('\nA YOUNG PERSON CANNOT SIGN FOR THEMSELVES');
{
  await asLink(teen.link);
  const f = { [`disc_${disc.id}`]: '1', accepted: '1', acceptedName: 'Ana Young', weight: '38' };
  const r = await req(`/me/events/${tournament.id}/${teen.id}`, { method: 'POST', form: f });
  ok('refused, and told to ask a parent', r.status === 422 && /parent or guardian has to make this entry/.test(r.html),
    `${r.status}`);
  ok('nothing saved', (await entries(teen.id)).length === 0);
  const g = await req(`/me/events/${grading.id}/${teen.id}`, { method: 'POST',
    form: { accepted: '1', acceptedName: 'Ana Young', confirm: 'yes' } });
  ok('but they can enter where no guardian is needed', g.status === 302, String(g.status));
  ok('as themselves', (await entries(teen.id)).length === 1);
}

console.log('\nTHE CLUB SEES THE ENTRIES');
{
  await signIn('doug@example.nz');
  const r = await req(`/o/whanganui/events/wh-grading/entries`);
  ok('the entries list opens', r.status === 200, String(r.status));
  ok('and has the child on it', /Kahu/.test(r.html), 'not listed');
}

console.log('\nENDING THE LINK ENDS THE RIGHT TO ENTER');
{
  const id = (await one(`select id from guardian_link where child_id=$1 and ended_on is null`, [kid.id])).id;
  await req(`/p/${kid.id}/guardians/${id}/end`, { method: 'POST', form: {} });
  await asLink((await req(`/p/${parent.id}/access`, { method: 'POST',
    form: { role: 'member', email: 'pania@example.nz' } })).html.match(/\/signin\/[A-Za-z0-9_-]+/)?.[0]);
  const later = await addEvent(wh, { title: 'Later Grading', slug: 'wh-later' });
  const r = await req(`/me/events/${later.id}/${kid.id}`, { method: 'POST',
    form: { accepted: '1', acceptedName: 'Pania Parent', confirm: 'yes' } });
  ok('she cannot enter him in a later event', r.status === 403, String(r.status));
  ok('and the offer list no longer includes him', !/For Kahu/.test((await req('/me/events')).html));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
server.close();
process.exit(fail ? 1 : 0);
