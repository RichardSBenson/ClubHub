/** Push notifications on the server: subscribing, who is reached, dead devices forgotten, installability tags. */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import { pool, people, push, messages } from './data.mjs';
import { TestPush } from '../infrastructure/push/webpush.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) { const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jar[k]; else jar[k] = v; } };
async function req(p, { method = 'GET', form } = {}) {
  const headers = {}; if (cookie()) headers.cookie = cookie();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + p, { method, headers, redirect: 'manual', body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString() : undefined });
  keep(res); return { status: res.status, location: res.headers.get('location'), headers: res.headers, html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => { delete jar.honbu_session; await req('/signin'); const { token } = await auth.requestLink(email); await req(`/signin/${token}`); };

const wh = await one(`select * from organisation where slug='whanganui'`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob, email = null) => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob, email });
const login = async (person, email) => (await pool.query(`insert into account (email, person_id) values ($1,$2) on conflict (email) do update set person_id=excluded.person_id returning id`, [email, person.id])).rows[0].id;
const KEY = 'B'.repeat(87), AUTH = 'a'.repeat(22);
const sub = (n) => ({ endpoint: `https://push.example.net/s/${n}`, p256dh: KEY, auth: AUTH });

const ann = await enrol('Ann', 'Push', '1990-01-01', 'ann@example.nz'); const annAcc = await login(ann, 'ann@example.nz');
const kid = await enrol('Kid', 'Push', '2015-01-01'); 
const parent = await enrol('Pat', 'Parent', '1985-01-01', 'pat@example.nz'); const patAcc = await login(parent, 'pat@example.nz');
await pool.query(`insert into guardian_link (child_id, guardian_id, relationship) values ($1,$2,'parent')`, [kid.id, parent.id]).catch(() => {});
const stranger = await enrol('Sam', 'Stranger', '1980-01-01', 'sam@example.nz'); const samAcc = await login(stranger, 'sam@example.nz');

console.log('\nWHEN PUSH IS OFF');
await signIn('ann@example.nz');
{
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  let r = await req('/me/notifications');
  ok('the screen says it is not switched on', r.status === 200 && /not been switched on/.test(r.html) && !/push-on/.test(r.html));
  r = await req('/push/subscribe', { method: 'POST', form: sub(1) });
  ok('subscribing is refused', r.status === 422);
  ok('and nothing is sent', (await push.toPerson(ann.id, { title: 'x' })) === 0);
}

console.log('\nWHEN IT IS ON');
const { generateVapidKeys } = await import('../infrastructure/push/webpush.mjs');
const keys = generateVapidKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey; process.env.VAPID_SUBJECT = 'mailto:a@b.nz';
{
  let r = await req('/me/notifications');
  ok('the screen offers the button and carries the public key', /id="push-on"/.test(r.html) && r.html.includes(keys.publicKey) && /\/vendor\/push\.js/.test(r.html));
  r = await req('/push/subscribe', { method: 'POST', form: sub(1) });
  ok('a device is saved', r.status === 200 && (await one('select count(*)::int n from push_subscription where account_id=$1', [annAcc])).n === 1);
  r = await req('/push/subscribe', { method: 'POST', form: sub(1) });
  ok('the same device twice is still one', (await one('select count(*)::int n from push_subscription where account_id=$1', [annAcc])).n === 1);
  r = await req('/push/subscribe', { method: 'POST', form: { endpoint: 'http://insecure.example/x', p256dh: KEY, auth: AUTH } });
  ok('an insecure address is refused', r.status === 422);
  r = await req('/push/subscribe', { method: 'POST', form: { endpoint: 'https://push.example.net/y', p256dh: 'short', auth: AUTH } });
  ok('a bad key is refused', r.status === 422);
  for (let i = 2; i <= 13; i++) await req('/push/subscribe', { method: 'POST', form: sub(i) });
  ok('a person keeps at most ten devices', (await one('select count(*)::int n from push_subscription where account_id=$1', [annAcc])).n === 10);
  r = await req('/me/notifications');
  ok('they are listed', (r.html.match(/Remove/g) ?? []).length >= 10);
  const dev = await one('select id from push_subscription where account_id=$1 limit 1', [annAcc]);
  r = await req(`/me/notifications/${dev.id}/remove`, { method: 'POST', form: {} });
  ok('one can be removed', /done=/.test(r.location) && (await one('select count(*)::int n from push_subscription where account_id=$1', [annAcc])).n === 9);
  r = await req('/push/unsubscribe', { method: 'POST', form: { endpoint: sub(13).endpoint } });
  ok('a device can switch itself off', r.status === 200 && !(await one('select 1 x from push_subscription where endpoint=$1', [sub(13).endpoint])));
}
await signIn('sam@example.nz');
{
  const mine = await one('select id from push_subscription where account_id=$1 limit 1', [annAcc]);
  let r = await req(`/me/notifications/${mine.id}/remove`, { method: 'POST', form: {} });
  ok('nobody can remove somebody else\'s device', r.status === 404 && !!(await one('select 1 x from push_subscription where id=$1', [mine.id])));
  r = await req('/push/unsubscribe', { method: 'POST', form: { endpoint: (await one('select endpoint from push_subscription where account_id=$1 limit 1', [annAcc])).endpoint } });
  ok('nor unsubscribe it by its address', !!(await one('select 1 x from push_subscription where account_id=$1', [annAcc])));
  r = await req('/push/subscribe', { method: 'POST', form: sub(1) });
  ok('a device that signs in as somebody else moves with them', (await one('select account_id from push_subscription where endpoint=$1', [sub(1).endpoint])).account_id === samAcc);
}
await signIn('pat@example.nz');
await req('/push/subscribe', { method: 'POST', form: sub(50) });

console.log('\nWHO IS REACHED');
{
  const fake = new TestPush();
  let n = await push.toPerson(parent.id, { title: 'Hello', body: 'World', url: '/me' }, fake);
  ok('a person is reached on their own device', n === 1 && fake.sent[0].endpoint === sub(50).endpoint);
  fake.sent.length = 0;
  n = await push.toPerson(kid.id, { title: 'For the child' }, fake);
  ok('a child\'s notices go to their parent', n === 1 && fake.sent[0].endpoint === sub(50).endpoint);
  fake.sent.length = 0;
  n = await push.toPerson(stranger.id, { title: 'x' }, fake);
  ok('a stranger\'s devices are not touched by others\' news', fake.sent.every((s) => s.endpoint === sub(1).endpoint));
  fake.gone.add(sub(50).endpoint);
  await push.toPerson(parent.id, { title: 'x' }, fake);
  ok('a dead device is forgotten', !(await one('select 1 x from push_subscription where endpoint=$1', [sub(50).endpoint])));
  const failing = { send: async () => 'failed' };
  await push.toPerson(ann.id, { title: 'x' }, failing);
  ok('a failing device is counted, not deleted', (await one('select max(failures)::int f from push_subscription where account_id=$1', [annAcc])).f === 1);
  const throwing = { send: async () => { throw new Error('boom'); } };
  ok('a provider that throws does not break the caller', (await push.toPerson(ann.id, { title: 'x' }, throwing)) === 0);
}

console.log('\nTHE INSTALLABLE APP');
{
  const r = await req('/me/notifications');
  ok('app pages link the manifest, the colour and the registration script', /rel="manifest" href="\/manifest\.webmanifest"/.test(r.html) && /theme-color/.test(r.html) && /src="\/vendor\/pwa\.js"/.test(r.html));
  ok('with no inline script (the page policy forbids it)', !/<script(?![^>]*src=)/.test(r.html));
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
